/**
 * Pruebas del gateway con Vault simulado, un Auth Service falso que cumple el
 * mismo contrato que el real (login, introspección, logout) y un backend
 * falso que exige la credencial interna.
 *
 *   npm test
 */

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import express from "express";

import { crearApp } from "../src/app.js";
import { leerConfig } from "../src/config.js";
import { crearVaultFalso } from "./vault-falso.js";

const ejecutar = promisify(execFile);
const CREDENCIAL = "credencial-interna-de-prueba";
const SECRETO = "secreto-de-introspeccion";
const ORIGEN = "https://kevin.github.io";

const escuchar = (app) => new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;

function authFalso() {
  const app = express();
  const usuarios = { admin: { clave: "ClaveAdmin2026", rol: "admin" }, vendedor: { clave: "ClaveVende2026", rol: "usuario" } };
  const sesiones = new Map();
  const estado = { llamadas: [], secreto: SECRETO };
  app.use(express.json());
  app.get("/salud", (_req, res) => res.json({ ok: true }));
  app.use((req, res, next) => {
    estado.llamadas.push(req.path);
    if (req.get("authorization") !== `Basic ${Buffer.from(`gateway:${estado.secreto}`).toString("base64")}`) return res.status(401).json({ error: "CLIENTE_NO_AUTORIZADO" });
    next();
  });
  app.post("/login", (req, res) => {
    const u = usuarios[req.body.usuario];
    if (req.body.usuario === "bloqueado") return res.set("Retry-After", "300").status(429).json({ error: "USUARIO_BLOQUEADO", mensaje: "Demasiados intentos." });
    if (!u || u.clave !== req.body.clave) return res.status(401).json({ error: "CREDENCIALES_INVALIDAS", mensaje: "Usuario o contraseña incorrectos." });
    const token = randomBytes(32).toString("base64url");
    const ahora = Math.floor(Date.now() / 1000);
    sesiones.set(token, { sub: `id-${req.body.usuario}`, usuario: req.body.usuario, nombre: req.body.usuario, rol: u.rol, exp: ahora + 1800 });
    res.json({ token, expira: ahora + 1800, expiraMaximo: ahora + 28800, usuario: { usuario: req.body.usuario, rol: u.rol } });
  });
  app.post("/introspect", (req, res) => {
    const s = sesiones.get(req.body.token);
    res.json(s ? { active: true, ...s } : { active: false });
  });
  app.post("/logout", (req, res) => {
    sesiones.delete(req.body.token);
    res.status(204).end();
  });
  return { app, estado, sesiones };
}

function backendFalso() {
  const app = express();
  const recibidas = [];
  app.use(express.json());
  app.get("/salud", (_req, res) => res.json({ ok: true }));
  app.all("*", (req, res) => {
    recibidas.push({ metodo: req.method, url: req.url, cabeceras: req.headers });
    if (req.get("x-credencial-interna") !== CREDENCIAL) return res.status(403).json({ detail: "Acceso directo no permitido." });
    if (req.method === "DELETE") return res.status(204).end();
    res.status(req.method === "POST" ? 201 : 200).json(req.method === "POST" ? { id: "nuevo" } : [{ nombre: "Ponzu" }]);
  });
  return { app, recibidas };
}

/** Saca la cookie pf_sesion de una respuesta. */
const cookieDe = (respuesta) => respuesta.headers.getSetCookie().find((c) => c.startsWith("pf_sesion="));
const valorCookie = (respuesta) => cookieDe(respuesta)?.split(";")[0];

describe("gateway con sesiones", () => {
  let vault, auth, backend, servidores, config, base;

  async function gateway(cambios = {}) {
    const s = await escuchar(crearApp({ ...config, ...cambios }));
    servidores.push(s);
    return url(s);
  }

  async function iniciar(usuario, clave, destino = base) {
    const respuesta = await fetch(`${destino}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario, clave }) });
    return { respuesta, cookie: valorCookie(respuesta) };
  }

  const pedir = (ruta, { cookie, metodo = "GET", cabeceras = {}, cuerpo, destino = base } = {}) =>
    fetch(`${destino}${ruta}`, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(cuerpo ? { "Content-Type": "application/json" } : {}), ...cabeceras },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });

  before(async () => {
    vault = crearVaultFalso();
    vault.escribir("poke-fresh/backend", { credencial_interna: CREDENCIAL });
    vault.escribir("poke-fresh/introspeccion", { secreto: SECRETO });
    auth = authFalso();
    backend = backendFalso();
    const [sVault, sAuth, sBackend] = await Promise.all([escuchar(vault.app), escuchar(auth.app), escuchar(backend.app)]);
    servidores = [sVault, sAuth, sBackend];

    config = {
      ...leerConfig({ NODE_ENV: "test" }),
      vaultAddr: url(sVault),
      vaultToken: "root",
      urlAuth: url(sAuth),
      urlBackend: url(sBackend),
      origenesPermitidos: [ORIGEN],
      cookieSecure: true,
    };
    base = await gateway();
  });

  beforeEach(() => {
    vault.estado.sellado = false;
    auth.estado.secreto = SECRETO;
  });

  after(() => servidores.forEach((s) => s.close()));

  // --- Login y cookie -------------------------------------------------------------

  test("login correcto: cookie HttpOnly, Secure, SameSite y sin el token en el cuerpo", async () => {
    const { respuesta } = await iniciar("vendedor", "ClaveVende2026");
    const cookie = cookieDe(respuesta);
    const cuerpo = await respuesta.json();

    assert.equal(respuesta.status, 200);
    for (const atributo of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api"]) assert.ok(cookie.includes(atributo), `falta ${atributo}`);
    assert.equal(cuerpo.usuario.rol, "usuario");
    assert.ok(!JSON.stringify(cuerpo).includes(cookie.split(";")[0].split("=")[1]), "el token no debe ir en el cuerpo");
  });

  test("credenciales incorrectas: 401 con el mensaje del Auth Service y sin cookie", async () => {
    const { respuesta, cookie } = await iniciar("vendedor", "mala");
    assert.equal(respuesta.status, 401);
    assert.equal((await respuesta.json()).error, "CREDENCIALES_INVALIDAS");
    assert.equal(cookie, undefined);
  });

  test("usuario bloqueado: 429 con Retry-After", async () => {
    const { respuesta } = await iniciar("bloqueado", "x");
    assert.equal(respuesta.status, 429);
    assert.equal(respuesta.headers.get("retry-after"), "300");
  });

  test("faltan datos: 400", async () => {
    assert.equal((await pedir("/api/auth/login", { metodo: "POST", cuerpo: { usuario: "admin" } })).status, 400);
  });

  // --- 401: sin sesión o sesión terminada ---------------------------------------------

  test("productos sin cookie: 401 y no llega al backend", async () => {
    const antes = backend.recibidas.length;
    const respuesta = await pedir("/api/v1/productos");
    assert.equal(respuesta.status, 401);
    assert.equal((await respuesta.json()).error, "SIN_SESION");
    assert.equal(backend.recibidas.length, antes);
  });

  test("cookie con un token inventado: 401 y la cookie se borra", async () => {
    const respuesta = await pedir("/api/v1/productos", { cookie: "pf_sesion=inventado" });
    assert.equal(respuesta.status, 401);
    assert.equal((await respuesta.json()).error, "SESION_EXPIRADA");
    assert.match(cookieDe(respuesta), /Max-Age=0/);
  });

  test("logout revoca la sesión: la misma cookie deja de servir", async () => {
    const { cookie } = await iniciar("admin", "ClaveAdmin2026");
    assert.equal((await pedir("/api/v1/productos", { cookie })).status, 200);

    const salida = await pedir("/api/auth/logout", { metodo: "POST", cookie });
    assert.equal(salida.status, 204);
    assert.match(cookieDe(salida), /Max-Age=0/);
    assert.equal((await pedir("/api/v1/productos", { cookie })).status, 401);
  });

  test("cada petición consulta al Auth Service (introspección sin caché)", async () => {
    const { cookie } = await iniciar("vendedor", "ClaveVende2026");
    const antes = auth.estado.llamadas.filter((l) => l === "/introspect").length;
    await pedir("/api/v1/productos", { cookie });
    await pedir("/api/v1/productos", { cookie });
    assert.equal(auth.estado.llamadas.filter((l) => l === "/introspect").length - antes, 2);
  });

  test("/api/auth/sesion devuelve quién soy", async () => {
    const { cookie } = await iniciar("admin", "ClaveAdmin2026");
    const cuerpo = await (await pedir("/api/auth/sesion", { cookie })).json();
    assert.equal(cuerpo.usuario, "admin");
    assert.equal(cuerpo.rol, "admin");
  });

  // --- Con sesión válida -------------------------------------------------------------------

  test("con sesión: 200, el backend recibe la credencial y el rol, pero no la cookie", async () => {
    const { cookie } = await iniciar("vendedor", "ClaveVende2026");
    const respuesta = await pedir("/api/v1/productos?categoria=SALSA", { cookie, cabeceras: { "X-Usuario-Rol": "admin", "X-Credencial-Interna": "inventada" } });
    const recibida = backend.recibidas.at(-1);

    assert.equal(respuesta.status, 200);
    assert.equal(recibida.url, "/items?categoria=SALSA");
    assert.equal(recibida.cabeceras["x-credencial-interna"], CREDENCIAL);
    assert.equal(recibida.cabeceras["x-usuario-rol"], "usuario", "el rol lo pone el gateway, no el cliente");
    assert.equal(recibida.cabeceras.cookie, undefined);
  });

  test("un usuario puede crear y editar", async () => {
    const { cookie } = await iniciar("vendedor", "ClaveVende2026");
    assert.equal((await pedir("/api/v1/productos", { cookie, metodo: "POST", cuerpo: { nombre: "x" } })).status, 201);
    assert.equal((await pedir("/api/v1/productos/abc", { cookie, metodo: "PUT", cuerpo: { precio: 1 } })).status, 200);
  });

  // --- 403: rol insuficiente ------------------------------------------------------------------

  test("un usuario no puede borrar: 403 y no llega al backend", async () => {
    const { cookie } = await iniciar("vendedor", "ClaveVende2026");
    const antes = backend.recibidas.length;
    const respuesta = await pedir("/api/v1/productos/abc", { cookie, metodo: "DELETE" });

    assert.equal(respuesta.status, 403);
    assert.equal((await respuesta.json()).error, "PERMISO_INSUFICIENTE");
    assert.equal(backend.recibidas.length, antes);
  });

  test("el admin sí puede borrar", async () => {
    const { cookie } = await iniciar("admin", "ClaveAdmin2026");
    assert.equal((await pedir("/api/v1/productos/abc", { cookie, metodo: "DELETE" })).status, 204);
    assert.equal(backend.recibidas.at(-1).metodo, "DELETE");
  });

  // --- 403: llamada directa al backend ------------------------------------------------------

  test("directo al backend sin credencial: 403", async () => {
    assert.equal((await fetch(`${config.urlBackend}/items`)).status, 403);
  });

  // --- CSRF y CORS -----------------------------------------------------------------------------

  test("un POST desde un sitio no autorizado: 403 aunque traiga la cookie", async () => {
    const { cookie } = await iniciar("admin", "ClaveAdmin2026");
    const respuesta = await pedir("/api/v1/productos/abc", { cookie, metodo: "DELETE", cabeceras: { Origin: "https://sitio-malicioso.com" } });
    assert.equal(respuesta.status, 403);
    assert.equal((await respuesta.json()).error, "ORIGEN_NO_PERMITIDO");
  });

  test("desde el frontend autorizado sí pasa, y CORS permite credenciales", async () => {
    const { cookie } = await iniciar("admin", "ClaveAdmin2026");
    const respuesta = await pedir("/api/v1/productos", { cookie, cabeceras: { Origin: ORIGEN } });
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get("access-control-allow-origin"), ORIGEN);
    assert.equal(respuesta.headers.get("access-control-allow-credentials"), "true");
  });

  // --- 500 / 502: servicios caídos ---------------------------------------------------------------

  test("Auth Service caído: 502 en login y en productos", async () => {
    const sinAuth = await gateway({ urlAuth: "http://127.0.0.1:9" });
    assert.equal((await iniciar("admin", "ClaveAdmin2026", sinAuth)).respuesta.status, 502);
    const respuesta = await pedir("/api/v1/productos", { cookie: "pf_sesion=x", destino: sinAuth });
    assert.equal(respuesta.status, 502);
    assert.equal((await respuesta.json()).error, "AUTH_NO_DISPONIBLE");
  });

  test("si el Auth Service rechaza al gateway, es 502 y no un 401 al usuario", async () => {
    auth.estado.secreto = "otro-secreto";
    assert.equal((await iniciar("admin", "ClaveAdmin2026")).respuesta.status, 502);
  });

  test("Vault sellado: 502", async () => {
    const { cookie } = await iniciar("admin", "ClaveAdmin2026");
    vault.estado.sellado = true;
    const respuesta = await pedir("/api/v1/productos", { cookie });
    assert.equal(respuesta.status, 502);
    assert.equal((await respuesta.json()).error, "VAULT_NO_DISPONIBLE");
  });

  test("token de Vault sin permiso: 500", async () => {
    const mal = await gateway({ vaultToken: "no-existe" });
    assert.equal((await iniciar("admin", "ClaveAdmin2026", mal)).respuesta.status, 500);
  });

  test("backend caído: 502", async () => {
    const sinBackend = await gateway({ urlBackend: "http://127.0.0.1:9" });
    const { cookie } = await iniciar("admin", "ClaveAdmin2026", sinBackend);
    const respuesta = await pedir("/api/v1/productos", { cookie, destino: sinBackend });
    assert.equal(respuesta.status, 502);
    assert.equal((await respuesta.json()).error, "BACKEND_NO_DISPONIBLE");
  });

  test("salud: los cuatro componentes", async () => {
    const cuerpo = await (await fetch(`${base}/api/salud`)).json();
    assert.deepEqual(cuerpo, { gateway: "ok", vault: "ok", auth: "ok", backend: "ok" });
  });

  // --- Preparación de Vault --------------------------------------------------------------------------

  test("npm run secretos crea tres tokens y cada uno lee solo lo suyo", async () => {
    const limpio = crearVaultFalso();
    const s = await escuchar(limpio.app);
    servidores.push(s);

    const { stdout } = await ejecutar(process.execPath, ["scripts/cargar-secretos.js"], { env: { ...process.env, VAULT_ADDR: url(s), VAULT_TOKEN: "root" } });
    const tokens = Object.fromEntries([...stdout.matchAll(/(gateway|backend|auth-service)\s+VAULT_TOKEN=(\S+)/g)].map((m) => [m[1], m[2]]));
    const lee = (servicio, ruta) => fetch(`${url(s)}/v1/secret/data/poke-fresh/${ruta}`, { headers: { "X-Vault-Token": tokens[servicio] } }).then((r) => r.status);

    const esperado = {
      gateway: { backend: 200, introspeccion: 200, auth: 403 },
      backend: { backend: 200, introspeccion: 403, auth: 403 },
      "auth-service": { backend: 403, introspeccion: 200, auth: 200 },
    };
    for (const [servicio, rutas] of Object.entries(esperado)) {
      for (const [ruta, estado] of Object.entries(rutas)) {
        assert.equal(await lee(servicio, ruta), estado, `${servicio} leyendo ${ruta}`);
      }
    }
  });
});
