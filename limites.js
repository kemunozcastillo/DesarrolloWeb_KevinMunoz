import rateLimit from "express-rate-limit";

const respuesta = (mensaje) => ({ error: "DEMASIADAS_PETICIONES", mensaje });

/**
 * Dos límites por IP y por minuto:
 *   - general, para todo /api: frena a un cliente que dispare peticiones en bucle;
 *   - de escritura, más estricto, para POST, PUT y DELETE en las rutas REST,
 *     que son las que cambian datos. No se aplica a GraphQL: ahí toda consulta
 *     viaja por POST, incluidas las lecturas.
 * Al pasarse, se responde 429 con la cabecera Retry-After.
 */
export function limites({ limiteGeneral, limiteEscritura }) {
  const comunes = { windowMs: 60_000, standardHeaders: "draft-7", legacyHeaders: false };

  const general = rateLimit({
    ...comunes,
    limit: limiteGeneral,
    message: respuesta("Demasiadas peticiones. Espera un minuto y vuelve a intentar."),
  });

  const escritura = rateLimit({
    ...comunes,
    limit: limiteEscritura,
    skip: (req) => ["GET", "HEAD", "OPTIONS"].includes(req.method),
    message: respuesta("Demasiados cambios seguidos. Espera un minuto y vuelve a intentar."),
  });

  return { general, escritura };
}
