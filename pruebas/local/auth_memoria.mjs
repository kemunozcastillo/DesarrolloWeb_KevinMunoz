/** Auth Service con cuentas en memoria (solo pruebas locales sin Mongo). */
import { crearApp } from "../../auth-service/src/app.js";
import { leerConfig } from "../../auth-service/src/config.js";
import { repositorioMemoria } from "../../auth-service/src/cuentas.js";
import { crearCuentasDemo } from "../../auth-service/src/demo.js";
import { crearClienteVault } from "../../auth-service/src/vault.js";

const config = leerConfig();
const vault = crearClienteVault(config);
const cuentas = repositorioMemoria();
await crearCuentasDemo(cuentas, await vault.leerValor(config.rutaSecretoAuth, "pepper"));
crearApp(config, { vault, cuentas }).listen(config.puerto, "127.0.0.1", () => console.log(`Auth Service (memoria) en ${config.puerto}`));
