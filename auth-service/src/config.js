/**
 * Configuración del Auth Service, desde variables de entorno.
 *
 * No hay contraseñas aquí. El pepper de las claves, los secretos de los
 * clientes del servicio y el usuario de Mongo están en Vault; por entorno
 * solo llega dónde está el token de Vault.
 */

import { existsSync, readFileSync } from "node:fs";

const entero = (valor, porDefecto) => {
  const numero = Number.parseInt(valor, 10);
  return Number.isFinite(numero) && numero >= 0 ? numero : porDefecto;
};

function tokenVault(entorno) {
  if (entorno.VAULT_TOKEN_ARCHIVO && existsSync(entorno.VAULT_TOKEN_ARCHIVO)) return readFileSync(entorno.VAULT_TOKEN_ARCHIVO, "utf8").trim();
  return entorno.VAULT_TOKEN ?? "";
}

export function leerConfig(entorno = process.env) {
  return {
    puerto: entero(entorno.PORT, 4100),
    host: entorno.HOST ?? "127.0.0.1",
    // Certificado y clave del servidor (HTTPS). Sin ellos, HTTP.
    tlsCert: entorno.TLS_CERT ?? "",
    tlsKey: entorno.TLS_KEY ?? "",

    vaultAddr: (entorno.VAULT_ADDR ?? "http://127.0.0.1:8200").replace(/\/$/, ""),
    vaultToken: tokenVault(entorno),
    vaultMontaje: entorno.VAULT_MONTAJE ?? "secret",
    rutaSecretoAuth: entorno.VAULT_RUTA_AUTH ?? "poke-fresh/auth",
    // Bajo esta ruta está el secreto de cada cliente: <ruta>/auth-gateway, <ruta>/auth-clientes
    rutaClientes: entorno.VAULT_RUTA_CLIENTES ?? "poke-fresh/internos",
    rutaMongo: entorno.MONGO_RUTA_VAULT ?? "",
    vaultCacheSegundos: entero(entorno.VAULT_CACHE_SEGUNDOS, 30),

    mongoUri: entorno.MONGO_URI ?? "mongodb://127.0.0.1:27017",
    mongoDb: entorno.MONGO_DB ?? "pf_auth",

    // Una sesión vence por inactividad o al cumplir su duración máxima, lo que ocurra primero.
    sesionInactividadSeg: entero(entorno.SESION_INACTIVIDAD_SEG, 30 * 60),
    sesionMaximaSeg: entero(entorno.SESION_MAXIMA_SEG, 8 * 60 * 60),

    // Intentos fallidos antes de bloquear un correo, y por cuánto tiempo.
    maxIntentos: entero(entorno.MAX_INTENTOS, 5),
    bloqueoSeg: entero(entorno.BLOQUEO_SEG, 5 * 60),

    // Modo demo: los códigos de verificación vuelven en la respuesta (correo simulado)
    // y se crean las cuentas de prueba si la base está vacía.
    modoDemo: (entorno.MODO_DEMO ?? "true") === "true",

    registrarAccesos: entorno.NODE_ENV !== "test",
  };
}
