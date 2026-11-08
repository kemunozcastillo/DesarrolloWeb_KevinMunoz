"""
Microservicio de clientes: la ficha de cada cliente (RUN, nombre, dirección,
comuna, contacto). Es dueño de esos datos personales; la contraseña y la
verificación del correo las guarda el Auth Service, nunca este servicio.

Rutas que llegan por el gateway:
  POST  /clientes/registro         registro desde el sitio (público)
  GET   /clientes/yo               ficha propia (cliente)
  PUT   /clientes/yo               editar ficha propia (cliente)
  GET   /clientes?q=               listado (admin)
  POST  /clientes                  registrar en el local, con clave temporal (admin)
  GET   /clientes/{id}             (admin)
  PUT   /clientes/{id}             (admin)
  PATCH /clientes/{id}/estado      activar o desactivar (admin)

Interna:
  GET /internos/clientes/{id}      datos para armar un pedido (pedidos)
"""

import re
import secrets
import uuid

from fastapi import APIRouter, Depends, Request
from pymongo.errors import DuplicateKeyError

from comun import internos as servicios
from comun.aplicacion import crear_app, request_id
from comun.config import ajustes
from comun.db import obtener_db
from comun.errores import ErrorApi, invalido, no_encontrado
from comun.seguridad import Identidad, requerir
from comun.tiempo import ahora_iso
from clientes.ficha import tiene_despacho, validar_ficha

publico = APIRouter(prefix="/clientes", tags=["Clientes"])
internos = APIRouter(prefix="/internos", tags=["Interno"])


def a_json(doc: dict, verificado: bool | None = None) -> dict:
    datos = {k: doc.get(k) for k in ("run", "nombre", "direccion", "region", "provincia", "comuna", "fechaNacimiento", "sexo", "email", "telefono", "activo", "origen", "creadoEn")}
    datos["id"] = doc["_id"]
    datos["tieneDespacho"] = tiene_despacho(doc["comuna"])
    if verificado is not None:
        datos["emailVerificado"] = verificado
    return datos


async def _unicos(db, ficha: dict, excepto: str | None = None) -> None:
    if await db["clientes"].find_one({"run": ficha["run"], "_id": {"$ne": excepto}}):
        raise ErrorApi(409, "DUPLICADO", "Ya existe un cliente con ese RUN.")
    if await db["clientes"].find_one({"email": ficha["email"], "_id": {"$ne": excepto}}):
        raise ErrorApi(409, "DUPLICADO", "Ese correo ya está registrado.")


def clave_temporal() -> str:
    letras = "abcdefghjkmnpqrstuvwxyz"
    return "".join(secrets.choice(letras) for _ in range(4)) + str(1000 + secrets.randbelow(9000))


async def _alta(db, request: Request, datos: dict, origen: str, clave: str) -> dict:
    """Crea la ficha y luego la cuenta en el Auth Service. Si la cuenta falla, se borra la ficha (compensación)."""
    ficha = validar_ficha(datos)
    await _unicos(db, ficha)

    doc = {"_id": f"cli_{uuid.uuid4().hex[:12]}", **ficha, "activo": True, "origen": origen, "creadoEn": ahora_iso()}
    try:
        await db["clientes"].insert_one(doc)
    except DuplicateKeyError:
        raise ErrorApi(409, "DUPLICADO", "Ya existe un cliente con ese RUN o correo.")

    try:
        cuenta = await servicios.llamar(
            "auth", "POST", "/cuentas",
            json={"email": ficha["email"], "clave": clave, "rol": "cliente", "nombre": ficha["nombre"], "sujetoId": doc["_id"]},
            request_id=request_id(request),
        )
    except ErrorApi:
        await db["clientes"].delete_one({"_id": doc["_id"]})
        raise

    return {"cliente": a_json(doc, verificado=False), "codigoDemo": (cuenta or {}).get("codigoDemo")}


@publico.post("/registro", status_code=201)
async def registro(datos: dict, request: Request, db=Depends(obtener_db)):
    clave = datos.get("clave")
    if not isinstance(clave, str):
        raise invalido("Escribe una contraseña.")
    return await _alta(db, request, datos, "WEB", clave)


@publico.get("/yo")
async def mi_ficha(db=Depends(obtener_db), yo: Identidad = Depends(requerir("cliente"))):
    doc = await db["clientes"].find_one({"_id": yo.sujeto})
    if not doc:
        raise no_encontrado("No encontramos tu ficha.")
    return a_json(doc)


async def _editar(db, request: Request, cliente_id: str, datos: dict) -> dict:
    actual = await db["clientes"].find_one({"_id": cliente_id})
    if not actual:
        raise no_encontrado("No existe ese cliente.")
    ficha = validar_ficha({**actual, **datos})
    await _unicos(db, ficha, excepto=cliente_id)

    codigo = None
    if ficha["email"] != actual["email"]:
        # El correo vive también en la cuenta: el Auth Service lo cambia y exige verificarlo de nuevo.
        respuesta = await servicios.llamar(
            "auth", "PATCH", f"/cuentas/sujeto/{cliente_id}", json={"email": ficha["email"]}, request_id=request_id(request)
        )
        codigo = (respuesta or {}).get("codigoDemo") or "enviado"

    if ficha["nombre"] != actual["nombre"] and ficha["email"] == actual["email"]:
        await servicios.llamar("auth", "PATCH", f"/cuentas/sujeto/{cliente_id}", json={"nombre": ficha["nombre"]}, request_id=request_id(request))

    await db["clientes"].update_one({"_id": cliente_id}, {"$set": {**ficha, "actualizadoEn": ahora_iso()}})
    doc = await db["clientes"].find_one({"_id": cliente_id})
    return {"cliente": a_json(doc), "codigoDemo": codigo, "cambioCorreo": codigo is not None}


@publico.put("/yo")
async def editar_mi_ficha(datos: dict, request: Request, db=Depends(obtener_db), yo: Identidad = Depends(requerir("cliente"))):
    # RUN y origen no los cambia el cliente.
    datos = {k: v for k, v in datos.items() if k not in ("run", "origen", "activo", "_id", "id")}
    return await _editar(db, request, yo.sujeto, datos)


@publico.get("")
async def listar(request: Request, q: str = "", db=Depends(obtener_db), _admin: Identidad = Depends(requerir("admin"))):
    filtro: dict = {}
    texto = q.strip()
    if texto:
        patron = re.compile(re.escape(texto), re.IGNORECASE)
        run = re.sub(r"[.\-\s]", "", texto)
        filtro["$or"] = [{"nombre": patron}, {"email": patron}] + ([{"run": re.compile(re.escape(run[:-1]))}] if len(run) > 3 else [])
    docs = [d async for d in db["clientes"].find(filtro).sort("nombre", 1).limit(500)]

    # Si el correo está verificado lo sabe el Auth Service: una sola consulta para toda la lista.
    try:
        estados = await servicios.llamar("auth", "GET", "/cuentas/verificacion", params={"rol": "cliente"}, request_id=request_id(request))
    except ErrorApi:
        estados = {}
    return [a_json(d, verificado=(estados or {}).get(d["_id"])) for d in docs]


@publico.post("", status_code=201)
async def alta_en_local(datos: dict, request: Request, db=Depends(obtener_db), _admin: Identidad = Depends(requerir("admin"))):
    clave = clave_temporal()
    resultado = await _alta(db, request, datos, "ADMIN", clave)
    # La clave temporal se entrega una sola vez. Fuera del modo demo, se
    # enviaría por correo y no volvería en la respuesta.
    resultado["claveTemporal"] = clave if ajustes().modo_demo else None
    return resultado


@publico.get("/{cliente_id}")
async def obtener(cliente_id: str, db=Depends(obtener_db), _admin: Identidad = Depends(requerir("admin"))):
    doc = await db["clientes"].find_one({"_id": cliente_id})
    if not doc:
        raise no_encontrado("No existe ese cliente.")
    return a_json(doc)


@publico.put("/{cliente_id}")
async def editar(cliente_id: str, datos: dict, request: Request, db=Depends(obtener_db), _admin: Identidad = Depends(requerir("admin"))):
    datos = {k: v for k, v in datos.items() if k not in ("origen", "activo", "_id", "id")}
    return await _editar(db, request, cliente_id, datos)


@publico.patch("/{cliente_id}/estado")
async def cambiar_estado(cliente_id: str, datos: dict, request: Request, db=Depends(obtener_db), _admin: Identidad = Depends(requerir("admin"))):
    activo = datos.get("activo")
    if not isinstance(activo, bool):
        raise invalido("Indica si el cliente queda activo o inactivo.")
    if not await db["clientes"].find_one({"_id": cliente_id}):
        raise no_encontrado("No existe ese cliente.")
    # Primero la cuenta: desactivarla cierra sus sesiones en el Auth Service.
    await servicios.llamar("auth", "PATCH", f"/cuentas/sujeto/{cliente_id}", json={"activo": activo}, request_id=request_id(request))
    await db["clientes"].update_one({"_id": cliente_id}, {"$set": {"activo": activo, "actualizadoEn": ahora_iso()}})
    return a_json(await db["clientes"].find_one({"_id": cliente_id}))


@internos.get("/clientes/{cliente_id}")
async def para_pedido(cliente_id: str, db=Depends(obtener_db)):
    doc = await db["clientes"].find_one({"_id": cliente_id})
    if not doc:
        raise no_encontrado("No existe ese cliente.")
    return a_json(doc)


async def preparar(app) -> None:
    db = app.state.db
    await db["clientes"].create_index("run", unique=True)
    await db["clientes"].create_index("email", unique=True)
    await db["clientes"].create_index("nombre")


def crear_aplicacion():
    return crear_app("clientes", "Poke Fresh: clientes", [publico, internos], al_iniciar=preparar)


app = crear_aplicacion()
