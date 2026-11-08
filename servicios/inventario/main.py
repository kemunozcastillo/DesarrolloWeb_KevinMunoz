"""
Microservicio de inventario: catálogo, precios, reglas de armado y stock.

Es el único dueño de los productos y de su stock. Pedidos le pide cotizar un
carrito y reservar stock; no puede tocar la colección de productos.

Rutas que llegan por el gateway:
  GET    /items                    catálogo (público; el stock solo lo ve el personal)
  GET    /items/{id}
  GET    /configuracion            tamaños, reglas de armado y promociones
  POST   /items                    admin, dueño
  PUT    /items/{id}               admin, dueño
  DELETE /items/{id}               solo admin

Rutas internas (el gateway no las publica):
  POST /internos/cotizar                 precio de un carrito, calculado aquí
  POST /internos/reservas                descuenta stock de un pedido (idempotente)
  POST /internos/reservas/{id}/liberar   devuelve el stock de un pedido anulado (idempotente)
"""

import re
import unicodedata

from fastapi import APIRouter, Depends, Query, Request
from pymongo.errors import DuplicateKeyError

from comun.aplicacion import crear_app
from comun.db import obtener_db
from comun.errores import ErrorApi, invalido, no_encontrado
from comun.seguridad import Identidad, identidad_opcional, requerir
from comun.tiempo import ahora_iso
from inventario.reglas import CATEGORIAS, PROMOS, REGLAS, TAMANOS, Cotizador, documentos_iniciales, vendible

PREFIJOS = {"BASE": "base", "PROTEINA": "pro", "SALSA": "sal", "TOPPING": "top", "BEBIDA": "beb", "PROMOCION": "promo"}

publico = APIRouter(tags=["Catálogo"])
internos = APIRouter(prefix="/internos", tags=["Interno"])


def a_json(doc: dict, identidad: Identidad | None) -> dict:
    item = {
        "id": doc["_id"],
        "categoria": doc["categoria"],
        "nombre": doc["nombre"],
        "descripcion": doc["descripcion"],
        "precio": doc["precio"],
        "disponible": vendible(doc),
    }
    # El stock y la disponibilidad configurada son datos internos: solo los ve quien administra el catálogo.
    if identidad and identidad.rol in ("admin", "dueno"):
        item["stock"] = doc.get("stock")
        item["activo"] = bool(doc.get("disponible"))
    return item


async def catalogo_completo(db) -> dict[str, dict]:
    return {d["_id"]: d async for d in db["items"].find({})}


def slug(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", sin_tildes.lower()).strip("_")


def validar_item(datos: dict) -> dict:
    nombre = str(datos.get("nombre") or "").strip()
    descripcion = str(datos.get("descripcion") or "").strip()
    categoria = datos.get("categoria")
    precio = datos.get("precio")
    stock = datos.get("stock")

    if not 2 <= len(nombre) <= 80:
        raise invalido("El nombre debe tener entre 2 y 80 caracteres.")
    if not 2 <= len(descripcion) <= 200:
        raise invalido("La descripción debe tener entre 2 y 200 caracteres.")
    if categoria not in CATEGORIAS:
        raise invalido("La categoría no es válida.")
    if not isinstance(precio, int) or isinstance(precio, bool) or not 0 <= precio <= 100000:
        raise invalido("El precio debe ser un entero entre 0 y 100.000.")
    if stock is not None and (not isinstance(stock, int) or isinstance(stock, bool) or not 0 <= stock <= 100000):
        raise invalido("El stock debe ser un entero entre 0 y 100.000, o vacío si no se controla.")

    return {
        "nombre": nombre,
        "descripcion": descripcion,
        "categoria": categoria,
        # Las bases tienen precio fijo: su precio individual no se usa.
        "precio": 0 if categoria == "BASE" else precio,
        "disponible": bool(datos.get("disponible", True)),
        "stock": stock,
    }


# ---------------------------------------------------------------------------
# Catálogo
# ---------------------------------------------------------------------------


@publico.get("/items")
async def listar(
    categoria: str | None = None,
    ids: str | None = Query(default=None, description="Lista separada por comas, para consultas en lote"),
    db=Depends(obtener_db),
    identidad: Identidad | None = Depends(identidad_opcional),
):
    filtro: dict = {}
    if categoria:
        if categoria not in CATEGORIAS:
            raise invalido("La categoría no es válida.")
        filtro["categoria"] = categoria
    if ids:
        lista = [i for i in ids.split(",") if i][:100]
        filtro["_id"] = {"$in": lista}
    orden = {c: i for i, c in enumerate(CATEGORIAS)}
    docs = [d async for d in db["items"].find(filtro)]
    docs.sort(key=lambda d: (orden[d["categoria"]], d["nombre"]))
    return [a_json(d, identidad) for d in docs]


@publico.get("/items/{item_id}")
async def obtener(item_id: str, db=Depends(obtener_db), identidad: Identidad | None = Depends(identidad_opcional)):
    doc = await db["items"].find_one({"_id": item_id})
    if not doc:
        raise no_encontrado(f"No existe el item {item_id}.")
    return a_json(doc, identidad)


@publico.get("/configuracion")
async def configuracion():
    return {"tamanos": TAMANOS, "reglas": REGLAS, "promos": PROMOS}


async def _nombre_libre(db, nombre: str, excepto: str | None = None) -> None:
    patron = re.compile(f"^{re.escape(nombre)}$", re.IGNORECASE)
    repetido = await db["items"].find_one({"nombre": patron, "_id": {"$ne": excepto}})
    if repetido:
        raise ErrorApi(409, "DUPLICADO", f'Ya existe un item llamado "{repetido["nombre"]}".')


@publico.post("/items", status_code=201)
async def crear_item(datos: dict, db=Depends(obtener_db), identidad: Identidad = Depends(requerir("admin", "dueno"))):
    limpio = validar_item(datos)
    await _nombre_libre(db, limpio["nombre"])

    base = f"{PREFIJOS[limpio['categoria']]}_{slug(limpio['nombre'])}"
    id_, n = base, 2
    while await db["items"].find_one({"_id": id_}):
        id_, n = f"{base}_{n}", n + 1

    doc = {"_id": id_, **limpio, "actualizadoEn": ahora_iso()}
    try:
        await db["items"].insert_one(doc)
    except DuplicateKeyError:
        raise ErrorApi(409, "DUPLICADO", "Ya existe un item con ese nombre.")
    return a_json(doc, identidad)


@publico.put("/items/{item_id}")
async def actualizar_item(item_id: str, datos: dict, db=Depends(obtener_db), identidad: Identidad = Depends(requerir("admin", "dueno"))):
    actual = await db["items"].find_one({"_id": item_id})
    if not actual:
        raise no_encontrado(f"No existe el item {item_id}.")
    limpio = validar_item({**actual, **datos})
    await _nombre_libre(db, limpio["nombre"], excepto=item_id)
    await db["items"].update_one({"_id": item_id}, {"$set": {**limpio, "actualizadoEn": ahora_iso()}})
    return a_json(await db["items"].find_one({"_id": item_id}), identidad)


@publico.delete("/items/{item_id}", status_code=204)
async def eliminar_item(item_id: str, db=Depends(obtener_db), _identidad: Identidad = Depends(requerir("admin"))):
    resultado = await db["items"].delete_one({"_id": item_id})
    if resultado.deleted_count == 0:
        raise no_encontrado(f"No existe el item {item_id}.")


# ---------------------------------------------------------------------------
# Internos: cotización y reservas de stock
# ---------------------------------------------------------------------------


@internos.post("/cotizar")
async def cotizar(datos: dict, db=Depends(obtener_db)):
    return Cotizador(await catalogo_completo(db)).lineas(datos.get("lineas"))


@internos.post("/reservas")
async def reservar(datos: dict, db=Depends(obtener_db)):
    """
    Descuenta el stock de un pedido. Es idempotente: si la reserva de ese
    pedido ya existe, no vuelve a descontar.

    Mongo sin réplica no tiene transacciones entre documentos, así que se
    descuenta ítem por ítem con una condición (stock >= cantidad) y, si uno
    falla, se devuelve lo ya descontado.
    """
    pedido_id = datos.get("pedidoId")
    consumo = datos.get("consumo") or []
    if not pedido_id or not isinstance(consumo, list):
        raise invalido("Faltan el pedido o el consumo.")

    existente = await db["reservas"].find_one({"_id": pedido_id})
    if existente:
        return {"pedidoId": pedido_id, "estado": existente["estado"], "repetida": True}

    descontados = []
    for linea in consumo:
        item_id, cantidad = linea.get("itemId"), int(linea.get("cantidad", 0))
        item = await db["items"].find_one({"_id": item_id})
        if not item:
            await _devolver(db, descontados)
            raise no_encontrado(f"No existe el item {item_id}.")
        if item.get("stock") is None:
            continue
        r = await db["items"].update_one({"_id": item_id, "stock": {"$gte": cantidad}}, {"$inc": {"stock": -cantidad}})
        if r.modified_count == 0:
            await _devolver(db, descontados)
            raise ErrorApi(409, "SIN_STOCK", f'Se acabó "{item["nombre"]}" mientras confirmabas. Quita ese producto o elige otro.')
        descontados.append({"itemId": item_id, "cantidad": cantidad})

    await db["reservas"].insert_one({"_id": pedido_id, "estado": "ACTIVA", "lineas": descontados, "creadaEn": ahora_iso()})
    return {"pedidoId": pedido_id, "estado": "ACTIVA", "repetida": False}


async def _devolver(db, lineas: list[dict]) -> None:
    for l in lineas:
        await db["items"].update_one({"_id": l["itemId"], "stock": {"$ne": None}}, {"$inc": {"stock": l["cantidad"]}})


@internos.post("/reservas/{pedido_id}/liberar")
async def liberar(pedido_id: str, db=Depends(obtener_db)):
    """Devuelve el stock de un pedido anulado. Solo la primera llamada devuelve; las siguientes no hacen nada."""
    reserva = await db["reservas"].find_one_and_update(
        {"_id": pedido_id, "estado": "ACTIVA"}, {"$set": {"estado": "LIBERADA", "liberadaEn": ahora_iso()}}
    )
    if reserva:
        await _devolver(db, reserva["lineas"])
        return {"pedidoId": pedido_id, "estado": "LIBERADA", "repetida": False}
    return {"pedidoId": pedido_id, "estado": "LIBERADA", "repetida": True}


async def preparar(app) -> None:
    db = app.state.db
    await db["items"].create_index("categoria")
    # Carga el catálogo inicial solo si la base está vacía.
    if await db["items"].count_documents({}) == 0:
        await db["items"].insert_many(documentos_iniciales(ahora_iso()))


def crear_aplicacion():
    return crear_app("inventario", "Poke Fresh: inventario", [publico, internos], al_iniciar=preparar)


app = crear_aplicacion()
