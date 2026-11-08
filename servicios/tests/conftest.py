"""
Arma los cuatro microservicios y la pasarela en memoria, conectados entre sí
como en producción pero sin red: Mongo es mongomock, Vault es un diccionario
y cada llamada entre servicios pasa por un transporte ASGI.

El Auth Service real es Node (tiene sus propias pruebas en auth-service/);
aquí se usa un doble mínimo con el mismo contrato.
"""

import uuid
from urllib.parse import quote

import httpx
import pytest
from fastapi import FastAPI, Request
from mongomock_motor import AsyncMongoMockClient

from comun import internos, vault
from comun.errores import ErrorApi, registrar_manejadores

CREDENCIALES = {s: f"credencial-{s}-de-prueba" for s in ("inventario", "clientes", "pedidos", "pagos")}
COMERCIO = {"api_key": "api-key-de-prueba", "secreto_firma": "firma-de-prueba"}

SECRETOS = {
    **{f"poke-fresh/internos/{s}": {"credencial": c} for s, c in CREDENCIALES.items()},
    "poke-fresh/internos/auth-clientes": {"secreto": "secreto-clientes-auth"},
    "poke-fresh/pasarela/comercio": COMERCIO,
}

CLIENTE_DEMO = {
    "run": "16.459.723-7",
    "nombre": "Javiera Morales Díaz",
    "direccion": "Av. Providencia 2133, depto 504",
    "region": "Región Metropolitana de Santiago",
    "provincia": "Santiago",
    "comuna": "Providencia",
    "fechaNacimiento": "1994-05-12",
    "sexo": "F",
    "email": "javiera@correo.cl",
    "telefono": "+56 9 8123 4567",
}

BOWL = {"tamanoId": "regular", "baseIds": ["base_gohan"], "proteinaIds": ["pro_atun"], "salsaIds": ["sal_ponzu"], "toppingIds": ["top_mango"]}


def auth_falso(estado: dict) -> FastAPI:
    """Doble del Auth Service: registra cuentas y responde como el real."""
    app = FastAPI()
    registrar_manejadores(app)

    @app.post("/cuentas", status_code=201)
    async def crear(datos: dict, request: Request):
        if estado.get("fallar"):
            raise ErrorApi(400, "CLAVE_DEBIL", "La contraseña debe tener al menos 8 caracteres.")
        assert request.headers["authorization"].startswith("Basic ")
        estado.setdefault("cuentas", {})[datos["sujetoId"]] = datos
        return {"id": str(uuid.uuid4()), "codigoDemo": "123456"}

    @app.patch("/cuentas/sujeto/{sujeto}")
    async def cambiar(sujeto: str, datos: dict):
        estado.setdefault("cambios", []).append((sujeto, datos))
        return {"codigoDemo": "654321" if "email" in datos else None}

    @app.get("/cuentas/verificacion")
    async def verificacion():
        return {s: True for s in estado.get("cuentas", {})}

    return app


class Sistema:
    def __init__(self):
        from clientes.main import crear_aplicacion as clientes
        from inventario.main import crear_aplicacion as inventario
        from pagos.main import crear_aplicacion as pagos
        from pasarela.main import crear_aplicacion as pasarela
        from pedidos.main import crear_aplicacion as pedidos

        self.mongo = AsyncMongoMockClient()
        self.apps = {"inventario": inventario(), "clientes": clientes(), "pedidos": pedidos(), "pagos": pagos()}
        self.auth_estado: dict = {}
        self.auth = auth_falso(self.auth_estado)
        self.pasarela = pasarela()

    async def preparar(self):
        from clientes.main import preparar as p_clientes
        from inventario.main import preparar as p_inventario
        from pagos.main import preparar as p_pagos
        from pedidos.main import preparar as p_pedidos

        for nombre, app in self.apps.items():
            app.state.db = self.mongo[f"pf_{nombre}"]
        for app, preparar in zip(self.apps.values(), (p_inventario, p_clientes, p_pedidos, p_pagos)):
            await preparar(app)

        internos.transportes.clear()
        for nombre, app in self.apps.items():
            internos.transportes[nombre] = httpx.ASGITransport(app=app)
        internos.transportes["auth"] = httpx.ASGITransport(app=self.auth)
        internos.transportes["pasarela"] = httpx.ASGITransport(app=self.pasarela)

        # La pasarela notifica "al gateway": aquí se entrega directo a pagos con su credencial.
        import pasarela.main as pas

        pagos_app = self.apps["pagos"]

        async def al_gateway(request: httpx.Request) -> httpx.Response:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=pagos_app), base_url="http://pagos") as c:
                r = await c.post("/pagos/notificacion", content=request.content, headers={**request.headers, "X-Credencial-Interna": CREDENCIALES["pagos"]})
            return httpx.Response(r.status_code, content=r.content, headers=r.headers)

        pas.transporte_notificacion = httpx.MockTransport(al_gateway)
        pas.transacciones.clear()

    def cliente(self, servicio: str, rol: str | None = None, sujeto: str | None = None, credencial: str | None = "ok") -> httpx.AsyncClient:
        """Cliente HTTP que llega a un servicio como lo haría el gateway, con la identidad indicada."""
        cabeceras = {}
        if credencial == "ok":
            cabeceras["X-Credencial-Interna"] = CREDENCIALES[servicio]
        elif credencial:
            cabeceras["X-Credencial-Interna"] = credencial
        if rol:
            cabeceras.update({"X-Usuario-Id": f"u-{sujeto or rol}", "X-Usuario-Rol": rol, "X-Usuario-Sujeto": sujeto or f"u-{rol}", "X-Usuario-Nombre": quote(f"Persona {rol}")})
        app = self.pasarela if servicio == "pasarela" else self.apps[servicio]
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=f"http://{servicio}", headers=cabeceras)

    async def registrar_cliente(self, **cambios) -> str:
        async with self.cliente("clientes") as c:
            r = await c.post("/clientes/registro", json={**CLIENTE_DEMO, **cambios, "clave": "Clave2026"})
        assert r.status_code == 201, r.text
        return r.json()["cliente"]["id"]

    async def crear_pedido(self, cliente_id: str, lineas=None, modo="DELIVERY", clave=None) -> httpx.Response:
        lineas = lineas or [{"tipo": "BOWL", "cantidad": 1, "entrada": BOWL}]
        cabeceras = {"Idempotency-Key": clave} if clave else {}
        async with self.cliente("pedidos", "cliente", cliente_id) as c:
            return await c.post("/pedidos", json={"modoEntrega": modo, "nota": "", "lineas": lineas}, headers=cabeceras)

    async def pagar(self, cliente_id: str, pedido_id: str, decision="APROBADO") -> dict:
        async with self.cliente("pagos", "cliente", cliente_id) as c:
            r = await c.post("/pagos", json={"pedidoId": pedido_id}, headers={"Idempotency-Key": f"clave-{pedido_id}-{decision}"})
        assert r.status_code == 201, r.text
        token = r.json()["urlPago"].rsplit("/", 1)[1]
        async with self.cliente("pasarela", credencial=None) as c:
            await c.post(f"/pagar/{token}", data={"decision": decision})
        return r.json()


@pytest.fixture
async def sistema():
    vault.usar_valores_fijos(SECRETOS)
    s = Sistema()
    await s.preparar()
    from pedidos import eventos

    eventos.publicados.clear()
    yield s
    vault.usar_valores_fijos(None)
    internos.transportes.clear()
