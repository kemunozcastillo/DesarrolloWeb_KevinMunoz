import { randomUUID } from "node:crypto";

/**
 * Id de petición. Viaja hacia el servicio en la cabecera X-Request-Id y
 * vuelve en la respuesta: si algo falla, el mismo id aparece en el log del
 * gateway y en el del servicio, y se puede seguir la petición completa.
 * Si el cliente ya trae uno válido, se respeta.
 */
export function idPeticion(req, res, next) {
  const recibido = req.get("x-request-id");
  req.id = recibido && /^[\w-]{8,64}$/.test(recibido) ? recibido : randomUUID();
  res.set("X-Request-Id", req.id);
  next();
}

/** Log de acceso: método, ruta, estado, tiempo y servicio que respondió. */
export function registroAccesos(activo) {
  return (req, res, next) => {
    if (!activo) return next();

    const inicio = performance.now();
    res.on("finish", () => {
      const ms = Math.round(performance.now() - inicio);
      const servicio = res.locals.servicio ? ` -> ${res.locals.servicio}` : "";
      console.log(`${req.method} ${req.originalUrl}${servicio} ${res.statusCode} ${ms} ms [${req.id}]`);
    });
    next();
  };
}

/** Cabeceras de seguridad básicas para toda respuesta del gateway. */
export function seguridad(_req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  next();
}
