from mongomock_motor import AsyncMongoMockClient

from scripts.semilla import sembrar


async def test_semilla_carga_un_mes_coherente_y_no_repite():
    mongo = AsyncMongoMockClient()
    print(await sembrar(mongo))
    pedidos = [p async for p in mongo["pf_pedidos"]["pedidos"].find({})]
    pagos = [p async for p in mongo["pf_pagos"]["pagos"].find({})]
    assert len(pedidos) > 40
    # Cada venta tiene su pago, por el mismo monto.
    con_venta = {p["_id"]: p["total"] for p in pedidos if p["venta"]}
    assert {p["pedidoId"]: p["monto"] for p in pagos} == con_venta
    # Hay trabajo para cocina y despacho hoy.
    estados = {p["estado"] for p in pedidos}
    assert {"PAGADO", "EN_PREPARACION"} <= estados
    # Las líneas guardan los productos que las componen (para el GraphQL).
    assert all(l["itemIds"] for p in pedidos for l in p["lineas"])
    assert (await mongo["pf_pedidos"]["contadores"].find_one({"_id": "pedido"}))["valor"] == len(pedidos)
    assert "Ya hay pedidos" in await sembrar(mongo)
