/**
 * Pruebas del Auth Service con un Vault simulado, cuentas en memoria y un
 * reloj controlable para probar la expiración sin esperar de verdad.
 *
 *   npm test
 */

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { crearApp } from "../src/app.js";
import { hashear, verificar } from "../src/claves.js";
import { leerConfig } from "../src/config.js";
import { repositorioMemoria } from "../src/cuentas.js";
import { crearCuentasDemo } from "../src/demo.js";
import { crearVaultFalso } from "./vault-falso.js";

const SECRETO_GATEWAY = "secreto-gateway";
const SECRETO_CLIENTES = "secreto-clientes";
const PEPPER = "pepper-de-prueba";

const escuchar = (app) => new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;
const basic = (cliente = "gateway", secreto = cliente === "gateway" ? SECRETO_GATEWAY : SECRETO_CLIENTES) =>
  `Basic ${Buffer.from(`${cliente}:${secreto}`).toString("base64")}`;

describe("auth service", () => {
  let vault, servidores, config, base, ahora, cuentas;

  const reloj = () => ahora;
  const avanzar = (minutos) => (ahora += minutos * 60_000);

  const pedir = (ruta, cuerpo, { metodo = "POST", autorizacion = basic(), destino = base, cabeceras = {} } = {}) =>
    fetch(`${destino}${ruta}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", ...(autorizacion ? { Authorization: autorizacion } : {}), ...cabeceras },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  const login = (usuario, clave, opciones) => pedir("/login", { usuario, clave }, opciones);
  const introspect = async (token) => (await pedir("/introspect", { token })).json();
  const comoAdmin = { "X-Usuario-Rol": "admin", "X-Usuario-Id": "actor" };

  async function servicio(cambios = {}) {
    const s = await escuchar(crearApp({ ...config, ...cambios }, { reloj, sinLimpieza: true, cuentas }));
    servidores.push(s);
    return url(s);
  }

  before(async () => {
    vault = crearVaultFalso();
    vault.escribir("poke-fresh/internos/auth-gateway", { secreto: SECRETO_GATEWAY });
    vault.escribir("poke-fresh/internos/auth-clientes", { secreto: SECRETO_CLIENTES });
    vault.escribir("poke-fresh/auth", { pepper: PEPPER });
    const sVault = await escuchar(vault.app);
    servidores = [sVault];
    config = { ...leerConfig({ NODE_ENV: "test" }), vaultAddr: url(sVault), vaultToken: "root", vaultCacheSegundos: 0 };
  });

  beforeEach(async () => {
    ahora = Date.parse("2026-11-05T12:00:00Z");
    vault.estado.sellado = false;
    cuentas = repositorioMemoria();
    await crearCuentasDemo(cuentas, PEPPER);
    base = await servicio(); // servicio nuevo en cada prueba: sesiones e intentos limpios
  });

  after(() => servidores.forEach((s) => s.close()));

  // --- Quién puede llamar ----------------------------------------------------------

  test("sin credencial de cliente: 401", async () => {
    const r = await login("admin@pokefresh.cl", "Admin2026", { autorizacion: null });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).codigo, "CLIENTE_NO_AUTORIZADO");
  });

  test("secreto equivocado: 401", async () => {
    assert.equal((await login("admin@pokefresh.cl", "Admin2026", { autorizacion: basic("gateway", "otro") })).status, 401);
  });

  test("el servicio de clientes no puede hacer login ni crear personal", async () => {
    const r = await login("admin@pokefresh.cl", "Admin2026", { autorizacion: basic("clientes") });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).codigo, "RUTA_NO_PERMITIDA");
    // Aunque pida rol admin, la cuenta que crea es de cliente.
    await pedir("/cuentas", { email: "colado@correo.cl", clave: "Clave2026", rol: "admin", sujetoId: "cli_x" }, { autorizacion: basic("clientes") });
    assert.equal((await cuentas.porEmail("colado@correo.cl")).rol, "cliente");
  });

  // --- Login --------------------------------------------------------------------------

  test("login correcto: token opaco, expiración, rol y sujeto", async () => {
    const r = await login("cliente@correo.cl", "Cliente2026");
    assert.equal(r.status, 200);
    const cuerpo = await r.json();
    assert.match(cuerpo.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(cuerpo.usuario.rol, "cliente");
    assert.equal(cuerpo.usuario.sujeto, "cli_demo_1");
    assert.equal(cuerpo.expira - Math.floor(ahora / 1000), 30 * 60);
  });

  test("clave incorrecta y correo inexistente responden igual", async () => {
    const a = await login("admin@pokefresh.cl", "Incorrecta1");
    const b = await login("nadie@pokefresh.cl", "Incorrecta1");
    assert.equal(a.status, 401);
    assert.deepEqual(await a.json(), await b.json());
  });

  test("tras 5 intentos fallidos se bloquea, incluso con la clave correcta", async () => {
    for (let i = 0; i < 5; i++) await login("admin@pokefresh.cl", "Incorrecta1");
    const r = await login("admin@pokefresh.cl", "Admin2026");
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("retry-after")) > 0);
    avanzar(6);
    assert.equal((await login("admin@pokefresh.cl", "Admin2026")).status, 200);
  });

  // --- Sesiones --------------------------------------------------------------------------

  test("introspección: activo con rol y sujeto; un token inventado no", async () => {
    const { token } = await (await login("cocina@pokefresh.cl", "Cocina2026")).json();
    const datos = await introspect(token);
    assert.equal(datos.active, true);
    assert.equal(datos.rol, "cocina");
    assert.deepEqual(await introspect("inventado"), { active: false });
  });

  test("vence a los 30 minutos sin actividad y a las 8 horas aunque se use", async () => {
    const { token } = await (await login("admin@pokefresh.cl", "Admin2026")).json();
    avanzar(29);
    assert.equal((await introspect(token)).active, true);
    avanzar(31);
    assert.equal((await introspect(token)).active, false);

    const { token: otro } = await (await login("admin@pokefresh.cl", "Admin2026")).json();
    for (let i = 0; i < 16; i++) {
      avanzar(29);
      await introspect(otro);
    }
    assert.equal((await introspect(otro)).active, true);
    avanzar(29);
    assert.equal((await introspect(otro)).active, false);
  });

  test("logout revoca la sesión al instante", async () => {
    const { token } = await (await login("admin@pokefresh.cl", "Admin2026")).json();
    assert.equal((await pedir("/logout", { token })).status, 204);
    assert.equal((await introspect(token)).active, false);
  });

  // --- Registro y verificación de clientes ---------------------------------------------------

  test("cuenta nueva de cliente: sin verificar no entra; con el código sí", async () => {
    const r = await pedir("/cuentas", { email: "nueva@correo.cl", clave: "Clave2026", nombre: "Ana Nueva", sujetoId: "cli_nueva" }, { autorizacion: basic("clientes") });
    assert.equal(r.status, 201);
    const { codigoDemo } = await r.json();
    assert.match(codigoDemo, /^\d{6}$/);

    const sinVerificar = await login("nueva@correo.cl", "Clave2026");
    assert.equal(sinVerificar.status, 403);
    assert.equal((await sinVerificar.json()).codigo, "SIN_VERIFICAR");

    assert.equal((await pedir("/verificacion", { email: "nueva@correo.cl", codigo: "000000" })).status, 400);
    assert.equal((await pedir("/verificacion", { email: "nueva@correo.cl", codigo: codigoDemo })).status, 200);
    assert.equal((await login("nueva@correo.cl", "Clave2026")).status, 200);
    // El código no se guarda en claro.
    assert.ok(!JSON.stringify(await cuentas.porEmail("nueva@correo.cl")).includes(codigoDemo));
  });

  test("el código vence a las 24 horas", async () => {
    const { codigoDemo } = await (await pedir("/cuentas", { email: "tarde@correo.cl", clave: "Clave2026", sujetoId: "cli_t" }, { autorizacion: basic("clientes") })).json();
    avanzar(25 * 60);
    assert.equal((await (await pedir("/verificacion", { email: "tarde@correo.cl", codigo: codigoDemo })).json()).codigo, "VENCIDO");
  });

  test("clave débil se rechaza y el reenvío no revela si el correo existe", async () => {
    const r = await pedir("/cuentas", { email: "debil@correo.cl", clave: "abc", sujetoId: "cli_d" }, { autorizacion: basic("clientes") });
    assert.equal(r.status, 400);
    const a = await (await pedir("/verificacion/reenviar", { email: "nadie@correo.cl" })).json();
    const b = await (await pedir("/verificacion/reenviar", { email: "cliente@correo.cl" })).json();
    assert.equal(a.mensaje, b.mensaje);
  });

  test("desactivar un cliente corta su sesión abierta", async () => {
    const { token } = await (await login("cliente@correo.cl", "Cliente2026")).json();
    await pedir("/cuentas/sujeto/cli_demo_1", { activo: false }, { metodo: "PATCH", autorizacion: basic("clientes") });
    assert.equal((await introspect(token)).active, false);
    assert.equal((await login("cliente@correo.cl", "Cliente2026")).status, 403);
  });

  test("cambiar el correo exige verificarlo de nuevo", async () => {
    const r = await pedir("/cuentas/sujeto/cli_demo_1", { email: "javiera@nuevo.cl" }, { metodo: "PATCH", autorizacion: basic("clientes") });
    assert.match((await r.json()).codigoDemo, /^\d{6}$/);
    assert.equal((await (await login("javiera@nuevo.cl", "Cliente2026")).json()).codigo, "SIN_VERIFICAR");
  });

  test("cambio de clave exige la actual", async () => {
    const id = (await cuentas.porEmail("cliente@correo.cl"))._id;
    assert.equal((await pedir("/clave", { cuentaId: id, actual: "mala", nueva: "Nueva2026" })).status, 400);
    assert.equal((await pedir("/clave", { cuentaId: id, actual: "Cliente2026", nueva: "Nueva2026" })).status, 204);
    assert.equal((await login("cliente@correo.cl", "Nueva2026")).status, 200);
  });

  // --- Usuarios internos ----------------------------------------------------------------

  test("solo un admin gestiona usuarios y siempre queda uno activo", async () => {
    assert.equal((await pedir("/usuarios", undefined, { metodo: "GET", cabeceras: { "X-Usuario-Rol": "dueno" } })).status, 403);

    const lista = await (await pedir("/usuarios", undefined, { metodo: "GET", cabeceras: comoAdmin })).json();
    assert.equal(lista.length, 4);
    assert.ok(lista.every((u) => !("hash" in u)));

    const admin = lista.find((u) => u.rol === "admin");
    const r = await pedir(`/usuarios/${admin.id}/estado`, { activo: false }, { metodo: "PATCH", cabeceras: comoAdmin });
    assert.equal((await r.json()).codigo, "ULTIMO_ADMIN");

    const nuevo = await pedir("/usuarios", { nombre: "Pedro Soto", email: "pedro@pokefresh.cl", rol: "cocina", clave: "Cocina2027" }, { cabeceras: comoAdmin });
    assert.equal(nuevo.status, 201);
    assert.equal((await login("pedro@pokefresh.cl", "Cocina2027")).status, 200);
  });

  // --- Claves y Vault -------------------------------------------------------------------------

  test("las cuentas guardan hash con sal; sin el pepper de Vault el hash no sirve", async () => {
    const cuenta = await cuentas.porEmail("admin@pokefresh.cl");
    assert.match(cuenta.hash, /^scrypt\$16384\$8\$1\$/);
    assert.ok(!JSON.stringify(cuenta).includes("Admin2026"));
    assert.equal(await verificar("Admin2026", cuenta.hash, "otro-pepper"), false);
    assert.notEqual(await hashear("Misma2026", PEPPER), await hashear("Misma2026", PEPPER));
  });

  test("Vault sellado: 503 y no se puede iniciar sesión", async () => {
    vault.estado.sellado = true;
    const r = await login("admin@pokefresh.cl", "Admin2026");
    assert.equal(r.status, 503);
    assert.equal((await r.json()).codigo, "SECRETOS_NO_DISPONIBLES");
  });

  test("salud: 200 con Vault arriba y 503 sellado", async () => {
    assert.equal((await fetch(`${base}/salud`)).status, 200);
    vault.estado.sellado = true;
    assert.equal((await fetch(`${base}/salud`)).status, 503);
  });
});
