/**
 * Auth Service de Poke Fresh: cuentas, contraseñas, sesiones y verificación de correo.
 *
 * Es un servicio interno. Lo llaman dos clientes, cada uno con su propio
 * secreto en Vault (HTTP Basic) y solo a las rutas que necesita:
 *
 *   gateway   POST /login, /introspect, /logout, /clave
 *             POST /verificacion, /verificacion/reenviar
 *             GET/POST/PUT/PATCH /usuarios...   (personal; solo si el gateway indica rol admin)
 *   clientes  POST /cuentas                     (crea cuentas de rol cliente, nunca de personal)
 *             PATCH /cuentas/sujeto/:id         (correo, nombre, activo)
 *             GET /cuentas/verificacion         (qué clientes verificaron su correo)
 *
 *   GET /salud   pública
 *
 * La introspección sigue la idea del estándar OAuth (RFC 7662): responde
 * { active: true, ... } o { active: false }, sin explicar por qué.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";

import { codigoCoincide, HASH_FICTICIO, hashCodigo, hashear, nuevoCodigo, validarFortaleza, verificar } from "./claves.js";
import { ErrorCuenta, publica, ROLES_PERSONAL } from "./cuentas.js";
import { crearAlmacenSesiones, crearControlIntentos } from "./sesiones.js";
import { crearClienteVault, ErrorVault } from "./vault.js";

const iguales = (a, b) => {
  const hash = (t) => createHash("sha256").update(String(t)).digest();
  return timingSafeEqual(hash(a), hash(b));
};

const segundos = (ms) => Math.floor(ms / 1000);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HORAS_CODIGO = 24;

/** Qué rutas puede llamar cada cliente del servicio. */
const PERMISOS = {
  gateway: ["/login", "/introspect", "/logout", "/clave", "/verificacion", "/usuarios"],
  clientes: ["/cuentas"],
};

export function crearApp(config, dependencias) {
  const vault = dependencias.vault ?? crearClienteVault(config);
  const cuentas = dependencias.cuentas;
  const reloj = dependencias.reloj ?? Date.now;
  const sesiones = dependencias.sesiones ?? crearAlmacenSesiones({ inactividadSeg: config.sesionInactividadSeg, maximaSeg: config.sesionMaximaSeg, reloj });
  const intentos = crearControlIntentos({ maxIntentos: config.maxIntentos, bloqueoSeg: config.bloqueoSeg, reloj });

  const fallo = (estado, codigo, mensaje) => new ErrorCuenta(estado, codigo, mensaje);
  const pepper = () => vault.leerValor(config.rutaSecretoAuth, "pepper");

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));

  if (config.registrarAccesos) {
    app.use((req, res, next) => {
      const inicio = performance.now();
      res.on("finish", () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Math.round(performance.now() - inicio)} ms rid=${req.get("x-request-id") ?? "-"}`));
      next();
    });
  }

  app.get("/salud", async (_req, res) => {
    const estadoVault = await vault.salud();
    res.status(estadoVault === "ok" ? 200 : 503).json({ servicio: "auth", ok: estadoVault === "ok", vault: estadoVault, sesionesActivas: sesiones.cantidad() });
  });

  // --- Autenticación de los clientes del servicio -------------------------------

  app.use(async (req, res, next) => {
    const [tipo, valor] = (req.get("authorization") ?? "").split(" ");
    const [cliente, secreto] = tipo === "Basic" && valor ? Buffer.from(valor, "base64").toString().split(":") : [];
    const permisos = PERMISOS[cliente];

    if (!cliente || !secreto || !permisos) {
      return res.status(401).json({ codigo: "CLIENTE_NO_AUTORIZADO", mensaje: "Este servicio solo atiende a servicios internos autorizados." });
    }
    try {
      const esperado = await vault.leerValor(`${config.rutaClientes}/auth-${cliente}`, "secreto");
      if (!iguales(secreto, esperado)) {
        return res.status(401).json({ codigo: "CLIENTE_NO_AUTORIZADO", mensaje: "Credenciales de cliente inválidas." });
      }
      if (!permisos.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
        return res.status(403).json({ codigo: "RUTA_NO_PERMITIDA", mensaje: `El cliente ${cliente} no puede usar ${req.path}.` });
      }
      req.cliente = cliente;
      next();
    } catch (error) {
      next(error);
    }
  });

  // --- Login, introspección, logout ---------------------------------------------------

  app.post("/login", async (req, res, next) => {
    const email = String(req.body?.usuario ?? req.body?.email ?? "").trim().toLowerCase();
    const clave = req.body?.clave;

    if (!email || typeof clave !== "string" || !clave) {
      return res.status(400).json({ codigo: "DATOS_INCOMPLETOS", mensaje: "Escribe tu correo y tu contraseña." });
    }

    const bloqueo = intentos.bloqueadoHasta(email);
    if (bloqueo) {
      const espera = Math.ceil((bloqueo - reloj()) / 1000);
      res.set("Retry-After", String(espera));
      return res.status(429).json({ codigo: "BLOQUEADO", mensaje: `Demasiados intentos. Espera ${Math.ceil(espera / 60)} minuto(s) y vuelve a intentar.` });
    }

    try {
      const cuenta = await cuentas.porEmail(email);
      // Se calcula un hash incluso si la cuenta no existe, para que el tiempo
      // de respuesta sea el mismo en ambos casos.
      const coincide = await verificar(clave, cuenta?.hash ?? HASH_FICTICIO, await pepper());

      if (!cuenta || !coincide) {
        intentos.fallo(email);
        // Mismo mensaje para correo inexistente y clave incorrecta.
        return res.status(401).json({ codigo: "CREDENCIALES", mensaje: "Correo o contraseña incorrectos." });
      }
      intentos.exito(email);

      if (!cuenta.activo) return res.status(403).json({ codigo: "INACTIVA", mensaje: "Esta cuenta está desactivada. Contacta al restaurante." });
      if (cuenta.rol === "cliente" && !cuenta.emailVerificado) {
        return res.status(403).json({ codigo: "SIN_VERIFICAR", mensaje: "Verifica tu correo antes de ingresar." });
      }

      const { token, vence, venceMaximo } = sesiones.crear({ id: cuenta._id, usuario: cuenta.email, nombre: cuenta.nombre, rol: cuenta.rol });
      res.json({
        token,
        tipo: "sesion",
        expira: segundos(vence),
        expiraMaximo: segundos(venceMaximo),
        usuario: { id: cuenta._id, email: cuenta.email, nombre: cuenta.nombre, rol: cuenta.rol, sujeto: cuenta.sujetoId ?? cuenta._id },
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/introspect", async (req, res, next) => {
    const token = req.body?.token;
    if (typeof token !== "string" || !token) return res.json({ active: false });

    const sesion = sesiones.usar(token);
    if (!sesion) return res.json({ active: false });

    try {
      // La cuenta pudo desactivarse o cambiar de rol desde el login: se responde con su estado actual.
      const cuenta = await cuentas.porId(sesion.usuarioId);
      if (!cuenta || !cuenta.activo) {
        sesiones.revocar(token);
        return res.json({ active: false });
      }
      res.json({
        active: true,
        sub: cuenta._id,
        email: cuenta.email,
        nombre: cuenta.nombre,
        rol: cuenta.rol,
        sujeto: cuenta.sujetoId ?? cuenta._id,
        iat: segundos(sesion.creada),
        exp: segundos(sesion.vence),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/logout", (req, res) => {
    if (typeof req.body?.token === "string") sesiones.revocar(req.body.token);
    res.status(204).end(); // cerrar una sesión que ya no existe no es un error
  });

  app.post("/clave", async (req, res, next) => {
    try {
      const { cuentaId, actual, nueva } = req.body ?? {};
      const cuenta = await cuentas.porId(String(cuentaId ?? ""));
      if (!cuenta) throw fallo(404, "NO_ENCONTRADO", "No existe esa cuenta.");
      if (!(await verificar(String(actual ?? ""), cuenta.hash, await pepper()))) throw fallo(400, "CLAVE_ACTUAL", "La contraseña actual no es correcta.");
      const problema = validarFortaleza(nueva);
      if (problema) throw fallo(400, "CLAVE_DEBIL", problema);
      await cuentas.actualizar(cuenta._id, { hash: await hashear(nueva, await pepper()) });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // --- Verificación de correo ----------------------------------------------------

  /** Emite un código nuevo. Solo se guarda su hash; en modo demo vuelve en la respuesta para mostrar el "correo simulado". */
  async function emitirCodigo(cuenta) {
    const codigo = nuevoCodigo();
    await cuentas.actualizar(cuenta._id, { emailVerificado: false, verificacion: { hash: hashCodigo(codigo), vence: reloj() + HORAS_CODIGO * 3600_000 } });
    return config.modoDemo ? codigo : null;
  }

  app.post("/verificacion", async (req, res, next) => {
    try {
      const cuenta = await cuentas.porEmail(req.body?.email);
      const codigo = String(req.body?.codigo ?? "");
      if (cuenta?.emailVerificado) return res.json({ verificado: true });
      if (!cuenta || !cuenta.verificacion || !codigoCoincide(codigo, cuenta.verificacion.hash)) {
        throw fallo(400, "CODIGO", "El código no coincide. Revisa el correo más reciente.");
      }
      if (reloj() > cuenta.verificacion.vence) throw fallo(400, "VENCIDO", "El código venció. Pide uno nuevo.");
      await cuentas.actualizar(cuenta._id, { emailVerificado: true, verificacion: null });
      res.json({ verificado: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/verificacion/reenviar", async (req, res, next) => {
    try {
      const cuenta = await cuentas.porEmail(req.body?.email);
      // La respuesta es igual exista o no la cuenta: no revela qué correos están registrados.
      const codigoDemo = cuenta && cuenta.rol === "cliente" && !cuenta.emailVerificado ? await emitirCodigo(cuenta) : null;
      res.json({ mensaje: "Si el correo está registrado y sin verificar, enviamos un código nuevo.", codigoDemo });
    } catch (error) {
      next(error);
    }
  });

  // --- Cuentas de clientes (las pide el servicio de clientes) ---------------------------

  app.post("/cuentas", async (req, res, next) => {
    try {
      const { email, clave, nombre, sujetoId } = req.body ?? {};
      if (!EMAIL.test(String(email ?? ""))) throw fallo(400, "DATOS_INVALIDOS", "El correo no tiene un formato válido.");
      if (!sujetoId) throw fallo(400, "DATOS_INVALIDOS", "Falta el cliente al que pertenece la cuenta.");
      const problema = validarFortaleza(clave);
      if (problema) throw fallo(400, "CLAVE_DEBIL", problema);

      // El servicio de clientes solo puede crear cuentas de rol cliente.
      const cuenta = await cuentas.crear({
        email,
        nombre: String(nombre ?? "").trim(),
        rol: "cliente",
        sujetoId,
        hash: await hashear(clave, await pepper()),
        activo: true,
        emailVerificado: false,
      });
      const codigoDemo = await emitirCodigo(cuenta);
      res.status(201).json({ id: cuenta._id, codigoDemo });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/cuentas/sujeto/:sujetoId", async (req, res, next) => {
    try {
      const cuenta = await cuentas.porSujeto(req.params.sujetoId);
      if (!cuenta) throw fallo(404, "NO_ENCONTRADO", "No existe la cuenta de ese cliente.");
      const { email, nombre, activo } = req.body ?? {};
      const cambios = {};
      if (typeof nombre === "string" && nombre.trim()) cambios.nombre = nombre.trim();
      if (typeof activo === "boolean") cambios.activo = activo;
      if (email !== undefined) {
        if (!EMAIL.test(String(email))) throw fallo(400, "DATOS_INVALIDOS", "El correo no tiene un formato válido.");
        cambios.email = String(email).trim().toLowerCase();
      }
      let actualizada = await cuentas.actualizar(cuenta._id, cambios);

      // Desactivar o cambiar el correo cierra las sesiones abiertas de la cuenta.
      let codigoDemo = null;
      if (cambios.activo === false || (cambios.email && cambios.email !== cuenta.email)) sesiones.revocarDeUsuario(cuenta._id);
      if (cambios.email && cambios.email !== cuenta.email) {
        codigoDemo = await emitirCodigo(actualizada);
        actualizada = await cuentas.porId(cuenta._id);
      }
      res.json({ ...publica(actualizada), codigoDemo });
    } catch (error) {
      next(error);
    }
  });

  app.get("/cuentas/verificacion", async (_req, res, next) => {
    try {
      const lista = await cuentas.listar({ rol: "cliente" });
      res.json(Object.fromEntries(lista.map((c) => [c.sujetoId, Boolean(c.emailVerificado)])));
    } catch (error) {
      next(error);
    }
  });

  // --- Usuarios internos (mantenedor del administrador) --------------------------------

  /** El gateway ya validó la sesión; aquí se exige además que quien pide sea admin. */
  function soloAdmin(req, _res, next) {
    if (req.get("x-usuario-rol") !== "admin") return next(fallo(403, "PROHIBIDO", "Solo el administrador gestiona usuarios."));
    req.actorId = req.get("x-usuario-id");
    next();
  }

  function validarUsuario(datos) {
    const nombre = String(datos.nombre ?? "").trim().replace(/\s+/g, " ");
    const email = String(datos.email ?? "").trim().toLowerCase();
    if (nombre.length < 3 || nombre.length > 80) throw fallo(400, "DATOS_INVALIDOS", "Escribe el nombre del usuario.");
    if (!EMAIL.test(email)) throw fallo(400, "DATOS_INVALIDOS", "El correo no tiene un formato válido.");
    if (!ROLES_PERSONAL.includes(datos.rol)) throw fallo(400, "DATOS_INVALIDOS", "Elige un perfil.");
    return { nombre, email, rol: datos.rol };
  }

  const adminsActivos = async () => (await cuentas.listar({ rol: "admin" })).filter((c) => c.activo).length;

  app.get("/usuarios", soloAdmin, async (_req, res, next) => {
    try {
      res.json((await cuentas.listar({ rol: { $in: ROLES_PERSONAL } })).map(publica));
    } catch (error) {
      next(error);
    }
  });

  app.post("/usuarios", soloAdmin, async (req, res, next) => {
    try {
      const datos = validarUsuario(req.body ?? {});
      const problema = validarFortaleza(req.body?.clave);
      if (problema) throw fallo(400, "CLAVE_DEBIL", problema);
      const cuenta = await cuentas.crear({ ...datos, hash: await hashear(req.body.clave, await pepper()), activo: true, emailVerificado: true });
      res.status(201).json(publica(cuenta));
    } catch (error) {
      next(error);
    }
  });

  app.put("/usuarios/:id", soloAdmin, async (req, res, next) => {
    try {
      const cuenta = await cuentas.porId(req.params.id);
      if (!cuenta || cuenta.rol === "cliente") throw fallo(404, "NO_ENCONTRADO", "No existe ese usuario.");
      const datos = validarUsuario({ ...cuenta, ...req.body });

      if (cuenta.rol === "admin" && datos.rol !== "admin" && cuenta.activo && (await adminsActivos()) === 1) {
        throw fallo(400, "ULTIMO_ADMIN", "Debe quedar al menos un administrador activo.");
      }
      if (cuenta._id === req.actorId && datos.rol !== cuenta.rol) throw fallo(400, "PROPIO_PERFIL", "No puedes cambiar tu propio perfil.");

      const cambios = { ...datos };
      if (req.body?.clave) {
        const problema = validarFortaleza(req.body.clave);
        if (problema) throw fallo(400, "CLAVE_DEBIL", problema);
        cambios.hash = await hashear(req.body.clave, await pepper());
      }
      const actualizada = await cuentas.actualizar(cuenta._id, cambios);
      if (cambios.hash || datos.rol !== cuenta.rol) sesiones.revocarDeUsuario(cuenta._id);
      res.json(publica(actualizada));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/usuarios/:id/estado", soloAdmin, async (req, res, next) => {
    try {
      const cuenta = await cuentas.porId(req.params.id);
      if (!cuenta || cuenta.rol === "cliente") throw fallo(404, "NO_ENCONTRADO", "No existe ese usuario.");
      const activo = req.body?.activo;
      if (typeof activo !== "boolean") throw fallo(400, "DATOS_INVALIDOS", "Indica si el usuario queda activo.");
      if (cuenta._id === req.actorId && !activo) throw fallo(400, "PROPIA_CUENTA", "No puedes desactivar tu propia cuenta.");
      if (!activo && cuenta.rol === "admin" && cuenta.activo && (await adminsActivos()) === 1) {
        throw fallo(400, "ULTIMO_ADMIN", "Debe quedar al menos un administrador activo.");
      }
      const actualizada = await cuentas.actualizar(cuenta._id, { activo });
      if (!activo) sesiones.revocarDeUsuario(cuenta._id);
      res.json(publica(actualizada));
    } catch (error) {
      next(error);
    }
  });

  // --- Errores ---------------------------------------------------------------------

  app.use((error, _req, res, _next) => {
    if (error instanceof ErrorCuenta) return res.status(error.estado).json({ codigo: error.codigo, mensaje: error.message });
    if (error instanceof ErrorVault) {
      console.error(`Vault: ${error.message} (${error.detalle})`);
      return res.status(503).json({ codigo: "SECRETOS_NO_DISPONIBLES", mensaje: "El servicio de cuentas no pudo leer sus secretos. Intenta en unos minutos." });
    }
    if (error.type === "entity.parse.failed") return res.status(400).json({ codigo: "JSON_INVALIDO", mensaje: "El cuerpo no es JSON válido." });

    console.error("error interno:", error);
    res.status(500).json({ codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." });
  });

  if (!dependencias.sinLimpieza) setInterval(() => sesiones.limpiar(), 60_000).unref();

  return app;
}
