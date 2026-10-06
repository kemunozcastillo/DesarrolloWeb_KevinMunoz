/**
 * Sesión y permisos en el gateway.
 *
 *   POST /api/auth/login    reenvía usuario y clave al Auth Service y guarda
 *                           el token en una cookie HttpOnly
 *   POST /api/auth/logout   revoca la sesión y borra la cookie
 *   GET  /api/auth/sesion   quién soy y hasta cuándo dura mi sesión
 *
 * En cada petición a la API, el gateway lee la cookie y le pregunta al Auth
 * Service si el token sigue activo (introspección). Así, un logout o un
 * usuario desactivado tienen efecto en la petición siguiente.
 */

import express from "express";

import { ErrorAuth } from "./cliente-auth.js";
import { ErrorVault } from "./vault.js";

/** Qué roles pueden usar cada método en la API de productos. */
export const PERMISOS = {
  GET: ["admin", "usuario"],
  POST: ["admin", "usuario"],
  PUT: ["admin", "usuario"],
  DELETE: ["admin"],
};

const error = (res, estado, codigo, mensaje) => res.status(estado).json({ error: codigo, mensaje, idPeticion: res.get("X-Request-Id") });

// --- Cookie ----------------------------------------------------------------------

function leerCookie(req, nombre) {
  for (const parte of (req.get("cookie") ?? "").split(";")) {
    const [clave, ...valor] = parte.trim().split("=");
    if (clave === nombre) return decodeURIComponent(valor.join("="));
  }
  return null;
}

/**
 * HttpOnly: JavaScript no puede leerla, así que un script inyectado en la
 * página no puede robar la sesión.
 * Secure: solo viaja por HTTPS (se puede desactivar para localhost).
 * SameSite=Lax: el navegador no la manda en un POST o DELETE iniciado desde
 * otro sitio, lo que frena los ataques CSRF.
 * Path=/api: solo se envía a la API, no a otras rutas.
 */
function opcionesCookie(config, maxAgeSeg) {
  return [`Path=/api`, `HttpOnly`, `SameSite=${config.cookieSameSite}`, config.cookieSecure ? "Secure" : "", `Max-Age=${maxAgeSeg}`].filter(Boolean).join("; ");
}

const ponerCookie = (res, config, token, maxAgeSeg) => res.append("Set-Cookie", `${config.cookieNombre}=${encodeURIComponent(token)}; ${opcionesCookie(config, maxAgeSeg)}`);
const borrarCookie = (res, config) => res.append("Set-Cookie", `${config.cookieNombre}=; ${opcionesCookie(config, 0)}`);

// --- Errores de servicios -----------------------------------------------------------

/** Vault o el Auth Service caídos: 502. Vault mal configurado: 500. */
export function manejarErrorServicios(err, req, res, next) {
  if (err instanceof ErrorVault) {
    console.error(`[${req.id}] Vault: ${err.message} (${err.detalle})`);
    return err.tipo === "NO_DISPONIBLE"
      ? error(res, 502, "VAULT_NO_DISPONIBLE", "No se pudo verificar la sesión: el gestor de secretos no está disponible.")
      : error(res, 500, "VAULT_MAL_CONFIGURADO", "No se pudo verificar la sesión por un error de configuración del gateway.");
  }
  if (err instanceof ErrorAuth) {
    console.error(`[${req.id}] Auth Service: ${err.message} (${err.detalle})`);
    return error(res, 502, "AUTH_NO_DISPONIBLE", "El servicio de autenticación no está disponible en este momento.");
  }
  next(err);
}

// --- Protección CSRF por origen --------------------------------------------------------

/**
 * Una petición que cambia datos y viene desde un sitio que no está en la
 * lista se rechaza, aunque traiga la cookie. Es una segunda barrera además
 * de SameSite. Sin cabecera Origin (curl, Postman) no es un navegador y no aplica.
 */
export function verificarOrigen(config) {
  return (req, res, next) => {
    const origen = req.get("origin");
    const cambiaDatos = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (cambiaDatos && origen && !config.origenesPermitidos.includes(origen)) {
      return error(res, 403, "ORIGEN_NO_PERMITIDO", "Esta petición viene de un sitio no autorizado.");
    }
    next();
  };
}

// --- Rutas de sesión --------------------------------------------------------------------

export function rutasSesion(config, auth) {
  const router = express.Router();
  router.use(express.json({ limit: "10kb" }));

  router.post("/login", async (req, res, next) => {
    const usuario = req.body?.usuario;
    const clave = req.body?.clave;
    if (typeof usuario !== "string" || typeof clave !== "string" || !usuario || !clave) {
      return error(res, 400, "DATOS_INCOMPLETOS", "Envía usuario y clave.");
    }

    try {
      const { estado, datos, retryAfter } = await auth.login(usuario, clave);

      if (estado !== 200) {
        if (retryAfter) res.set("Retry-After", retryAfter);
        return error(res, estado, datos?.error ?? "LOGIN_FALLIDO", datos?.mensaje ?? "No se pudo iniciar sesión.");
      }

      // El token va solo en la cookie: el cuerpo de la respuesta no lo incluye.
      const maxAge = Math.max(0, datos.expiraMaximo - Math.floor(Date.now() / 1000));
      ponerCookie(res, config, datos.token, maxAge);
      res.json({ usuario: datos.usuario, expira: new Date(datos.expira * 1000).toISOString() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", async (req, res, next) => {
    const token = leerCookie(req, config.cookieNombre);
    try {
      if (token) await auth.logout(token);
      borrarCookie(res, config);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get("/sesion", exigirSesion(config, auth), (req, res) => {
    res.json({ usuario: req.usuario.usuario, nombre: req.usuario.nombre, rol: req.usuario.rol, expira: new Date(req.usuario.exp * 1000).toISOString() });
  });

  return router;
}

// --- Exigir sesión y rol ------------------------------------------------------------------

/** 401 sin cookie, o si el Auth Service dice que el token ya no está activo. */
export function exigirSesion(config, auth) {
  return async (req, res, next) => {
    const token = leerCookie(req, config.cookieNombre);
    if (!token) {
      res.set("WWW-Authenticate", 'Cookie realm="poke-fresh"');
      return error(res, 401, "SIN_SESION", "Inicia sesión para usar la API: POST /api/auth/login.");
    }

    try {
      const resultado = await auth.introspect(token);
      if (!resultado?.active) {
        borrarCookie(res, config); // una cookie muerta no sirve de nada en el navegador
        return error(res, 401, "SESION_EXPIRADA", "Tu sesión expiró o se cerró. Vuelve a iniciar sesión.");
      }
      req.usuario = resultado;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** 403 si el rol del usuario no puede usar este método. */
export function autorizarPorRol(permisos = PERMISOS) {
  return (req, res, next) => {
    const permitidos = permisos[req.method] ?? [];
    if (permitidos.includes(req.usuario.rol)) return next();

    error(res, 403, "PERMISO_INSUFICIENTE", `Tu rol (${req.usuario.rol}) no puede hacer ${req.method} en productos. Necesitas: ${permitidos.join(" o ") || "ninguno"}.`);
  };
}
