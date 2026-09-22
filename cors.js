import cors from "cors";

/**
 * CORS centralizado en el gateway.
 *
 * El frontend está publicado en GitHub Pages, un dominio distinto al del
 * gateway, así que el navegador exige que la API autorice ese origen. Se
 * autoriza aquí, una sola vez, y los servicios de atrás no necesitan saber
 * nada del frontend. Un origen que no está en la lista no recibe la cabecera
 * y el navegador bloquea la respuesta.
 */
export function politicaCors(origenesPermitidos) {
  return cors({
    origin(origen, responder) {
      // Sin cabecera Origin (curl, Postman, otro servidor): no es un navegador
      // y CORS no aplica.
      if (!origen) return responder(null, true);
      responder(null, origenesPermitidos.includes(origen));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "RateLimit", "RateLimit-Policy", "Retry-After"],
    maxAge: 600, // el navegador guarda la respuesta del preflight 10 minutos
  });
}

/**
 * Los servicios pueden traer sus propias cabeceras CORS (FastAPI tiene su
 * middleware). Si pasan, el navegador recibiría dos Access-Control-Allow-Origin
 * y rechazaría la respuesta. El gateway las quita: la política es solo suya.
 */
export function quitarCorsDelServicio(proxyRes) {
  for (const cabecera of Object.keys(proxyRes.headers)) {
    if (cabecera.startsWith("access-control-")) delete proxyRes.headers[cabecera];
  }
}
