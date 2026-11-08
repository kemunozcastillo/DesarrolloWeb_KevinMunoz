import { createHash, randomBytes } from "node:crypto";

/**
 * Almacén de sesiones en memoria.
 *
 * El token que recibe el cliente es aleatorio (256 bits) y no contiene
 * información: es solo una llave. Lo que significa (quién es, qué rol tiene,
 * cuándo vence) vive aquí, y por eso el gateway tiene que preguntar con
 * introspección. La ventaja: cerrar sesión o desactivar un usuario tiene
 * efecto inmediato, cosa que un token autocontenido como un JWT no permite.
 *
 * Se guarda el hash del token, no el token: si alguien leyera la memoria o un
 * respaldo del almacén, no obtendría tokens válidos.
 *
 * Una sesión vence por inactividad (cada uso la renueva) o al llegar a su
 * duración máxima, lo que ocurra primero.
 */
export function crearAlmacenSesiones({ inactividadSeg, maximaSeg, reloj = Date.now }) {
  const sesiones = new Map();
  const hashDe = (token) => createHash("sha256").update(String(token)).digest("hex");

  const vigente = (s, ahora) => ahora < s.venceMaximo && ahora < s.ultimaActividad + inactividadSeg * 1000;
  const vencimiento = (s) => Math.min(s.venceMaximo, s.ultimaActividad + inactividadSeg * 1000);

  function crear(usuario) {
    const token = randomBytes(32).toString("base64url");
    const ahora = reloj();
    const sesion = {
      usuarioId: usuario.id,
      usuario: usuario.usuario,
      nombre: usuario.nombre,
      rol: usuario.rol,
      creada: ahora,
      ultimaActividad: ahora,
      venceMaximo: ahora + maximaSeg * 1000,
    };
    sesiones.set(hashDe(token), sesion);
    return { token, sesion, vence: vencimiento(sesion), venceMaximo: sesion.venceMaximo };
  }

  /** Devuelve la sesión si sigue vigente, y la renueva; si no, null. */
  function usar(token) {
    const clave = hashDe(token);
    const sesion = sesiones.get(clave);
    if (!sesion) return null;

    const ahora = reloj();
    if (!vigente(sesion, ahora)) {
      sesiones.delete(clave);
      return null;
    }

    sesion.ultimaActividad = ahora;
    return { ...sesion, vence: vencimiento(sesion) };
  }

  const revocar = (token) => sesiones.delete(hashDe(token));

  function revocarDeUsuario(usuarioId) {
    for (const [clave, s] of sesiones) if (s.usuarioId === usuarioId) sesiones.delete(clave);
  }

  function limpiar() {
    const ahora = reloj();
    for (const [clave, s] of sesiones) if (!vigente(s, ahora)) sesiones.delete(clave);
  }

  return { crear, usar, revocar, revocarDeUsuario, limpiar, cantidad: () => sesiones.size };
}

/**
 * Bloqueo por intentos fallidos: tras varios errores seguidos con un mismo
 * usuario, se rechazan sus logins por unos minutos. Frena a quien intente
 * adivinar una contraseña probando muchas.
 */
export function crearControlIntentos({ maxIntentos, bloqueoSeg, reloj = Date.now }) {
  const registro = new Map();

  return {
    bloqueadoHasta(usuario) {
      const r = registro.get(usuario);
      return r?.bloqueadoHasta && reloj() < r.bloqueadoHasta ? r.bloqueadoHasta : null;
    },
    fallo(usuario) {
      const r = registro.get(usuario) ?? { fallidos: 0, bloqueadoHasta: null };
      r.fallidos += 1;
      if (r.fallidos >= maxIntentos) {
        r.bloqueadoHasta = reloj() + bloqueoSeg * 1000;
        r.fallidos = 0;
      }
      registro.set(usuario, r);
    },
    exito(usuario) {
      registro.delete(usuario);
    },
  };
}
