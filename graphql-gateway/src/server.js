import { crearApp } from "./app.js";
import { leerConfig } from "./config.js";

const config = leerConfig();
if (!config.vaultToken) {
  console.error("Falta el token de Vault (VAULT_TOKEN o VAULT_TOKEN_ARCHIVO).");
  process.exit(1);
}

const app = await crearApp(config);
const servidor = app.listen(config.puerto, config.host, () => console.log(`GraphQL Gateway en http://${config.host}:${config.puerto}/graphql`));
process.on("SIGTERM", () => servidor.close(() => process.exit(0)));
