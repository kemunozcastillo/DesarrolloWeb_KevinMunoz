import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derivarScrypt = promisify(scrypt);

// Parámetros de scrypt: cuánta memoria y CPU cuesta calcular un hash. Lo
// bastante caro para que probar millones de claves sea lento, y lo bastante
// barato para que un login tarde una fracción de segundo.
const COSTO = { N: 16384, r: 8, p: 1 };
const LARGO = 64;

/**
 * La clave se mezcla con el pepper (un secreto que vive en Vault) antes de
 * pasar por scrypt. La sal es distinta para cada usuario y se guarda junto al
 * hash; el pepper es uno solo y nunca se guarda con los usuarios. Si alguien
 * robara el archivo de usuarios, sin el pepper no podría ni empezar a probar
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
 * Hash de una clave cualquiera, para usarlo cuando el usuario no existe.
 * Así un login con usuario inexistente tarda lo mismo que uno con clave
 * incorrecta, y el tiempo de respuesta no delata qué usuarios existen.
 */
export const HASH_FICTICIO = `scrypt$${COSTO.N}$${COSTO.r}$${COSTO.p}$${randomBytes(16).toString("base64")}$${randomBytes(LARGO).toString("base64")}`;

export function validarFortaleza(clave) {
  if (String(clave).length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (!/[a-zA-Z]/.test(clave) || !/\d/.test(clave)) return "La contraseña debe combinar letras y números.";
  return null;
}
