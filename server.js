import { crearApp } from "./app.js";
import { leerConfig } from "./config.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const config = leerConfig();

if (!config.vaultToken) {
  console.error("Falta VAULT_TOKEN en el .env: el Auth Service necesita Vault para validar contraseñas.");
  process.exit(1);
}

crearApp(config).listen(config.puerto, "127.0.0.1", () => {
  console.log(`Auth Service en http://127.0.0.1:${config.puerto} (solo accesible desde este equipo)`);
  console.log(`  Sesiones: ${config.sesionInactividadSeg / 60} min de inactividad, ${config.sesionMaximaSeg / 3600} h como máximo`);
});
