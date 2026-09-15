# Poke Fresh — API REST con FastAPI y MongoDB

CRUD del menú de Poke Fresh: bases, proteínas, salsas, toppings, bebidas y promociones.

## Cómo correrlo

**1. Levantar Mongo.** Con Docker, en local:

```bash
docker run -d -p 27017:27017 --name mongo mongo:7
```

O crear un cluster gratis en MongoDB Atlas y copiar la cadena de conexión (`mongodb+srv://...`).

**2. Configurar el entorno:**

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # y ajustar MONGODB_URI
```

**3. Cargar el menú y levantar la API:**

```bash
python -m scripts.seed
uvicorn app.main:app --reload
```

Swagger en `http://127.0.0.1:8000/docs`.

## Endpoints

| Método | Ruta | Qué hace | Respuesta |
|---|---|---|---|
| GET | `/items` | Lista el menú, con filtros por categoría y disponibilidad | 200 |
| GET | `/items/{id}` | Busca un item por su `_id` | 200 / 400 / 404 |
| POST | `/items` | Inserta un item nuevo | 201 / 409 / 422 |
| PUT | `/items/{id}` | Actualiza campos de un item existente | 200 / 400 / 404 / 409 |
| DELETE | `/items/{id}` | Elimina un item | 204 / 400 / 404 |

`GET /items` acepta `categoria`, `solo_disponibles`, `limite` y `salto` como parámetros de consulta.

## Estructura

```
app/
  main.py              app FastAPI, CORS y ciclo de vida
  config.py            settings por variables de entorno
  database.py          cliente de motor, dependencia get_db e índices
  models.py            modelos Pydantic y manejo de ObjectId
  routers/menu.py      los cinco endpoints CRUD
scripts/seed.py        carga el menú inicial
tests/test_menu.py     9 tests de integración
```

## Decisiones de diseño

**Pydantic es el esquema.** Mongo acepta cualquier documento, así que la colección no tiene forma propia: la impone `ItemMenuCreate`. Lo que no pasa por ahí, no entra.

**`_id` hacia afuera es `id`.** Mongo devuelve un `ObjectId`, que no es serializable a JSON. El modelo lo convierte a string y lo expone como `id`, manteniendo `_id` dentro de la base.

**Un id mal formado responde 400, no 500.** `ObjectId("abc")` lanza `InvalidId` antes de llegar a la consulta, así que el formato se valida primero. Un id bien formado que no existe sí es 404.

**`$set` en el update.** Sin el operador, Mongo reemplaza el documento entero y borra los campos que no se enviaron. Además se usa `exclude_unset` para no pisar con `null` lo que el cliente no mandó, y hay un test que lo cubre.

**Índices por código.** No hay migraciones: los índices se crean al arrancar la app. El índice único sobre `nombre` es el que hace que insertar un ingrediente repetido responda 409 en vez de duplicarlo en silencio.

**Un solo cliente de motor.** El pool de conexiones se abre al arrancar y se cierra al apagar. Crear un cliente por request es el error de rendimiento clásico con motor.

**Tests sin base real.** Usan `mongomock_motor`, que expone la misma API que motor en memoria, con la dependencia `get_db` reemplazada. Corren en medio segundo y no ensucian datos.

## Notas viniendo de Postgres

| Postgres / Supabase | Aquí |
|---|---|
| Migraciones y tablas con esquema | Sin migraciones: valida Pydantic, la colección se crea sola |
| `id SERIAL` / `uuid` | `_id` de tipo `ObjectId` generado por Mongo |
| `UPDATE ... SET` | `update_one({...}, {"$set": {...}})` |
| `CREATE INDEX` en la migración | `create_index` al arrancar la app |
| `WHERE categoria = 'SALSA'` | `find({"categoria": "SALSA"})` |
| JOIN entre tablas | No hay: se embebe el dato en el documento |
| `RETURNING *` | `find_one_and_update(..., return_document=AFTER)` |

## Pendiente

- Autenticación: hoy cualquiera puede modificar el menú.
- Paginación con total de resultados, no solo `limite` y `salto`.
- Colecciones de carrito y órdenes.
