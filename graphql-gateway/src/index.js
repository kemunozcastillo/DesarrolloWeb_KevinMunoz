import express from "express";
import cors from "cors";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { specifiedRules } from "graphql";

import { typeDefs } from "./graphql/typeDefs.js";
import { resolvers } from "./graphql/resolvers.js";
import { crearLoaders } from "./graphql/loaders.js";
import { limiteProfundidad } from "./graphql/limiteProfundidad.js";

const PUERTO = process.env.PORT ?? 4000;
const PROFUNDIDAD_MAXIMA = 8;

export async function crearApp() {
  const app = express();

  const apollo = new ApolloServer({
    typeDefs,
    resolvers,
    validationRules: [...specifiedRules, limiteProfundidad(PROFUNDIDAD_MAXIMA)],
    // En producción conviene desactivar la introspección y el playground.
    introspection: process.env.NODE_ENV !== "production",
  });

  await apollo.start();

  app.use(
    "/graphql",
    // Ajustar al dominio real del frontend antes de publicar.
    cors({ origin: process.env.ORIGEN_FRONTEND ?? "*" }),
    express.json(),
    expressMiddleware(apollo, {
      // El contexto se arma por request: aquí irían el usuario autenticado
      // y la conexión a la BD cuando existan.
      context: async () => ({ loaders: crearLoaders() }),
    }),
  );

  app.get("/salud", (_req, res) => res.json({ ok: true }));

  return app;
}

if (process.argv[1]?.endsWith("index.js")) {
  const app = await crearApp();
  app.listen(PUERTO, () => {
    console.log(`GraphQL escuchando en http://localhost:${PUERTO}/graphql`);
  });
}
