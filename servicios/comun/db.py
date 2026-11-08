"""
Conexión a MongoDB. Cada servicio usa su propia base (pf_inventario,
pf_pedidos, ...) con su propio usuario, que solo tiene permiso de lectura y
escritura en esa base. Así un servicio no puede leer ni modificar los datos
de otro aunque quisiera: si necesita algo, lo pide por la API del dueño.
"""

from urllib.parse import quote_plus, urlsplit, urlunsplit

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ReturnDocument

from comun import vault
from comun.config import ajustes

from fastapi import Request


async def _uri_con_credenciales() -> str:
    a = ajustes()
    if not a.mongo_ruta_vault:
        return a.mongo_uri
    datos = await vault.leer_secreto(a.mongo_ruta_vault)
    partes = urlsplit(a.mongo_uri)
    netloc = f"{quote_plus(datos['usuario'])}:{quote_plus(datos['clave'])}@{partes.hostname}"
    if partes.port:
        netloc += f":{partes.port}"
    # Se conserva lo que traiga la URI base (por ejemplo tls=true&tlsCAFile=...).
    consulta = "&".join(filter(None, [f"authSource={a.mongo_db}", partes.query]))
    return urlunsplit((partes.scheme, netloc, f"/{a.mongo_db}", consulta, ""))


async def conectar() -> tuple[AsyncIOMotorClient, AsyncIOMotorDatabase]:
    cliente = AsyncIOMotorClient(await _uri_con_credenciales(), serverSelectionTimeoutMS=5000)
    return cliente, cliente[ajustes().mongo_db]


def obtener_db(request: Request) -> AsyncIOMotorDatabase:
    """Dependencia de FastAPI. Cada app guarda su base en app.state (las pruebas ponen una en memoria)."""
    base = getattr(request.app.state, "db", None)
    if base is None:
        raise RuntimeError("La base de datos no está conectada.")
    return base


async def siguiente(db, nombre: str) -> int:
    """Correlativo atómico (pedidos, ventas, boletas): $inc no repite números aunque lleguen dos a la vez."""
    doc = await db["contadores"].find_one_and_update(
        {"_id": nombre}, {"$inc": {"valor": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return doc["valor"]
