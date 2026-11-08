/**
 * GraphQL Gateway privado.
 *
 * No es público: solo lo llama el API Gateway, con la credencial interna de
 * "graphql" (de Vault) y la identidad ya verificada del usuario. Una petición
 * directa sin esa credencial recibe 403.
 *
 * Protecciones de la consulta:
 *   - profundidad máxima y costo máximo (se rechaza antes de ejecutar);
 *   - paginación con máximo 50 por página;
 *   - tiempo máximo por llamada a cada servicio;
 *   - introspección desactivada fuera de desarrollo;
 *   - errores parciales: si un servicio falla, ese campo vuelve null con su
 *     error en `errors`, y el resto de la respuesta llega igual.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import express from "express";
import { specifiedRules } from "graphql";

import { typeDefs } from "./graphql/esquema.js";
import { limiteCosto } from "./graphql/limiteCosto.js";
import { limiteProfundidad } from "./graphql/limiteProfundidad.js";
import { crearCargadores, resolvers } from "./graphql/resolvers.js";
import { crearClienteServicios } from "./servicios.js";
import { crearClienteVault } from "./vault.js";

const iguales = (a, b) => {
  const h = (t) => createHash("sha256").update(String(t)).digest();
  return timingSafeEqual(h(a), h(b));
};

export async function crearApp(config, dependencias = {}) {
  const vault = dependencias.vault ?? crearClienteVault(config);
  const llamar = crearClienteServicios(config, vault);

  const apollo = new ApolloServer({
    typeDefs,
    resolvers,
    validationRules: [...specifiedRules, limiteProfundidad(config.profundidadMaxima), limiteCosto(config.costoMaximo)],
    introspection: config.introspeccion,
    includeStacktraceInErrorResponses: false,
  });
  await apollo.start();

  const app = express();
  app.disable("x-powered-by");

  app.get("/salud", async (_req, res) => {
    const estado = await vault.salud();
    res.status(estado === "ok" ? 200 : 503).json({ servicio: "graphql", ok: estado === "ok", vault: estado });
  });

  // Solo el API Gateway: credencial interna obligatoria.
  app.use(async (req, res, next) => {
    const recibida = req.get("x-credencial-interna");
    if (!recibida) return res.status(403).json({ codigo: "ACCESO_DIRECTO", mensaje: "Acceso directo no permitido: este servicio solo atiende peticiones internas." });
    try {
      const esperada = await vault.leerValor(`${config.rutaInternos}/graphql`, "credencial");
      if (!iguales(recibida, esperada)) return res.status(403).json({ codigo: "CREDENCIAL_INVALIDA", mensaje: "Credencial interna inválida." });
      next();
    } catch {
      res.status(503).json({ codigo: "SECRETOS_NO_DISPONIBLES", mensaje: "No se pudo verificar la credencial interna." });
    }
  });

  app.use(
    "/graphql",
    express.json({ limit: "20kb" }),
    (req, res, next) => {
      if (!req.get("x-usuario-id") || !req.get("x-usuario-rol")) return res.status(401).json({ codigo: "SIN_SESION", mensaje: "Inicia sesión para continuar." });
      next();
    },
    expressMiddleware(apollo, {
      context: async ({ req }) => {
        const ctx = {
          identidad: {
            id: req.get("x-usuario-id"),
            rol: req.get("x-usuario-rol"),
            sujeto: req.get("x-usuario-sujeto") ?? req.get("x-usuario-id"),
            nombre: decodeURIComponent(req.get("x-usuario-nombre") ?? ""),
          },
          idPeticion: req.get("x-request-id"),
          llamar,
          llamadas: { inventario: 0, pagos: 0 },
        };
        ctx.cargadores = crearCargadores(llamar, ctx);
        req.ctx = ctx;
        return ctx;
      },
    }),
  );

  return app;
}
