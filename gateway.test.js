/**
 * Pruebas del gateway. Levantan dos servicios falsos que registran cada
 * petición que reciben, así se puede comprobar exactamente qué le llegó al
 * servicio: ruta reescrita, cuerpo, cabeceras. No hacen falta MongoDB ni
 * las APIs reales.
 *
 *   npm test
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { crearApp } from "../src/app.js";
import { leerConfig } from "../src/config.js";

const ORIGEN_FRONTEND = "https://kevin.github.io";

/** Servicio falso: responde eco de lo que recibió. */
function servicioFalso({ nombre, conCors = false, demoraMs = 0 }) {
  const app = express();
  const recibidas = [];

  app.use(express.json());
  app.get("/salud", (_req, res) => res.json({ ok: true }));
  app.all("*", async (req, res) => {
    recibidas.push({ metodo: req.method, url: req.url, cuerpo: req.body, cabeceras: req.headers });
    if (demoraMs) await new Promise((r) => setTimeout(r, demoraMs));
    // Simula un servicio que trae su propia política CORS (como FastAPI).
    if (conCors) res.set("Access-Control-Allow-Origin", "*");
    res.status(req.method === "POST" ? 201 : 200).json({ servicio: nombre, url: req.url, cuerpo: req.body });
  });

  return { app, recibidas };
}

function escuchar(app) {
  return new Promise((resolver) => {
    const servidor = app.listen(0, "127.0.0.1", () => resolver(servidor));
  });
}

const url = (servidor) => `http://127.0.0.1:${servidor.address().port}`;

describe("gateway", () => {
  let rest, graphql, lento, servidores, gateway, base, gatewayCaido, baseCaido;

  before(async () => {
    rest = servicioFalso({ nombre: "rest", conCors: true });
    graphql = servicioFalso({ nombre: "graphql" });
    lento = servicioFalso({ nombre: "lento", demoraMs: 600 });

    const [sRest, sGraphql, sLento] = await Promise.all([escuchar(rest.app), escuchar(graphql.app), escuchar(lento.app)]);

    const config = {
      ...leerConfig({ NODE_ENV: "test" }),
      urlApiRest: url(sRest),
      urlApiGraphql: url(sGraphql),
      origenesPermitidos: [ORIGEN_FRONTEND],
      tiempoMaximoMs: 300,
      limiteGeneral: 1000,
      limiteEscritura: 5,
    };
    gateway = await escuchar(crearApp(config));
    base = url(gateway);

    // Un segundo gateway: el menú apunta a un puerto sin nadie escuchando, y
    // GraphQL a un servicio más lento que el tiempo máximo.
    gatewayCaido = await escuchar(crearApp({ ...config, urlApiRest: "http://127.0.0.1:9", urlApiGraphql: url(sLento) }));
    baseCaido = url(gatewayCaido);

    servidores = [sRest, sGraphql, sLento, gateway, gatewayCaido];
  });

  after(() => servidores.forEach((s) => s.close()));

  // --- Routing ------------------------------------------------------------------

  test("reescribe /api/v1/menu hacia /items conservando la query", async () => {
    const respuesta = await fetch(`${base}/api/v1/menu?categoria=SALSA&limite=5`);
    assert.equal(respuesta.status, 200);
    assert.equal(rest.recibidas.at(-1).url, "/items?categoria=SALSA&limite=5");
  });

  test("reescribe /api/v1/menu/:id hacia /items/:id", async () => {
    await fetch(`${base}/api/v1/menu/abc123`);
    assert.equal(rest.recibidas.at(-1).url, "/items/abc123");
  });

  test("/api/v1/menu sin nada más llega como /items", async () => {
    await fetch(`${base}/api/v1/menu`);
    assert.equal(rest.recibidas.at(-1).url, "/items");
  });

  test("enruta /api/v1/graphql hacia el otro servicio", async () => {
    const respuesta = await fetch(`${base}/api/v1/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ tamanos { id } }" }),
    });
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.servicio, "graphql");
    assert.equal(graphql.recibidas.at(-1).url, "/graphql");
  });

  test("el cuerpo del POST llega intacto al servicio", async () => {
    const item = { nombre: "Salsa de ajo", precio: 0, categoria: "SALSA" };
    const respuesta = await fetch(`${base}/api/v1/menu`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    assert.equal(respuesta.status, 201);
    assert.deepEqual(rest.recibidas.at(-1).cuerpo, item);
  });

  test("rechaza con 405 un método que la ruta no acepta", async () => {
    const respuesta = await fetch(`${base}/api/v1/graphql`, { method: "DELETE" });
    assert.equal(respuesta.status, 405);
    assert.equal(respuesta.headers.get("allow"), "GET, POST");
  });

  test("una ruta /api inexistente responde 404 en JSON", async () => {
    const respuesta = await fetch(`${base}/api/v1/pedidos`);
    assert.equal(respuesta.status, 404);
    assert.equal((await respuesta.json()).error, "RUTA_INEXISTENTE");
  });

  test("GET /api lista las rutas disponibles", async () => {
    const cuerpo = await (await fetch(`${base}/api`)).json();
    assert.deepEqual(
      cuerpo.rutas.map((r) => r.prefijo),
      ["/api/v1/menu", "/api/v1/graphql", "/api/salud"],
    );
  });

  // --- Trazabilidad -------------------------------------------------------------------

  test("genera un id de petición y lo reenvía al servicio", async () => {
    const respuesta = await fetch(`${base}/api/v1/menu`);
    const id = respuesta.headers.get("x-request-id");
    assert.match(id, /^[\w-]{36}$/);
    assert.equal(rest.recibidas.at(-1).cabeceras["x-request-id"], id);
  });

  test("respeta el id de petición que trae el cliente", async () => {
    const respuesta = await fetch(`${base}/api/v1/menu`, { headers: { "X-Request-Id": "prueba-12345678" } });
    assert.equal(respuesta.headers.get("x-request-id"), "prueba-12345678");
  });

  test("agrega X-Forwarded-For para el servicio", async () => {
    await fetch(`${base}/api/v1/menu`);
    assert.ok(rest.recibidas.at(-1).cabeceras["x-forwarded-for"]);
  });

  // --- Errores de los servicios ----------------------------------------------------------

  test("servicio caído: 502 con el servicio identificado", async () => {
    const respuesta = await fetch(`${baseCaido}/api/v1/menu`);
    assert.equal(respuesta.status, 502);
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.error, "SERVICIO_NO_DISPONIBLE");
    assert.equal(cuerpo.servicio, "menu");
  });

  test("servicio lento: 504 al pasar el tiempo máximo", async () => {
    const respuesta = await fetch(`${baseCaido}/api/v1/graphql`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    assert.equal(respuesta.status, 504);
    assert.equal((await respuesta.json()).error, "SERVICIO_LENTO");
  });

  test("salud: 200 con todo arriba y 503 si un servicio falla", async () => {
    const bien = await fetch(`${base}/api/salud`);
    assert.equal(bien.status, 200);
    assert.ok((await bien.json()).servicios.every((s) => s.estado === "ok"));

    const mal = await fetch(`${baseCaido}/api/salud`);
    assert.equal(mal.status, 503);
    const menu = (await mal.json()).servicios.find((s) => s.servicio === "menu");
    assert.equal(menu.estado, "sin respuesta");
  });

  // --- CORS ---------------------------------------------------------------------------

  test("autoriza el origen del frontend", async () => {
    const respuesta = await fetch(`${base}/api/v1/menu`, { headers: { Origin: ORIGEN_FRONTEND } });
    assert.equal(respuesta.headers.get("access-control-allow-origin"), ORIGEN_FRONTEND);
  });

  test("no autoriza un origen desconocido", async () => {
    const respuesta = await fetch(`${base}/api/v1/menu`, { headers: { Origin: "https://sitio-ajeno.com" } });
    assert.equal(respuesta.headers.get("access-control-allow-origin"), null);
  });

  test("quita el CORS propio del servicio para no duplicar cabeceras", async () => {
    // El servicio falso responde "*": si pasara, el navegador vería dos valores.
    const respuesta = await fetch(`${base}/api/v1/menu`, { headers: { Origin: ORIGEN_FRONTEND } });
    assert.equal(respuesta.headers.get("access-control-allow-origin"), ORIGEN_FRONTEND);
  });

  test("responde el preflight sin molestar al servicio", async () => {
    const antes = rest.recibidas.length;
    const respuesta = await fetch(`${base}/api/v1/menu/abc`, {
      method: "OPTIONS",
      headers: { Origin: ORIGEN_FRONTEND, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "Content-Type" },
    });
    assert.equal(respuesta.status, 204);
    assert.match(respuesta.headers.get("access-control-allow-methods"), /PUT/);
    assert.equal(rest.recibidas.length, antes);
  });

  // --- Límite de peticiones ------------------------------------------------------------------

  test("limita las escrituras en REST pero no las lecturas ni GraphQL", async () => {
    const escribir = () => fetch(`${base}/api/v1/menu`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

    // Ya hubo un POST antes en estas pruebas; se llega al límite de 5 y se pasa.
    const estados = [];
    for (let i = 0; i < 6; i++) estados.push((await escribir()).status);
    assert.equal(estados.at(-1), 429);
    assert.ok(estados.includes(201));

    // Las lecturas siguen funcionando, y GraphQL también, aunque use POST.
    assert.equal((await fetch(`${base}/api/v1/menu`)).status, 200);
    const consulta = await fetch(`${base}/api/v1/graphql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(consulta.status, 201);
  });

  // --- Seguridad ------------------------------------------------------------------------------

  test("agrega cabeceras de seguridad y oculta la tecnología", async () => {
    const respuesta = await fetch(`${base}/api`);
    assert.equal(respuesta.headers.get("x-content-type-options"), "nosniff");
    assert.equal(respuesta.headers.get("x-powered-by"), null);
  });
});
