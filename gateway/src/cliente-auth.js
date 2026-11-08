/**
 * Cliente del Auth Service para login, introspección y logout. El gateway se
 * identifica con HTTP Basic: usuario "gateway" y su secreto, que lee de Vault.
 */

export class ErrorAuth extends Error {
  constructor(mensaje, detalle) {
    super(mensaje);
    this.name = "ErrorAuth";
    this.detalle = detalle;
  }
}

export function crearClienteAuth({ urls, rutaInternos }, vault) {
  async function llamar(ruta, cuerpo, idPeticion) {
    const secreto = await vault.leerValor(`${rutaInternos}/auth-gateway`, "secreto");
    const credencial = Buffer.from(`gateway:${secreto}`).toString("base64");

    let respuesta;
    try {
      respuesta = await fetch(`${urls.auth}${ruta}`, {
        method: "POST",
        headers: { Authorization: `Basic ${credencial}`, "Content-Type": "application/json", ...(idPeticion ? { "X-Request-Id": idPeticion } : {}) },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new ErrorAuth("El servicio de cuentas no responde.", error.cause?.code ?? error.name);
    }

    const datos = respuesta.status === 204 ? null : await respuesta.json().catch(() => null);

    // Un 5xx, o que el Auth Service rechace al propio gateway (secreto
    // desalineado), son fallas nuestras y no del usuario: 502, no "clave incorrecta".
    if (respuesta.status >= 500 || datos?.codigo === "CLIENTE_NO_AUTORIZADO") {
      throw new ErrorAuth("El servicio de cuentas no está disponible.", `HTTP ${respuesta.status} en ${ruta}${datos?.codigo ? ` (${datos.codigo})` : ""}`);
    }
    return { estado: respuesta.status, datos, retryAfter: respuesta.headers.get("retry-after") };
  }

  return {
    login: (usuario, clave, id) => llamar("/login", { usuario, clave }, id),
    introspect: async (token, id) => (await llamar("/introspect", { token }, id)).datos,
    logout: (token, id) => llamar("/logout", { token }, id),
    cambiarClave: (cuentaId, actual, nueva, id) => llamar("/clave", { cuentaId, actual, nueva }, id),
  };
}
