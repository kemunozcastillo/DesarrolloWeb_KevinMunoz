/**
 * Prepara Vault y Mongo antes de que arranquen los servicios. Se corre en
 * cada `docker compose up` y es idempotente.
 *
 *   1. Inicializa Vault la primera vez y lo desbloquea (unseal).
 *   2. Crea los secretos que falten, con valores aleatorios. Los que ya
 *      existen no se tocan (cambiar el pepper invalidaría todas las claves).
 *   3. Crea en Mongo un usuario por servicio, con permiso solo sobre su base,
 *      y deja su clave en Vault.
 *   4. Carga las políticas de vault/politicas/ y crea un token por servicio
 *      con su política. Escribe cada token en /tokens/<servicio>.token.
 *
 * Nunca imprime valores de secretos.
 *
 * Desarrollo vs. producción: aquí la clave de desbloqueo y el token raíz
 * quedan en un volumen local (/claves) para que el entorno arranque solo.
 * En producción se usa auto-unseal (KMS) o claves repartidas (Shamir), el
 * token raíz se revoca, y cada token llega solo al contenedor que lo usa.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { MongoClient } from "mongodb";

const VAULT = (process.env.VAULT_ADDR ?? "http://vault:8200").replace(/\/$/, "");
const DIR_CLAVES = process.env.DIR_CLAVES ?? "/claves";
const DIR_TOKENS = process.env.DIR_TOKENS ?? "/tokens";
const DIR_POLITICAS = process.env.DIR_POLITICAS ?? new URL("./politicas", import.meta.url).pathname;
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://mongo:27017";

const aleatorio = (bytes = 32) => randomBytes(bytes).toString("base64url");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let raiz = null;

async function vault(metodo, ruta, cuerpo) {
  // Recién montado el motor KV v2, Vault responde unos segundos con error
  // mientras lo prepara ("upgrading"): se reintenta hasta 15 veces.
  for (let intento = 1; ; intento++) {
    const r = await fetch(`${VAULT}/v1/${ruta}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", ...(raiz ? { "X-Vault-Token": raiz } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const texto = await r.text();
    const reintentar = (r.status === 400 || r.status >= 500) && /upgrad|not ready|sealed/i.test(texto);
    if (reintentar && intento < 15) {
      await esperar(1000);
      continue;
    }
    return { estado: r.status, datos: texto ? JSON.parse(texto) : null };
  }
}

async function esperarVault() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${VAULT}/v1/sys/seal-status`);
      if (r.ok) return;
    } catch {
      /* todavía no arranca */
    }
    await esperar(1000);
  }
  throw new Error("Vault no respondió en 60 segundos.");
}

async function inicializarYDesbloquear() {
  const archivo = join(DIR_CLAVES, "vault-desarrollo.json");
  await mkdir(DIR_CLAVES, { recursive: true });

  const { datos: init } = await vault("GET", "sys/init");
  if (!init.initialized) {
    const { datos } = await vault("PUT", "sys/init", { secret_shares: 1, secret_threshold: 1 });
    await writeFile(archivo, JSON.stringify({ clave: datos.keys_base64[0], raiz: datos.root_token }));
    await chmod(archivo, 0o600);
    console.log("Vault inicializado.");
  }
  if (!existsSync(archivo)) throw new Error(`Vault ya estaba inicializado pero falta ${archivo}. Borra el volumen de Vault para empezar de cero.`);

  const claves = JSON.parse(await readFile(archivo, "utf8"));
  raiz = claves.raiz;
  const { datos: sello } = await vault("GET", "sys/seal-status");
  if (sello.sealed) {
    await vault("PUT", "sys/unseal", { key: claves.clave });
    console.log("Vault desbloqueado.");
  }

  const { datos: montajes } = await vault("GET", "sys/mounts");
  if (!montajes["secret/"] && !montajes.data?.["secret/"]) {
    await vault("POST", "sys/mounts/secret", { type: "kv", options: { version: "2" } });
    console.log("Motor KV v2 montado en secret/.");
  }
}

async function leerSecreto(ruta) {
  const { estado, datos } = await vault("GET", `secret/data/${ruta}`);
  return estado === 200 ? datos.data.data : null;
}

async function asegurarSecreto(ruta, generar) {
  const actual = await leerSecreto(ruta);
  if (actual) return actual;
  const nuevo = generar();
  const { estado } = await vault("POST", `secret/data/${ruta}`, { data: nuevo });
  if (estado >= 300) throw new Error(`No se pudo escribir ${ruta} (HTTP ${estado}).`);
  console.log(`  secreto creado: ${ruta}`);
  return nuevo;
}

const SERVICIOS = ["inventario", "clientes", "pedidos", "pagos", "graphql"];
const BASES = { auth: ["pf_auth"], inventario: ["pf_inventario"], clientes: ["pf_clientes"], pedidos: ["pf_pedidos"], pagos: ["pf_pagos"], semilla: ["pf_clientes", "pf_pedidos", "pf_pagos"] };

async function crearSecretos() {
  console.log("Secretos:");
  for (const s of SERVICIOS) await asegurarSecreto(`poke-fresh/internos/${s}`, () => ({ credencial: aleatorio() }));
  for (const c of ["gateway", "clientes"]) await asegurarSecreto(`poke-fresh/internos/auth-${c}`, () => ({ secreto: aleatorio() }));
  await asegurarSecreto("poke-fresh/auth", () => ({ pepper: aleatorio() }));
  await asegurarSecreto("poke-fresh/pasarela/comercio", () => ({ api_key: aleatorio(24), secreto_firma: aleatorio() }));
  const mongo = {};
  for (const s of Object.keys(BASES)) mongo[s] = await asegurarSecreto(`poke-fresh/mongo/${s}`, () => ({ usuario: `pf_${s}`, clave: aleatorio(24) }));
  return mongo;
}

async function crearUsuariosMongo(credenciales) {
  const usuario = process.env.MONGO_ROOT_USUARIO;
  const clave = process.env.MONGO_ROOT_CLAVE;
  const url = new URL(MONGO_URI);
  url.username = encodeURIComponent(usuario);
  url.password = encodeURIComponent(clave);

  const cliente = new MongoClient(url.toString(), { serverSelectionTimeoutMS: 30_000 });
  await cliente.connect();
  console.log("Usuarios de Mongo (uno por servicio, solo su base):");
  try {
    for (const [servicio, bases] of Object.entries(BASES)) {
      const { usuario: nombre, clave: secreto } = credenciales[servicio];
      // El usuario se crea en la base principal del servicio (authSource).
      const db = cliente.db(bases[0]);
      const roles = bases.map((b) => ({ role: "readWrite", db: b }));
      const existe = (await db.command({ usersInfo: nombre })).users.length > 0;
      if (existe) await db.command({ updateUser: nombre, pwd: secreto, roles });
      else await db.command({ createUser: nombre, pwd: secreto, roles });
      console.log(`  ${nombre}: readWrite en ${bases.join(", ")}`);
    }
  } finally {
    await cliente.close();
  }
}

async function crearPoliticasYTokens() {
  await mkdir(DIR_TOKENS, { recursive: true });
  console.log("Políticas y tokens:");
  for (const archivo of (await readdir(DIR_POLITICAS)).filter((a) => a.endsWith(".hcl"))) {
    const nombre = basename(archivo, ".hcl");
    const politica = await readFile(join(DIR_POLITICAS, archivo), "utf8");
    await vault("PUT", `sys/policies/acl/poke-fresh-${nombre}`, { policy: politica });

    const { estado, datos } = await vault("POST", "auth/token/create", {
      policies: [`poke-fresh-${nombre}`],
      no_default_policy: true,
      ttl: "720h",
      display_name: nombre,
      meta: { servicio: nombre },
    });
    if (estado !== 200) throw new Error(`No se pudo crear el token de ${nombre} (HTTP ${estado}).`);
    const destino = join(DIR_TOKENS, `${nombre}.token`);
    await writeFile(destino, datos.auth.client_token);
    await chmod(destino, 0o644);
    console.log(`  ${nombre}: política poke-fresh-${nombre}, token en ${destino}`);
  }
}

await esperarVault();
await inicializarYDesbloquear();
const credencialesMongo = await crearSecretos();
// SIN_MONGO: solo para el entorno de pruebas local, que usa Mongo en memoria.
if (process.env.SIN_MONGO !== "true") await crearUsuariosMongo(credencialesMongo);
await crearPoliticasYTokens();
console.log("Listo.");
