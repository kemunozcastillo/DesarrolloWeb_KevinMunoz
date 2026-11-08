import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derivarScrypt = promisify(scrypt);

// Parámetros de scrypt: cuánta memoria y CPU cuesta calcular un hash. Lo
// bastante caro para que probar millones de claves sea lento, y lo bastante
// barato para que un login tarde una fracción de segundo.
const COSTO = { N: 16384, r: 8, p: 1 };
const LARGO = 64;

/**
 * La clave se mezcla con el pepper (un secreto que vive en Vault) antes de
 * pasar por scrypt. La sal es distinta para cada cuenta y se guarda junto al
 * hash; el pepper es uno solo y nunca se guarda con las cuentas. Si alguien
 * robara la base de cuentas, sin el pepper no podría ni empezar a probar
 * contraseñas.
 */
async function derivar(clave, sal, pepper, costo = COSTO) {
  const conPepper = createHmac("sha256", pepper).update(String(clave)).digest();
  return derivarScrypt(conPepper, sal, LARGO, { ...costo, maxmem: 64 * 1024 * 1024 });
}

/** Devuelve "scrypt$N$r$p$sal$hash", todo lo necesario para verificar después. */
export async function hashear(clave, pepper) {
  const sal = randomBytes(16);
  const hash = await derivar(clave, sal, pepper);
  return ["scrypt", COSTO.N, COSTO.r, COSTO.p, sal.toString("base64"), hash.toString("base64")].join("$");
}

export async function verificar(clave, guardado, pepper) {
  const partes = String(guardado).split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;

  const [, N, r, p, sal, hash] = partes;
  const esperado = Buffer.from(hash, "base64");
  const calculado = await derivar(clave, Buffer.from(sal, "base64"), pepper, { N: Number(N), r: Number(r), p: Number(p) });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/**
 * Hash de una clave cualquiera, para usarlo cuando la cuenta no existe.
 * Así un login con correo inexistente tarda lo mismo que uno con clave
 * incorrecta, y el tiempo de respuesta no delata qué correos existen.
 */
export const HASH_FICTICIO = `scrypt$${COSTO.N}$${COSTO.r}$${COSTO.p}$${randomBytes(16).toString("base64")}$${randomBytes(LARGO).toString("base64")}`;

/** Las mismas reglas que muestra el formulario del sitio. */
export function validarFortaleza(clave) {
  if (typeof clave !== "string" || clave.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (clave.length > 128) return "La contraseña puede tener hasta 128 caracteres.";
  if (!/[a-zA-Z]/.test(clave) || !/\d/.test(clave)) return "La contraseña debe combinar letras y números.";
  return null;
}

// --- Códigos de verificación de correo --------------------------------------------

export const nuevoCodigo = () => String(randomInt(100000, 1000000));
export const hashCodigo = (codigo) => createHash("sha256").update(String(codigo).trim()).digest("hex");

export function codigoCoincide(codigo, guardado) {
  const a = Buffer.from(hashCodigo(codigo));
  const b = Buffer.from(String(guardado ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
