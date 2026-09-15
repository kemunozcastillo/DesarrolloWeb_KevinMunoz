"""
Tests del CRUD. Usan `mongomock_motor`, una base en memoria con la misma API
de motor, así que corren sin levantar Mongo ni ensuciar datos reales.
"""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

from app import database
from app.main import app

ITEM = {
    "nombre": "Salmón fresco",
    "descripcion": "Cortado en cubos, marinado suave",
    "categoria": "PROTEINA",
    "precio": 0,
    "disponible": True,
}


@pytest_asyncio.fixture
async def cliente():
    # Se reemplaza la base real por la falsa antes de construir el cliente.
    database.usar_base_datos(AsyncMongoMockClient()["test"])

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
