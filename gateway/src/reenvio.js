/**
 * Reenvío de una petición ya autorizada a un servicio privado.
 *
 * Antes de reenviar:
 *   - se arma un juego de cabeceras NUEVO: del navegador solo pasan
 *     Content-Type, Accept, Idempotency-Key y X-Firma (la firma de la pasarela). La cookie, Authorization y
 *     cualquier X-Usuario-* o X-Credencial-Interna que mande el navegador se
 *     descartan: la identidad la escribe solo el gateway;
 *   - se agrega la credencial interna del servicio de destino (de Vault);
 *   - se agrega la identidad verificada por el Auth Service y el X-Request-Id.
 *
 * El cuerpo se reenvía tal cual (bytes), porque pagos verifica la firma HMAC
 * de la notificación sobre el cuerpo exacto.
 *
 * Si el servicio no responde: 502. Si tarda más que el máximo: 504.
 */

export class ErrorDestino extends Error {
  constructor(estado, codigo, mensaje) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

const NOMBRES = { inventario: "inventario", clientes: "clientes", pedidos: "pedidos", pagos: "pagos", graphql: "consultas", auth: "cuentas" };
const DEJAR_PASAR = ["content-type", "accept", "idempotency-key", "x-firma"];

export function crearReenvio(config, vault) {
  async function cabecerasInternas(destino) {
    if (destino === "auth") {
      const secreto = await vault.leerValor(`${config.rutaInternos}/auth-gateway`, "secreto");
      return { Authorization: `Basic ${Buffer.from(`gateway:${secreto}`).toString("base64")}` };
    }
    return { "X-Credencial-Interna": await vault.leerValor(`${config.rutaInternos}/${destino}`, "credencial") };
  }

  return async function reenviar(req, res, { destino, ruta, usuario, cuerpo }) {
    const cabeceras = {};
    for (const nombre of DEJAR_PASAR) if (req.get(nombre)) cabeceras[nombre] = req.get(nombre);

    Object.assign(cabeceras, await cabecerasInternas(destino), { "X-Request-Id": req.id, "X-Forwarded-For": req.ip });
    if (usuario) {
      Object.assign(cabeceras, {
        "X-Usuario-Id": usuario.sub,
        "X-Usuario-Rol": usuario.rol,
        "X-Usuario-Sujeto": usuario.sujeto ?? usuario.sub,
        "X-Usuario-Nombre": encodeURIComponent(usuario.nombre ?? ""),
      });
    }

    const consulta = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const tieneCuerpo = !["GET", "HEAD"].includes(req.method);
    let respuesta;
    try {
      respuesta = await fetch(`${config.urls[destino]}${ruta}${consulta}`, {
        method: req.method,
        headers: cabeceras,
        body: tieneCuerpo ? (cuerpo ?? (Buffer.isBuffer(req.body) && req.body.length ? req.body : undefined)) : undefined,
        signal: AbortSignal.timeout(config.tiempoMaximoMs),
        redirect: "manual",
      });
    } catch (error) {
      const porTiempo = error.name === "TimeoutError";
      console.error(`[${req.id}] ${destino}: ${porTiempo ? "sin respuesta a tiempo" : "no disponible"} (${error.cause?.code ?? error.name})`);
      throw porTiempo
        ? new ErrorDestino(504, "SERVICIO_LENTO", `El servicio de ${NOMBRES[destino]} tardó demasiado en responder.`)
        : new ErrorDestino(502, "SERVICIO_NO_DISPONIBLE", `El servicio de ${NOMBRES[destino]} no está disponible en este momento.`);
    }

    // Del servicio solo vuelven el estado, el tipo de contenido y el cuerpo.
    // Sus cabeceras CORS, de servidor, etc. no llegan al navegador.
    res.status(respuesta.status);
    const tipo = respuesta.headers.get("content-type");
    if (tipo) res.set("Content-Type", tipo);
    const datos = Buffer.from(await respuesta.arrayBuffer());
    if (respuesta.status >= 500 && !tipo?.includes("json")) {
      return res.status(502).json({ codigo: "SERVICIO_NO_DISPONIBLE", mensaje: `El servicio de ${NOMBRES[destino]} falló.`, idPeticion: req.id });
    }
    res.end(datos);
  };
}
