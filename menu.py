from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.database import get_coleccion_menu, get_db
from app.models import (
    Categoria,
    ItemMenu,
    ItemMenuCreate,
    ItemMenuUpdate,
    ahora,
    es_object_id_valido,
)

router = APIRouter(prefix="/items", tags=["Menú"])


def validar_id(item_id: str) -> ObjectId:
    if not es_object_id_valido(item_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El id '{item_id}' no tiene formato de ObjectId.",
        )

    return ObjectId(item_id)


@router.get(
    "",
    response_model=list[ItemMenu],
    summary="Consultar items",
    description="Lista los items del menú, con filtros opcionales por categoría y disponibilidad.",
)
async def consultar_items(
    categoria: Categoria | None = None,
    solo_disponibles: bool = False,
    limite: int = Query(default=50, ge=1, le=200),
    salto: int = Query(default=0, ge=0),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list[dict]:
    # El filtro de Mongo es un diccionario: se arma condicionalmente.
    filtro: dict = {}

    if categoria is not None:
        filtro["categoria"] = categoria.value
    if solo_disponibles:
        filtro["disponible"] = True

    cursor = get_coleccion_menu(db).find(filtro).skip(salto).limit(limite)

    # `to_list` materializa el cursor; sin límite, Mongo lo traería entero.
    return await cursor.to_list(length=limite)


@router.get(
    "/{item_id}",
    response_model=ItemMenu,
    summary="Consultar item por id",
)
async def consultar_item(
    item_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    documento = await get_coleccion_menu(db).find_one({"_id": validar_id(item_id)})

    if documento is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe el item {item_id}.",
        )

    return documento


@router.post(
    "",
    response_model=ItemMenu,
    status_code=status.HTTP_201_CREATED,
    summary="Insertar item",
)
async def insertar_item(
    datos: ItemMenuCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    marca = ahora()
    documento = {**datos.model_dump(), "creado_en": marca, "actualizado_en": marca}
    documento["categoria"] = datos.categoria.value

    try:
        resultado = await get_coleccion_menu(db).insert_one(documento)
    except DuplicateKeyError:
        # Lo levanta el índice único sobre `nombre`.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un item llamado '{datos.nombre}'.",
        )

    # insert_one devuelve solo el id: el documento completo se relee.
    return await get_coleccion_menu(db).find_one({"_id": resultado.inserted_id})


@router.put(
    "/{item_id}",
    response_model=ItemMenu,
    summary="Actualizar item",
)
async def actualizar_item(
    item_id: str,
    datos: ItemMenuUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    # `exclude_unset` deja fuera los campos que el cliente no envió, para no
    # sobrescribirlos con None.
    cambios = datos.model_dump(exclude_unset=True, exclude_none=True)

    if not cambios:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se envió ningún campo para actualizar.",
        )

    if "categoria" in cambios:
        cambios["categoria"] = cambios["categoria"].value

    cambios["actualizado_en"] = ahora()

    try:
        # Sin `$set`, Mongo reemplaza el documento completo y borra el resto
        # de los campos. Es el error más común del primer CRUD.
        documento = await get_coleccion_menu(db).find_one_and_update(
            {"_id": validar_id(item_id)},
            {"$set": cambios},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un item llamado '{cambios.get('nombre')}'.",
        )

    if documento is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe el item {item_id}.",
        )

    return documento


@router.delete(
    "/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar item",
)
async def eliminar_item(
    item_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    resultado = await get_coleccion_menu(db).delete_one({"_id": validar_id(item_id)})

    # delete_one no falla si el id no existe: hay que mirar deleted_count.
    if resultado.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe el item {item_id}.",
        )
