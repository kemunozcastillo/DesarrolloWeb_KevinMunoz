from tests.conftest import CLIENTE_DEMO


async def test_registro_crea_ficha_y_cuenta(sistema):
    async with sistema.cliente("clientes") as c:
        r = await c.post("/clientes/registro", json={**CLIENTE_DEMO, "clave": "Clave2026"})
    assert r.status_code == 201
    datos = r.json()
    assert datos["cliente"]["run"] == "16459723-7"
    assert datos["codigoDemo"] == "123456"
    cuenta = sistema.auth_estado["cuentas"][datos["cliente"]["id"]]
    assert cuenta["rol"] == "cliente" and cuenta["email"] == "javiera@correo.cl"
    # La ficha nunca guarda la contraseña.
    doc = await sistema.apps["clientes"].state.db["clientes"].find_one({"_id": datos["cliente"]["id"]})
    assert "clave" not in doc and "hash" not in doc


async def test_run_invalido_y_duplicados(sistema):
    async with sistema.cliente("clientes") as c:
        r = await c.post("/clientes/registro", json={**CLIENTE_DEMO, "run": "16.459.723-1", "clave": "Clave2026"})
        assert r.status_code == 400 and "RUN" in r.json()["mensaje"]
        assert (await c.post("/clientes/registro", json={**CLIENTE_DEMO, "clave": "Clave2026"})).status_code == 201
        r = await c.post("/clientes/registro", json={**CLIENTE_DEMO, "email": "otro@correo.cl", "clave": "Clave2026"})
        assert r.status_code == 409


async def test_si_falla_la_cuenta_se_borra_la_ficha(sistema):
    sistema.auth_estado["fallar"] = True
    async with sistema.cliente("clientes") as c:
        r = await c.post("/clientes/registro", json={**CLIENTE_DEMO, "clave": "corta"})
    assert r.status_code == 400
    assert await sistema.apps["clientes"].state.db["clientes"].count_documents({}) == 0


async def test_cliente_ve_y_edita_solo_su_ficha(sistema):
    cid = await sistema.registrar_cliente()
    async with sistema.cliente("clientes", "cliente", cid) as c:
        assert (await c.get("/clientes/yo")).json()["id"] == cid
        # El listado y las fichas por id son solo para el administrador.
        assert (await c.get("/clientes")).status_code == 403
        assert (await c.get(f"/clientes/{cid}")).status_code == 403
        r = await c.put("/clientes/yo", json={"email": "nuevo@correo.cl", "run": "11111111-1"})
    assert r.status_code == 200
    assert r.json()["cambioCorreo"] is True
    assert r.json()["cliente"]["run"] == "16459723-7"  # el RUN no lo cambia el cliente
    assert ("email" in sistema.auth_estado["cambios"][-1][1])


async def test_admin_registra_en_local_con_clave_temporal_y_desactiva(sistema):
    async with sistema.cliente("clientes", "admin") as c:
        r = await c.post("/clientes", json={**CLIENTE_DEMO})
        assert r.status_code == 201
        assert len(r.json()["claveTemporal"]) == 8
        cid = r.json()["cliente"]["id"]
        lista = (await c.get("/clientes", params={"q": "javiera"})).json()
        assert lista[0]["emailVerificado"] is True
        r = await c.patch(f"/clientes/{cid}/estado", json={"activo": False})
        assert r.json()["activo"] is False
    assert sistema.auth_estado["cambios"][-1] == (cid, {"activo": False})
