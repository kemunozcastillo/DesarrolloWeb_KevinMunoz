/**
 * Vault simulado para las pruebas. Imita las rutas de la API HTTP de
 * HashiCorp Vault que usa este proyecto, con sus mismas respuestas:
 *
 *   GET/POST /v1/secret/data/<ruta>        motor KV versión 2
 *   PUT      /v1/sys/policies/acl/<nombre> políticas
 *   POST     /v1/auth/token/create         tokens con políticas
 *   GET      /v1/sys/health                estado (200, o 503 si está sellado)
 *
 * Aplica las políticas: un token solo lee las rutas que su política permite,
 * igual que el Vault real. Así las pruebas verifican también el mínimo privilegio.
 */

import express from "express";

export function crearVaultFalso({ tokenRaiz = "root" } = {}) {
  const app = express();
  const secretos = new Map();
  const politicas = new Map();
  const tokens = new Map([[tokenRaiz, { raiz: true, politicas: [] }]]);
  const estado = { sellado: false, lecturas: 0 };

  app.use(express.json());

  app.get("/v1/sys/health", (_req, res) => res.status(estado.sellado ? 503 : 200).json({ sealed: estado.sellado }));

  // Todo lo demás exige un token válido.
  app.use("/v1", (req, res, next) => {
    if (estado.sellado) return res.status(503).json({ errors: ["Vault is sealed"] });
    const token = tokens.get(req.get("x-vault-token"));
    if (!token) return res.status(403).json({ errors: ["permission denied"] });
    req.token = token;
    next();
  });

  /** ¿La política del token permite esta capacidad en esta ruta? */
  function permite(token, ruta, capacidad) {
    if (token.raiz) return true;
    return token.politicas.some((nombre) => {
      const texto = politicas.get(nombre) ?? "";
      const bloques = [...texto.matchAll(/path\s+"([^"]+)"\s*\{[^}]*capabilities\s*=\s*\[([^\]]*)\]/g)];
      return bloques.some(([, camino, caps]) => camino === ruta && caps.includes(`"${capacidad}"`));
    });
  }

  app.get("/v1/secret/data/*", (req, res) => {
    const ruta = req.params[0];
    if (!permite(req.token, `secret/data/${ruta}`, "read")) return res.status(403).json({ errors: ["permission denied"] });
    estado.lecturas += 1;
    if (!secretos.has(ruta)) return res.status(404).json({ errors: [] });
    res.json({ data: { data: secretos.get(ruta), metadata: { version: 1 } } });
  });

  app.post("/v1/secret/data/*", (req, res) => {
    const ruta = req.params[0];
    if (!permite(req.token, `secret/data/${ruta}`, "create")) return res.status(403).json({ errors: ["permission denied"] });
    secretos.set(ruta, req.body.data);
    res.json({ data: { version: 1 } });
  });

  app.put("/v1/sys/policies/acl/:nombre", (req, res) => {
    if (!req.token.raiz) return res.status(403).json({ errors: ["permission denied"] });
    politicas.set(req.params.nombre, req.body.policy);
    res.status(204).end();
  });

  app.post("/v1/auth/token/create", (req, res) => {
    if (!req.token.raiz) return res.status(403).json({ errors: ["permission denied"] });
    const nuevo = `hvs.${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    tokens.set(nuevo, { raiz: false, politicas: req.body.policies ?? [] });
    res.json({ auth: { client_token: nuevo, policies: req.body.policies } });
  });

  return {
    app,
    estado,
    escribir: (ruta, datos) => secretos.set(ruta, datos),
    leer: (ruta) => secretos.get(ruta),
  };
}
