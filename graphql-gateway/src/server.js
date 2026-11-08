import { crearApp } from "./app.js";
import { leerConfig } from "./config.js";
import { crearServidor } from "./tls.js";

const config = leerConfig();
if (!config.vaultToken) {
  console.error("Falta el token de Vault (VAULT_TOKEN o VAULT_TOKEN_ARCHIVO).");
  process.exit(1);
}

const app = await crearApp(config);
const servidor = crearServidor(app, config).listen(config.puerto, config.host, () =>
  console.log(`GraphQL Gateway en ${config.tlsCert ? "https" : "http"}://${config.host}:${config.puerto}/graphql`),
);
process.on("SIGTERM", () => servidor.close(() => process.exit(0)));
