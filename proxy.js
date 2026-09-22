import { createProxyMiddleware } from "http-proxy-middleware";
import { quitarCorsDelServicio } from "./middlewares/cors.js";

/**
 * Crea el proxy de una ruta de la tabla. Responde:
 *   502 si el servicio no contesta (caído, apagado o mal configurado),
 *   504 si contesta más lento que el tiempo máximo.
 * Se distinguen por cuánto se esperó: un servicio apagado falla al instante.
 * En ambos casos el cuerpo es JSON, con el mismo formato que el resto de los
 * errores del gateway, para que el frontend los maneje igual.
 */
export function crearProxy(ruta, { tiempoMaximoMs }) {
  return createProxyMiddleware({
    target: ruta.destino,
    changeOrigin: true,
    xfwd: true, // agrega X-Forwarded-For, -Host y -Proto para el servicio
    proxyTimeout: tiempoMaximoMs,
    // Express quita el prefijo al montar el middleware: aquí solo llega "/abc"
    // o "/?x=1", y se antepone la ruta real del servicio.
    pathRewrite: (resto) => `${ruta.reescritura}${resto === "/" ? "" : resto.replace(/^\/\?/, "?")}`,
    on: {
      proxyReq(proxyReq, req, res) {
        proxyReq.setHeader("X-Request-Id", req.id);
        res.locals.servicio = ruta.servicio;
        req.inicioProxy = Date.now();
      },
      proxyRes: quitarCorsDelServicio,
      error(error, req, res) {
        const demora = Date.now() - (req.inicioProxy ?? Date.now());
        const porTiempo = demora >= tiempoMaximoMs - 50;
        const estado = porTiempo ? 504 : 502;

        console.error(`[${req.id}] ${ruta.servicio}: ${porTiempo ? "sin respuesta a tiempo" : "no disponible"} (${error.code ?? error.message})`);

        if (res.headersSent) return res.end();

        res.writeHead(estado, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            error: porTiempo ? "SERVICIO_LENTO" : "SERVICIO_NO_DISPONIBLE",
            mensaje: porTiempo
              ? `El servicio "${ruta.nombre}" tardó más de ${tiempoMaximoMs / 1000} s en responder.`
              : `El servicio "${ruta.nombre}" no está disponible en este momento.`,
            servicio: ruta.servicio,
            idPeticion: req.id,
          }),
        );
      },
    },
  });
}
