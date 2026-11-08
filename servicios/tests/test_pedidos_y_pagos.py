"""Pruebas de punta a punta del circuito de compra entre pedidos, inventario, clientes, pagos y la pasarela."""

import hashlib
import hmac
import json

from tests.conftest import BOWL, COMERCIO


async def stock(sistema, item):
    return (await sistema.apps["inventario"].state.db["items"].find_one({"_id": item}))["stock"]


async def test_crear_pedido_calcula_total_y_reserva_stock(sistema):
    cid = await sistema.registrar_cliente()
    lineas = [
        {"tipo": "BOWL", "cantidad": 2, "entrada": BOWL, "precioUnitario": 10},
        {"tipo": "ITEM", "cantidad": 1, "itemId": "beb_te"},
    ]
    r = await sistema.crear_pedido(cid, lineas)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["id"] == "PF-00001"
    assert p["total"] == 2 * 8490 + 2200
    assert p["estado"] == "PENDIENTE_PAGO"
    assert p["direccion"].endswith("Providencia")
    assert await stock(sistema, "pro_atun") == 28


async def test_doble_clic_no_crea_dos_pedidos(sistema):
    cid = await sistema.registrar_cliente()
    a = await sistema.crear_pedido(cid, clave="clic-123456")
    b = await sistema.crear_pedido(cid, clave="clic-123456")
    assert a.json()["id"] == b.json()["id"]
    assert await sistema.apps["pedidos"].state.db["pedidos"].count_documents({}) == 1


async def test_despacho_fuera_de_radio(sistema):
    cid = await sistema.registrar_cliente(comuna="Maipú", direccion="Av. Pajaritos 3200")
    r = await sistema.crear_pedido(cid, modo="DELIVERY")
    assert r.status_code == 400 and r.json()["codigo"] == "FUERA_DE_RADIO"
    assert (await sistema.crear_pedido(cid, modo="RETIRO")).status_code == 201


async def test_pedido_ajeno_responde_404_sin_datos(sistema):
    duena = await sistema.registrar_cliente()
    otro = await sistema.registrar_cliente(run="18.234.567-9", email="otro@correo.cl")
    pid = (await sistema.crear_pedido(duena)).json()["id"]

    async with sistema.cliente("pedidos", "cliente", otro) as c:
        r = await c.get(f"/pedidos/{pid}")
        assert r.status_code == 404
        assert "Javiera" not in r.text
        assert (await c.get("/pedidos")).json() == []
        assert (await c.post(f"/pedidos/{pid}/anular", json={"motivo": "no es mío"})).status_code == 404
    async with sistema.cliente("pedidos", "cliente", duena) as c:
        assert (await c.get(f"/pedidos/{pid}")).status_code == 200


async def test_pago_completo_por_la_pasarela(sistema):
    cid = await sistema.registrar_cliente()
    pid = (await sistema.crear_pedido(cid)).json()["id"]
    await sistema.pagar(cid, pid)

    async with sistema.cliente("pedidos", "cliente", cid) as c:
        p = (await c.get(f"/pedidos/{pid}")).json()
    assert p["estado"] == "PAGADO"
    assert p["venta"]["numero"] == 1 and p["boleta"]["numero"] == 1
    assert p["boleta"]["neto"] + p["boleta"]["iva"] == p["total"]
    assert p["pago"]["referencia"].startswith("SVP-")
    # Avisos a ActiveMQ: boleta por correo y pedido nuevo para cocina.
    from pedidos import eventos

    assert [cola for cola, _ in eventos.publicados] == ["/queue/correos", "/queue/cocina"]


async def test_pago_rechazado_deja_el_pedido_pendiente(sistema):
    cid = await sistema.registrar_cliente()
    pid = (await sistema.crear_pedido(cid)).json()["id"]
    await sistema.pagar(cid, pid, decision="RECHAZADO")
    async with sistema.cliente("pedidos", "cliente", cid) as c:
        assert (await c.get(f"/pedidos/{pid}")).json()["estado"] == "PENDIENTE_PAGO"


async def test_pago_exige_idempotency_key_y_la_respeta(sistema):
    cid = await sistema.registrar_cliente()
    pid = (await sistema.crear_pedido(cid)).json()["id"]
    async with sistema.cliente("pagos", "cliente", cid) as c:
        assert (await c.post("/pagos", json={"pedidoId": pid})).status_code == 400
        a = await c.post("/pagos", json={"pedidoId": pid, "monto": 1}, headers={"Idempotency-Key": "pago-abc-123"})
        b = await c.post("/pagos", json={"pedidoId": pid}, headers={"Idempotency-Key": "pago-abc-123"})
    assert a.json()["id"] == b.json()["id"]
    # El monto que manda el navegador se ignora: sale del pedido.
    assert a.json()["monto"] == 8490


async def test_no_se_puede_pagar_un_pedido_ajeno(sistema):
    duena = await sistema.registrar_cliente()
    otro = await sistema.registrar_cliente(run="18.234.567-9", email="otro@correo.cl")
    pid = (await sistema.crear_pedido(duena)).json()["id"]
    async with sistema.cliente("pagos", "cliente", otro) as c:
        r = await c.post("/pagos", json={"pedidoId": pid}, headers={"Idempotency-Key": "ajeno-12345"})
    assert r.status_code == 404


def notificacion(pago: dict, token: str, **cambios) -> bytes:
    cuerpo = {"token": token, "orden": pago["id"], "monto": pago["monto"], "estado": "APROBADO", "referencia": "SVP-1", **cambios}
    return json.dumps(cuerpo).encode()


def firma(cuerpo: bytes, secreto=COMERCIO["secreto_firma"]) -> str:
    return hmac.new(secreto.encode(), cuerpo, hashlib.sha256).hexdigest()


async def iniciar_pago(sistema):
    cid = await sistema.registrar_cliente()
    pid = (await sistema.crear_pedido(cid)).json()["id"]
    async with sistema.cliente("pagos", "cliente", cid) as c:
        pago = (await c.post("/pagos", json={"pedidoId": pid}, headers={"Idempotency-Key": "pago-xyz-789"})).json()
    token = pago["urlPago"].rsplit("/", 1)[1]
    return cid, pid, pago, token


async def test_notificacion_sin_firma_o_alterada_se_rechaza(sistema):
    cid, pid, pago, token = await iniciar_pago(sistema)
    async with sistema.cliente("pagos") as c:
        # El navegador intenta confirmar el pago él mismo, sin la firma de la pasarela.
        cuerpo = notificacion(pago, token)
        assert (await c.post("/pagos/notificacion", content=cuerpo)).status_code == 401
        assert (await c.post("/pagos/notificacion", content=cuerpo, headers={"X-Firma": firma(cuerpo, "otro-secreto")})).status_code == 401
        # Firma válida pero monto alterado.
        cuerpo = notificacion(pago, token, monto=1)
        r = await c.post("/pagos/notificacion", content=cuerpo, headers={"X-Firma": firma(cuerpo)})
        assert r.status_code == 409
    async with sistema.cliente("pedidos", "cliente", cid) as c:
        assert (await c.get(f"/pedidos/{pid}")).json()["estado"] == "PENDIENTE_PAGO"


async def test_notificacion_duplicada_no_cobra_ni_registra_dos_veces(sistema):
    cid, pid, pago, token = await iniciar_pago(sistema)
    cuerpo = notificacion(pago, token)
    async with sistema.cliente("pagos") as c:
        r1 = await c.post("/pagos/notificacion", content=cuerpo, headers={"X-Firma": firma(cuerpo)})
        r2 = await c.post("/pagos/notificacion", content=cuerpo, headers={"X-Firma": firma(cuerpo)})
    assert r1.json()["repetido"] is False and r2.json()["repetido"] is True
    pedido = await sistema.apps["pedidos"].state.db["pedidos"].find_one({"_id": pid})
    assert pedido["venta"]["numero"] == 1
    assert len([h for h in pedido["historial"] if h["estado"] == "PAGADO"]) == 1


async def test_flujo_de_cocina_y_despacho_con_permisos(sistema):
    cid = await sistema.registrar_cliente()
    pid = (await sistema.crear_pedido(cid)).json()["id"]
    await sistema.pagar(cid, pid)

    async with sistema.cliente("pedidos", "cocina") as c:
        cola = (await c.get("/pedidos")).json()
        assert [p["id"] for p in cola] == [pid]
        # Cocina ve nombre y teléfono, no RUN ni correo.
        assert set(cola[0]["cliente"]) == {"nombre", "telefono"}
        assert (await c.post(f"/pedidos/{pid}/despachar", json={"chofer": "Luis Contreras"})).status_code == 403
        assert (await c.post(f"/pedidos/{pid}/aceptar")).status_code == 200
        # Otro puesto de cocina intenta aceptar el mismo pedido.
        assert (await c.post(f"/pedidos/{pid}/aceptar")).status_code == 409
        assert (await c.post(f"/pedidos/{pid}/terminar")).json()["estado"] == "LISTO_DESPACHO"

    async with sistema.cliente("pedidos", "despacho") as c:
        assert (await c.post(f"/pedidos/{pid}/despachar", json={"chofer": "Nadie"})).status_code == 400
        assert (await c.post(f"/pedidos/{pid}/despachar", json={"chofer": "Luis Contreras"})).json()["estado"] == "EN_DESPACHO"
        assert (await c.post(f"/pedidos/{pid}/entregar")).json()["estado"] == "ENTREGADO"

    async with sistema.cliente("pedidos", "cliente", cid) as c:
        p = (await c.get(f"/pedidos/{pid}")).json()
    assert [h["estado"] for h in p["historial"]] == ["PENDIENTE_PAGO", "PAGADO", "EN_PREPARACION", "LISTO_DESPACHO", "EN_DESPACHO", "ENTREGADO"]
    assert "actor" not in p["historial"][0]


async def test_anular_pedido_pagado_devuelve_pago_y_stock(sistema):
    cid = await sistema.registrar_cliente()
    pid = (await sistema.crear_pedido(cid)).json()["id"]
    assert await stock(sistema, "pro_atun") == 29
    await sistema.pagar(cid, pid)

    async with sistema.cliente("pedidos", "cliente", cid) as c:
        assert (await c.post(f"/pedidos/{pid}/anular", json={"motivo": "no"})).status_code == 400
        r = await c.post(f"/pedidos/{pid}/anular", json={"motivo": "Me equivoqué de dirección"})
    assert r.status_code == 200
    p = r.json()
    assert p["estado"] == "ANULADO" and p["venta"]["anulada"] is True and p["pago"]["estado"] == "DEVUELTO"
    assert await stock(sistema, "pro_atun") == 30
    pago = await sistema.apps["pagos"].state.db["pagos"].find_one({"pedidoId": pid})
    assert pago["estado"] == "DEVUELTO"


async def test_no_se_anula_lo_que_cocina_acepto(sistema):
    cid = await sistema.registrar_cliente()
    pid = (await sistema.crear_pedido(cid)).json()["id"]
    await sistema.pagar(cid, pid)
    async with sistema.cliente("pedidos", "cocina") as c:
        await c.post(f"/pedidos/{pid}/aceptar")
    async with sistema.cliente("pedidos", "admin") as c:
        r = await c.post(f"/pedidos/{pid}/anular", json={"motivo": "Cliente llamó"})
    assert r.status_code == 409


async def test_confirmacion_de_pago_no_esta_en_rutas_publicas(sistema):
    """La ruta interna exige la credencial; el gateway además no la publica."""
    cid = await sistema.registrar_cliente()
    pid = (await sistema.crear_pedido(cid)).json()["id"]
    async with sistema.cliente("pedidos", credencial=None) as c:
        r = await c.post(f"/internos/pedidos/{pid}/pago-confirmado", json={"pagoId": "x", "monto": 8490})
    assert r.status_code == 403


async def test_reporte_de_ventas_solo_admin_y_dueno(sistema):
    cid = await sistema.registrar_cliente()
    for _ in range(2):
        pid = (await sistema.crear_pedido(cid)).json()["id"]
        await sistema.pagar(cid, pid)
    from comun.tiempo import ahora_iso, dia_local

    hoy = dia_local(ahora_iso())
    async with sistema.cliente("pedidos", "dueno") as c:
        r = (await c.get("/reportes/ventas", params={"desde": hoy, "hasta": hoy})).json()
    assert r["cantidad"] == 2 and r["monto"] == 2 * 8490
    assert r["masVendidos"][0]["cantidad"] == 2
    async with sistema.cliente("pedidos", "cocina") as c:
        assert (await c.get("/reportes/ventas", params={"desde": hoy, "hasta": hoy})).status_code == 403


async def test_vault_caido_responde_503(sistema):
    from comun import vault

    vault.usar_valores_fijos({})
    async with sistema.cliente("inventario") as c:
        r = await c.get("/items")
    assert r.status_code == 503
    assert r.json()["codigo"] == "SECRETOS_NO_DISPONIBLES"


async def test_servicio_caido_responde_502(sistema):
    import httpx

    from comun import internos

    async def caido(_req):
        raise httpx.ConnectError("sin conexión")

    cid = await sistema.registrar_cliente()
    internos.transportes["inventario"] = httpx.MockTransport(caido)
    r = await sistema.crear_pedido(cid)
    assert r.status_code == 502
    assert r.json()["codigo"] == "SERVICIO_NO_DISPONIBLE"
