# [PR] Auth Service con sesiones, introspección y autorización por rol

## Qué se hizo

El gateway deja de usar un Bearer Token fijo. Ahora:

- Hay un Auth Service con login de usuario y contraseña, sesiones con expiración y logout.
- El gateway guarda la sesión en una cookie `HttpOnly` y, en cada petición, le pregunta al Auth Service si sigue activa (introspección).
- Solo el rol `admin` puede borrar productos; el rol `usuario` puede ver, crear y editar.
- Vault guarda los tres secretos del sistema, y cada servicio tiene un token que solo lee los suyos.

## Cambios

**Auth Service nuevo (`auth-service/`)**
- `POST /login`, `POST /introspect`, `POST /logout`.
- Contraseñas con scrypt, sal por usuario y un pepper guardado en Vault.
- Tokens opacos de 256 bits; se guarda su hash, no el token.
- Sesiones que vencen a los 30 minutos sin uso o a las 8 horas como máximo.
- Bloqueo de 5 minutos tras 5 intentos fallidos.
- Solo atiende al gateway, que se identifica con un secreto de Vault.
- Script para crear usuarios con contraseñas aleatorias.

**Gateway (`gateway-seguro/`)**
- Login y logout en `/api/auth`, con cookie `HttpOnly`, `SameSite=Lax` y `Secure`.
- Introspección en cada petición a productos.
- Permisos por método y rol: `DELETE` solo para `admin`.
- Rechazo de peticiones que cambian datos desde sitios no autorizados.
- El script de secretos ahora crea tres secretos, tres políticas y un token por servicio.

**Backend:** sin cambios en el código; sigue exigiendo la credencial interna.

## Códigos de error

| Código | Cuándo |
|---|---|
| 401 | Sin sesión, sesión vencida o cerrada, o credenciales incorrectas |
| 403 | Rol insuficiente, origen no autorizado, o llamada directa al backend |
| 429 | Usuario bloqueado por intentos fallidos |
| 500 | Vault no permite leer los secretos |
| 502 | Vault, el Auth Service o el backend caídos |

## Pruebas

- Auth Service: 20 pruebas (`npm test`).
- Gateway: 24 pruebas (`npm test`).
- Probado de punta a punta con los cuatro servicios reales: `npm run demo` recorre los 11 casos con el resultado esperado, y se verificó el 502 con Vault sellado y con el Auth Service apagado.
