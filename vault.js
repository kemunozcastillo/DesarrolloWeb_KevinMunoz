/**
 * Cliente mínimo de HashiCorp Vault para leer secretos del motor KV v2.
 *
 *   GET {VAULT_ADDR}/v1/{montaje}/data/{ruta}
 *   Cabecera: X-Vault-Token
 *
 * Distingue dos tipos de falla, porque se responden distinto:
 *   - Vault no contesta (apagado, sin red, lento o con error 5xx): 502.
 *   - Vault contesta pero rechaza la lectura (token sin permiso, ruta o
 *     clave inexistente): 500, porque es un error de configuración nuestro.
 */

export class ErrorVault extends Error {
  constructor(mensaje, { tipo, detalle }) {
    super(mensaje);
    this.name = "ErrorVault";
    this.tipo = tipo; // "NO_DISPONIBLE" o "CONFIGURACION"
    this.detalle = detalle;
  }
}

export function crearClienteVault({ vaultAddr, vaultToken, vaultMontaje, vaultCacheSegundos }, { tiempoMaximoMs = 3_000 } = {}) {
  const cache = new Map();

  async function leer(ruta) {
    const guardado = cache.get(ruta);
    if (guardado && guardado.vence > Date.now()) return guardado.datos;

    let respuesta;
    try {
      respuesta = await fetch(`${vaultAddr}/v1/${vaultMontaje}/data/${ruta}`, {
        headers: { "X-Vault-Token": vaultToken },
        signal: AbortSignal.timeout(tiempoMaximoMs),
      });
    } catch (error) {
      const codigo = error.cause?.code ?? error.cause?.errors?.[0]?.code ?? (error.name === "TimeoutError" ? "tiempo agotado" : error.name);
      throw new ErrorVault("El gestor de secretos no responde.", { tipo: "NO_DISPONIBLE", detalle: codigo });
    }

    if (respuesta.status >= 500) {
      // 503 incluye el caso de Vault sellado (sealed): arriba, pero sin poder leer.
      throw new ErrorVault("El gestor de secretos no está disponible.", { tipo: "NO_DISPONIBLE", detalle: `HTTP ${respuesta.status}` });
    }
    if (!respuesta.ok) {
      throw new ErrorVault("El gateway no pudo leer sus secretos en Vault.", { tipo: "CONFIGURACION", detalle: `HTTP ${respuesta.status} en ${ruta}` });
    }

    const cuerpo = await respuesta.json().catch(() => null);
    const datos = cuerpo?.data?.data;
    if (!datos || typeof datos !== "object") {
      throw new ErrorVault("El secreto en Vault no tiene el formato esperado.", { tipo: "CONFIGURACION", detalle: `sin datos en ${ruta}` });
    }

    if (vaultCacheSegundos > 0) cache.set(ruta, { datos, vence: Date.now() + vaultCacheSegundos * 1000 });
    return datos;
  }

  /** Lee un valor puntual y exige que exista. */
  async function leerValor(ruta, clave) {
    const datos = await leer(ruta);
    const valor = datos[clave];
    if (typeof valor !== "string" || valor.length === 0) {
      throw new ErrorVault("Falta un secreto en Vault.", { tipo: "CONFIGURACION", detalle: `sin "${clave}" en ${ruta}` });
    }
    return valor;
  }

  /** Estado de Vault para /api/salud: activo, sellado o sin respuesta. */
  async function salud() {
    try {
      const respuesta = await fetch(`${vaultAddr}/v1/sys/health`, { signal: AbortSignal.timeout(2_000) });
      if (respuesta.status === 200) return "ok";
      if (respuesta.status === 503) return "sellado";
      return `error ${respuesta.status}`;
    } catch {
      return "sin respuesta";
    }
  }

  return { leer, leerValor, salud };
}
