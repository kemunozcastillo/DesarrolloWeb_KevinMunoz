/**
 * Pruebas del GraphQL Gateway con servicios simulados que aplican las mismas
 * reglas que los reales (un pedido ajeno responde 404).
 *
 *   npm test
 */

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { crearApp } from "../src/app.js";
import { leerConfig } from "../src/config.js";
import { crearVaultFalso } from "./vault-falso.js";

const escuchar = (app) => new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;

const PEDIDO = {
  id: "PF-00001",
  clienteId: "cli_1",
  estado: "PAGADO",
  modoEntrega: "DELIVERY",
  direccion: "Av. Providencia 2133, Providencia",
  total: 10690,
  creadoEn: "2026-11-07T15:00:00.000Z",
  venta: { numero: 1, fecha: "2026-11-07T15:01:00.000Z", anulada: false },
  boleta: { numero: 1, fecha: "2026-11-07T15:01:00.000Z", total: 10690 },
  lineas: [
    { descripcion: "Bowl Regular: Arroz gohan, Atún", cantidad: 1, precioUnitario: 8490, subtotal: 8490, itemIds: ["base_gohan", "pro_atun"] },
    { descripcion: "Té verde frío", cantidad: 1, precioUnitario: 2200, subtotal: 2200, itemIds: ["beb_te"] },
  ],
};

const PRODUCTOS = {
  base_gohan: { id: "base_gohan", nombre: "Arroz gohan", categoria: "BASE", disponible: true },
  pro_atun: { id: "pro_atun", nombre: "Atún", categoria: "PROTEINA", disponible: false },
  beb_te: { id: "beb_te", nombre: "Té verde frío", categoria: "BEBIDA", disponible: true },
};

function servicios(estado) {
  const app = express();
  app.use((req, res, next) => {
    estado.cabeceras.push(req.headers);
    if (!req.get("x-credencial-interna")?.startsWith("cred-")) return res.status(403).json({ codigo: "ACCESO_DIRECTO" });
    next();
  });
  app.get("/pedidos/:id", (req, res) => {
    estado.llamadas.pedidos += 1;
    const rol = req.get("x-usuario-rol");
    if (req.params.id !== PEDIDO.id || (rol === "cliente" && req.get("x-usuario-sujeto") !== PEDIDO.clienteId)) {
      return res.status(404).json({ codigo: "NO_ENCONTRADO", mensaje: "No encontramos ese pedido." });
    }
    res.json(PEDIDO);
  });
  app.get("/pedidos", (_req, res) => res.json(Array.from({ length: 12 }, (_v, i) => ({ ...PEDIDO, id: `PF-${String(i + 1).padStart(5, "0")}` }))));
  app.get("/reportes/ventas", (_req, res) => res.json({ desde: "2026-11-01", hasta: "2026-11-07", cantidad: 1, monto: 10690, ventas: [PEDIDO] }));
  app.get("/items", (req, res) => {
    estado.llamadas.inventario += 1;
    res.json(req.query.ids.split(",").map((id) => PRODUCTOS[id]).filter(Boolean));
  });
  app.get("/internos/pagos", (req, res) => {
    estado.llamadas.pagos += 1;
    if (estado.pagosCaido) return res.status(500).end();
    res.json(req.query.ids.split(",").includes("PF-00001") ? [{ id: "PAG-1", pedidoId: "PF-00001", estado: "APROBADO", monto: 10690, medio: "SERVIPAG", referencia: "SVP-1", creadoEn: "x" }] : []);
  });
  app.get("/clientes/:id", (req, res) => {
    if (req.get("x-usuario-rol") !== "admin") return res.status(403).json({ codigo: "PROHIBIDO" });
    res.json({ nombre: "Javiera Morales", telefono: "+56 9 8123 4567", email: "j@correo.cl", comuna: "Providencia" });
  });
  return app;
}

describe("GraphQL Gateway", () => {
  let base, servidores, estado;

  const consultar = (query, { rol = "cliente", sujeto = "cli_1", credencial = "cred-graphql", variables } = {}) =>
    fetch(`${base}/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credencial ? { "X-Credencial-Interna": credencial } : {}),
        ...(rol ? { "X-Usuario-Id": `u-${rol}`, "X-Usuario-Rol": rol, "X-Usuario-Sujeto": sujeto } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
  const datos = async (...args) => (await consultar(...args)).json();

  const RESUMEN = `query ($id: ID!) { resumenPedido(id: $id) {
    pedido { id estadoTexto total lineas { descripcion productos { id nombre categoria disponibleHoy } } }
    pagos { estado monto referencia }
  } }`;

  before(async () => {
    estado = { llamadas: {}, cabeceras: [] };
    const vault = crearVaultFalso();
    for (const s of ["inventario", "clientes", "pedidos", "pagos", "graphql"]) vault.escribir(`poke-fresh/internos/${s}`, { credencial: `cred-${s}` });
    const [sVault, sServicios] = await Promise.all([escuchar(vault.app), escuchar(servicios(estado))]);
    const s = url(sServicios);
    const app = await crearApp({ ...leerConfig({}), vaultAddr: url(sVault), vaultToken: "root", vaultCacheSegundos: 0, urls: { inventario: s, clientes: s, pedidos: s, pagos: s } });
    const sGraphql = await escuchar(app);
    servidores = [sVault, sServicios, sGraphql];
    base = url(sGraphql);
  });

  beforeEach(() => {
    estado.llamadas = { pedidos: 0, inventario: 0, pagos: 0 };
    estado.cabeceras = [];
    estado.pagosCaido = false;
  });

  after(() => servidores.forEach((s) => s.close()));

  test("sin credencial interna: 403 (el navegador no puede llamarlo directo)", async () => {
    const r = await consultar("{ __typename }", { credencial: null });
    assert.equal(r.status, 403);
    assert.equal((await consultar("{ __typename }", { credencial: "inventada" })).status, 403);
  });

  test("resumenPedido combina pedidos, pagos e inventario con una llamada por servicio", async () => {
    const r = await datos(RESUMEN, { variables: { id: "PF-00001" } });
    assert.equal(r.errors, undefined);
    const resumen = r.data.resumenPedido;
    assert.equal(resumen.pedido.estadoTexto, "Esperando cocina");
    assert.equal(resumen.pagos[0].referencia, "SVP-1");
    assert.deepEqual(resumen.pedido.lineas[0].productos.map((p) => p.categoria), ["BASE", "PROTEINA"]);
    assert.equal(resumen.pedido.lineas[0].productos[1].disponibleHoy, false);
    // DataLoader: dos líneas con tres productos = una sola llamada a inventario.
    assert.deepEqual(estado.llamadas, { pedidos: 1, inventario: 1, pagos: 1 });
  });

  test("la identidad viaja a los servicios: pedidos decide si el pedido es tuyo", async () => {
    await datos(RESUMEN, { variables: { id: "PF-00001" } });
    const aPedidos = estado.cabeceras.find((h) => h["x-credencial-interna"] === "cred-pedidos");
    assert.equal(aPedidos["x-usuario-sujeto"], "cli_1");

    const ajeno = await datos(RESUMEN, { variables: { id: "PF-00001" }, sujeto: "cli_otro" });
    assert.equal(ajeno.data.resumenPedido, null);
    assert.equal(estado.llamadas.pagos, 1); // el ajeno no llegó a pedir pagos
  });

  test("autorización por campo: un cliente no obtiene la ficha de contacto aunque la pida", async () => {
    const q = `{ resumenPedido(id: "PF-00001") { pedido { id } cliente { email telefono } } }`;
    const comoCliente = await datos(q);
    assert.equal(comoCliente.data.resumenPedido.pedido.id, "PF-00001");
    assert.equal(comoCliente.data.resumenPedido.cliente, null);
    assert.equal(comoCliente.errors[0].extensions.code, "PROHIBIDO");

    const comoAdmin = await datos(q, { rol: "admin", sujeto: "u-admin" });
    assert.equal(comoAdmin.data.resumenPedido.cliente.email, "j@correo.cl");
  });

  test("si pagos no responde, el resumen llega igual con el error parcial", async () => {
    estado.pagosCaido = true;
    const r = await datos(RESUMEN, { variables: { id: "PF-00001" } });
    assert.equal(r.data.resumenPedido.pedido.id, "PF-00001");
    assert.equal(r.data.resumenPedido.pagos, null);
    assert.equal(r.errors[0].extensions.code, "SERVICIO_NO_DISPONIBLE");
    assert.equal(r.errors[0].extensions.servicio, "pagos");
  });

  test("consultas demasiado profundas o costosas se rechazan antes de ejecutarse", async () => {
    const profunda = await datos("{ resumenPedido(id: \"PF-00001\") { pedido { lineas { productos { id } } } } }", { variables: {} });
    assert.equal(profunda.errors, undefined);

    const costosa = await datos("{ misPedidos(primeros: 50) { nodos { id lineas { descripcion cantidad productos { id nombre categoria disponibleHoy } } } } }");
    // Apollo marca los errores de validación como GRAPHQL_VALIDATION_FAILED; el motivo va en el mensaje.
    assert.equal(costosa.errors[0].extensions.code, "GRAPHQL_VALIDATION_FAILED");
    assert.match(costosa.errors[0].message, /cuesta \d+ y el máximo permitido es 1000/);
    assert.equal(estado.llamadas.pedidos, 0);
  });

  test("límite de profundidad", async () => {
    const { limiteProfundidad } = await import("../src/graphql/limiteProfundidad.js");
    const { buildSchema, parse, validate, specifiedRules } = await import("graphql");
    const schema = buildSchema("type Query { a: A } type A { b: A, c: Int }");
    const errores = validate(schema, parse("{ a { b { b { b { b { b { b { c } } } } } } } }"), [...specifiedRules, limiteProfundidad(6)]);
    assert.equal(errores[0].extensions.code, "CONSULTA_MUY_PROFUNDA");
  });

  test("paginación de misPedidos: máximo 50 y cursor", async () => {
    const malo = await datos("{ misPedidos(primeros: 100) { nodos { id } } }");
    assert.equal(malo.errors[0].extensions.code, "BAD_USER_INPUT");
    const p1 = await datos("{ misPedidos(primeros: 5) { nodos { id } siguiente } }");
    assert.equal(p1.data.misPedidos.nodos.length, 5);
    const p3 = await datos(`{ misPedidos(primeros: 5, despuesDe: "PF-00010") { nodos { id } siguiente } }`);
    assert.deepEqual(p3.data.misPedidos.nodos.map((n) => n.id), ["PF-00011", "PF-00012"]);
    assert.equal(p3.data.misPedidos.siguiente, null);
  });

  test("reporteVentas: solo admin o dueño; combina ventas, categorías y pagos", async () => {
    const q = "{ reporteVentas(desde: \"2026-11-01\", hasta: \"2026-11-07\") { monto porCategoria { categoria unidades } conciliacion { ventas pagosAprobados pedidosConDiferencia } } }";
    const cocina = await datos(q, { rol: "cocina", sujeto: "u-cocina" });
    assert.equal(cocina.data.reporteVentas, null);
    assert.equal(cocina.errors[0].extensions.code, "PROHIBIDO");

    const dueno = await datos(q, { rol: "dueno", sujeto: "u-dueno" });
    assert.deepEqual(dueno.data.reporteVentas.conciliacion, { ventas: 1, pagosAprobados: 1, pedidosConDiferencia: [] });
    assert.deepEqual(dueno.data.reporteVentas.porCategoria.map((c) => c.categoria).sort(), ["BASE", "BEBIDA", "PROTEINA"]);
  });

  test("sin identidad de usuario: 401", async () => {
    assert.equal((await consultar("{ __typename }", { rol: null })).status, 401);
  });
});
