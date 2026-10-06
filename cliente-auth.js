/**
 * Cliente del Auth Service. El gateway se identifica con HTTP Basic: usuario
 * "gateway" y el secreto de introspección, que lee de Vault en cada llamada.
 */

export class ErrorAuth extends Error {
  constructor(mensaje, detalle) {
    super(mensaje);
    this.name = "ErrorAuth";
    this.detalle = detalle;
  }
}

export function crearClienteAuth({ urlAuth, rutaSecretoIntrospeccion }, vault) {
  async function llamar(ruta, cuerpo) {
    const secreto = await vault.leerValor(rutaSecretoIntrospeccion, "secreto");
    const credencial = Buffer.from(`gateway:${secreto}`).toString("base64");

    let respuesta;
    try {
      respuesta = await fetch(`${urlAuth}${ruta}`, {
        method: "POST",
        headers: { Authorization: `Basic ${credencial}`, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new ErrorAuth("El servicio de autenticación no responde.", error.cause?.code ?? error.name);
    }

    const datos = respuesta.status === 204 ? null : await respuesta.json().catch(() => null);

    // Un 5xx, o que el Auth Service rechace al propio gateway (secreto
    // desalineado), son fallas nuestras y no del usuario: el gateway responde
    // 502 en vez de decirle que su contraseña está mal.
    if (respuesta.status >= 500 || datos?.error === "CLIENTE_NO_AUTORIZADO") {
      throw new ErrorAuth("El servicio de autenticación no está disponible.", `HTTP ${respuesta.status} en ${ruta}${datos?.error ? ` (${datos.error})` : ""}`);
    }

    return { estado: respuesta.status, datos, retryAfter: respuesta.headers.get("retry-after") };
  }

  return {
    login: (usuario, clave) => llamar("/login", { usuario, clave }),
    introspect: async (token) => (await llamar("/introspect", { token })).datos,
    logout: (token) => llamar("/logout", { token }),
  };
}
