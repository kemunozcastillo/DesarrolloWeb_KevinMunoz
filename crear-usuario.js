/**
 * Crea o actualiza usuarios del Auth Service.
 *
 *   npm run usuarios-ejemplo
 *       crea "admin" (rol admin) y "vendedor" (rol usuario)
 *
 *   npm run usuario -- <usuario> <rol> "<Nombre Apellido>" [--clave <clave>]
 *       sin --clave, se genera una al azar
 *
 * Necesita Vault arriba: la contraseña se mezcla con el pepper que vive ahí.
 * Las contraseñas se muestran una sola vez y no se guardan en ninguna parte;
 * solo queda su hash en data/usuarios.json.
 */

import { randomInt } from "node:crypto";

import { hashear, validarFortaleza } from "../src/claves.js";
import { leerConfig } from "../src/config.js";
import { crearRepositorioUsuarios, ROLES } from "../src/usuarios.js";
import { crearClienteVault } from "../src/vault.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const config = leerConfig();
const argumentos = process.argv.slice(2);

/** Contraseña aleatoria legible: sin letras que se confundan (l, 1, O, 0). */
function claveAleatoria() {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digitos = "23456789";
  const elegir = (texto, n) => Array.from({ length: n }, () => texto[randomInt(texto.length)]).join("");
  return `${elegir(letras, 4)}-${elegir(digitos, 4)}-${elegir(letras, 4)}`;
}

let pedidos;
if (argumentos.includes("--ejemplo")) {
  pedidos = [
    { usuario: "admin", rol: "admin", nombre: "Camila Rojas" },
    { usuario: "vendedor", rol: "usuario", nombre: "Matías Pérez" },
  ];
} else {
  const [usuario, rol, nombre] = argumentos.filter((a, i) => !a.startsWith("--") && argumentos[i - 1] !== "--clave");
  const indiceClave = argumentos.indexOf("--clave");
  if (!usuario || !rol) {
    console.error(`Uso: npm run usuario -- <usuario> <${ROLES.join("|")}> "<Nombre>" [--clave <clave>]`);
    process.exit(1);
  }
  pedidos = [{ usuario, rol, nombre, clave: indiceClave >= 0 ? argumentos[indiceClave + 1] : undefined }];
}

try {
  const pepper = await crearClienteVault(config).leerValor(config.rutaSecretoAuth, "pepper");
  const repositorio = crearRepositorioUsuarios(config.archivoUsuarios);

  console.log("");
  for (const pedido of pedidos) {
    const clave = pedido.clave ?? claveAleatoria();
    const problema = validarFortaleza(clave);
    if (problema) throw new Error(`${pedido.usuario}: ${problema}`);

    const { creado } = await repositorio.crear({ ...pedido, hash: await hashear(clave, pepper) });
    console.log(`${creado ? "Creado" : "Actualizado"}: ${pedido.usuario.padEnd(10)} rol ${pedido.rol.padEnd(8)} contraseña ${clave}`);
  }
  console.log("\nAnota las contraseñas: no se guardan en ninguna parte y no se pueden recuperar.\n");
} catch (error) {
  console.error(error.message.includes("Vault") ? `${error.message} ¿Está corriendo Vault y el VAULT_TOKEN es el del Auth Service?` : error.message);
  process.exit(1);
}
