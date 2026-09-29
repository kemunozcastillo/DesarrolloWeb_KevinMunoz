# Poke Fresh: gateway con seguridad

Gateway que protege la API de Productos. Ahora nadie puede consultar los productos sin un token, y el backend rechaza cualquier llamada que no venga del gateway.

```
Cliente ──Bearer token──> Gateway ──consulta──> Vault
                             │
                             └──X-Credencial-Interna──> API de Productos
```

1. El cliente manda su token en la cabecera `Authorization: Bearer <token>`.
2. El gateway busca en Vault cuál es el token válido y lo compara.
3. Si coincide, agrega una credencial interna (otro secreto guardado en Vault) y reenvía la petición al backend.
4. El backend revisa esa credencial. Si no viene o no coincide, responde 403.

Ninguna contraseña está escrita en el código. Los dos secretos están en Vault, y lo único que va en el `.env` es el token para conectarse a Vault.

## Códigos de error

| Código | Cuándo |
|---|---|
| 401 | No se mandó token, el formato no es `Bearer`, o el token es incorrecto |
| 403 | Alguien llamó directo al backend sin pasar por el gateway |
| 500 | Vault responde pero el gateway no puede leer sus secretos (token o ruta mal configurados) |
| 502 | Vault o el backend están caídos |
| 504 | El backend tardó demasiado en responder |

## Cómo correrlo

**1. Levantar Vault en modo desarrollo.** Con Vault instalado (en Windows: `winget install Hashicorp.Vault`):

```bash
vault server -dev -dev-root-token-id=root
```

O con Docker:

```bash
docker run --cap-add=IPC_LOCK -e VAULT_DEV_ROOT_TOKEN_ID=root -p 8200:8200 hashicorp/vault
```

**2. Cargar los secretos.** El script genera el token de los clientes y la credencial interna al azar, los guarda en Vault y crea un token de Vault para cada servicio:

```bash
cd gateway-seguro
npm install
VAULT_TOKEN=root npm run secretos
```

En PowerShell el comando es `$env:VAULT_TOKEN="root"; npm run secretos`.

El script muestra el token del cliente y el `VAULT_TOKEN` que va en el `.env` del gateway y en el del backend.

**3. Levantar el backend** con su `VAULT_TOKEN` en el `.env` (ver el README de la API).

**4. Levantar el gateway:**

```bash
cp .env.example .env    # y pegar el VAULT_TOKEN del gateway
npm start
```

**5. Probar los casos:**

```bash
npm run demo -- <token del cliente>
```

Muestra el 401 sin token, el 401 con token incorrecto, el 200 con el correcto y los dos 403 al llamar directo al backend. Para ver el 502, se apaga Vault o el backend y se vuelve a correr.

Vault en modo desarrollo guarda todo en memoria: si se reinicia, hay que volver a correr `npm run secretos` y actualizar los `VAULT_TOKEN` de los `.env`.

## Rutas

| Ruta | Protegida | Va a |
|---|---|---|
| `/api/v1/productos` | Sí | `/items` del backend |
| `/api/v1/productos/:id` | Sí | `/items/:id` del backend |
| `/api/salud` | No | Estado del gateway, de Vault y del backend |

Ejemplo con curl:

```bash
curl http://localhost:3000/api/v1/productos -H "Authorization: Bearer <token del cliente>"
```

## Detalles de seguridad

- El token del cliente y la credencial interna están en rutas distintas de Vault. El gateway puede leer las dos, pero el backend solo la suya, así que si alguien consiguiera el acceso del backend a Vault, no vería el token de los clientes. Las políticas están en la carpeta `vault/`.
- El gateway no le pasa al backend el token del cliente, y si el cliente intenta mandar su propia `X-Credencial-Interna`, se reemplaza por la real.
- Los secretos se comparan en tiempo constante, para que no se puedan adivinar midiendo cuánto tarda la respuesta.
- Por defecto se consulta Vault en cada petición: si se cambia el token en Vault, el cambio aplica al instante, y si Vault se cae, el error aparece de inmediato. Con `VAULT_CACHE_SEGUNDOS` se puede guardar un rato para no consultarlo tanto.

## Pruebas

```bash
npm test
```

Son 19 pruebas con un Vault simulado y un backend falso. Revisan los 401, el 403, los 500 y 502, que la credencial interna llegue al backend y el token del cliente no, y que el backend no pueda leer el token de los clientes en Vault.

## Estructura

```
src/
  server.js           arranque
  app.js              rutas del gateway
  autenticacion.js    validación del Bearer Token contra Vault
  vault.js            lectura de secretos en Vault
  proxy.js            reenvío al backend con la credencial interna
  config.js           variables de entorno
scripts/
  cargar-secretos.js  prepara Vault
  demo.js             muestra los códigos de error
vault/
  politica-gateway.hcl
  politica-backend.hcl
test/
```
