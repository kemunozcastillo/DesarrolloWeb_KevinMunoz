"""
Microservicio de pagos: integración con la pasarela (Servipag), idempotencia
y devoluciones.

  POST /pagos                    el cliente inicia el pago de su pedido (exige Idempotency-Key)
  GET  /pagos?pedidoId=          pagos de un pedido (dueño del pedido o personal)
  POST /pagos/notificacion       aviso de la pasarela, firmado con HMAC (sin sesión)

Interna:
  POST /internos/devoluciones    pedidos lo llama al anular un pedido pagado

Reglas que evitan cobros mal hechos:
  - el monto sale del pedido (calculado por el backend), nunca del navegador;
  - la misma Idempotency-Key devuelve el mismo pago: un doble clic no cobra dos veces;
  - solo se acepta una notificación con la firma correcta de la pasarela, para
    el mismo token y el mismo monto; una notificación repetida no hace nada;
  - un pedido tiene a lo sumo un pago aprobado.
"""

import hashlib
import hmac
import json
import uuid

from fastapi import APIRouter, Depends, Header, Request

from comun import internos as servicios
from comun import vault
from comun.aplicacion import crear_app, request_id
from comun.config import ajustes
from comun.db import obtener_db
from comun.errores import ErrorApi, conflicto, invalido, no_encontrado
from comun.seguridad import Identidad, requerir
from comun.tiempo import ahora_iso

RUTA_COMERCIO = "poke-fresh/pasarela/comercio"

publico = APIRouter(prefix="/pagos", tags=["Pagos"])
webhook = APIRouter(prefix="/pagos", tags=["Pasarela"])
internos = APIRouter(prefix="/internos", tags=["Interno"])


def vista(pago: dict) -> dict:
    # El token de la pasarela y la clave de idempotencia no salen del servicio.
    return {
        "id": pago["_id"],
        "pedidoId": pago["pedidoId"],
        "monto": pago["monto"],
        "medio": pago["medio"],
        "estado": pago["estado"],
        "referencia": pago.get("referencia"),
        "creadoEn": pago["creadoEn"],
        "actualizadoEn": pago.get("actualizadoEn"),
        "urlPago": pago.get("urlPago") if pago["estado"] == "PENDIENTE" else None,
    }


def firmar(cuerpo: bytes, secreto: str) -> str:
    return hmac.new(secreto.encode(), cuerpo, hashlib.sha256).hexdigest()


@publico.post("", status_code=201)
async def iniciar(
    datos: dict,
    request: Request,
    db=Depends(obtener_db),
    yo: Identidad = Depends(requerir("cliente")),
    clave: str | None = Header(default=None, alias="Idempotency-Key"),
):
    if not clave or not 8 <= len(clave) <= 100:
        raise invalido("Falta la cabecera Idempotency-Key (entre 8 y 100 caracteres).", "SIN_IDEMPOTENCIA")

    previo = await db["pagos"].find_one({"idempotencia": f"{yo.sujeto}:{clave}"})
    if previo:
        return vista(previo)

    pedido_id = str(datos.get("pedidoId") or "")
    if not pedido_id:
        raise invalido("Indica qué pedido quieres pagar.")

    # El servicio de pedidos decide si este cliente puede ver el pedido (si es ajeno responde 404).
    rid = request_id(request)
    pedido = await servicios.llamar("pedidos", "GET", f"/pedidos/{pedido_id}", identidad=yo, request_id=rid)
    if pedido["estado"] != "PENDIENTE_PAGO":
        raise conflicto("Este pedido ya no espera pago.", "ESTADO")

    # Si ya hay un pago pendiente para el pedido, se reutiliza en vez de abrir otro.
    pendiente = await db["pagos"].find_one({"pedidoId": pedido_id, "estado": "PENDIENTE"})
    if pendiente:
        return vista(pendiente)

    pago_id = f"PAG-{uuid.uuid4().hex[:12].upper()}"
    monto = pedido["total"]  # el monto lo fija el backend
    comercio = await vault.leer_secreto(RUTA_COMERCIO)
    transaccion = await _pasarela_crear(comercio, pago_id, monto, pedido_id)

    pago = {
        "_id": pago_id,
        "pedidoId": pedido_id,
        "clienteId": yo.sujeto,
        "monto": monto,
        "medio": "SERVIPAG",
        "estado": "PENDIENTE",
        "token": transaccion["token"],
        "urlPago": transaccion["urlPago"],
        "idempotencia": f"{yo.sujeto}:{clave}",
        "creadoEn": ahora_iso(),
        "eventos": [{"tipo": "CREADO", "fecha": ahora_iso()}],
    }
    await db["pagos"].insert_one(pago)
    return vista(pago)


async def _pasarela_crear(comercio: dict, pago_id: str, monto: int, pedido_id: str) -> dict:
    import httpx

    a = ajustes()
    cuerpo = {
        "orden": pago_id,
        "monto": monto,
        "glosa": f"Poke Fresh, pedido {pedido_id}",
        "urlRetorno": f"{a.url_publica}/#/orden/{pedido_id}",
        "urlNotificacion": a.url_notificacion_pagos or f"{a.url_publica}/api/v1/pagos/notificacion",
    }
    try:
        async with httpx.AsyncClient(base_url=a.urls["pasarela"], timeout=5, transport=servicios.transportes.get("pasarela")) as cliente:
            r = await cliente.post("/api/transacciones", json=cuerpo, headers={"X-Api-Key": comercio["api_key"]})
    except httpx.HTTPError:
        raise ErrorApi(502, "PASARELA_NO_DISPONIBLE", "La plataforma de pago no está disponible. Intenta en unos minutos.")
    if r.status_code != 201:
        raise ErrorApi(502, "PASARELA_RECHAZO", "La plataforma de pago rechazó la transacción.")
    return r.json()


@publico.get("")
async def listar(pedidoId: str, request: Request, db=Depends(obtener_db), yo: Identidad = Depends(requerir("cliente", "admin", "dueno"))):
    # Se pregunta a pedidos si quien consulta puede ver ese pedido.
    await servicios.llamar("pedidos", "GET", f"/pedidos/{pedidoId}", identidad=yo, request_id=request_id(request))
    return [vista(p) async for p in db["pagos"].find({"pedidoId": pedidoId}).sort("creadoEn", 1)]


@webhook.post("/notificacion")
async def notificacion(request: Request, db=Depends(obtener_db), firma: str | None = Header(default=None, alias="X-Firma")):
    """
    La pasarela avisa el resultado. Se verifica la firma HMAC-SHA256 del
    cuerpo con el secreto compartido (en Vault): un aviso inventado o
    alterado por el navegador no tiene la firma correcta y se rechaza.
    """
    cuerpo = await request.body()
    comercio = await vault.leer_secreto(RUTA_COMERCIO)
    if not firma or not hmac.compare_digest(firma, firmar(cuerpo, comercio["secreto_firma"])):
        raise ErrorApi(401, "FIRMA_INVALIDA", "Notificación sin firma válida.")

    try:
        aviso = json.loads(cuerpo)
    except ValueError:
        raise invalido("Notificación mal formada.")

    pago = await db["pagos"].find_one({"_id": aviso.get("orden"), "token": aviso.get("token")})
    if not pago:
        raise no_encontrado("No existe ese pago.")
    if aviso.get("monto") != pago["monto"]:
        raise conflicto("El monto notificado no coincide con el del pago.", "MONTO_DISTINTO")

    resultado = aviso.get("estado")
    if resultado not in ("APROBADO", "RECHAZADO"):
        raise invalido("Estado de pago desconocido.")

    if pago["estado"] != "PENDIENTE":
        # Aviso repetido. Si el pago estaba aprobado pero pedidos no alcanzó a enterarse, se reintenta.
        if pago["estado"] == "APROBADO" and not pago.get("pedidoNotificado"):
            await _avisar_pedido(db, pago, request_id(request))
        return {"ok": True, "repetido": True}

    ahora = ahora_iso()
    r = await db["pagos"].update_one(
        {"_id": pago["_id"], "estado": "PENDIENTE"},
        {
            "$set": {"estado": resultado, "referencia": aviso.get("referencia"), "actualizadoEn": ahora, "pedidoNotificado": False},
            "$push": {"eventos": {"tipo": resultado, "fecha": ahora}},
        },
    )
    if r.modified_count == 0:
        return {"ok": True, "repetido": True}

    if resultado == "APROBADO":
        pago = await db["pagos"].find_one({"_id": pago["_id"]})
        await _avisar_pedido(db, pago, request_id(request))
    return {"ok": True, "repetido": False}


async def _avisar_pedido(db, pago: dict, rid: str | None) -> None:
    """Si pedidos no responde, la pasarela recibe un 502 y reintenta: el aviso se procesa de nuevo."""
    await servicios.llamar(
        "pedidos", "POST", f"/internos/pedidos/{pago['pedidoId']}/pago-confirmado",
        json={"pagoId": pago["_id"], "referencia": pago.get("referencia"), "monto": pago["monto"]},
        request_id=rid,
    )
    await db["pagos"].update_one({"_id": pago["_id"]}, {"$set": {"pedidoNotificado": True}})


@internos.post("/devoluciones")
async def devolver(datos: dict, request: Request, db=Depends(obtener_db)):
    """Devuelve el pago aprobado de un pedido. Idempotente."""
    pedido_id = datos.get("pedidoId")
    pago = await db["pagos"].find_one({"pedidoId": pedido_id, "estado": {"$in": ["APROBADO", "DEVUELTO"]}})
    if not pago:
        raise no_encontrado("Ese pedido no tiene un pago aprobado.")
    if pago["estado"] == "DEVUELTO":
        return {"pagoId": pago["_id"], "estado": "DEVUELTO", "repetido": True}

    comercio = await vault.leer_secreto(RUTA_COMERCIO)
    import httpx

    try:
        async with httpx.AsyncClient(base_url=ajustes().urls["pasarela"], timeout=5, transport=servicios.transportes.get("pasarela")) as cliente:
            r = await cliente.post("/api/devoluciones", json={"token": pago["token"], "monto": pago["monto"]}, headers={"X-Api-Key": comercio["api_key"]})
    except httpx.HTTPError:
        raise ErrorApi(502, "PASARELA_NO_DISPONIBLE", "La plataforma de pago no responde: no se pudo devolver el pago.")
    if r.status_code != 200:
        raise ErrorApi(502, "PASARELA_RECHAZO", "La plataforma de pago rechazó la devolución.")

    ahora = ahora_iso()
    await db["pagos"].update_one(
        {"_id": pago["_id"], "estado": "APROBADO"},
        {"$set": {"estado": "DEVUELTO", "actualizadoEn": ahora}, "$push": {"eventos": {"tipo": "DEVUELTO", "fecha": ahora, "motivo": datos.get("motivo", "")}}},
    )
    return {"pagoId": pago["_id"], "estado": "DEVUELTO", "repetido": False}


@internos.get("/pagos")
async def por_pedidos(ids: str, db=Depends(obtener_db)):
    """Consulta en lote para el GraphQL Gateway (evita una llamada por pedido)."""
    lista = [i for i in ids.split(",") if i][:200]
    return [vista(p) async for p in db["pagos"].find({"pedidoId": {"$in": lista}}).sort("creadoEn", 1)]


async def preparar(app) -> None:
    db = app.state.db
    await db["pagos"].create_index("idempotencia", unique=True)
    await db["pagos"].create_index("pedidoId")
    await db["pagos"].create_index("token", unique=True)


def crear_aplicacion():
    # La notificación no exige sesión de usuario, pero sí llega por el gateway
    # (con la credencial interna): nadie puede llamarla directo en la red privada.
    return crear_app("pagos", "Poke Fresh: pagos", [publico, webhook, internos], al_iniciar=preparar)


app = crear_aplicacion()
