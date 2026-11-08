/**
 * Configuración del GraphQL Gateway, desde variables de entorno. Sin
 * contraseñas: las credenciales internas se leen de Vault.
 */

import { existsSync, readFileSync } from "node:fs";

const entero = (valor, porDefecto) => {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) && n >= 0 ? n : porDefecto;
};
const url = (valor, porDefecto) => (valor ?? porDefecto).replace(/\/$/, "");

function tokenVault(entorno) {
  if (entorno.VAULT_TOKEN_ARCHIVO && existsSync(entorno.VAULT_TOKEN_ARCHIVO)) return readFileSync(entorno.VAULT_TOKEN_ARCHIVO, "utf8").trim();
  return entorno.VAULT_TOKEN ?? "";
}

export function leerConfig(entorno = process.env) {
  return {
    puerto: entero(entorno.PORT, 4000),
    host: entorno.HOST ?? "127.0.0.1",
    vaultAddr: url(entorno.VAULT_ADDR, "http://127.0.0.1:8200"),
    vaultToken: tokenVault(entorno),
    vaultMontaje: entorno.VAULT_MONTAJE ?? "secret",
    vaultCacheSegundos: entero(entorno.VAULT_CACHE_SEGUNDOS, 30),
    rutaInternos: entorno.VAULT_RUTA_INTERNOS ?? "poke-fresh/internos",
    urls: {
      inventario: url(entorno.URL_INVENTARIO, "http://127.0.0.1:8001"),
      clientes: url(entorno.URL_CLIENTES, "http://127.0.0.1:8002"),
      pedidos: url(entorno.URL_PEDIDOS, "http://127.0.0.1:8003"),
      pagos: url(entorno.URL_PAGOS, "http://127.0.0.1:8004"),
    },
    tiempoMaximoMs: entero(entorno.TIEMPO_MAXIMO_MS, 3_000),
    profundidadMaxima: entero(entorno.PROFUNDIDAD_MAXIMA, 6),
    costoMaximo: entero(entorno.COSTO_MAXIMO, 1_000),
    introspeccion: entorno.NODE_ENV !== "production",
  };
}
