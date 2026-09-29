/**
 * Prepara Vault para Poke Fresh:
 *   1. Genera el token de los clientes y la credencial interna, al azar.
 *   2. Los guarda en dos rutas separadas del motor KV:
 *        secret/poke-fresh/gateway  { token_cliente }
 *        secret/poke-fresh/backend  { credencial_interna }
 *   3. Crea una política para el gateway y otra para el backend, y un token
 *      de Vault para cada uno con solo esos permisos.
 *
 * Uso (con Vault en modo desarrollo y su token raíz):
 *   VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=root npm run secretos
 *   npm run secretos -- --rotar      genera secretos nuevos aunque ya existan
 *
 * Los secretos nunca se escriben en el código ni en el repositorio.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const VAULT_ADDR = (process.env.VAULT_ADDR ?? "http://127.0.0.1:8200").replace(/\/$/, "");
const VAULT_TOKEN = process.env.VAULT_TOKEN_ADMIN ?? process.env.VAULT_TOKEN;
const ROTAR = process.argv.includes("--rotar");

if (!VAULT_TOKEN) {
  console.error("Falta el token de Vault. Ejecuta con VAULT_TOKEN=<token raíz> npm run secretos");
  process.exit(1);
}

const secreto = () => randomBytes(32).toString("base64url");
const leerPolitica = (nombre) => readFileSync(fileURLToPath(new URL(`../vault/${nombre}`, import.meta.url)), "utf8");

async function vault(metodo, ruta, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(`${VAULT_ADDR}/v1/${ruta}`, {
      method: metodo,
      headers: { "X-Vault-Token": VAULT_TOKEN, "Content-Type": "application/json" },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new Error(`No hay conexión con Vault en ${VAULT_ADDR}. ¿Está corriendo?`);
  }
  if (respuesta.status === 404 && metodo === "GET") return null;
  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Vault respondió ${respuesta.status} en ${ruta}: ${detalle}`);
  }
  return respuesta.status === 204 ? null : respuesta.json();
}

async function asegurarSecreto(ruta, clave) {
  const actual = await vault("GET", `secret/data/${ruta}`);
  const existente = actual?.data?.data?.[clave];
  if (existente && !ROTAR) return { valor: existente, nuevo: false };

  const valor = secreto();
  await vault("POST", `secret/data/${ruta}`, { data: { [clave]: valor } });
  return { valor, nuevo: true };
}

try {
  const cliente = await asegurarSecreto("poke-fresh/gateway", "token_cliente");
  const interna = await asegurarSecreto("poke-fresh/backend", "credencial_interna");

  await vault("PUT", "sys/policies/acl/poke-fresh-gateway", { policy: leerPolitica("politica-gateway.hcl") });
  await vault("PUT", "sys/policies/acl/poke-fresh-backend", { policy: leerPolitica("politica-backend.hcl") });

  const crearToken = (politica) => vault("POST", "auth/token/create", { policies: [politica], ttl: "720h", display_name: politica }).then((r) => r.auth.client_token);
  const [tokenGateway, tokenBackend] = await Promise.all([crearToken("poke-fresh-gateway"), crearToken("poke-fresh-backend")]);

  console.log(`
Secretos ${cliente.nuevo || interna.nuevo ? "creados" : "ya existentes (usa --rotar para cambiarlos)"} en ${VAULT_ADDR}

Token para los clientes (va en Authorization: Bearer ...):
  ${cliente.valor}

En el .env del gateway:
  VAULT_TOKEN=${tokenGateway}

En el .env del backend:
  VAULT_TOKEN=${tokenBackend}

Cada token de Vault solo puede leer lo que su servicio necesita (ver carpeta vault/).
`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
