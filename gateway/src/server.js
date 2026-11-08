import { crearApp } from "./app.js";
import { leerConfig } from "./config.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env: se usan las variables del sistema */
}

const config = leerConfig();

if (!config.vaultToken) {
  console.error("Falta VAULT_TOKEN: el gateway no puede validar sesiones sin acceso a Vault. Revisa el .env.");
  process.exit(1);
}

crearApp(config).listen(config.puerto, () => {
  console.log(`Gateway seguro en http://localhost:${config.puerto}`);
  console.log(`  Vault:        ${config.vaultAddr}`);
  console.log(`  Auth Service: ${config.urlAuth}`);
  console.log(`  Backend:      ${config.urlBackend}`);
  if (!config.cookieSecure) console.log("  Cookie sin Secure: solo para probar en localhost, nunca en producción.");
});
