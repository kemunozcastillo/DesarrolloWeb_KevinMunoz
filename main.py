from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.database import conectar, desconectar
from app.routers import menu
from app.seguridad import verificar_credencial_interna


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    """Abre la conexión a Mongo al arrancar y la cierra al apagar."""
    await conectar()
    yield
    await desconectar()


app = FastAPI(
    title="Poke Fresh API - FastAPI & MongoDB",
    description="API de Productos de Poke Fresh. Solo acepta peticiones que llegan por el gateway.",
    version="0.2.0",
    lifespan=ciclo_de_vida,
)

# Todas las rutas de productos exigen la credencial interna que pone el
# gateway. Sin CORS: ningún navegador debe llamar a esta API directamente,
# y la política CORS la maneja el gateway.
app.include_router(menu.router, dependencies=[Depends(verificar_credencial_interna)])


@app.get("/salud", tags=["Sistema"], summary="Estado del servicio")
async def salud() -> dict:
    # Pública a propósito: el gateway la consulta para su /api/salud y no
    # entrega ningún dato del negocio.
    return {"ok": True}
