import { crearApp } from "./app.js";
import { leerConfig } from "./config.js";

// Carga el .env si existe. Sin él, se usan las variables del sistema o los
// valores por defecto de config.js.
try {
  process.loadEnvFile();
} catch {
  /* sin .env: no pasa nada */
}

const config = leerConfig();
const app = crearApp(config);

app.listen(config.puerto, () => {
  console.log(`Gateway en http://localhost:${config.puerto}/api`);
  console.log(`  /api/v1/menu    -> ${config.urlApiRest}/items`);
  console.log(`  /api/v1/graphql -> ${config.urlApiGraphql}/graphql`);
  console.log(`  Orígenes permitidos: ${config.origenesPermitidos.join(", ") || "ninguno"}`);
});
