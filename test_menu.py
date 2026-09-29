"""
Tests del CRUD. Usan `mongomock_motor`, una base en memoria con la misma API
de motor, así que corren sin levantar Mongo ni ensuciar datos reales.
"""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

import httpx

from app import database, seguridad
from app.main import app

CLAVE_PRUEBA = "credencial-de-prueba"

ITEM = {
    "nombre": "Salmón fresco",
    "descripcion": "Cortado en cubos, marinado suave",
    "categoria": "PROTEINA",
    "precio": 0,
    "disponible": True,
}


def vault_simulado(respuesta: httpx.Response | Exception):
    """Transporte que responde como Vault, o que falla como si estuviera caído."""

    def manejar(request: httpx.Request) -> httpx.Response:
        if isinstance(respuesta, Exception):
            raise respuesta
        return respuesta

    return httpx.MockTransport(manejar)


def secreto_en_vault(valor: str) -> httpx.Response:
    return httpx.Response(200, json={"data": {"data": {"credencial_interna": valor}}})


@pytest_asyncio.fixture(autouse=True)
async def vault_con_credencial(monkeypatch):
    """Por defecto, Vault responde con la credencial de prueba."""
    seguridad.limpiar_cache()
    monkeypatch.setattr(seguridad, "_transporte", vault_simulado(secreto_en_vault(CLAVE_PRUEBA)))
    yield
    seguridad.limpiar_cache()


@pytest_asyncio.fixture
async def base_falsa():
    database.usar_base_datos(AsyncMongoMockClient()["test"])


@pytest_asyncio.fixture
async def cliente(base_falsa):
    """Cliente que llega como lo haría el gateway: con la credencial interna."""
    transporte = ASGITransport(app=app)
    async with AsyncClient(transport=transporte, base_url="http://test", headers={seguridad.CABECERA_INTERNA: CLAVE_PRUEBA}) as c:
        yield c


@pytest_asyncio.fixture
async def cliente_directo(base_falsa):
    """Cliente que intenta saltarse el gateway: sin credencial interna."""
    transporte = ASGITransport(app=app)
    async with AsyncClient(transport=transporte, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_insertar_devuelve_201_con_id(cliente):
    respuesta = await cliente.post("/items", json=ITEM)

    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    assert cuerpo["id"]
    assert cuerpo["nombre"] == ITEM["nombre"]
    assert cuerpo["creado_en"]


@pytest.mark.asyncio
async def test_consultar_lista_y_filtra_por_categoria(cliente):
    await cliente.post("/items", json=ITEM)
    await cliente.post("/items", json={**ITEM, "nombre": "Ponzu", "categoria": "SALSA"})

    todos = await cliente.get("/items")
    assert len(todos.json()) == 2

    salsas = await cliente.get("/items", params={"categoria": "SALSA"})
    assert [i["nombre"] for i in salsas.json()] == ["Ponzu"]


@pytest.mark.asyncio
async def test_consultar_por_id(cliente):
    creado = (await cliente.post("/items", json=ITEM)).json()

    respuesta = await cliente.get(f"/items/{creado['id']}")

    assert respuesta.status_code == 200
    assert respuesta.json()["id"] == creado["id"]


@pytest.mark.asyncio
async def test_actualizar_parcial_no_borra_los_otros_campos(cliente):
    creado = (await cliente.post("/items", json=ITEM)).json()

    respuesta = await cliente.put(f"/items/{creado['id']}", json={"precio": 1500})

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["precio"] == 1500
    assert cuerpo["descripcion"] == ITEM["descripcion"]  # sigue ahí


@pytest.mark.asyncio
async def test_eliminar_devuelve_204_y_luego_404(cliente):
    creado = (await cliente.post("/items", json=ITEM)).json()

    assert (await cliente.delete(f"/items/{creado['id']}")).status_code == 204
    assert (await cliente.get(f"/items/{creado['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_id_con_formato_invalido_devuelve_400(cliente):
    respuesta = await cliente.get("/items/no-es-un-objectid")

    assert respuesta.status_code == 400


@pytest.mark.asyncio
async def test_id_valido_inexistente_devuelve_404(cliente):
    respuesta = await cliente.get("/items/507f1f77bcf86cd799439011")

    assert respuesta.status_code == 404


@pytest.mark.asyncio
async def test_precio_negativo_devuelve_422(cliente):
    respuesta = await cliente.post("/items", json={**ITEM, "precio": -100})

    assert respuesta.status_code == 422


@pytest.mark.asyncio
async def test_actualizar_sin_campos_devuelve_400(cliente):
    creado = (await cliente.post("/items", json=ITEM)).json()

    respuesta = await cliente.put(f"/items/{creado['id']}", json={})

    assert respuesta.status_code == 400


# ---------------------------------------------------------------------------
# Credencial interna: solo se entra por el gateway
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sin_credencial_interna_devuelve_403(cliente_directo):
    respuesta = await cliente_directo.get("/items")

    assert respuesta.status_code == 403
    assert "gateway" in respuesta.json()["detail"]


@pytest.mark.asyncio
async def test_credencial_inventada_devuelve_403(cliente_directo):
    respuesta = await cliente_directo.get("/items", headers={seguridad.CABECERA_INTERNA: "adivinando"})

    assert respuesta.status_code == 403


@pytest.mark.asyncio
async def test_escribir_sin_credencial_tambien_devuelve_403(cliente_directo):
    respuesta = await cliente_directo.post("/items", json=ITEM)

    assert respuesta.status_code == 403


@pytest.mark.asyncio
async def test_salud_es_publica(cliente_directo):
    respuesta = await cliente_directo.get("/salud")

    assert respuesta.status_code == 200


@pytest.mark.asyncio
async def test_vault_caido_devuelve_500(cliente, monkeypatch):
    seguridad.limpiar_cache()
    monkeypatch.setattr(seguridad, "_transporte", vault_simulado(httpx.ConnectError("Vault apagado")))

    respuesta = await cliente.get("/items")

    assert respuesta.status_code == 500
    assert "gestor de secretos" in respuesta.json()["detail"]


@pytest.mark.asyncio
async def test_vault_sin_permiso_devuelve_500(cliente, monkeypatch):
    seguridad.limpiar_cache()
    monkeypatch.setattr(seguridad, "_transporte", vault_simulado(httpx.Response(403, json={"errors": ["permission denied"]})))

    respuesta = await cliente.get("/items")

    assert respuesta.status_code == 500


@pytest.mark.asyncio
async def test_sin_credencial_no_consulta_vault(cliente_directo, monkeypatch):
    # Si se rechaza sin la cabecera, Vault ni siquiera se consulta.
    seguridad.limpiar_cache()
    monkeypatch.setattr(seguridad, "_transporte", vault_simulado(AssertionError("no debería llamar a Vault")))

    respuesta = await cliente_directo.get("/items")

    assert respuesta.status_code == 403
