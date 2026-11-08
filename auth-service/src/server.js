import { MongoClient } from "mongodb";

import { crearApp } from "./app.js";
import { leerConfig } from "./config.js";
import { repositorioMongo } from "./cuentas.js";
import { crearCuentasDemo } from "./demo.js";
import { crearClienteVault } from "./vault.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const config = leerConfig();

if (!config.vaultToken) {
  console.error("Falta el token de Vault (VAULT_TOKEN o VAULT_TOKEN_ARCHIVO): el Auth Service lo necesita para validar contraseñas.");
  process.exit(1);
}

const vault = crearClienteVault(config);

/** El usuario y la clave de Mongo de este servicio se leen de Vault, no del entorno. */
async function uriMongo() {
  if (!config.rutaMongo) return config.mongoUri;
  const [usuario, clave] = await Promise.all([vault.leerValor(config.rutaMongo, "usuario"), vault.leerValor(config.rutaMongo, "clave")]);
  const url = new URL(config.mongoUri);
  url.username = encodeURIComponent(usuario);
  url.password = encodeURIComponent(clave);
  url.pathname = `/${config.mongoDb}`;
  url.searchParams.set("authSource", config.mongoDb);
  return url.toString();
}

const mongo = new MongoClient(await uriMongo(), { serverSelectionTimeoutMS: 10_000 });
await mongo.connect();
const cuentas = repositorioMongo(mongo.db(config.mongoDb));
await cuentas.preparar();

if (config.modoDemo) {
  const creadas = await crearCuentasDemo(cuentas, await vault.leerValor(config.rutaSecretoAuth, "pepper"));
  if (creadas) console.log(`Modo demo: se crearon ${creadas} cuentas de prueba.`);
}

const servidor = crearApp(config, { vault, cuentas }).listen(config.puerto, config.host, () => {
  console.log(`Auth Service en http://${config.host}:${config.puerto}`);
  console.log(`  Sesiones: ${config.sesionInactividadSeg / 60} min de inactividad, ${config.sesionMaximaSeg / 3600} h como máximo`);
});

const apagar = () => servidor.close(() => mongo.close().then(() => process.exit(0)));
process.on("SIGTERM", apagar);
process.on("SIGINT", apagar);
