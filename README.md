# Poke Fresh: Auth Service

Servicio de autenticación de Poke Fresh. Maneja el login con usuario y contraseña, crea las sesiones y le responde al gateway si una sesión sigue activa y qué rol tiene el usuario.

Es un servicio interno: solo escucha en `127.0.0.1` y solo atiende al gateway, que se identifica con un secreto guardado en Vault. Los usuarios nunca le hablan directo.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/login` | Recibe `usuario` y `clave`. Si son correctos, crea una sesión y devuelve el token |
| POST | `/introspect` | Recibe un `token` y responde si está activo, de quién es y qué rol tiene |
| POST | `/logout` | Recibe un `token` y cierra esa sesión |
| GET | `/salud` | Estado del servicio y de Vault (no pide credencial) |

Todas menos `/salud` exigen `Authorization: Basic` con el usuario `gateway` y el secreto de introspección.

## Cómo funcionan las sesiones

- El token es un valor aleatorio de 256 bits que no contiene información. Lo que significa (quién es, qué rol tiene, cuándo vence) solo lo sabe este servicio, por eso el gateway tiene que preguntar con `/introspect`.
- Gracias a eso, cerrar sesión o desactivar un usuario tiene efecto inmediato. Con un token autocontenido como un JWT no se podría: seguiría sirviendo hasta que venza.
- Una sesión vence a los 30 minutos sin uso o a las 8 horas como máximo, lo que pase primero. Cada uso renueva el plazo de inactividad.
- Se guarda el hash de cada token, no el token. Si alguien leyera la memoria del servicio, no obtendría tokens que sirvan.
- Las sesiones viven en memoria: si se reinicia el servicio, todos tienen que volver a iniciar sesión.

## Contraseñas

- Se guardan con scrypt, cada una con su propia sal. En `data/usuarios.json` solo queda el hash, nunca la contraseña.
- Antes del hash, la contraseña se mezcla con un pepper que vive en Vault. Si alguien se robara el archivo de usuarios, sin el pepper no podría ni empezar a probar contraseñas.
- Tras 5 intentos fallidos seguidos, el usuario queda bloqueado 5 minutos (responde 429).
- Usuario inexistente y contraseña incorrecta dan el mismo mensaje y tardan lo mismo, así no se puede averiguar qué usuarios existen.

## Roles

| Rol | Puede |
|---|---|
| `admin` | Ver, crear, editar y borrar productos |
| `usuario` | Ver, crear y editar productos, pero no borrar |

La regla de qué puede cada rol la aplica el gateway. Este servicio solo informa el rol.

## Cómo correrlo

Primero hay que tener Vault con los secretos cargados (ver el README del gateway).

```bash
cd auth-service
npm install
cp .env.example .env          # y pegar el VAULT_TOKEN del auth-service
npm run usuarios-ejemplo      # crea admin y vendedor
npm start
```

`npm run usuarios-ejemplo` muestra las contraseñas una sola vez; hay que anotarlas. Para crear otro usuario:

```bash
npm run usuario -- maria usuario "María González"
```

Si el usuario ya existe, se actualiza su nombre, rol y contraseña. Los cambios se notan al instante, sin reiniciar: si a alguien se le cambia el rol o se desactiva, su sesión abierta lo refleja en la petición siguiente.

## Pruebas

```bash
npm test
```

Son 20 pruebas con un Vault simulado y un reloj controlable, para probar la expiración sin esperar 30 minutos. Revisan el login, el bloqueo por intentos, la introspección, las dos expiraciones, el logout, los cambios de rol y desactivación, el hash de las contraseñas y los errores cuando Vault no responde.

## Estructura

```
src/
  server.js           arranque
  app.js              endpoints
  sesiones.js         sesiones e intentos fallidos
  usuarios.js         usuarios en data/usuarios.json
  claves.js           hash de contraseñas con scrypt y pepper
  vault.js            lectura de secretos
  config.js           variables de entorno
scripts/crear-usuario.js
test/
```
