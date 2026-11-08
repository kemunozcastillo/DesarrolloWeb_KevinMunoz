"""
Arma la app FastAPI de cada servicio con lo que todos comparten:

  - formato de errores común;
  - registro de cada petición con su identificador de correlación
    (X-Request-Id, lo crea el gateway) y sin datos personales;
  - GET /salud, pública, con el estado de Mongo y de Vault;
  - todas las demás rutas exigen la credencial interna del servicio.
"""

import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Awaitable, Callable

from fastapi import APIRouter, Depends, FastAPI, Request

from comun import db, vault
from comun.errores import registrar_manejadores
from comun.seguridad import servicio_actual, verificar_credencial_interna

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def crear_app(
    servicio: str,
    titulo: str,
    routers: list[APIRouter],
    *,
    al_iniciar: Callable[[FastAPI], Awaitable[None]] | None = None,
    con_base_datos: bool = True,
    publicos: list[APIRouter] | None = None,
) -> FastAPI:
    registro = logging.getLogger(servicio)

    @asynccontextmanager
    async def ciclo(app: FastAPI):
        cliente = None
        if con_base_datos and getattr(app.state, "db", None) is None:
            cliente, app.state.db = await db.conectar()
        if al_iniciar:
            await al_iniciar(app)
        yield
        if cliente is not None:
            cliente.close()

    app = FastAPI(title=titulo, version="2.0.0", lifespan=ciclo)
    app.state.servicio = servicio
    app.state.db = None
    registrar_manejadores(app)

    @app.middleware("http")
    async def correlacion(request: Request, siguiente):
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = rid
        marca = servicio_actual.set(servicio)
        inicio = time.perf_counter()
        try:
            respuesta = await siguiente(request)
        finally:
            servicio_actual.reset(marca)
        respuesta.headers["X-Request-Id"] = rid
        # Solo método, ruta, estado y tiempo: nunca cuerpos ni cabeceras con datos personales.
        registro.info("%s %s %s %dms rid=%s", request.method, request.url.path, respuesta.status_code, (time.perf_counter() - inicio) * 1000, rid)
        return respuesta

    @app.get("/salud", tags=["Salud"])
    async def salud():
        estado_db = "no aplica"
        if con_base_datos:
            try:
                await app.state.db.command("ping")
                estado_db = "ok"
            except Exception:
                estado_db = "sin conexión"
        estado_vault = await vault.salud()
        ok = estado_vault == "ok" and estado_db in ("ok", "no aplica")
        return {"servicio": servicio, "ok": ok, "mongo": estado_db, "vault": estado_vault}

    for router in publicos or []:
        app.include_router(router)
    for router in routers:
        app.include_router(router, dependencies=[Depends(verificar_credencial_interna)])

    return app


def request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)
