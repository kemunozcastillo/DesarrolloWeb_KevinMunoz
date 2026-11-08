import { crearApp } from "./app.js";
import { leerConfig } from "./config.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const config = leerConfig();

if (!config.vaultToken) {
  console.error("Falta el token de Vault (VAULT_TOKEN o VAULT_TOKEN_ARCHIVO): el gateway lo necesita para leer las credenciales internas.");
  process.exit(1);
}

const servidor = crearApp(config).listen(config.puerto, config.host, () => {
  console.log(`API Gateway en http://${config.host}:${config.puerto}`);
  console.log(`  Frontend: ${config.dirFrontend}`);
  console.log(`  Cookie Secure: ${config.cookieSecure ? "sí" : "no (solo para localhost)"}`);
});

process.on("SIGTERM", () => servidor.close(() => process.exit(0)));
