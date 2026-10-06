/**
 * Pruebas del Auth Service con un Vault simulado y un reloj controlable,
 * para probar la expiración de sesiones sin esperar de verdad.
 *
 *   npm test
 */

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { crearApp } from "../src/app.js";
import { hashear, verificar } from "../src/claves.js";
import { leerConfig } from "../src/config.js";
import { crearVaultFalso } from "./vault-falso.js";

const ejecutar = promisify(execFile);
const SECRETO = "secreto-de-introspeccion";
const PEPPER = "pepper-de-prueba";
const CLAVE_ADMIN = "AdminSegura2026";
const CLAVE_VENDEDOR = "Vendedor2026x";

const escuchar = (app) => new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;
const basic = (secreto = SECRETO, cliente = "gateway") => `Basic ${Buffer.from(`${cliente}:${secreto}`).toString("base64")}`;

describe("auth service", () => {
  let vault, sVault, servidores, archivo, config, base, ahora;

  const reloj = () => ahora;
  const avanzar = (minutos) => (ahora += minutos * 60_000);

  const pedir = (ruta, cuerpo, { autorizacion = basic(), destino = base } = {}) =>
    fetch(`${destino}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", ...(autorizacion ? { Authorization: autorizacion } : {}) }, body: JSON.stringify(cuerpo) });
  const login = (usuario, clave, opciones) => pedir("/login", { usuario, clave }, opciones);
  const introspect = async (token) => (await pedir("/introspect", { token })).json();

  async function servicio(cambios = {}, deps = {}) {
    const s = await escuchar(crearApp({ ...config, ...cambios }, { reloj, sinLimpieza: true, ...deps }));
    servidores.push(s);
    return url(s);
  }

  before(async () => {
    vault = crearVaultFalso();
    vault.escribir("poke-fresh/introspeccion", { secreto: SECRETO });
    vault.escribir("poke-fresh/auth", { pepper: PEPPER });
    sVault = await escuchar(vault.app);
    servidores = [sVault];

    archivo = join(await mkdtemp(join(tmpdir(), "auth-")), "usuarios.json");
    await writeFile(
      archivo,
      JSON.stringify([
        { id: "u-admin", usuario: "admin", nombre: "Camila Rojas", rol: "admin", hash: await hashear(CLAVE_ADMIN, PEPPER), activo: true },
        { id: "u-vendedor", usuario: "vendedor", nombre: "Matías Pérez", rol: "usuario", hash: await hashear(CLAVE_VENDEDOR, PEPPER), activo: true },
      ]),
    );

    config = { ...leerConfig({ NODE_ENV: "test" }), vaultAddr: url(sVault), vaultToken: "root", vaultCacheSegundos: 0, archivoUsuarios: archivo };
  });

  beforeEach(async () => {
    ahora = Date.parse("2026-10-05T12:00:00Z");
    vault.estado.sellado = false;
    base = await servicio(); // servicio nuevo en cada prueba: sesiones e intentos limpios
  });

  after(() => servidores.forEach((s) => s.close()));

  // --- Solo atiende al gateway ----------------------------------------------------

  test("sin credencial de cliente: 401", async () => {
    const respuesta = await login("admin", CLAVE_ADMIN, { autorizacion: null });
    assert.equal(respuesta.status, 401);
    assert.equal((await respuesta.json()).error, "CLIENTE_NO_AUTORIZADO");
  });

  test("con el secreto de introspección equivocado: 401", async () => {
    assert.equal((await login("admin", CLAVE_ADMIN, { autorizacion: basic("otro") })).status, 401);
    assert.equal((await login("admin", CLAVE_ADMIN, { autorizacion: basic(SECRETO, "intruso") })).status, 401);
  });

  // --- Login ------------------------------------------------------------------------

  test("login correcto: token opaco, expiración y datos del usuario", async () => {
    const respuesta = await login("Admin", CLAVE_ADMIN); // el usuario no distingue mayúsculas
    const cuerpo = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.match(cuerpo.token, /^[\w-]{43}$/);
    assert.equal(cuerpo.usuario.rol, "admin");
    assert.equal(cuerpo.expira, Math.floor(ahora / 1000) + 30 * 60);
    assert.equal(cuerpo.expiraMaximo, Math.floor(ahora / 1000) + 8 * 3600);
  });

  test("clave incorrecta y usuario inexistente responden igual", async () => {
    const mala = await (await login("admin", "NoEsLaClave1")).json();
    const nadie = await (await login("fantasma", "NoEsLaClave1")).json();
    assert.deepEqual(mala, nadie);
    assert.equal(mala.error, "CREDENCIALES_INVALIDAS");
  });

  test("tras 5 intentos fallidos se bloquea, incluso con la clave correcta", async () => {
    for (let i = 0; i < 5; i++) await login("vendedor", "NoEsLaClave1");
    const bloqueado = await login("vendedor", CLAVE_VENDEDOR);

    assert.equal(bloqueado.status, 429);
    assert.equal(bloqueado.headers.get("retry-after"), "300");

    avanzar(6);
    assert.equal((await login("vendedor", CLAVE_VENDEDOR)).status, 200);
  });

  test("faltan datos: 400", async () => {
    assert.equal((await login("admin", "")).status, 400);
  });

  // --- Introspección y expiración -------------------------------------------------------

  test("introspección de un token activo: usuario y rol", async () => {
    const { token } = await (await login("vendedor", CLAVE_VENDEDOR)).json();
    const resultado = await introspect(token);

    assert.equal(resultado.active, true);
    assert.equal(resultado.usuario, "vendedor");
    assert.equal(resultado.rol, "usuario");
  });

  test("un token inventado no está activo, sin dar detalles", async () => {
    assert.deepEqual(await introspect("token-inventado"), { active: false });
  });

  test("vence a los 30 minutos sin actividad", async () => {
    const { token } = await (await login("vendedor", CLAVE_VENDEDOR)).json();
    avanzar(29);
    assert.equal((await introspect(token)).active, true); // este uso la renueva
    avanzar(29);
    assert.equal((await introspect(token)).active, true);
    avanzar(31);
    assert.equal((await introspect(token)).active, false);
  });

  test("vence a las 8 horas aunque se use todo el tiempo", async () => {
    const { token } = await (await login("vendedor", CLAVE_VENDEDOR)).json();
    for (let minutos = 0; minutos < 8 * 60 - 20; minutos += 20) {
      avanzar(20);
      assert.equal((await introspect(token)).active, true);
    }
    avanzar(25);
    assert.equal((await introspect(token)).active, false);
  });

  test("logout revoca la sesión al instante", async () => {
    const { token } = await (await login("admin", CLAVE_ADMIN)).json();
    assert.equal((await pedir("/logout", { token })).status, 204);
    assert.equal((await introspect(token)).active, false);
    assert.equal((await pedir("/logout", { token })).status, 204); // repetirlo no es error
  });

  test("desactivar a un usuario corta su sesión abierta, y un cambio de rol se ve al instante", async () => {
    const original = await readFile(archivo, "utf8");
    try {
      const { token: tokenVendedor } = await (await login("vendedor", CLAVE_VENDEDOR)).json();
      const { token: tokenAdmin } = await (await login("admin", CLAVE_ADMIN)).json();

      // Se edita el archivo con las sesiones ya abiertas y el servicio corriendo.
      const lista = JSON.parse(original);
      lista.find((u) => u.usuario === "vendedor").activo = false;
      lista.find((u) => u.usuario === "admin").rol = "usuario";
      await new Promise((r) => setTimeout(r, 20)); // asegura una fecha de modificación distinta
      await writeFile(archivo, JSON.stringify(lista));

      assert.equal((await introspect(tokenVendedor)).active, false);
      assert.equal((await introspect(tokenAdmin)).rol, "usuario");
      assert.equal((await login("vendedor", CLAVE_VENDEDOR)).status, 401);
    } finally {
      await writeFile(archivo, original);
    }
  });

  // --- Claves --------------------------------------------------------------------------

  test("el archivo de usuarios no guarda contraseñas, solo hash con sal", async () => {
    const texto = await readFile(archivo, "utf8");
    assert.ok(!texto.includes(CLAVE_ADMIN));
    assert.match(JSON.parse(texto)[0].hash, /^scrypt\$16384\$8\$1\$/);
  });

  test("sin el pepper de Vault, el hash no sirve", async () => {
    const hash = await hashear(CLAVE_ADMIN, PEPPER);
    assert.equal(await verificar(CLAVE_ADMIN, hash, PEPPER), true);
    assert.equal(await verificar(CLAVE_ADMIN, hash, "otro-pepper"), false);
  });

  test("dos usuarios con la misma clave tienen hash distintos (sal)", async () => {
    assert.notEqual(await hashear("MismaClave2026", PEPPER), await hashear("MismaClave2026", PEPPER));
  });

  // --- Vault caído ------------------------------------------------------------------------

  test("Vault sellado: 502 y no se puede iniciar sesión", async () => {
    vault.estado.sellado = true;
    const respuesta = await login("admin", CLAVE_ADMIN);
    assert.equal(respuesta.status, 502);
    assert.equal((await respuesta.json()).error, "VAULT_NO_DISPONIBLE");
  });

  test("token de Vault sin permiso: 500", async () => {
    const malConfigurado = await servicio({ vaultToken: "no-existe" });
    assert.equal((await login("admin", CLAVE_ADMIN, { destino: malConfigurado })).status, 500);
  });

  test("salud: 200 con Vault arriba y 503 sellado", async () => {
    assert.equal((await fetch(`${base}/salud`)).status, 200);
    vault.estado.sellado = true;
    assert.equal((await fetch(`${base}/salud`)).status, 503);
  });

  // --- Script de usuarios -----------------------------------------------------------------

  test("npm run usuarios-ejemplo crea admin y vendedor con claves aleatorias que funcionan", async () => {
    const otro = join(await mkdtemp(join(tmpdir(), "auth-")), "usuarios.json");
    const { stdout } = await ejecutar(process.execPath, ["scripts/crear-usuario.js", "--ejemplo"], {
      env: { ...process.env, VAULT_ADDR: url(sVault), VAULT_TOKEN: "root", ARCHIVO_USUARIOS: otro },
    });

    const claves = Object.fromEntries([...stdout.matchAll(/:\s+(\w+)\s+rol \w+\s+contraseña (\S+)/g)].map((m) => [m[1], m[2]]));
    assert.deepEqual(Object.keys(claves), ["admin", "vendedor"]);
    assert.ok(!(await readFile(otro, "utf8")).includes(claves.admin));

    const conOtro = await servicio({ archivoUsuarios: otro });
    assert.equal((await login("admin", claves.admin, { destino: conOtro })).status, 200);
  });
});
