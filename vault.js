/**
 * Lectura de secretos en HashiCorp Vault (motor KV versión 2).
 *
 * Dos tipos de falla:
 *   NO_DISPONIBLE   Vault no contesta, está sellado o responde 5xx
 *   CONFIGURACION   Vault contesta pero rechaza la lectura o falta la clave
 */

export class ErrorVault extends Error {
  constructor(mensaje, { tipo, detalle }) {
    super(mensaje);
    this.name = "ErrorVault";
    this.tipo = tipo;
    this.detalle = detalle;
  }
}

export function crearClienteVault({ vaultAddr, vaultToken, vaultMontaje, vaultCacheSegundos }) {
  const cache = new Map();

  async function leerValor(ruta, clave) {
    const guardado = cache.get(ruta);
    let datos = guardado && guardado.vence > Date.now() ? guardado.datos : null;

    if (!datos) {
      let respuesta;
      try {
        respuesta = await fetch(`${vaultAddr}/v1/${vaultMontaje}/data/${ruta}`, {
          headers: { "X-Vault-Token": vaultToken },
          signal: AbortSignal.timeout(3_000),
        });
      } catch (error) {
        throw new ErrorVault("Vault no responde.", { tipo: "NO_DISPONIBLE", detalle: error.cause?.code ?? error.name });
      }

      if (respuesta.status >= 500) throw new ErrorVault("Vault no está disponible.", { tipo: "NO_DISPONIBLE", detalle: `HTTP ${respuesta.status}` });
      if (!respuesta.ok) throw new ErrorVault("No se pudo leer un secreto en Vault.", { tipo: "CONFIGURACION", detalle: `HTTP ${respuesta.status} en ${ruta}` });

      datos = (await respuesta.json().catch(() => null))?.data?.data;
      if (!datos) throw new ErrorVault("El secreto en Vault no tiene el formato esperado.", { tipo: "CONFIGURACION", detalle: ruta });
      if (vaultCacheSegundos > 0) cache.set(ruta, { datos, vence: Date.now() + vaultCacheSegundos * 1000 });
    }

    const valor = datos[clave];
    if (typeof valor !== "string" || !valor) throw new ErrorVault("Falta un secreto en Vault.", { tipo: "CONFIGURACION", detalle: `sin "${clave}" en ${ruta}` });
    return valor;
  }

  async function salud() {
    try {
      const r = await fetch(`${vaultAddr}/v1/sys/health`, { signal: AbortSignal.timeout(2_000) });
      return r.status === 200 ? "ok" : r.status === 503 ? "sellado" : `error ${r.status}`;
    } catch {
      return "sin respuesta";
    }
  }

  return { leerValor, salud };
}
