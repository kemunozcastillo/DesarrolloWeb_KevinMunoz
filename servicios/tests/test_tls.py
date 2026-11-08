"""
TLS hacia Mongo: la URI base lleva tls=true&tlsCAFile=..., y al agregar las
credenciales de Vault no debe perderse (si se pierde, la conexión falla o,
peor, queda sin cifrar).
"""

from comun import db, vault
from comun.config import ajustes

RUTA = "poke-fresh/mongo/inventario"
URI_TLS = "mongodb://mongo:27017/?tls=true&tlsCAFile=/run/tls/ca.pem"


async def test_la_uri_con_credenciales_conserva_las_opciones_de_tls(monkeypatch):
    monkeypatch.setenv("MONGO_URI", URI_TLS)
    monkeypatch.setenv("MONGO_RUTA_VAULT", RUTA)
    monkeypatch.setenv("MONGO_DB", "pf_inventario")
    ajustes.cache_clear()
    vault.usar_valores_fijos({RUTA: {"usuario": "pf_inventario", "clave": "una clave/rara"}})
    try:
        uri = await db._uri_con_credenciales()
    finally:
        vault.usar_valores_fijos(None)
        ajustes.cache_clear()

    assert uri.startswith("mongodb://pf_inventario:una+clave%2Frara@mongo:27017/pf_inventario?")
    assert "authSource=pf_inventario" in uri
    assert "tls=true" in uri and "tlsCAFile=/run/tls/ca.pem" in uri


async def test_sin_tls_la_uri_sigue_igual_que_antes(monkeypatch):
    monkeypatch.setenv("MONGO_URI", "mongodb://127.0.0.1:27017")
    monkeypatch.setenv("MONGO_RUTA_VAULT", RUTA)
    monkeypatch.setenv("MONGO_DB", "pf_inventario")
    ajustes.cache_clear()
    vault.usar_valores_fijos({RUTA: {"usuario": "u", "clave": "c"}})
    try:
        uri = await db._uri_con_credenciales()
    finally:
        vault.usar_valores_fijos(None)
        ajustes.cache_clear()

    assert uri == "mongodb://u:c@127.0.0.1:27017/pf_inventario?authSource=pf_inventario"
