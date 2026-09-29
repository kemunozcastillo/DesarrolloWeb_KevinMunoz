/**
 * Pruebas del gateway seguro, con un Vault simulado y un backend falso que
 * exige la credencial interna igual que la API de Productos real.
 *
 *   npm test
 */

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";

import { crearApp } from "../src/app.js";
import { leerConfig } from "../src/config.js";
import { crearVaultFalso } from "./vault-falso.js";

const ejecutar = promisify(execFile);
const TOKEN_CLIENTE = "token-de-cliente-de-prueba";
const CREDENCIAL = "credencial-interna-de-prueba";

function escuchar(app) {
  return new Promise((resolver) => {
    const servidor = app.listen(0, "127.0.0.1", () => resolver(servidor));
  });
}

const url = (servidor) => `http://127.0.0.1:${servidor.address().port}`;

/** Backend falso: responde 403 sin la credencial, igual que FastAPI. */
function backendFalso(credencialEsperada) {
  const app = express();
  const recibidas = [];
  app.use(express.json());
  app.get("/salud", (_req, res) => res.json({ ok: true }));
  app.all("*", (req, res) => {
    recibidas.push({ metodo: req.method, url: req.url, cabeceras: req.headers, cuerpo: req.body });
    if (req.get("x-credencial-interna") !== credencialEsperada()) {
      return res.status(403).json({ detail: "Acceso directo no permitido: esta API solo acepta peticiones que llegan por el gateway." });
    }
    res.status(req.method === "POST" ? 201 : 200).json([{ nombre: "Ponzu" }]);
  });
  return { app, recibidas };
}

describe("gateway seguro", () => {
  let vault, backend, servidores, sVault, sBackend, base, config;

  const bearer = (token = TOKEN_CLIENTE) => ({ Authorization: `Bearer ${token}` });

  async function gateway(cambios = {}) {
    const servidor = await escuchar(crearApp({ ...config, ...cambios }));
    servidores.push(servidor);
    return url(servidor);
  }

  before(async () => {
    vault = crearVaultFalso();
    vault.escribir("poke-fresh/gateway", { token_cliente: TOKEN_CLIENTE });
    vault.escribir("poke-fresh/backend", { credencial_interna: CREDENCIAL });
    backend = backendFalso(() => vault.leer("poke-fresh/backend").credencial_interna);

    [sVault, sBackend] = await Promise.all([escuchar(vault.app), escuchar(backend.app)]);
    servidores = [sVault, sBackend];

    config = {
      ...leerConfig({ NODE_ENV: "test" }),
      vaultAddr: url(sVault),
      vaultToken: "root",
      urlBackend: url(sBackend),
      origenesPermitidos: ["https://kevin.github.io"],
      tiempoMaximoMs: 2_000,
    };
    base = await gateway();
  });

  beforeEach(() => {
    vault.estado.sellado = false;
  });

  after(() => servidores.forEach((s) => s.close()));

  // --- 401: sin token o token inválido ---------------------------------------

  test("sin token: 401 y no llega al backend", async () => {
    const antes = backend.recibidas.length;
    const respuesta = await fetch(`${base}/api/v1/productos`);

    assert.equal(respuesta.status, 401);
    assert.match(respuesta.headers.get("www-authenticate"), /error="invalid_request"/);
    assert.equal(backend.recibidas.length, antes);
  });

  test("formato distinto a Bearer: 401", async () => {
    const respuesta = await fetch(`${base}/api/v1/productos`, { headers: { Authorization: `Basic ${TOKEN_CLIENTE}` } });
    assert.equal(respuesta.status, 401);
  });

  test("token incorrecto: 401 y no llega al backend", async () => {
    const antes = backend.recibidas.length;
    const respuesta = await fetch(`${base}/api/v1/productos`, { headers: bearer("adivinando") });

    assert.equal(respuesta.status, 401);
    assert.match(respuesta.headers.get("www-authenticate"), /error="invalid_token"/);
    assert.equal((await respuesta.json()).error, "NO_AUTORIZADO");
    assert.equal(backend.recibidas.length, antes);
  });

  test("tener la credencial interna no sirve sin el token del cliente", async () => {
    const respuesta = await fetch(`${base}/api/v1/productos`, { headers: { "X-Credencial-Interna": CREDENCIAL } });
    assert.equal(respuesta.status, 401);
  });

  // --- Token válido: pasa con la credencial interna ---------------------------------

  test("token correcto: 200 y el backend recibe la credencial interna", async () => {
    const respuesta = await fetch(`${base}/api/v1/productos?categoria=SALSA`, { headers: bearer() });
    const recibida = backend.recibidas.at(-1);

    assert.equal(respuesta.status, 200);
    assert.equal(recibida.url, "/items?categoria=SALSA");
    assert.equal(recibida.cabeceras["x-credencial-interna"], CREDENCIAL);
  });

  test("el token del cliente no viaja al backend", async () => {
    await fetch(`${base}/api/v1/productos`, { headers: bearer() });
    assert.equal(backend.recibidas.at(-1).cabeceras.authorization, undefined);
  });

  test("una credencial interna enviada por el cliente se reemplaza por la real", async () => {
    await fetch(`${base}/api/v1/productos`, { headers: { ...bearer(), "X-Credencial-Interna": "inventada" } });
    assert.equal(backend.recibidas.at(-1).cabeceras["x-credencial-interna"], CREDENCIAL);
  });

  test("el cuerpo de un POST llega intacto", async () => {
    const item = { nombre: "Salsa de ajo", categoria: "SALSA", precio: 0 };
    const respuesta = await fetch(`${base}/api/v1/productos`, {
      method: "POST",
      headers: { ...bearer(), "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });

    assert.equal(respuesta.status, 201);
    assert.deepEqual(backend.recibidas.at(-1).cuerpo, item);
  });

  // --- 403: llamar directo al backend --------------------------------------------------

  test("directo al backend sin credencial: 403", async () => {
    const respuesta = await fetch(`${url(sBackend)}/items`);
    assert.equal(respuesta.status, 403);
  });

  // --- 500 / 502: Vault o el backend caídos ------------------------------------------------

  test("Vault apagado: 502 y no llega al backend", async () => {
    const sinVault = await gateway({ vaultAddr: "http://127.0.0.1:9" });
    const antes = backend.recibidas.length;
    const respuesta = await fetch(`${sinVault}/api/v1/productos`, { headers: bearer() });

    assert.equal(respuesta.status, 502);
    assert.equal((await respuesta.json()).error, "VAULT_NO_DISPONIBLE");
    assert.equal(backend.recibidas.length, antes);
  });

  test("Vault sellado: 502", async () => {
    vault.estado.sellado = true;
    const respuesta = await fetch(`${base}/api/v1/productos`, { headers: bearer() });
    assert.equal(respuesta.status, 502);
  });

  test("token de Vault sin permiso: 500 por mala configuración", async () => {
    const malConfigurado = await gateway({ vaultToken: "token-que-no-existe" });
    const respuesta = await fetch(`${malConfigurado}/api/v1/productos`, { headers: bearer() });

    assert.equal(respuesta.status, 500);
    assert.equal((await respuesta.json()).error, "VAULT_MAL_CONFIGURADO");
  });

  test("backend apagado: 502", async () => {
    const sinBackend = await gateway({ urlBackend: "http://127.0.0.1:9" });
    const respuesta = await fetch(`${sinBackend}/api/v1/productos`, { headers: bearer() });

    assert.equal(respuesta.status, 502);
    assert.equal((await respuesta.json()).error, "BACKEND_NO_DISPONIBLE");
  });

  // --- Vault se consulta de verdad ---------------------------------------------------------

  test("un token rotado en Vault vale de inmediato", async () => {
    vault.escribir("poke-fresh/gateway", { token_cliente: "token-nuevo" });
    try {
      assert.equal((await fetch(`${base}/api/v1/productos`, { headers: bearer() })).status, 401);
      assert.equal((await fetch(`${base}/api/v1/productos`, { headers: bearer("token-nuevo") })).status, 200);
    } finally {
      vault.escribir("poke-fresh/gateway", { token_cliente: TOKEN_CLIENTE });
    }
  });

  test("con caché activa, Vault se consulta una vez por ruta", async () => {
    const conCache = await gateway({ vaultCacheSegundos: 60 });
    const antes = vault.estado.lecturas;
    for (let i = 0; i < 3; i++) await fetch(`${conCache}/api/v1/productos`, { headers: bearer() });
    assert.equal(vault.estado.lecturas - antes, 2); // gateway y backend, una vez cada una
  });

  // --- CORS y salud ------------------------------------------------------------------------------

  test("el preflight del navegador no exige token", async () => {
    const respuesta = await fetch(`${base}/api/v1/productos`, {
      method: "OPTIONS",
      headers: { Origin: "https://kevin.github.io", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization" },
    });
    assert.equal(respuesta.status, 204);
    assert.match(respuesta.headers.get("access-control-allow-headers"), /Authorization/);
  });

  test("salud: 200 con todo arriba, 503 con Vault sellado", async () => {
    const bien = await fetch(`${base}/api/salud`);
    assert.equal(bien.status, 200);
    assert.deepEqual(await bien.json(), { gateway: "ok", vault: "ok", backend: "ok" });

    vault.estado.sellado = true;
    const mal = await fetch(`${base}/api/salud`);
    assert.equal(mal.status, 503);
    assert.equal((await mal.json()).vault, "sellado");
  });

  // --- Script de preparación y mínimo privilegio ------------------------------------------------------

  test("npm run secretos prepara Vault con un token por servicio y permisos separados", async () => {
    const limpio = crearVaultFalso();
    const sLimpio = await escuchar(limpio.app);
    servidores.push(sLimpio);

    const { stdout } = await ejecutar(process.execPath, ["scripts/cargar-secretos.js"], {
      env: { ...process.env, VAULT_ADDR: url(sLimpio), VAULT_TOKEN: "root" },
    });

    const tokenCliente = limpio.leer("poke-fresh/gateway").token_cliente;
    assert.ok(tokenCliente.length >= 40, "el token del cliente debe ser largo y aleatorio");
    assert.ok(stdout.includes(tokenCliente));

    const [tokenGateway, tokenBackend] = [...stdout.matchAll(/VAULT_TOKEN=(\S+)/g)].map((m) => m[1]);
    const leer = (token, ruta) => fetch(`${url(sLimpio)}/v1/secret/data/${ruta}`, { headers: { "X-Vault-Token": token } }).then((r) => r.status);

    assert.equal(await leer(tokenGateway, "poke-fresh/gateway"), 200);
    assert.equal(await leer(tokenGateway, "poke-fresh/backend"), 200);
    assert.equal(await leer(tokenBackend, "poke-fresh/backend"), 200);
    assert.equal(await leer(tokenBackend, "poke-fresh/gateway"), 403, "el backend no debe ver el token de los clientes");
  });
});
