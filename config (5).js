/**
 * Configuración del Auth Service, desde variables de entorno.
 *
 * No hay contraseñas aquí. El pepper de las claves y el secreto con que se
 * autentica el gateway están en Vault; solo VAULT_TOKEN va por entorno.
 */

const entero = (valor, porDefecto) => {
  const numero = Number.parseInt(valor, 10);
  return Number.isFinite(numero) && numero >= 0 ? numero : porDefecto;
};

export function leerConfig(entorno = process.env) {
  return {
    puerto: entero(entorno.PORT, 4100),

    vaultAddr: (entorno.VAULT_ADDR ?? "http://127.0.0.1:8200").replace(/\/$/, ""),
    vaultToken: entorno.VAULT_TOKEN ?? "",
    vaultMontaje: entorno.VAULT_MONTAJE ?? "secret",
    rutaSecretoAuth: entorno.VAULT_RUTA_AUTH ?? "poke-fresh/auth",
    rutaSecretoIntrospeccion: entorno.VAULT_RUTA_INTROSPECCION ?? "poke-fresh/introspeccion",
    vaultCacheSegundos: entero(entorno.VAULT_CACHE_SEGUNDOS, 30),

    archivoUsuarios: entorno.ARCHIVO_USUARIOS ?? "data/usuarios.json",

    // Una sesión vence por inactividad o al cumplir su duración máxima, lo
    // que ocurra primero.
    sesionInactividadSeg: entero(entorno.SESION_INACTIVIDAD_SEG, 30 * 60),
    sesionMaximaSeg: entero(entorno.SESION_MAXIMA_SEG, 8 * 60 * 60),

    // Intentos fallidos antes de bloquear un usuario, y por cuánto tiempo.
    maxIntentos: entero(entorno.MAX_INTENTOS, 5),
    bloqueoSeg: entero(entorno.BLOQUEO_SEG, 5 * 60),

    registrarAccesos: entorno.NODE_ENV !== "test",
  };
}
