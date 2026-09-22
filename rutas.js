/**
 * Tabla de rutas del gateway.
 *
 * Cada entrada dice qué prefijo público atiende, a qué servicio lo manda y
 * cómo reescribe la ruta. Agregar un servicio nuevo es agregar una entrada
 * aquí: el resto del gateway (proxy, errores, salud, índice) la toma sola.
 *
 * Las rutas públicas llevan versión (/api/v1): si mañana cambia la forma de
 * una respuesta, se publica /api/v2 sin romper a los clientes que ya existen.
 */

export function definirRutas(config) {
  return [
    {
      servicio: "menu",
      nombre: "API REST del menú (FastAPI + MongoDB)",
      prefijo: "/api/v1/menu",
      destino: config.urlApiRest,
      // /api/v1/menu?categoria=SALSA -> /items?categoria=SALSA
      // /api/v1/menu/abc123          -> /items/abc123
      reescritura: "/items",
      salud: "/salud",
      metodos: ["GET", "POST", "PUT", "DELETE"],
      limitarEscrituras: true,
    },
    {
      servicio: "tienda",
      nombre: "API GraphQL de la tienda (Apollo)",
      prefijo: "/api/v1/graphql",
      destino: config.urlApiGraphql,
      reescritura: "/graphql",
      salud: "/salud",
      metodos: ["GET", "POST"],
      limitarEscrituras: false, // en GraphQL las lecturas también son POST
    },
  ];
}
