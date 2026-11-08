/**
 * Vault simulado para correr el sistema sin Docker (solo pruebas locales).
 * Usa el mismo Vault falso de las pruebas del gateway, que aplica políticas
 * y tokens, más las rutas de inicialización y desbloqueo que usa
 * vault/iniciar.js. Así el script real de inicialización corre contra él.
 */
import express from "express";
import { crearVaultFalso } from "./vault-falso.js";

const puerto = Number(process.env.PORT ?? 8200);
const vault = crearVaultFalso({ tokenRaiz: "raiz-local" });
const estado = { iniciado: false, sellado: true };

const app = express();
app.use(express.json());
app.get("/v1/sys/init", (_req, res) => res.json({ initialized: estado.iniciado }));
app.put("/v1/sys/init", (_req, res) => {
  estado.iniciado = true;
  res.json({ keys_base64: ["clave-local"], root_token: "raiz-local" });
});
app.get("/v1/sys/seal-status", (_req, res) => res.json({ sealed: estado.sellado, initialized: estado.iniciado }));
app.put("/v1/sys/unseal", (_req, res) => {
  estado.sellado = false;
  res.json({ sealed: false });
});
app.get("/v1/sys/mounts", (_req, res) => res.json({ "secret/": { type: "kv", options: { version: "2" } } }));
app.post("/v1/_sellar", (req, res) => {
  vault.estado.sellado = Boolean(req.body?.sellado);
  res.json({ sellado: vault.estado.sellado });
});
app.use(vault.app);
app.listen(puerto, "127.0.0.1", () => console.log(`Vault simulado en http://127.0.0.1:${puerto}`));
