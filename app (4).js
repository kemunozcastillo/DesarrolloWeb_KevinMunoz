/**
 * Auth Service de Poke Fresh.
 *
 *   POST /login        usuario y contraseña -> token de sesión
 *   POST /introspect   token -> ¿está activo? ¿de quién es? ¿qué rol tiene?
 *   POST /logout       token -> lo revoca
 *   GET  /salud        estado del servicio y de Vault (pública)
 *
 * Es un servicio interno: solo el gateway puede llamarlo. Cada petición debe
 * traer "Authorization: Basic" con el usuario "gateway" y el secreto de
 * introspección, que ambos leen de Vault. La introspección sigue la idea del
 * estándar OAuth para este fin (RFC 7662): responde { active: true, ... } o
 * { active: false }, sin explicar por qué un token no sirve.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";

import { HASH_FICTICIO, verificar } from "./claves.js";
import { crearAlmacenSesiones, crearControlIntentos } from "./sesiones.js";
import { crearRepositorioUsuarios } from "./usuarios.js";
import { crearClienteVault, ErrorVault } from "./vault.js";

const iguales = (a, b) => {
  const hash = (t) => createHash("sha256").update(String(t)).digest();
  return timingSafeEqual(hash(a), hash(b));
};

const segundos = (ms) => Math.floor(ms / 1000);

export function crearApp(config, dependencias = {}) {
  const vault = dependencias.vault ?? crearClienteVault(config);
  const usuarios = dependencias.usuarios ?? crearRepositorioUsuarios(config.archivoUsuarios);
  const reloj = dependencias.reloj ?? Date.now;
  const sesiones = dependencias.sesiones ?? crearAlmacenSesiones({ inactividadSeg: config.sesionInactividadSeg, maximaSeg: config.sesionMaximaSeg, reloj });
  const intentos = crearControlIntentos({ maxIntentos: config.maxIntentos, bloqueoSeg: config.bloqueoSeg, reloj });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));

  if (config.registrarAccesos) {
    app.use((req, res, next) => {
      const inicio = performance.now();
      res.on("finish", () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Math.round(performance.now() - inicio)} ms`));
      next();
    });
  }

  app.get("/salud", async (_req, res) => {
    const estadoVault = await vault.salud();
    res.status(estadoVault === "ok" ? 200 : 503).json({ ok: estadoVault === "ok", vault: estadoVault, sesionesActivas: sesiones.cantidad() });
  });

  // --- Solo el gateway puede llamar al resto -------------------------------------

  app.use(async (req, res, next) => {
    const [tipo, valor] = (req.get("authorization") ?? "").split(" ");
    const [cliente, secreto] = tipo === "Basic" && valor ? Buffer.from(valor, "base64").toString().split(":") : [];

    if (!cliente || !secreto) {
      return res.status(401).json({ error: "CLIENTE_NO_AUTORIZADO", mensaje: "Este servicio solo atiende al gateway." });
    }

    try {
      const esperado = await vault.leerValor(config.rutaSecretoIntrospeccion, "secreto");
      if (cliente !== "gateway" || !iguales(secreto, esperado)) {
        return res.status(401).json({ error: "CLIENTE_NO_AUTORIZADO", mensaje: "Credenciales de cliente inválidas." });
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  // --- Login ------------------------------------------------------------------

  app.post("/login", async (req, res, next) => {
    const usuario = String(req.body?.usuario ?? "").trim().toLowerCase();
    const clave = req.body?.clave;

    if (!usuario || typeof clave !== "string" || !clave) {
      return res.status(400).json({ error: "DATOS_INCOMPLETOS", mensaje: "Envía usuario y clave." });
    }

    const bloqueo = intentos.bloqueadoHasta(usuario);
    if (bloqueo) {
      const espera = Math.ceil((bloqueo - reloj()) / 1000);
      res.set("Retry-After", String(espera));
      return res.status(429).json({ error: "USUARIO_BLOQUEADO", mensaje: `Demasiados intentos fallidos. Espera ${Math.ceil(espera / 60)} minuto(s).` });
    }

    try {
      const pepper = await vault.leerValor(config.rutaSecretoAuth, "pepper");
      const encontrado = await usuarios.buscar(usuario);

      // Se calcula un hash incluso si el usuario no existe, para que el tiempo
      // de respuesta sea el mismo en ambos casos.
      const coincide = await verificar(clave, encontrado?.hash ?? HASH_FICTICIO, pepper);

      if (!encontrado || !coincide || !encontrado.activo) {
        intentos.fallo(usuario);
        // Mismo mensaje para usuario inexistente y clave incorrecta: no se
        // revela qué usuarios existen.
        return res.status(401).json({ error: "CREDENCIALES_INVALIDAS", mensaje: "Usuario o contraseña incorrectos." });
      }

      intentos.exito(usuario);
      const { token, sesion, vence, venceMaximo } = sesiones.crear(encontrado);

      res.json({
        token,
        tipo: "sesion",
        expira: segundos(vence),
        expiraMaximo: segundos(venceMaximo),
        usuario: { id: sesion.usuarioId, usuario: sesion.usuario, nombre: sesion.nombre, rol: sesion.rol },
      });
    } catch (error) {
      next(error);
    }
  });

  // --- Introspección ---------------------------------------------------------------

  app.post("/introspect", async (req, res, next) => {
    const token = req.body?.token;
    if (typeof token !== "string" || !token) return res.json({ active: false });

    const sesion = sesiones.usar(token);
    if (!sesion) return res.json({ active: false });

    try {
      // El usuario pudo desactivarse o cambiar de rol desde que inició sesión:
      // se responde con el estado actual, no con el del momento del login.
      const usuario = await usuarios.obtener(sesion.usuarioId);
      if (!usuario || !usuario.activo) {
        sesiones.revocar(token);
        return res.json({ active: false });
      }

      res.json({
        active: true,
        sub: usuario.id,
        usuario: usuario.usuario,
        nombre: usuario.nombre,
        rol: usuario.rol,
        iat: segundos(sesion.creada),
        exp: segundos(sesion.vence),
      });
    } catch (error) {
      next(error);
    }
  });

  // --- Logout ----------------------------------------------------------------------

  app.post("/logout", (req, res) => {
    if (typeof req.body?.token === "string") sesiones.revocar(req.body.token);
    // Siempre 204: cerrar una sesión que ya no existe no es un error.
    res.status(204).end();
  });

  // --- Errores ---------------------------------------------------------------------

  app.use((error, _req, res, _next) => {
    if (error instanceof ErrorVault) {
      console.error(`Vault: ${error.message} (${error.detalle})`);
      const caido = error.tipo === "NO_DISPONIBLE";
      return res.status(caido ? 502 : 500).json({
        error: caido ? "VAULT_NO_DISPONIBLE" : "VAULT_MAL_CONFIGURADO",
        mensaje: caido ? "El gestor de secretos no está disponible." : "El servicio no pudo leer sus secretos en Vault.",
      });
    }
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "JSON_INVALIDO", mensaje: "El cuerpo no es JSON válido." });

    console.error("error interno:", error);
    res.status(500).json({ error: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." });
  });

  // Limpieza periódica de sesiones vencidas. unref(): no impide que el proceso termine.
  if (!dependencias.sinLimpieza) setInterval(() => sesiones.limpiar(), 60_000).unref();

  return app;
}
