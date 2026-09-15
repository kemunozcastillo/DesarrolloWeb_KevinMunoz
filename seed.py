"""
Carga el menú inicial en Mongo.

    python -m scripts.seed

Es idempotente: si el item ya existe por nombre, lo actualiza en vez de duplicarlo.
"""

import asyncio
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import get_settings

MENU = [
    {"nombre": "Arroz gohan", "descripcion": "Arroz blanco japonés con vinagre de arroz", "categoria": "BASE", "precio": 0},
    {"nombre": "Arroz integral", "descripcion": "Grano entero, textura más firme", "categoria": "BASE", "precio": 0},
    {"nombre": "Quinoa", "descripcion": "Alta en proteína, sin gluten", "categoria": "BASE", "precio": 500},
    {"nombre": "Mix de hojas verdes", "descripcion": "Lechuga, rúcula y espinaca", "categoria": "BASE", "precio": 0},
    {"nombre": "Fideos soba", "descripcion": "Trigo sarraceno, servidos fríos", "categoria": "BASE", "precio": 500},
    {"nombre": "Salmón fresco", "descripcion": "Cortado en cubos, marinado suave", "categoria": "PROTEINA", "precio": 0},
    {"nombre": "Atún", "descripcion": "Grado sashimi, corte del día", "categoria": "PROTEINA", "precio": 1500},
    {"nombre": "Pollo teriyaki", "descripcion": "Grillado y glaseado", "categoria": "PROTEINA", "precio": 0},
    {"nombre": "Camarón", "descripcion": "Cocido, con toque de limón", "categoria": "PROTEINA", "precio": 1000},
    {"nombre": "Tofu marinado", "descripcion": "Opción vegana, shoyu y jengibre", "categoria": "PROTEINA", "precio": 0},
    {"nombre": "Kanikama", "descripcion": "Clásico, suave y dulce", "categoria": "PROTEINA", "precio": 0},
    {"nombre": "Ponzu", "descripcion": "Cítrica y ligera, la más clásica", "categoria": "SALSA", "precio": 0},
    {"nombre": "Shoyu", "descripcion": "Soya con sésamo, sabor profundo", "categoria": "SALSA", "precio": 0},
    {"nombre": "Spicy mayo", "descripcion": "Cremosa con picante medio", "categoria": "SALSA", "precio": 0},
    {"nombre": "Goma", "descripcion": "Base de sésamo tostado, suave", "categoria": "SALSA", "precio": 0},
    {"nombre": "Teriyaki", "descripcion": "Dulce y espesa", "categoria": "SALSA", "precio": 0},
    {"nombre": "Maracuyá", "descripcion": "Ácida y fresca, para bowls de pollo", "categoria": "SALSA", "precio": 0},
    {"nombre": "Palta", "descripcion": "En láminas, media unidad", "categoria": "TOPPING", "precio": 900},
    {"nombre": "Mango", "descripcion": "En cubos, dulce y firme", "categoria": "TOPPING", "precio": 0},
    {"nombre": "Sésamo tostado", "descripcion": "Blanco y negro", "categoria": "TOPPING", "precio": 0},
    {"nombre": "Edamame", "descripcion": "Porotos de soya con sal marina", "categoria": "TOPPING", "precio": 0},
    {"nombre": "Limonada de menta", "descripcion": "500 ml, recién hecha", "categoria": "BEBIDA", "precio": 2500},
    {"nombre": "Té verde frío", "descripcion": "Sin azúcar añadida", "categoria": "BEBIDA", "precio": 2200},
    {"nombre": "Combo mediodía", "descripcion": "Bowl regular más bebida, de lunes a viernes", "categoria": "PROMOCION", "precio": 8990},
]


async def main() -> None:
    settings = get_settings()
    cliente = AsyncIOMotorClient(settings.mongodb_uri)
    coleccion = cliente[settings.mongodb_db]["menu"]

    await coleccion.create_index("nombre", unique=True)

    marca = datetime.now(timezone.utc)

    for item in MENU:
        await coleccion.update_one(
            {"nombre": item["nombre"]},
            {
                "$set": {**item, "disponible": True, "actualizado_en": marca},
                "$setOnInsert": {"creado_en": marca},
            },
            upsert=True,
        )

    total = await coleccion.count_documents({})
    print(f"Menú cargado. La colección tiene {total} items.")

    cliente.close()


if __name__ == "__main__":
    asyncio.run(main())
