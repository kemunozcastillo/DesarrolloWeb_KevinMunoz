import { crearApp } from "./app.js";
import { leerConfig } from "./config.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env: se usan las variables del sistema */
}

const config = leerConfig();

if (!config.vaultToken) {
  console.error("Falta VAULT_TOKEN: el gateway no puede validar tokens sin acceso a Vault. Revisa el .env.");
  process.exit(1);
}

crearApp(config).listen(config.puerto, () => {
  console.log(`Gateway seguro en http://localhost:${config.puerto}`);
  console.log(`  Vault:   ${config.vaultAddr} (${config.vaultMontaje}/${config.rutaSecretoGateway}, ${config.vaultMontaje}/${config.rutaSecretoBackend})`);
  console.log(`  Backend: ${config.urlBackend}`);
});
