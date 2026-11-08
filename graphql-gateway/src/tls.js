import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

/**
 * HTTPS cuando hay certificado (TLS_CERT y TLS_KEY); HTTP si no (pruebas y
 * entorno local sin Docker). Los clientes de este servicio confían en la CA
 * de prueba mediante NODE_EXTRA_CA_CERTS, así que no hace falta tocar fetch.
 */
export function crearServidor(app, config) {
  if (!config.tlsCert) return http.createServer(app);
  return https.createServer({ cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey), minVersion: "TLSv1.2" }, app);
}
