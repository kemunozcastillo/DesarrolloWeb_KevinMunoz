/**
 * Configuración del gateway, desde variables de entorno.
 *
 * Aquí no hay ninguna contraseña: las credenciales internas y el secreto con
 * que el gateway se presenta al Auth Service viven en Vault. Lo único sensible
 * es el token de Vault, que llega por entorno o en un archivo y nunca va al repositorio.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const lista = (valor) =>
  String(valor ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const entero = (valor, porDefecto) => {
  const numero = Number.parseInt(valor, 10);
  return Number.isFinite(numero) && numero >= 0 ? numero : porDefecto;
};

const url = (valor, porDefecto) => (valor ?? porDefecto).replace(/\/$/, "");

function tokenVault(entorno) {
  if (entorno.VAULT_TOKEN_ARCHIVO && existsSync(entorno.VAULT_TOKEN_ARCHIVO)) return readFileSync(entorno.VAULT_TOKEN_ARCHIVO, "utf8").trim();
  return entorno.VAULT_TOKEN ?? "";
}

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

export function leerConfig(entorno = process.env) {
  return {
    puerto: entero(entorno.PORT, 8080),
    host: entorno.HOST ?? "127.0.0.1",
    // Certificado y clave del servidor (HTTPS). Sin ellos, HTTP.
    tlsCert: entorno.TLS_CERT ?? "",
    tlsKey: entorno.TLS_KEY ?? "",
    // Vigencia de HSTS en segundos. En local es corta: HSTS sobre "localhost" afecta a todos los puertos.
    hstsMaxAge: entero(entorno.HSTS_MAX_AGE, 31_536_000),

    // HashiCorp Vault (motor KV versión 2, montado en "secret").
    vaultAddr: url(entorno.VAULT_ADDR, "http://127.0.0.1:8200"),
    vaultToken: tokenVault(entorno),
    vaultMontaje: entorno.VAULT_MONTAJE ?? "secret",
    rutaInternos: entorno.VAULT_RUTA_INTERNOS ?? "poke-fresh/internos",
    vaultCacheSegundos: entero(entorno.VAULT_CACHE_SEGUNDOS, 30),

    // Servicios privados. Solo el gateway los conoce.
    urls: {
      auth: url(entorno.URL_AUTH, "http://127.0.0.1:4100"),
      inventario: url(entorno.URL_INVENTARIO, "http://127.0.0.1:8001"),
      clientes: url(entorno.URL_CLIENTES, "http://127.0.0.1:8002"),
      pedidos: url(entorno.URL_PEDIDOS, "http://127.0.0.1:8003"),
      pagos: url(entorno.URL_PAGOS, "http://127.0.0.1:8004"),
      graphql: url(entorno.URL_GRAPHQL, "http://127.0.0.1:4000"),
    },

    // El frontend se sirve desde el mismo origen que la API: la cookie de
    // sesión funciona sin CORS y con SameSite.
    dirFrontend: entorno.DIR_FRONTEND ?? join(RAIZ, "..", "frontend"),

    cookieNombre: entorno.COOKIE_NOMBRE ?? "pf_sesion",
    cookieSecure: entorno.COOKIE_SECURE !== "false",
    cookieSameSite: entorno.COOKIE_SAMESITE ?? "Lax",

    origenesPermitidos: lista(entorno.ORIGENES_PERMITIDOS ?? "http://localhost:8080,http://127.0.0.1:8080"),
    tiempoMaximoMs: entero(entorno.TIEMPO_MAXIMO_MS, 8_000),

    // Límite de peticiones por IP y minuto: general y para login/registro.
    limiteGeneral: entero(entorno.LIMITE_POR_MINUTO, 300),
    limiteSensibles: entero(entorno.LIMITE_SENSIBLES_POR_MINUTO, 20),

    modoDemo: (entorno.MODO_DEMO ?? "true") === "true",
    cuentasDemo: [
      { perfil: "Cliente", email: "cliente@correo.cl", clave: "Cliente2026" },
      { perfil: "Administrador", email: "admin@pokefresh.cl", clave: "Admin2026" },
      { perfil: "Dueño", email: "dueno@pokefresh.cl", clave: "Dueno2026" },
      { perfil: "Cocina", email: "cocina@pokefresh.cl", clave: "Cocina2026" },
      { perfil: "Encargado de despacho", email: "despacho@pokefresh.cl", clave: "Despacho2026" },
    ],

    registrarAccesos: entorno.NODE_ENV !== "test",
  };
}
