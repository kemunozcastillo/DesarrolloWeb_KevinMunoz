# Poke Fresh: gateway con sesiones

Gateway que protege la API de Productos. Para usarla hay que iniciar sesión con usuario y contraseña; el gateway guarda la sesión en una cookie y, en cada petición, le pregunta al Auth Service si sigue activa y qué rol tiene el usuario. Solo el rol `admin` puede borrar productos.

```
Navegador ──login──> Gateway ──> Auth Service ──> Vault
          <──cookie──┘

Navegador ──cookie──> Gateway ──¿activa? ¿rol?──> Auth Service
                         │
                         └──X-Credencial-Interna──> API de Productos
```

1. El usuario manda su usuario y contraseña a `POST /api/auth/login`.
2. El gateway se los pasa al Auth Service, que los valida y crea una sesión.
3. El gateway guarda el token de la sesión en una cookie `HttpOnly`. El token nunca aparece en el cuerpo de la respuesta, y JavaScript no puede leer la cookie.
4. En cada petición a productos, el gateway le pregunta al Auth Service si la sesión sigue activa (introspección) y qué rol tiene.
5. Si el rol puede hacer esa acción, el gateway lee de Vault la credencial interna y reenvía la petición al backend.

## Códigos de error

| Código | Cuándo |
|---|---|
| 401 | No hay sesión, la sesión venció o se cerró, o el usuario o la contraseña son incorrectos |
| 403 | El rol no alcanza (un `usuario` intentando borrar), la petición viene de un sitio no autorizado, o alguien llamó directo al backend |
| 429 | El usuario quedó bloqueado por intentos fallidos |
| 500 | Vault responde pero no deja leer los secretos (configuración) |
| 502 | Vault, el Auth Service o el backend están caídos |

## Rutas

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/auth/login` | Inicia sesión con `{ "usuario", "clave" }` |
| POST | `/api/auth/logout` | Cierra la sesión |
| GET | `/api/auth/sesion` | Muestra quién es el usuario y cuándo vence su sesión |
| GET, POST, PUT | `/api/v1/productos` | Requiere sesión. Va a `/items` del backend |
| DELETE | `/api/v1/productos/:id` | Requiere sesión con rol `admin` |
| GET | `/api/salud` | Estado de Vault, el Auth Service y el backend |

## Cómo correrlo

Son cuatro piezas: Vault, el Auth Service, el backend y el gateway.

**1. Levantar Vault en modo desarrollo** (en Windows se instala con `winget install Hashicorp.Vault`):

```bash
vault server -dev -dev-root-token-id=root
```

**2. Cargar los secretos.** Genera los tres secretos al azar, los guarda en Vault y crea un token de Vault para cada servicio:

```bash
cd gateway-seguro
npm install
VAULT_TOKEN=root npm run secretos
```

En PowerShell: `$env:VAULT_TOKEN="root"; npm run secretos`. El script muestra tres `VAULT_TOKEN`, uno para el `.env` de cada servicio.

**3. Crear los usuarios y levantar el Auth Service:**

```bash
cd auth-service
npm install
cp .env.example .env          # pegar el VAULT_TOKEN del auth-service
npm run usuarios-ejemplo      # anota las contraseñas que muestra
npm start
```

**4. Levantar el backend** con su `VAULT_TOKEN` en el `.env` (ver su README).

**5. Levantar el gateway:**

```bash
cp .env.example .env          # pegar el VAULT_TOKEN del gateway
npm start
```

**6. Probar todos los casos:**

```bash
npm run demo -- <contraseña de vendedor> <contraseña de admin>
```

Recorre en orden: productos sin sesión (401), contraseña incorrecta (401), login del vendedor, listar (200), crear (201), intentar borrar (403), login del admin, borrar (204), cerrar sesión, reusar la cookie (401) y llamar directo al backend (403). Para ver el 502, se apaga Vault o el Auth Service y se vuelve a correr.

Vault en modo desarrollo guarda todo en memoria: si se reinicia, hay que repetir los pasos 2 y 3.

## Probarlo con curl

```bash
# Login: guarda la cookie en cookies.txt
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -d '{"usuario":"admin","clave":"<contraseña>"}'

# Usar la sesión
curl -b cookies.txt http://localhost:3000/api/v1/productos

# Cerrar sesión
curl -b cookies.txt -X POST http://localhost:3000/api/auth/logout
```

## Detalles de seguridad

- Cada servicio tiene su propio token de Vault y solo puede leer lo que necesita (políticas en la carpeta `vault/`). El gateway no ve el pepper de las contraseñas, el backend no ve el secreto de introspección y el Auth Service no ve la credencial del backend.
- La cookie es `HttpOnly` (JavaScript no la puede leer), `SameSite=Lax` (otro sitio no la puede usar en un POST o DELETE) y `Secure` fuera de localhost (solo viaja por HTTPS).
- Además, el gateway rechaza con 403 cualquier petición que cambie datos y venga de un sitio que no está en `ORIGENES_PERMITIDOS`.
- El gateway no le pasa al backend la cookie del usuario. Le manda la credencial interna y quién hizo la petición (`X-Usuario`, `X-Usuario-Rol`), y reemplaza esas cabeceras si el cliente intenta mandarlas.
- La introspección se hace en cada petición, así un logout o un cambio de rol aplican de inmediato.

Para que el frontend en GitHub Pages use la cookie desde otro dominio, el gateway tiene que estar en HTTPS con `COOKIE_SAMESITE=None`, y algunos navegadores bloquean igual las cookies de terceros. Lo más simple es servir el frontend y el gateway desde el mismo dominio.

## Pruebas

```bash
npm test
```

Son 24 pruebas con Vault simulado, un Auth Service falso y un backend falso. Revisan el login y los atributos de la cookie, los 401 sin sesión o con sesión cerrada, el 403 por rol y por origen, que el backend reciba la credencial y el rol correctos, los 500 y 502 con cada servicio caído, y que cada token de Vault lea solo lo suyo.

## Estructura

```
src/
  server.js           arranque
  app.js              rutas y orden de las validaciones
  sesion.js           login, logout, cookie, introspección, roles y origen
  cliente-auth.js     llamadas al Auth Service
  vault.js            lectura de secretos
  proxy.js            reenvío al backend con la credencial interna
  config.js           variables de entorno
scripts/
  cargar-secretos.js  prepara Vault
  demo.js             recorre todos los casos
vault/                políticas de cada servicio
test/
```
