from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase

from app.config import get_settings

# El cliente se guarda a nivel de módulo: motor mantiene un pool de conexiones
# y crear uno por request es un error clásico de rendimiento.
_cliente: AsyncIOMotorClient | None = None
_base_datos: AsyncIOMotorDatabase | None = None


async def conectar() -> None:
    """Abre el pool de conexiones. Se llama al arrancar la app."""
    global _cliente, _base_datos

    settings = get_settings()
    _cliente = AsyncIOMotorClient(settings.mongodb_uri)
    _base_datos = _cliente[settings.mongodb_db]

    await crear_indices()


async def desconectar() -> None:
    """Cierra el pool al apagar la app."""
    global _cliente, _base_datos

    if _cliente is not None:
        _cliente.close()

    _cliente = None
    _base_datos = None


def get_db() -> AsyncIOMotorDatabase:
    """
    Dependencia de FastAPI. Se inyecta en los endpoints para que en los tests
    se pueda reemplazar por una base falsa sin tocar el código de producción.
    """
    if _base_datos is None:
        raise RuntimeError("La base de datos no está conectada.")

    return _base_datos


def get_coleccion_menu(db: AsyncIOMotorDatabase) -> AsyncIOMotorCollection:
    return db["menu"]


async def crear_indices() -> None:
    """
    En Mongo los índices no vienen de una migración: hay que crearlos por código.
    `create_index` es idempotente, así que correrlo en cada arranque no molesta.
    """
    coleccion = get_coleccion_menu(get_db())

    # Sin este índice único, nada impide guardar dos veces el mismo ingrediente.
    await coleccion.create_index("nombre", unique=True)
    # Filtrar por categoría es la consulta más frecuente del menú.
    await coleccion.create_index("categoria")


def usar_base_datos(db: AsyncIOMotorDatabase) -> None:
    """Punto de entrada para los tests: inyecta una base ya construida."""
    global _base_datos
    _base_datos = db
