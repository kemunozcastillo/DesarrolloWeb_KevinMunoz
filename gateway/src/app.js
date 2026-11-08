/**
 * Gateway de Poke Fresh con sesiones.
 *
 *   1. El usuario inicia sesión: POST /api/auth/login. El gateway se lo pasa
 *      al Auth Service y guarda el token de sesión en una cookie HttpOnly.
 *   2. En cada petición a la API, el gateway lee la cookie y pregunta al Auth
 *      Service si la sesión sigue activa y qué rol tiene (introspección).
 *   3. Revisa si ese rol puede usar el método (solo admin puede borrar).
 *   4. Lee de Vault la credencial interna y reenvía al backend.
 *
 * Rutas:
 *   /api/auth/login, /api/auth/logout, /api/auth/sesion
 *   /api/v1/productos     requiere sesión; DELETE requiere rol admin
 *   /api/salud            pública
 *
 * Códigos propios:
 *   401  sin sesión, o la sesión expiró o se cerró; credenciales incorrectas
 *   403  el rol no alcanza, o la petición viene de un sitio no autorizado
 *   429  usuario bloqueado por intentos fallidos
 *   500  Vault mal configurado
 *   502  Vault, el Auth Service o el backend no responden
 * El backend responde 403 si alguien lo llama sin pasar por el gateway.
 */

import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";

import { crearClienteAuth } from "./cliente-auth.js";
import { proxyProductos } from "./proxy.js";
import { autorizarPorRol, exigirSesion, manejarErrorServicios, rutasSesion, verificarOrigen } from "./sesion.js";
import { crearClienteVault } from "./vault.js";

export function crearApp(config, dependencias = {}) {
  const vault = dependencias.vault ?? crearClienteVault(config);
  const auth = dependencias.auth ?? crearClienteAuth(config, vault);

  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const recibido = req.get("x-request-id");
    req.id = recibido && /^[\w-]{8,64}$/.test(recibido) ? recibido : randomUUID();
    res.set({ "X-Request-Id": req.id, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    next();
  });

  if (config.registrarAccesos) {
    app.use((req, res, next) => {
      const inicio = performance.now();
      res.on("finish", () => {
        const quien = req.usuario ? ` ${req.usuario.usuario}(${req.usuario.rol})` : "";
        console.log(`${req.method} ${req.originalUrl}${quien} ${res.statusCode} ${Math.round(performance.now() - inicio)} ms [${req.id}]`);
      });
      next();
    });
  }

  // CORS con credenciales: el navegador solo manda la cookie a otro dominio
  // si el servidor lo autoriza explícitamente para ese origen.
  app.use(
    "/api",
    cors({
      origin: (origen, responder) => responder(null, !origen || config.origenesPermitidos.includes(origen)),
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["Content-Type", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "Retry-After"],
      maxAge: 600,
    }),
    verificarOrigen(config),
  );

  app.get("/api/salud", async (_req, res) => {
    const consultar = (url) =>
      fetch(url, { signal: AbortSignal.timeout(2_000) })
        .then((r) => (r.ok ? "ok" : `error ${r.status}`))
        .catch(() => "sin respuesta");

    const [estadoVault, estadoAuth, estadoBackend] = await Promise.all([vault.salud(), consultar(`${config.urlAuth}/salud`), consultar(`${config.urlBackend}/salud`)]);
    const todoBien = [estadoVault, estadoAuth, estadoBackend].every((e) => e === "ok");
    res.status(todoBien ? 200 : 503).json({ gateway: "ok", vault: estadoVault, auth: estadoAuth, backend: estadoBackend });
  });

  app.use("/api/auth", rutasSesion(config, auth));

  // Productos: sesión, rol y credencial interna, en ese orden. El rol se
  // revisa antes de tocar Vault: un usuario sin permiso ni llega a pedir
  // la credencial del backend.
  app.use(
    "/api/v1/productos",
    exigirSesion(config, auth),
    autorizarPorRol(),
    async (req, _res, next) => {
      try {
        req.credencialInterna = await vault.leerValor(config.rutaSecretoBackend, "credencial_interna");
        next();
      } catch (err) {
        next(err);
      }
    },
    proxyProductos(config),
  );

  app.use((req, res) => {
    res.status(404).json({ error: "RUTA_INEXISTENTE", mensaje: `No existe ${req.method} ${req.originalUrl}.`, idPeticion: req.id });
  });

  app.use(manejarErrorServicios);

  app.use((err, req, res, _next) => {
    console.error(`[${req.id}] error interno:`, err);
    res.status(500).json({ error: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado en el gateway.", idPeticion: req.id });
  });

  return app;
}
