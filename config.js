/**
 * Configuración del gateway, desde variables de entorno.
 *
 * Aquí no hay ninguna contraseña: el secreto de introspección y la credencial
 * interna viven en Vault. Lo único sensible es VAULT_TOKEN, la llave para
 * hablar con Vault, que se entrega por entorno y nunca va al repositorio.
 */

const lista = (valor) =>
  String(valor ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const entero = (valor, porDefecto) => {
  const numero = Number.parseInt(valor, 10);
  return Number.isFinite(numero) && numero >= 0 ? numero : porDefecto;
};

export function leerConfig(entorno = process.env) {
  return {
    puerto: entero(entorno.PORT, 3000),

    // HashiCorp Vault (motor KV versión 2, montado en "secret").
    vaultAddr: (entorno.VAULT_ADDR ?? "http://127.0.0.1:8200").replace(/\/$/, ""),
    vaultToken: entorno.VAULT_TOKEN ?? "",
    vaultMontaje: entorno.VAULT_MONTAJE ?? "secret",
    rutaSecretoIntrospeccion: entorno.VAULT_RUTA_INTROSPECCION ?? "poke-fresh/introspeccion",
    rutaSecretoBackend: entorno.VAULT_RUTA_BACKEND ?? "poke-fresh/backend",
    // Segundos que se guarda lo leído de Vault. 0 = consultar en cada petición,
    // que es lo que permite mostrar el error apenas Vault se cae.
    vaultCacheSegundos: entero(entorno.VAULT_CACHE_SEGUNDOS, 0),

    // API de Productos (FastAPI + MongoDB) y Auth Service.
    urlBackend: (entorno.URL_BACKEND ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
    urlAuth: (entorno.URL_AUTH ?? "http://127.0.0.1:4100").replace(/\/$/, ""),

    // Cookie de sesión. Secure exige HTTPS: se desactiva solo para probar en
    // localhost. SameSite=Lax evita que otro sitio la use en un POST o DELETE.
    cookieNombre: entorno.COOKIE_NOMBRE ?? "pf_sesion",
    cookieSecure: entorno.COOKIE_SECURE !== "false",
    cookieSameSite: entorno.COOKIE_SAMESITE ?? "Lax",

    origenesPermitidos: lista(entorno.ORIGENES_PERMITIDOS ?? "http://localhost:5500,http://127.0.0.1:5500"),
    tiempoMaximoMs: entero(entorno.TIEMPO_MAXIMO_MS, 10_000),
    registrarAccesos: entorno.NODE_ENV !== "test",
  };
}
