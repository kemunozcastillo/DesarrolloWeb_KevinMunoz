from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import conectar, desconectar
from app.routers import menu


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    """Abre la conexión a Mongo al arrancar y la cierra al apagar."""
    await conectar()
    yield
    await desconectar()


app = FastAPI(
    title="Poke Fresh API - FastAPI & MongoDB",
    description="CRUD del menú de Poke Fresh sobre MongoDB.",
    version="0.1.0",
    lifespan=ciclo_de_vida,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().origen_frontend],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(menu.router)


@app.get("/salud", tags=["Sistema"], summary="Estado del servicio")
async def salud() -> dict:
    return {"ok": True}
