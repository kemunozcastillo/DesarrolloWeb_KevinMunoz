import { hashear } from "./claves.js";

/**
 * Cuentas de prueba (modo demo). Las fichas de estos clientes las crea el
 * script de datos de ejemplo de los servicios (servicios/scripts/semilla.py)
 * con los mismos ids (cli_demo_1, ...).
 *
 * Son credenciales de demostración documentadas en el README, no secretos:
 * en producción MODO_DEMO=false y estas cuentas no se crean.
 */
export const PERSONAL_DEMO = [
  { nombre: "Camila Rojas", email: "admin@pokefresh.cl", clave: "Admin2026", rol: "admin" },
  { nombre: "Tomás Fuentes", email: "dueno@pokefresh.cl", clave: "Dueno2026", rol: "dueno" },
  { nombre: "Francisca Lagos", email: "cocina@pokefresh.cl", clave: "Cocina2026", rol: "cocina" },
  { nombre: "Matías Pérez", email: "despacho@pokefresh.cl", clave: "Despacho2026", rol: "despacho" },
];

export const CLIENTES_DEMO = [
  { sujetoId: "cli_demo_1", nombre: "Javiera Morales Díaz", email: "cliente@correo.cl", clave: "Cliente2026" },
  { sujetoId: "cli_demo_2", nombre: "Benjamín Castro Vera", email: "benjamin.castro@correo.cl", clave: "Clave2026" },
  { sujetoId: "cli_demo_3", nombre: "Fernanda Silva Rojas", email: "fernanda.silva@correo.cl", clave: "Clave2026" },
  { sujetoId: "cli_demo_4", nombre: "Diego Araya Pinto", email: "diego.araya@correo.cl", clave: "Clave2026" },
  { sujetoId: "cli_demo_5", nombre: "Catalina Núñez León", email: "catalina.nunez@correo.cl", clave: "Clave2026" },
  { sujetoId: "cli_demo_6", nombre: "Ignacio Herrera Mora", email: "ignacio.herrera@correo.cl", clave: "Clave2026" },
];

/** Crea las cuentas de prueba si no hay ninguna cuenta. */
export async function crearCuentasDemo(cuentas, pepper) {
  if ((await cuentas.cantidad()) > 0) return 0;
  for (const p of PERSONAL_DEMO) {
    await cuentas.crear({ nombre: p.nombre, email: p.email, rol: p.rol, hash: await hashear(p.clave, pepper), activo: true, emailVerificado: true });
  }
  for (const c of CLIENTES_DEMO) {
    await cuentas.crear({ nombre: c.nombre, email: c.email, rol: "cliente", sujetoId: c.sujetoId, hash: await hashear(c.clave, pepper), activo: true, emailVerificado: true });
  }
  return PERSONAL_DEMO.length + CLIENTES_DEMO.length;
}
