import { createProxyMiddleware } from "http-proxy-middleware";

export const CABECERA_INTERNA = "X-Credencial-Interna";
const CABECERAS_USUARIO = ["x-usuario-id", "x-usuario", "x-usuario-rol"];

/**
 * Reenvía la petición ya autenticada a la API de Productos.
 *
 * Antes de reenviar:
 *   - quita la cookie de sesión y cualquier Authorization: el token del
 *     cliente no debe viajar más allá del gateway;
 *   - pone la credencial interna, reemplazando cualquier valor que el
 *     cliente haya intentado mandar en esa misma cabecera;
 *   - informa quién hizo la petición (id, usuario y rol), para que el backend
 *     pueda registrarlo. Solo el gateway escribe estas cabeceras.
 *
 * Si el backend no contesta: 502. Si tarda más que el tiempo máximo: 504.
 */
export function proxyProductos({ urlBackend, tiempoMaximoMs }) {
  return createProxyMiddleware({
    target: urlBackend,
    changeOrigin: true,
    xfwd: true,
    proxyTimeout: tiempoMaximoMs,
    // /api/v1/productos?categoria=SALSA -> /items?categoria=SALSA
    // /api/v1/productos/abc123          -> /items/abc123
    pathRewrite: (resto) => `/items${resto === "/" ? "" : resto.replace(/^\/\?/, "?")}`,
    on: {
      proxyReq(proxyReq, req) {
        proxyReq.removeHeader("authorization");
        proxyReq.removeHeader("cookie");
        CABECERAS_USUARIO.forEach((c) => proxyReq.removeHeader(c));

        proxyReq.setHeader(CABECERA_INTERNA, req.credencialInterna);
        proxyReq.setHeader("X-Usuario-Id", req.usuario.sub);
        proxyReq.setHeader("X-Usuario", req.usuario.usuario);
        proxyReq.setHeader("X-Usuario-Rol", req.usuario.rol);
        proxyReq.setHeader("X-Request-Id", req.id);
        req.inicioProxy = Date.now();
      },
      proxyRes(proxyRes) {
        // El CORS lo decide el gateway: se descartan las cabeceras del backend
        // para que el navegador no reciba dos políticas distintas.
        for (const cabecera of Object.keys(proxyRes.headers)) {
          if (cabecera.startsWith("access-control-")) delete proxyRes.headers[cabecera];
        }
      },
      error(error, req, res) {
        const porTiempo = Date.now() - (req.inicioProxy ?? Date.now()) >= tiempoMaximoMs - 50;
        console.error(`[${req.id}] backend: ${porTiempo ? "sin respuesta a tiempo" : "no disponible"} (${error.code ?? error.message})`);
        if (res.headersSent) return res.end();

        res.writeHead(porTiempo ? 504 : 502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            error: porTiempo ? "BACKEND_LENTO" : "BACKEND_NO_DISPONIBLE",
            mensaje: porTiempo ? "La API de Productos tardó demasiado en responder." : "La API de Productos no está disponible en este momento.",
            idPeticion: req.id,
          }),
        );
      },
    },
  });
}
