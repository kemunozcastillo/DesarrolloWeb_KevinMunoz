/**
 * Pruebas del gateway con Vault, Auth Service y servicios simulados.
 * El servicio simulado responde con lo que recibió, para revisar qué
 * cabeceras y qué cuerpo le llegan de verdad.
 *
 *   npm test
 */

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

import { crearApp } from "../src/app.js";
import { leerConfig } from "../src/config.js";
import { crearVaultFalso } from "./vault-falso.js";

const escuchar = (app) => new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;

const SESIONES = {
  "tok-cliente": { active: true, sub: "cuenta-1", rol: "cliente", sujeto: "cli_1", nombre: "Javiera Morales", email: "j@correo.cl", exp: 2e9 },
  "tok-admin": { active: true, sub: "cuenta-2", rol: "admin", sujeto: "cuenta-2", nombre: "Camila Rojas", email: "a@p.cl", exp: 2e9 },
  "tok-cocina": { active: true, sub: "cuenta-3", rol: "cocina", sujeto: "cuenta-3", nombre: "Francisca Lagos", email: "c@p.cl", exp: 2e9 },
  "tok-dueno": { active: true, sub: "cuenta-4", rol: "dueno", sujeto: "cuenta-4", nombre: "Tomás Fuentes", email: "d@p.cl", exp: 2e9 },
};

function authFalso(registro) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => (req.get("authorization") === `Basic ${Buffer.from("gateway:secreto-gw").toString("base64")}` ? next() : res.status(401).json({ codigo: "CLIENTE_NO_AUTORIZADO" })));
  app.post("/login", (req, res) => {
    if (req.body.clave !== "Correcta2026") return res.status(401).json({ codigo: "CREDENCIALES", mensaje: "Correo o contraseña incorrectos." });
    res.json({ token: "tok-cliente", expira: 2e9, expiraMaximo: Math.floor(Date.now() / 1000) + 3600, usuario: { id: "cuenta-1", rol: "cliente", sujeto: "cli_1", nombre: "Javiera", email: "j@correo.cl" } });
  });
  app.post("/introspect", (req, res) => res.json(SESIONES[req.body.token] ?? { active: false }));
  app.post("/logout", (_req, res) => res.status(204).end());
  app.post("/clave", (req, res) => {
    registro.clave = req.body;
    res.status(204).end();
  });
  app.post("/verificacion", (req, res) => res.json({ recibido: req.body }));
  return app;
}

function servicioEco() {
  const app = express();
  app.use(express.raw({ type: () => true }));
  app.all("*", (req, res) => res.json({ metodo: req.method, ruta: req.originalUrl, cabeceras: req.headers, cuerpo: req.body?.toString?.() ?? "" }));
  return app;
}

describe("API gateway", () => {
  let vault, servidores, config, base, eco, registro;

  const pedir = (ruta, { metodo = "GET", sesion, cuerpo, cabeceras = {} } = {}) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...(sesion ? { Cookie: `pf_sesion=${sesion}` } : {}), ...(cuerpo ? { "Content-Type": "application/json" } : {}), ...cabeceras },
      body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    });

  async function gateway(cambios = {}) {
    const s = await escuchar(crearApp({ ...config, ...cambios }));
    servidores.push(s);
    return url(s);
  }

  before(async () => {
    registro = {};
    vault = crearVaultFalso();
    for (const s of ["inventario", "clientes", "pedidos", "pagos", "graphql"]) vault.escribir(`poke-fresh/internos/${s}`, { credencial: `cred-${s}` });
    vault.escribir("poke-fresh/internos/auth-gateway", { secreto: "secreto-gw" });
    const [sVault, sAuth, sEco] = await Promise.all([escuchar(vault.app), escuchar(authFalso(registro)), escuchar(servicioEco())]);
    servidores = [sVault, sAuth, sEco];
    eco = url(sEco);

    const dir = await mkdtemp(join(tmpdir(), "front-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>Poke Fresh</title>");

    config = {
      ...leerConfig({ NODE_ENV: "test" }),
      vaultAddr: url(sVault),
      vaultToken: "root",
      vaultCacheSegundos: 0,
      dirFrontend: dir,
      urls: { auth: url(sAuth), inventario: eco, clientes: eco, pedidos: eco, pagos: eco, graphql: eco },
    };
  });

  beforeEach(async () => {
    vault.estado.sellado = false;
    base = await gateway();
  });

  after(() => servidores.forEach((s) => s.close()));

  test("sirve el frontend con Content-Security-Policy", async () => {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
  });

  test("/salud responde sin sesión ni consultar a otros componentes (healthcheck de Docker)", async () => {
    const r = await fetch(`${base}/salud`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { gateway: "ok" });
  });

  test("lo que no está en la matriz no existe: 404 (incluidas las rutas internas)", async () => {
    assert.equal((await pedir("/api/v1/nada")).status, 404);
    assert.equal((await pedir("/api/v1/internos/pedidos/PF-1/pago-confirmado", { metodo: "POST", sesion: "tok-admin" })).status, 404);
    assert.equal((await pedir("/api/v1/pedidos/PF-1/pago-confirmado", { metodo: "POST", sesion: "tok-admin" })).status, 404);
  });

  test("catálogo público: pasa sin sesión, con la credencial interna y sin identidad", async () => {
    const r = await pedir("/api/v1/catalogo/items?categoria=SALSA");
    assert.equal(r.status, 200);
    const eco = await r.json();
    assert.equal(eco.ruta, "/items?categoria=SALSA");
    assert.equal(eco.cabeceras["x-credencial-interna"], "cred-inventario");
    assert.equal(eco.cabeceras["x-usuario-rol"], undefined);
  });

  test("las cabeceras de identidad y la credencial que mande el navegador se descartan", async () => {
    const r = await pedir("/api/v1/pedidos", {
      sesion: "tok-cliente",
      cabeceras: { "X-Usuario-Rol": "admin", "X-Usuario-Sujeto": "cli_otro", "X-Credencial-Interna": "inventada", Authorization: "Bearer x" },
    });
    const { cabeceras } = await r.json();
    assert.equal(cabeceras["x-usuario-rol"], "cliente");
    assert.equal(cabeceras["x-usuario-sujeto"], "cli_1");
    assert.equal(cabeceras["x-credencial-interna"], "cred-pedidos");
    assert.equal(cabeceras.authorization, undefined);
    assert.equal(cabeceras.cookie, undefined);
  });

  test("sin sesión: 401; sesión inválida: 401 y se borra la cookie", async () => {
    assert.equal((await pedir("/api/v1/pedidos")).status, 401);
    const r = await pedir("/api/v1/pedidos", { sesion: "tok-vencido" });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).codigo, "SESION_EXPIRADA");
    assert.match(r.headers.get("set-cookie"), /pf_sesion=;.*Max-Age=0/);
  });

  test("autorización por rol: cocina no ve reportes; dueño no borra productos; admin sí", async () => {
    assert.equal((await pedir("/api/v1/reportes/ventas", { sesion: "tok-cocina" })).status, 403);
    assert.equal((await pedir("/api/v1/catalogo/items/top_mango", { metodo: "DELETE", sesion: "tok-dueno" })).status, 403);
    assert.equal((await pedir("/api/v1/catalogo/items/top_mango", { metodo: "PUT", sesion: "tok-dueno", cuerpo: {} })).status, 200);
    assert.equal((await pedir("/api/v1/catalogo/items/top_mango", { metodo: "DELETE", sesion: "tok-admin" })).status, 200);
    assert.equal((await pedir("/api/v1/clientes", { sesion: "tok-cliente" })).status, 403);
  });

  test("login: cookie HttpOnly y SameSite; el token no viaja en el cuerpo", async () => {
    const r = await pedir("/api/v1/auth/login", { metodo: "POST", cuerpo: { email: "j@correo.cl", clave: "Correcta2026" } });
    assert.equal(r.status, 200);
    const cookie = r.headers.get("set-cookie");
    assert.match(cookie, /pf_sesion=tok-cliente/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/api/);
    const cuerpo = await r.json();
    assert.equal(cuerpo.perfil, "CLIENTE");
    assert.ok(!JSON.stringify(cuerpo).includes("tok-cliente"));

    const malo = await pedir("/api/v1/auth/login", { metodo: "POST", cuerpo: { email: "j@correo.cl", clave: "mala" } });
    assert.equal(malo.status, 401);
  });

  test("sesión actual y cambio de clave usan la cuenta de la sesión, no la del cuerpo", async () => {
    const s = await (await pedir("/api/v1/auth/sesion", { sesion: "tok-cliente" })).json();
    assert.deepEqual([s.tipo, s.id, s.perfil], ["CLIENTE", "cli_1", "CLIENTE"]);
    await pedir("/api/v1/auth/clave", { metodo: "PUT", sesion: "tok-cliente", cuerpo: { cuentaId: "cuenta-2", actual: "a", nueva: "b" } });
    assert.equal(registro.clave.cuentaId, "cuenta-1");
  });

  test("las rutas públicas de /auth reenvían el cuerpo al Auth Service", async () => {
    const r = await pedir("/api/v1/auth/verificar", { metodo: "POST", cuerpo: { email: "j@correo.cl", codigo: "123456" } });
    assert.deepEqual((await r.json()).recibido, { email: "j@correo.cl", codigo: "123456" });
  });

  test("CSRF: un POST desde otro sitio se rechaza aunque traiga la cookie", async () => {
    const r = await pedir("/api/v1/pedidos", { metodo: "POST", sesion: "tok-cliente", cuerpo: {}, cabeceras: { Origin: "https://sitio-malicioso.example" } });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).codigo, "ORIGEN_NO_PERMITIDO");
  });

  test("la notificación de pago pasa sin sesión, con el cuerpo exacto y sin identidad", async () => {
    const cuerpo = '{"orden":"PAG-1","monto":8490}';
    const r = await pedir("/api/v1/pagos/notificacion", { metodo: "POST", sesion: "tok-admin", cuerpo, cabeceras: { "X-Firma": "abc" } });
    const eco = await r.json();
    assert.equal(eco.cuerpo, cuerpo);
    assert.equal(eco.cabeceras["x-firma"], "abc");
    assert.equal(eco.cabeceras["x-usuario-rol"], undefined);
  });

  test("Vault caído: 503", async () => {
    vault.estado.sellado = true;
    const r = await pedir("/api/v1/catalogo/items");
    assert.equal(r.status, 503);
    assert.equal((await r.json()).codigo, "SECRETOS_NO_DISPONIBLES");
  });

  test("servicio caído: 502", async () => {
    const otro = await gateway({ urls: { ...config.urls, inventario: "http://127.0.0.1:1" } });
    const r = await fetch(`${otro}/api/v1/catalogo/items`);
    assert.equal(r.status, 502);
    assert.equal((await r.json()).codigo, "SERVICIO_NO_DISPONIBLE");
  });

  test("límite de intentos de login por minuto: 429", async () => {
    const limitado = await gateway({ limiteSensibles: 3 });
    const intento = () => fetch(`${limitado}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@x.cl", clave: "mala" }) });
    for (let i = 0; i < 3; i++) assert.equal((await intento()).status, 401);
    const r = await intento();
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("retry-after")) > 0);
  });

  test("cada respuesta lleva X-Request-Id y respeta uno válido recibido", async () => {
    const r = await pedir("/api/v1/catalogo/items", { cabeceras: { "X-Request-Id": "prueba-12345678" } });
    assert.equal(r.headers.get("x-request-id"), "prueba-12345678");
    assert.equal((await r.json()).cabeceras["x-request-id"], "prueba-12345678");
  });
});
