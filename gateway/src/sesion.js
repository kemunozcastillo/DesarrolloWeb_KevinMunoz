/**
 * Sesión en el gateway.
 *
 *   POST /api/v1/auth/login    reenvía correo y clave al Auth Service y guarda
 *                              el token en una cookie HttpOnly (el cuerpo no lo trae)
 *   POST /api/v1/auth/logout   revoca la sesión y borra la cookie
 *   GET  /api/v1/auth/sesion   quién soy (o 401)
 *   PUT  /api/v1/auth/clave    cambia la clave de la cuenta de la sesión
 *
 * En cada petición a la API, el gateway lee la cookie y le pregunta al Auth
 * Service si el token sigue activo (introspección). Un logout o una cuenta
 * desactivada tienen efecto en la petición siguiente.
 */

import express from "express";

import { ErrorAuth } from "./cliente-auth.js";
import { ErrorDestino } from "./reenvio.js";
import { ErrorVault } from "./vault.js";

export const error = (res, estado, codigo, mensaje) => res.status(estado).json({ codigo, mensaje, idPeticion: res.get("X-Request-Id") });

// --- Cookie ----------------------------------------------------------------------

export function leerCookie(req, nombre) {
  for (const parte of (req.get("cookie") ?? "").split(";")) {
    const [clave, ...valor] = parte.trim().split("=");
    if (clave === nombre) return decodeURIComponent(valor.join("="));
  }
  return null;
}

/**
 * HttpOnly: JavaScript no puede leerla (un script inyectado no roba la sesión).
 * Secure: solo viaja por HTTPS (se desactiva para localhost).
 * SameSite=Lax: el navegador no la manda en un POST iniciado desde otro sitio (CSRF).
 * Path=/api: solo se envía a la API.
 */
function opcionesCookie(config, maxAgeSeg) {
  return ["Path=/api", "HttpOnly", `SameSite=${config.cookieSameSite}`, config.cookieSecure ? "Secure" : "", `Max-Age=${maxAgeSeg}`].filter(Boolean).join("; ");
}

const ponerCookie = (res, config, token, maxAgeSeg) => res.append("Set-Cookie", `${config.cookieNombre}=${encodeURIComponent(token)}; ${opcionesCookie(config, maxAgeSeg)}`);
const borrarCookie = (res, config) => res.append("Set-Cookie", `${config.cookieNombre}=; ${opcionesCookie(config, 0)}`);

/** Lo que el frontend necesita saber de la sesión. */
function sesionPublica(u) {
  return {
    tipo: u.rol === "cliente" ? "CLIENTE" : "USUARIO",
    id: u.sujeto ?? u.sub,
    perfil: u.rol.toUpperCase(),
    nombre: u.nombre,
    email: u.email,
    expira: new Date(u.exp * 1000).toISOString(),
  };
}

// --- Errores de servicios -----------------------------------------------------------

export function manejarErrorServicios(err, req, res, next) {
  if (err instanceof ErrorVault) {
    console.error(`[${req.id}] Vault: ${err.message} (${err.detalle})`);
    return error(res, 503, "SECRETOS_NO_DISPONIBLES", "El sistema no puede verificar credenciales en este momento. Intenta en unos minutos.");
  }
  if (err instanceof ErrorAuth) {
    console.error(`[${req.id}] Auth Service: ${err.message} (${err.detalle})`);
    return error(res, 502, "AUTH_NO_DISPONIBLE", "El servicio de cuentas no está disponible en este momento.");
  }
  if (err instanceof ErrorDestino) return error(res, err.estado, err.codigo, err.message);
  if (err.type === "entity.too.large") return error(res, 413, "CUERPO_GRANDE", "La petición es demasiado grande.");
  next(err);
}

// --- CSRF por origen --------------------------------------------------------------------

/**
 * Una petición que cambia datos y viene desde un sitio que no está en la lista
 * se rechaza aunque traiga la cookie. Es una segunda barrera además de SameSite.
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

// --- Identificar al usuario -----------------------------------------------------------------

/** Si hay cookie, pregunta al Auth Service quién es. No exige sesión: eso lo decide la ruta. */
export function identificar(config, auth) {
  return async (req, res, next) => {
    const token = leerCookie(req, config.cookieNombre);
    if (!token) return next();
    try {
      const resultado = await auth.introspect(token, req.id);
      if (resultado?.active) req.usuario = resultado;
      else {
        borrarCookie(res, config); // una cookie muerta no sirve de nada
        req.sesionVencida = true;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function rutasSesion(config, auth) {
  const router = express.Router();
  // El cuerpo se lee solo en las rutas de este router: el resto de /auth se reenvía tal cual.
  const json = express.json({ limit: "10kb" });

  router.post("/login", json, async (req, res, next) => {
    const usuario = req.body?.email ?? req.body?.usuario;
    const clave = req.body?.clave;
    if (typeof usuario !== "string" || typeof clave !== "string" || !usuario || !clave) {
      return error(res, 400, "DATOS_INCOMPLETOS", "Escribe tu correo y tu contraseña.");
    }
    try {
      const { estado, datos, retryAfter } = await auth.login(usuario, clave, req.id);
      if (estado !== 200) {
        if (retryAfter) res.set("Retry-After", retryAfter);
        return error(res, estado, datos?.codigo ?? "LOGIN_FALLIDO", datos?.mensaje ?? "No se pudo iniciar sesión.");
      }
      const maxAge = Math.max(0, datos.expiraMaximo - Math.floor(Date.now() / 1000));
      ponerCookie(res, config, datos.token, maxAge);
      const u = datos.usuario;
      res.json(sesionPublica({ ...u, sub: u.id, exp: datos.expira }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", async (req, res, next) => {
    const token = leerCookie(req, config.cookieNombre);
    try {
      if (token) await auth.logout(token, req.id);
      borrarCookie(res, config);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get("/sesion", (req, res) => {
    if (!req.usuario) return error(res, 401, req.sesionVencida ? "SESION_EXPIRADA" : "SIN_SESION", "No hay una sesión activa.");
    res.json(sesionPublica(req.usuario));
  });

  router.put("/clave", json, async (req, res, next) => {
    if (!req.usuario) return error(res, 401, "SIN_SESION", "Inicia sesión para continuar.");
    try {
      // La cuenta sale de la sesión, nunca del cuerpo: nadie cambia la clave de otro.
      const { estado, datos } = await auth.cambiarClave(req.usuario.sub, req.body?.actual, req.body?.nueva, req.id);
      if (estado !== 204) return error(res, estado, datos?.codigo ?? "ERROR", datos?.mensaje ?? "No se pudo cambiar la contraseña.");
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get("/config", (_req, res) => {
    // En modo demo, la pantalla de ingreso ofrece las cuentas de prueba documentadas en el README.
    res.json({ modoDemo: config.modoDemo, cuentasDemo: config.modoDemo ? config.cuentasDemo : [] });
  });

  return router;
}
