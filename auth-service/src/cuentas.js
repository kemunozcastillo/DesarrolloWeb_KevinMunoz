import { randomUUID } from "node:crypto";

/**
 * Cuentas: correo, nombre, rol, a quién representan y el hash de la clave.
 * La contraseña nunca se guarda; tampoco el código de verificación (solo su hash).
 *
 * Roles:
 *   cliente   compra en la tienda; `sujetoId` es su id en el servicio de clientes
 *   admin, dueno, cocina, despacho   personal del restaurante
 */
export const ROLES_PERSONAL = ["admin", "dueno", "cocina", "despacho"];
export const ROLES = [...ROLES_PERSONAL, "cliente"];

export class ErrorCuenta extends Error {
  constructor(estado, codigo, mensaje) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

const normalizar = (email) => String(email ?? "").trim().toLowerCase();

/** Lo que se puede mostrar de una cuenta: sin hash ni datos de verificación. */
export const publica = ({ _id, hash, verificacion, ...resto }) => ({ id: _id, ...resto });

/** Repositorio sobre MongoDB (base pf_auth, colección cuentas). */
export function repositorioMongo(db) {
  const c = db.collection("cuentas");

  return {
    async preparar() {
      await c.createIndex({ email: 1 }, { unique: true });
      await c.createIndex({ sujetoId: 1 }, { unique: true, sparse: true });
      await c.createIndex({ rol: 1 });
    },
    porEmail: (email) => c.findOne({ email: normalizar(email) }),
    porId: (id) => c.findOne({ _id: id }),
    porSujeto: (sujetoId) => c.findOne({ sujetoId }),
    listar: (filtro = {}) => c.find(filtro).sort({ nombre: 1 }).limit(1000).toArray(),
    cantidad: () => c.countDocuments({}),
    async crear(datos) {
      const doc = { _id: randomUUID(), ...datos, email: normalizar(datos.email), creadoEn: new Date().toISOString() };
      try {
        await c.insertOne(doc);
      } catch (error) {
        if (error.code === 11000) throw new ErrorCuenta(409, "DUPLICADO", "Ese correo ya está en uso.");
        throw error;
      }
      return doc;
    },
    async actualizar(id, cambios) {
      try {
        await c.updateOne({ _id: id }, { $set: cambios });
      } catch (error) {
        if (error.code === 11000) throw new ErrorCuenta(409, "DUPLICADO", "Ese correo ya está en uso.");
        throw error;
      }
      return c.findOne({ _id: id });
    },
  };
}

/** Mismo contrato en memoria, para las pruebas. */
export function repositorioMemoria() {
  const cuentas = new Map();
  const copia = (x) => (x ? structuredClone(x) : null);
  const buscar = (fn) => copia([...cuentas.values()].find(fn) ?? null);

  return {
    async preparar() {},
    porEmail: async (email) => buscar((x) => x.email === normalizar(email)),
    porId: async (id) => copia(cuentas.get(id)),
    porSujeto: async (sujetoId) => buscar((x) => x.sujetoId === sujetoId),
    listar: async (filtro = {}) =>
      [...cuentas.values()]
        .filter((x) => Object.entries(filtro).every(([k, v]) => (v?.$in ? v.$in.includes(x[k]) : x[k] === v)))
        .map(copia),
    cantidad: async () => cuentas.size,
    async crear(datos) {
      const doc = { _id: randomUUID(), ...datos, email: normalizar(datos.email), creadoEn: new Date().toISOString() };
      if ([...cuentas.values()].some((x) => x.email === doc.email)) throw new ErrorCuenta(409, "DUPLICADO", "Ese correo ya está en uso.");
      cuentas.set(doc._id, doc);
      return copia(doc);
    },
    async actualizar(id, cambios) {
      if (cambios.email && [...cuentas.values()].some((x) => x.email === cambios.email && x._id !== id)) {
        throw new ErrorCuenta(409, "DUPLICADO", "Ese correo ya está en uso.");
      }
      Object.assign(cuentas.get(id), structuredClone(cambios));
      return copia(cuentas.get(id));
    },
  };
}
