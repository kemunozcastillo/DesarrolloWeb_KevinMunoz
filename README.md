# Poke Fresh

Tienda web de poke bowls (caso 24) con su backend completo: frontend, API Gateway, Auth Service, GraphQL Gateway, cuatro microservicios (inventario, clientes, pedidos y pagos), Vault, MongoDB y ActiveMQ.

Ramo: Desarrollo Web, UNAB. Evaluación de la Unidad 2.

El informe con las matrices, los diagramas y las pruebas está en [docs/INFORME.md](docs/INFORME.md).

## Qué hay en cada carpeta

| Carpeta | Qué es |
|---|---|
| `frontend/` | La tienda y el panel del restaurante (HTML, CSS y JavaScript, sin frameworks) |
| `gateway/` | API Gateway (Node + Express). Sirve el frontend y es la única entrada a la API |
| `auth-service/` | Cuentas, contraseñas, sesiones y verificación de correo (Node) |
| `graphql-gateway/` | Agregaciones GraphQL sobre los microservicios (Apollo Server) |
| `servicios/` | Microservicios en FastAPI: `inventario`, `clientes`, `pedidos`, `pagos`, la pasarela de pago simulada y el notificador de ActiveMQ |
| `vault/` | Políticas de Vault por servicio y el script que prepara Vault y Mongo |
| `pruebas/` | Pruebas de punta a punta, recorrido de pantallas, prueba de carga y un entorno local sin Docker |
| `docs/` | Informe, diagramas (Mermaid y un modelo C4 en Structurizr DSL, editables), ADR y evidencias |

## Cómo levantarlo

Se necesita Docker Desktop (o Docker Engine con Compose).

1. Crear el archivo `.env` a partir del ejemplo y cambiar `MONGO_ROOT_CLAVE` por una clave larga:

   ```bash
   cp .env.example .env        # en Windows: copy .env.example .env
   ```

2. Levantar todo:

   ```bash
   docker compose up -d --build
   ```

   La primera vez demora unos minutos (descarga imágenes e instala dependencias). El contenedor `vault-init` inicializa Vault, crea los secretos y un usuario de Mongo por servicio, y termina; `semilla` carga los datos de ejemplo y también termina. Los demás quedan corriendo.

3. Abrir **http://localhost:8080**. La pasarela de pago de prueba queda en http://localhost:9000.

Para ver el estado: `docker compose ps` (todos `healthy`, salvo `vault-init` y `semilla`, que terminan con `Exited (0)`). Estado de cada componente: http://localhost:8080/api/salud.

Para detener: `docker compose down`. Para borrar también los datos: `docker compose down -v`.

### Cuentas de prueba

Solo existen con `MODO_DEMO=true` (el valor por defecto) y también aparecen en la pantalla de ingreso.

| Perfil | Correo | Contraseña |
|---|---|---|
| Cliente | cliente@correo.cl | Cliente2026 |
| Administrador | admin@pokefresh.cl | Admin2026 |
| Dueño | dueno@pokefresh.cl | Dueno2026 |
| Cocina | cocina@pokefresh.cl | Cocina2026 |
| Encargado de despacho | despacho@pokefresh.cl | Despacho2026 |

En modo demo el correo de verificación y la boleta no se envían de verdad: el código aparece en pantalla y el notificador deja la boleta en su log (`docker compose logs notificador`).

### Si algo falla

- `docker compose logs -f <servicio>` muestra los registros; cada línea trae el `X-Request-Id` de la petición.
- Si Vault se reinicia solo, queda sellado y los servicios responden 503. Se arregla con `docker compose up -d` (vuelve a correr `vault-init`, que lo desbloquea).
- Para partir de cero: `docker compose down -v` y de nuevo `docker compose up -d --build`.

## Pruebas

```bash
# Unitarias e integración de cada componente
cd servicios && pip install -r requirements-dev.txt && pytest      # 35 pruebas
cd auth-service && npm install && npm test                           # 20 pruebas
cd gateway && npm install && npm test                                # 17 pruebas
cd graphql-gateway && npm install && npm test                        # 11 pruebas

# De punta a punta, con el sistema arriba (deja evidencia en docs/evidencias/)
pip install httpx playwright && playwright install chromium
python pruebas/e2e/casos.py                 # 19 casos de seguridad y negocio (contra Docker)
python pruebas/e2e/pantallas.py             # recorrido de 16 pantallas de escritorio y 6 móviles, con capturas
node pruebas/carga/carga.mjs                # prueba de carga (ver docs/evidencias/carga.md)
```

En total son 83 pruebas unitarias y de integración (35 + 20 + 17 + 11) y 19 casos de punta a punta. El caso 7.11 bloquea a propósito la cuenta del dueño unos 5 minutos y agota el límite de logins por IP del gateway: espera un minuto entre `casos.py` y `pantallas.py`, y para repetir `casos.py` espera 5 minutos o reinicia con `docker compose down -v`. Para la prueba de carga hay que subir `LIMITE_POR_MINUTO` en `.env` (por ejemplo 100000), recrear el gateway con `docker compose up -d gateway` y volver al valor por defecto (300) después.

Sin Docker también se puede levantar todo con Mongo, Vault y ActiveMQ simulados en memoria (útil para las pruebas): `bash pruebas/local/levantar.sh`, y `python pruebas/e2e/casos.py --gateway http://127.0.0.1:8080 --pasarela http://127.0.0.1:9000 --directo` agrega 3 casos (7.9 acceso directo a los servicios, 7.10 secreto ajeno en Vault y 10.7 Vault sellado), 22 en total. Esos tres necesitan alcanzar la red privada desde el equipo, algo que en Docker está bloqueado a propósito, por eso solo corren en este entorno local.

## Variables de entorno

Ningún archivo del repositorio trae contraseñas. Las únicas variables con algo sensible van en `.env` (que no se sube):

| Variable | Para qué |
|---|---|
| `MONGO_ROOT_USUARIO`, `MONGO_ROOT_CLAVE` | Usuario raíz de Mongo. Solo lo usa `vault-init` para crear un usuario por servicio |
| `MODO_DEMO` | `true`: cuentas de prueba, códigos en pantalla y datos de ejemplo |
| `LIMITE_POR_MINUTO` | Peticiones por minuto y por IP en el gateway (300 por defecto) |

Todo lo demás (credenciales internas, pepper de contraseñas, clave de la pasarela, usuarios de Mongo de cada servicio) lo genera `vault-init` y vive en Vault.
