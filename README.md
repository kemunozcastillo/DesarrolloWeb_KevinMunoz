# Poke Fresh: API gateway

Gateway hecho en Express que funciona como entrada única a la API de Poke Fresh. Recibe todas las peticiones y las manda al servicio que corresponde:

- `/api/v1/menu` va a la API REST del menú (FastAPI + MongoDB).
- `/api/v1/graphql` va a la API GraphQL de la tienda (Apollo).

## Cómo correrlo

Primero hay que levantar las dos APIs. Después:

```bash
cd gateway
npm install
cp .env.example .env
npm start
```

Queda en `http://localhost:3000`. Para ver si los dos servicios están respondiendo, abrir `http://localhost:3000/api/salud`.

## Rutas

| Ruta | Va a | Métodos |
|---|---|---|
| `/api/v1/menu` | `/items` de la API REST | GET, POST |
| `/api/v1/menu/:id` | `/items/:id` de la API REST | GET, PUT, DELETE |
| `/api/v1/graphql` | `/graphql` de la API GraphQL | GET, POST |
| `/api/salud` | Estado de los dos servicios | GET |
| `/api` | Lista de rutas disponibles | GET |

La query se mantiene: `/api/v1/menu?categoria=SALSA` llega como `/items?categoria=SALSA`. Las rutas están definidas en `src/rutas.js`.

Ejemplos:

```bash
curl "http://localhost:3000/api/v1/menu?categoria=SALSA"

curl -X POST http://localhost:3000/api/v1/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ tamanos { id precio } }"}'
```

## Qué más hace

- Maneja el CORS para que el frontend en GitHub Pages pueda llamar a la API. Los orígenes permitidos se configuran en el `.env`.
- Limita la cantidad de peticiones por minuto, con un límite más bajo para crear, editar y borrar en la API REST.
- Responde los errores en JSON: 404 si la ruta no existe, 405 si el método no corresponde, 502 si un servicio está caído y 504 si tarda demasiado.
- Le pone un `X-Request-Id` a cada petición y lo manda al servicio, para poder seguirla en los logs.

## Configuración

Las variables están en `.env.example`:

| Variable | Para qué |
|---|---|
| `PORT` | Puerto del gateway (3000) |
| `URL_API_REST` | Dirección de la API REST |
| `URL_API_GRAPHQL` | Dirección de la API GraphQL |
| `ORIGENES_PERMITIDOS` | Sitios que pueden llamar a la API, separados por coma |
| `TIEMPO_MAXIMO_MS` | Cuánto esperar a un servicio antes de responder 504 |
| `LIMITE_GENERAL` y `LIMITE_ESCRITURA` | Peticiones por minuto |

## Pruebas

```bash
npm test
```

Son 20 pruebas que usan servicios de mentira, así que no hace falta tener MongoDB ni las APIs corriendo.