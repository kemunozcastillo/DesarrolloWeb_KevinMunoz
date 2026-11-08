/**
 * API Gateway de Poke Fresh: la única puerta pública del sistema.
 *
 *   /                 el frontend (archivos estáticos)
 *   /api/v1/auth/*    login, logout, sesión, verificación de correo
 *   /api/v1/*         la API, según la matriz de rutas (src/rutas.js)
 *   /api/salud        estado de cada componente
 *
 * Por cada petición a la API:
 *   1. le pone un X-Request-Id (o respeta uno válido) para seguirla en los logs;
 *   2. aplica el límite de peticiones;
 *   3. si trae la cookie de sesión, pregunta al Auth Service quién es;
 *   4. busca la ruta en la matriz y revisa si ese rol puede usarla;
 *   5. reenvía al servicio privado con su credencial interna (de Vault) y la
 *      identidad verificada, descartando lo que el navegador haya inventado.
 *
 * Respuestas propias: 401 sin sesión, 403 rol sin permiso u origen ajeno,
 * 404 ruta inexistente, 429 límite, 502/504 servicio caído o lento,
 * 503 Vault no disponible.
 */

import { randomUUID } from "node:crypto";
import express from "express";

import { crearClienteAuth } from "./cliente-auth.js";
import { limitarPorMinuto } from "./limites.js";
import { crearReenvio } from "./reenvio.js";
import { permitido, resolver } from "./rutas.js";
import { error, identificar, manejarErrorServicios, rutasSesion, verificarOrigen } from "./sesion.js";
import { crearClienteVault } from "./vault.js";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function crearApp(config, dependencias = {}) {
  const vault = dependencias.vault ?? crearClienteVault(config);
  const auth = dependencias.auth ?? crearClienteAuth(config, vault);
  const reenviar = crearReenvio(config, vault);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  app.use((req, res, next) => {
    const recibido = req.get("x-request-id");
    req.id = recibido && /^[\w-]{8,64}$/.test(recibido) ? recibido : randomUUID();
    res.set({ "X-Request-Id": req.id, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    // Con HTTPS, el navegador no vuelve a pedir este sitio por HTTP.
    if (config.tlsCert) res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  });

  // Vida del proceso, para el healthcheck de Docker. No consulta a nadie ni deja registro.
  app.get("/salud", (_req, res) => res.json({ gateway: "ok" }));

  if (config.registrarAccesos) {
    app.use((req, res, next) => {
      const inicio = performance.now();
      res.on("finish", () => {
        // Sin correos ni cuerpos en el log: el rol y el id de la cuenta bastan para seguir la petición.
        const quien = req.usuario ? ` ${req.usuario.rol}:${req.usuario.sub.slice(0, 8)}` : "";
        console.log(`${req.method} ${req.originalUrl.split("?")[0]}${quien} ${res.statusCode} ${Math.round(performance.now() - inicio)} ms [${req.id}]`);
      });
      next();
    });
  }

  // --- Frontend -----------------------------------------------------------------
  app.use(
    express.static(config.dirFrontend, {
      index: "index.html",
      dotfiles: "ignore",
      setHeaders: (res) => res.set({ "Content-Security-Policy": CSP, "X-Frame-Options": "DENY" }),
    }),
  );

  // --- API ------------------------------------------------------------------------
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", limitarPorMinuto(config.limiteGeneral), verificarOrigen(config));

  app.get("/api/salud", async (_req, res) => {
    const consultar = (url) =>
      fetch(`${url}/salud`, { signal: AbortSignal.timeout(2_000) })
        .then((r) => (r.ok ? "ok" : `error ${r.status}`))
        .catch(() => "sin respuesta");
    const nombres = Object.keys(config.urls);
    const estados = await Promise.all([vault.salud(), ...nombres.map((n) => consultar(config.urls[n]))]);
    const detalle = { gateway: "ok", vault: estados[0], ...Object.fromEntries(nombres.map((n, i) => [n, estados[i + 1]])) };
    res.status(estados.every((e) => e === "ok") ? 200 : 503).json(detalle);
  });

  const sensibles = limitarPorMinuto(config.limiteSensibles);
  app.use(["/api/v1/auth/login", "/api/v1/auth/reenviar", "/api/v1/auth/verificar", "/api/v1/clientes/registro"], sensibles);

  app.use("/api/v1", identificar(config, auth));
  app.use("/api/v1/auth", rutasSesion(config, auth));

  app.use("/api/v1", express.raw({ type: () => true, limit: "100kb" }), async (req, res, next) => {
    const encontrada = resolver(req.method, req.path);
    if (!encontrada) return error(res, 404, "RUTA_INEXISTENTE", `No existe ${req.method} /api/v1${req.path}.`);
    if (encontrada.existeOtroMetodo) return error(res, 405, "METODO_NO_PERMITIDO", `La ruta /api/v1${req.path} no acepta ${req.method}.`);

    const { ruta, destinoRuta } = encontrada;
    if (!permitido(ruta.acceso, req.usuario)) {
      if (!req.usuario) {
        return error(res, 401, req.sesionVencida ? "SESION_EXPIRADA" : "SIN_SESION", req.sesionVencida ? "Tu sesión expiró. Vuelve a ingresar." : "Inicia sesión para continuar.");
      }
      return error(res, 403, "PROHIBIDO", "Tu perfil no tiene permiso para esta operación.");
    }

    try {
      // La notificación de la pasarela no lleva identidad de usuario: la autentica su firma.
      const usuario = ruta.acceso === "webhook" ? null : req.usuario;
      await reenviar(req, res, { destino: ruta.destino, ruta: destinoRuta, usuario });
    } catch (err) {
      next(err);
    }
  });

  app.use("/api", (req, res) => error(res, 404, "RUTA_INEXISTENTE", `No existe ${req.method} ${req.originalUrl.split("?")[0]}.`));
  app.use(manejarErrorServicios);
  app.use((err, req, res, _next) => {
    console.error(`[${req.id}] error interno:`, err);
    error(res, 500, "ERROR_INTERNO", "Ocurrió un error inesperado en el gateway.");
  });

  return app;
}
