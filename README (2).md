# Poke Fresh: API de Productos

API REST del menú de Poke Fresh, hecha con FastAPI y MongoDB. Permite consultar, crear, editar y eliminar productos (bases, proteínas, salsas, toppings, bebidas y promociones).

Desde esta versión la API solo responde a peticiones que llegan por el gateway. Cada petición tiene que traer la cabecera `X-Credencial-Interna` con un valor guardado en HashiCorp Vault; si no la trae o no coincide, responde 403.

## Cómo correrlo

Se necesita MongoDB y Vault corriendo, con los secretos cargados (ver el README del gateway, paso 2).

```bash
python -m venv .venv
.venv\Scripts\activate          # en Linux o Mac: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # y pegar el VAULT_TOKEN del backend
python -m scripts.seed          # carga el menú inicial
uvicorn app.main:app --reload
```

Queda en `http://127.0.0.1:8000`. La documentación de Swagger está en `/docs`, pero las rutas de productos van a responder 403 desde ahí porque no pasan por el gateway. Para probarlas hay que usar el gateway.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/items` | Lista los productos. Acepta `categoria`, `solo_disponibles`, `limite` y `salto` |
| GET | `/items/{id}` | Busca un producto |
| POST | `/items` | Crea un producto |
| PUT | `/items/{id}` | Edita uno o más campos |
| DELETE | `/items/{id}` | Elimina un producto |
| GET | `/salud` | Estado del servicio (no pide credencial) |

Respuestas de error:

| Código | Cuándo |
|---|---|
| 400 | El id no tiene formato de ObjectId, o el PUT viene vacío |
| 403 | Falta la credencial interna o es incorrecta |
| 404 | El producto no existe |
| 409 | Ya existe un producto con ese nombre |
| 422 | Los datos no cumplen el formato (por ejemplo, un precio negativo) |
| 500 | No se pudo consultar Vault para comparar la credencial |

## Cómo funciona la credencial interna

La revisión está en `app/seguridad.py` y se aplica a todas las rutas de `/items`.

- Si la petición no trae `X-Credencial-Interna`, se rechaza con 403 sin consultar a Vault.
- Si la trae, se compara con la guardada en Vault, en `secret/poke-fresh/backend`. La comparación se hace en tiempo constante.
- El valor leído se guarda 30 segundos (`VAULT_CACHE_SEGUNDOS`) para no consultar a Vault en cada petición.
- El token de Vault del backend solo puede leer esa ruta, no los demás secretos del sistema.

## Configuración

Las variables están en `.env.example`:

| Variable | Para qué |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | Conexión a MongoDB |
| `VAULT_ADDR` | Dirección de Vault |
| `VAULT_TOKEN` | Token de Vault del backend (lo entrega `npm run secretos` en el gateway) |
| `VAULT_RUTA_BACKEND` | Ruta del secreto (`poke-fresh/backend`) |
| `VAULT_CACHE_SEGUNDOS` | Cuánto se guarda la credencial leída |

## Pruebas

```bash
pytest
```

Son 16 pruebas con una base de datos en memoria y un Vault simulado, así que no hace falta tener MongoDB ni Vault corriendo. Revisan el CRUD, los errores de validación, el 403 sin credencial o con una incorrecta, y el 500 cuando Vault no responde.

## Estructura

```
app/
  main.py           arranque y rutas protegidas
  seguridad.py      revisión de la credencial interna contra Vault
  config.py         variables de entorno
  database.py       conexión a MongoDB
  models.py         modelos de Pydantic
  routers/menu.py   endpoints de productos
scripts/seed.py     carga el menú inicial
tests/test_menu.py
```
