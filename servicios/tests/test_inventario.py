from tests.conftest import BOWL


async def test_sin_credencial_interna_responde_403(sistema):
    async with sistema.cliente("inventario", credencial=None) as c:
        r = await c.get("/items")
    assert r.status_code == 403
    assert r.json()["codigo"] == "ACCESO_DIRECTO"


async def test_credencial_de_otro_servicio_no_sirve(sistema):
    from tests.conftest import CREDENCIALES

    async with sistema.cliente("inventario", credencial=CREDENCIALES["pagos"]) as c:
        r = await c.get("/items")
    assert r.status_code == 403
    assert r.json()["codigo"] == "CREDENCIAL_INVALIDA"


async def test_salud_es_publica(sistema):
    async with sistema.cliente("inventario", credencial=None) as c:
        r = await c.get("/salud")
    assert r.status_code == 200
    assert r.json()["mongo"] == "ok"


async def test_catalogo_publico_no_muestra_stock(sistema):
    async with sistema.cliente("inventario") as c:
        items = (await c.get("/items")).json()
    assert len(items) == 29
    assert all("stock" not in i for i in items)
    lata = next(i for i in items if i["id"] == "beb_lata")
    assert lata["disponible"] is False  # stock 0


async def test_admin_ve_el_stock(sistema):
    async with sistema.cliente("inventario", "admin") as c:
        atun = (await c.get("/items/pro_atun")).json()
    assert atun["stock"] == 30


async def test_consulta_en_lote_por_ids(sistema):
    async with sistema.cliente("inventario") as c:
        items = (await c.get("/items", params={"ids": "pro_atun,top_palta,no_existe"})).json()
    assert {i["id"] for i in items} == {"pro_atun", "top_palta"}


async def test_cotizacion_la_calcula_el_backend_e_ignora_precios_del_carrito(sistema):
    linea = {"tipo": "BOWL", "cantidad": 2, "entrada": BOWL, "precioUnitario": 1, "subtotal": 2}
    async with sistema.cliente("inventario") as c:
        r = await c.post("/internos/cotizar", json={"lineas": [linea]})
    assert r.status_code == 200
    cot = r.json()
    # Regular 6.990 + atún premium 1.500 = 8.490 por bowl
    assert cot["lineas"][0]["precioUnitario"] == 8490
    assert cot["total"] == 16980
    assert {"itemId": "pro_atun", "cantidad": 2} in cot["consumo"]


async def test_reglas_de_armado_se_validan_en_el_servidor(sistema):
    malo = {**BOWL, "baseIds": ["base_gohan", "base_quinoa", "base_soba", "base_verdes"]}
    async with sistema.cliente("inventario") as c:
        r = await c.post("/internos/cotizar", json={"lineas": [{"tipo": "BOWL", "cantidad": 1, "entrada": malo}]})
    assert r.status_code == 400
    assert "entre 1 y 3 bases" in r.json()["mensaje"]


async def test_reserva_descuenta_y_liberar_devuelve_stock(sistema):
    async with sistema.cliente("inventario") as c:
        r = await c.post("/internos/reservas", json={"pedidoId": "PF-90001", "consumo": [{"itemId": "pro_atun", "cantidad": 5}]})
        assert r.json()["repetida"] is False
        # Idempotente: reservar otra vez el mismo pedido no descuenta de nuevo.
        r = await c.post("/internos/reservas", json={"pedidoId": "PF-90001", "consumo": [{"itemId": "pro_atun", "cantidad": 5}]})
        assert r.json()["repetida"] is True
    async with sistema.cliente("inventario", "admin") as c:
        assert (await c.get("/items/pro_atun")).json()["stock"] == 25
    async with sistema.cliente("inventario") as c:
        await c.post("/internos/reservas/PF-90001/liberar")
        await c.post("/internos/reservas/PF-90001/liberar")  # la segunda no suma otra vez
    async with sistema.cliente("inventario", "admin") as c:
        assert (await c.get("/items/pro_atun")).json()["stock"] == 30


async def test_sin_stock_suficiente_responde_409_y_no_descuenta_nada(sistema):
    consumo = [{"itemId": "pro_salmon", "cantidad": 2}, {"itemId": "pro_atun", "cantidad": 31}]
    async with sistema.cliente("inventario") as c:
        r = await c.post("/internos/reservas", json={"pedidoId": "PF-90002", "consumo": consumo})
    assert r.status_code == 409
    async with sistema.cliente("inventario", "admin") as c:
        assert (await c.get("/items/pro_salmon")).json()["stock"] == 80  # se devolvió lo descontado


async def test_solo_admin_elimina_y_dueno_puede_editar(sistema):
    async with sistema.cliente("inventario", "dueno") as c:
        assert (await c.delete("/items/top_mango")).status_code == 403
        r = await c.put("/items/top_mango", json={"precio": 300, "stock": 10})
        assert r.status_code == 200 and r.json()["precio"] == 300
    async with sistema.cliente("inventario", "cliente", "cli_x") as c:
        assert (await c.post("/items", json={"nombre": "X", "descripcion": "xx", "categoria": "BEBIDA", "precio": 1})).status_code == 403
    async with sistema.cliente("inventario", "admin") as c:
        assert (await c.delete("/items/top_mango")).status_code == 204
        assert (await c.get("/items/top_mango")).status_code == 404


async def test_crear_item_valida_y_evita_duplicados(sistema):
    async with sistema.cliente("inventario", "admin") as c:
        r = await c.post("/items", json={"nombre": "Kombucha", "descripcion": "Fermentada", "categoria": "BEBIDA", "precio": 2900, "stock": 12})
        assert r.status_code == 201 and r.json()["id"] == "beb_kombucha"
        r = await c.post("/items", json={"nombre": "kombucha", "descripcion": "Otra", "categoria": "BEBIDA", "precio": 2900})
        assert r.status_code == 409
        r = await c.post("/items", json={"nombre": "Té", "descripcion": "Caro", "categoria": "BEBIDA", "precio": 999999})
        assert r.status_code == 400
