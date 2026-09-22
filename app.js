/**
 * API gateway de Poke Fresh.
 *
 * Es la única puerta de entrada a la API. El cliente habla solo con el
 * gateway, y el gateway enruta cada petición al servicio que corresponde:
 *
 *   /api/v1/menu      -> API REST del menú (FastAPI + MongoDB)
 *   /api/v1/graphql   -> API GraphQL de la tienda (Apollo)
 *   /api/salud        -> estado de todos los servicios
 *   /api              -> índice de las rutas disponibles
 *
 * Todo lo transversal vive aquí y no en cada servicio: CORS, límite de
 * peticiones, id de petición, log de acceso, errores uniformes y tiempo
 * máximo de espera.
 */

import express from "express";

import { idPeticion, registroAccesos, seguridad } from "./middlewares/basicos.js";
import { politicaCors } from "./middlewares/cors.js";
import { limites } from "./middlewares/limites.js";
import { crearProxy } from "./proxy.js";
import { definirRutas } from "./rutas.js";
import { saludAgregada } from "./salud.js";

const errorJson = (res, estado, error, mensaje, extra = {}) =>
  res.status(estado).json({ error, mensaje, idPeticion: res.get("X-Request-Id"), ...extra });

export function crearApp(config) {
  const app = express();
  const rutas = definirRutas(config);
  const { general, escritura } = limites(config);

  app.disable("x-powered-by");
  app.set("trust proxy", 1); // detrás de un balanceador, la IP real viene en X-Forwarded-For

  app.use(seguridad, idPeticion, registroAccesos(config.registrarAccesos));
  app.use("/api", politicaCors(config.origenesPermitidos), general);

  // --- Rutas propias del gateway -------------------------------------------------
  // Van antes de los proxies para no reenviarse a ningún servicio.

  app.get("/api", (_req, res) => {
    res.json({
      nombre: "API de Poke Fresh",
      version: "v1",
      rutas: [
        ...rutas.map((r) => ({ prefijo: r.prefijo, servicio: r.servicio, descripcion: r.nombre, metodos: r.metodos })),
        { prefijo: "/api/salud", servicio: "gateway", descripcion: "Estado de todos los servicios", metodos: ["GET"] },
      ],
    });
  });

  app.get("/api/salud", saludAgregada(rutas));

  // --- Enrutamiento hacia los servicios --------------------------------------------
  // Importante: no se usa express.json() antes de los proxies. Si el gateway
  // leyera el cuerpo, el stream quedaría consumido y el servicio recibiría
  // una petición vacía.

  for (const ruta of rutas) {
    const soloMetodos = (req, res, next) => {
      if (ruta.metodos.includes(req.method)) return next();
      res.set("Allow", ruta.metodos.join(", "));
      errorJson(res, 405, "METODO_NO_PERMITIDO", `${ruta.prefijo} no acepta ${req.method}.`, { permitidos: ruta.metodos });
    };

    const cadena = [soloMetodos, ...(ruta.limitarEscrituras ? [escritura] : []), crearProxy(ruta, config)];
    app.use(ruta.prefijo, ...cadena);
  }

  // --- Lo que no coincide con ninguna ruta -----------------------------------------------

  app.use("/api", (req, res) => {
    errorJson(res, 404, "RUTA_INEXISTENTE", `No existe ${req.method} ${req.originalUrl}. Revisa GET /api para ver las rutas.`);
  });

  app.use((req, res) => {
    errorJson(res, 404, "RUTA_INEXISTENTE", "El gateway solo atiende rutas bajo /api.");
  });

  // Cualquier error inesperado responde JSON y no la página de error de Express.
  app.use((error, req, res, _next) => {
    console.error(`[${req.id}] error interno:`, error);
    errorJson(res, 500, "ERROR_INTERNO", "Ocurrió un error inesperado en el gateway.");
  });

  return app;
}
