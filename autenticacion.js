import { createHash, timingSafeEqual } from "node:crypto";
import { ErrorVault } from "./vault.js";

/**
 * Compara dos secretos en tiempo constante. Con una comparación normal (===)
 * la respuesta tarda un poco más cuantos más caracteres iniciales coinciden,
 * y midiendo esos tiempos se podría adivinar el token de a poco. Se comparan
 * sus hash para que ambos tengan siempre el mismo largo.
 */
export function iguales(a, b) {
  const hash = (texto) => createHash("sha256").update(String(texto)).digest();
  return timingSafeEqual(hash(a), hash(b));
}

function rechazar(res, codigo, mensaje) {
  // El estándar de Bearer (RFC 6750) pide avisar con WWW-Authenticate qué falló.
  res.set("WWW-Authenticate", `Bearer realm="poke-fresh", error="${codigo}"`);
  res.status(401).json({ error: "NO_AUTORIZADO", mensaje, idPeticion: res.get("X-Request-Id") });
}

/**
 * Exige un Bearer Token válido.
 *
 *   1. Sin cabecera Authorization, o con otro formato: 401.
 *   2. Consulta en Vault el token vigente y la credencial interna.
 *   3. Token distinto al de Vault: 401.
 *   4. Token correcto: deja la credencial interna en la petición para que
 *      el proxy se la entregue al backend.
 *
 * Si Vault falla, la petición no pasa: sin poder verificar, no se deja entrar.
 */
export function exigirBearer(vault, config) {
  return async (req, res, next) => {
    const cabecera = req.get("authorization") ?? "";
    const coincidencia = /^Bearer\s+(\S+)$/i.exec(cabecera);

    if (!coincidencia) {
      return rechazar(res, "invalid_request", cabecera ? 'El formato debe ser "Authorization: Bearer <token>".' : "Falta el token. Envía la cabecera Authorization: Bearer <token>.");
    }

    try {
      const [tokenValido, credencialInterna] = await Promise.all([
        vault.leerValor(config.rutaSecretoGateway, "token_cliente"),
        vault.leerValor(config.rutaSecretoBackend, "credencial_interna"),
      ]);

      if (!iguales(coincidencia[1], tokenValido)) {
        return rechazar(res, "invalid_token", "El token no es válido.");
      }

      req.credencialInterna = credencialInterna;
      next();
    } catch (error) {
      if (!(error instanceof ErrorVault)) return next(error);

      console.error(`[${req.id}] Vault: ${error.message} (${error.detalle})`);
      const estado = error.tipo === "NO_DISPONIBLE" ? 502 : 500;
      res.status(estado).json({
        error: error.tipo === "NO_DISPONIBLE" ? "VAULT_NO_DISPONIBLE" : "VAULT_MAL_CONFIGURADO",
        mensaje: error.tipo === "NO_DISPONIBLE" ? "No se pudo validar el token: el gestor de secretos no está disponible." : "No se pudo validar el token por un error de configuración del gateway.",
        idPeticion: req.id,
      });
    }
  };
}
