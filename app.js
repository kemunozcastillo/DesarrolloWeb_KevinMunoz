/**
 * Gateway seguro de Poke Fresh.
 *
 *   Cliente ──Bearer token──> Gateway ──consulta──> Vault
 *                                │
 *                                └──X-Credencial-Interna──> API de Productos
 *
 * Rutas:
 *   /api/v1/productos    protegida con Bearer Token, se reenvía al backend
 *   /api/salud           pública: estado del gateway, Vault y el backend
 *
 * Códigos de error propios:
 *   401  sin token, formato incorrecto o token inválido
 *   500  Vault responde pero rechaza la lectura (configuración)
 *   502  Vault o el backend no responden
 *   504  el backend tarda más que el tiempo máximo
 * El 403 lo pone el backend cuando lo llaman sin pasar por aquí.
 */

import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";

import { exigirBearer } from "./autenticacion.js";
import { proxyProductos } from "./proxy.js";
import { crearClienteVault } from "./vault.js";

export function crearApp(config, { vault = crearClienteVault(config) } = {}) {
  const app = express();
  app.disable("x-powered-by");

  // Id de petición: viaja al backend y vuelve al cliente, para seguirla en los logs.
  app.use((req, res, next) => {
    const recibido = req.get("x-request-id");
    req.id = recibido && /^[\w-]{8,64}$/.test(recibido) ? recibido : randomUUID();
    res.set({ "X-Request-Id": req.id, "X-Content-Type-Options": "nosniff" });
    next();
  });

  if (config.registrarAccesos) {
    app.use((req, res, next) => {
      const inicio = performance.now();
      res.on("finish", () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Math.round(performance.now() - inicio)} ms [${req.id}]`));
      next();
    });
  }

  // CORS va antes de la autenticación: el navegador manda el preflight
  // (OPTIONS) sin el token, y si se exigiera ahí, nunca podría enviar la
  // petición real.
  app.use(
    "/api",
    cors({
      origin: (origen, responder) => responder(null, !origen || config.origenesPermitidos.includes(origen)),
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "WWW-Authenticate"],
      maxAge: 600,
    }),
  );

  app.get("/api/salud", async (_req, res) => {
    const [estadoVault, estadoBackend] = await Promise.all([
      vault.salud(),
      fetch(`${config.urlBackend}/salud`, { signal: AbortSignal.timeout(2_000) })
        .then((r) => (r.ok ? "ok" : `error ${r.status}`))
        .catch(() => "sin respuesta"),
    ]);
    const todoBien = estadoVault === "ok" && estadoBackend === "ok";
    res.status(todoBien ? 200 : 503).json({ gateway: "ok", vault: estadoVault, backend: estadoBackend });
  });

  // No se usa express.json() antes del proxy: leer el cuerpo aquí dejaría
  // vacía la petición que recibe el backend.
  app.use("/api/v1/productos", exigirBearer(vault, config), proxyProductos(config));

  app.use((req, res) => {
    res.status(404).json({ error: "RUTA_INEXISTENTE", mensaje: `No existe ${req.method} ${req.originalUrl}.`, idPeticion: req.id });
  });

  app.use((error, req, res, _next) => {
    console.error(`[${req.id}] error interno:`, error);
    res.status(500).json({ error: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado en el gateway.", idPeticion: req.id });
  });

  return app;
}
