from datetime import datetime, timezone
from enum import Enum
from typing import Annotated

from bson import ObjectId
from pydantic import AliasChoices, BaseModel, BeforeValidator, ConfigDict, Field

# Mongo devuelve el id como ObjectId, que no es serializable a JSON.
# Este alias lo convierte a string al salir.
IdMongo = Annotated[str, BeforeValidator(str)]


class Categoria(str, Enum):
    BASE = "BASE"
    PROTEINA = "PROTEINA"
    SALSA = "SALSA"
    TOPPING = "TOPPING"
    BEBIDA = "BEBIDA"
    PROMOCION = "PROMOCION"


class ItemMenuCreate(BaseModel):
    """
    Cuerpo del POST. Mongo aceptaría cualquier documento, así que esta clase
    es el único esquema que tiene la colección: lo que no pase por aquí,
    no entra.
    """

    nombre: str = Field(min_length=2, max_length=80)
    descripcion: str = Field(min_length=2, max_length=200)
    categoria: Categoria
    precio: int = Field(ge=0, le=100_000, description="En pesos, sin decimales")
    disponible: bool = True

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "nombre": "Salmón fresco",
                "descripcion": "Cortado en cubos, marinado suave",
                "categoria": "PROTEINA",
                "precio": 0,
                "disponible": True,
            }
        }
    )


class ItemMenuUpdate(BaseModel):
    """
    Cuerpo del PUT. Todos los campos son opcionales para poder actualizar uno
    solo; `exclude_unset` en el endpoint evita pisar los demás con None.
    """

    nombre: str | None = Field(default=None, min_length=2, max_length=80)
    descripcion: str | None = Field(default=None, min_length=2, max_length=200)
    categoria: Categoria | None = None
    precio: int | None = Field(default=None, ge=0, le=100_000)
    disponible: bool | None = None


class ItemMenu(BaseModel):
    """Lo que devuelve la API. El `_id` de Mongo se expone como `id`."""

    # Mongo guarda el campo como `_id`; hacia afuera se expone como `id`.
    id: IdMongo = Field(
        validation_alias=AliasChoices("_id", "id"),
        serialization_alias="id",
    )
    nombre: str
    descripcion: str
    categoria: Categoria
    precio: int
    disponible: bool
    creado_en: datetime
    actualizado_en: datetime

    model_config = ConfigDict(populate_by_name=True)


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def es_object_id_valido(valor: str) -> bool:
    """
    Un id con formato inválido hace que bson lance InvalidId antes de tocar
    la base. Se valida antes para responder 400 en vez de un error 500.
    """
    return ObjectId.is_valid(valor)
