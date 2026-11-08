/**
 * Matriz de rutas del API Gateway: la única puerta del navegador al backend.
 *
 * Cada fila dice qué método y ruta pública existe, a qué servicio privado va,
 * con qué ruta, y quién puede usarla:
 *   "publico"  sin sesión (si hay sesión, igual se informa quién es)
 *   "sesion"   cualquier usuario con sesión
 *   [roles]    solo esos roles
 *
 * Lo que no está en esta tabla no existe hacia afuera (404). Las rutas
 * /internos/* de los servicios nunca se publican.
 *
 * El gateway hace el control grueso (rol). La regla fina (que un cliente solo
 * vea SUS pedidos, qué campos ve cocina) la aplica el servicio dueño del dato.
 */

const PERSONAL = ["admin", "dueno", "cocina", "despacho"];
const TODOS = ["cliente", ...PERSONAL];

export const RUTAS = [
  // Catálogo e inventario
  ["GET", "/catalogo/items", "inventario", "/items", "publico"],
  ["GET", "/catalogo/items/:id", "inventario", "/items/:id", "publico"],
  ["GET", "/catalogo/configuracion", "inventario", "/configuracion", "publico"],
  ["POST", "/catalogo/items", "inventario", "/items", ["admin", "dueno"]],
  ["PUT", "/catalogo/items/:id", "inventario", "/items/:id", ["admin", "dueno"]],
  ["DELETE", "/catalogo/items/:id", "inventario", "/items/:id", ["admin"]],

  // Clientes
  ["POST", "/clientes/registro", "clientes", "/clientes/registro", "publico"],
  ["GET", "/clientes/yo", "clientes", "/clientes/yo", ["cliente"]],
  ["PUT", "/clientes/yo", "clientes", "/clientes/yo", ["cliente"]],
  ["GET", "/clientes", "clientes", "/clientes", ["admin"]],
  ["POST", "/clientes", "clientes", "/clientes", ["admin"]],
  ["GET", "/clientes/:id", "clientes", "/clientes/:id", ["admin"]],
  ["PUT", "/clientes/:id", "clientes", "/clientes/:id", ["admin"]],
  ["PATCH", "/clientes/:id/estado", "clientes", "/clientes/:id/estado", ["admin"]],

  // Pedidos
  ["POST", "/pedidos", "pedidos", "/pedidos", ["cliente"]],
  ["GET", "/pedidos", "pedidos", "/pedidos", TODOS],
  ["GET", "/pedidos/configuracion", "pedidos", "/pedidos-config", TODOS],
  ["GET", "/pedidos/boleta/:numero", "pedidos", "/pedidos/boleta/:numero", ["cliente", "admin", "dueno"]],
  ["GET", "/pedidos/:id", "pedidos", "/pedidos/:id", TODOS],
  ["POST", "/pedidos/:id/aceptar", "pedidos", "/pedidos/:id/aceptar", ["admin", "cocina"]],
  ["POST", "/pedidos/:id/terminar", "pedidos", "/pedidos/:id/terminar", ["admin", "cocina"]],
  ["POST", "/pedidos/:id/despachar", "pedidos", "/pedidos/:id/despachar", ["admin", "despacho"]],
  ["POST", "/pedidos/:id/entregar", "pedidos", "/pedidos/:id/entregar", ["admin", "despacho"]],
  ["POST", "/pedidos/:id/impresa", "pedidos", "/pedidos/:id/impresa", ["admin", "cocina", "despacho"]],
  ["POST", "/pedidos/:id/anular", "pedidos", "/pedidos/:id/anular", ["cliente", "admin"]],
  ["GET", "/reportes/ventas", "pedidos", "/reportes/ventas", ["admin", "dueno"]],

  // Pagos. La notificación no lleva sesión: la valida pagos con la firma HMAC de la pasarela.
  ["POST", "/pagos", "pagos", "/pagos", ["cliente"]],
  ["GET", "/pagos", "pagos", "/pagos", ["cliente", "admin", "dueno"]],
  ["POST", "/pagos/notificacion", "pagos", "/pagos/notificacion", "webhook"],

  // Agregaciones
  ["POST", "/graphql", "graphql", "/graphql", "sesion"],

  // Cuentas (Auth Service)
  ["POST", "/auth/verificar", "auth", "/verificacion", "publico"],
  ["POST", "/auth/reenviar", "auth", "/verificacion/reenviar", "publico"],
  ["GET", "/usuarios", "auth", "/usuarios", ["admin"]],
  ["POST", "/usuarios", "auth", "/usuarios", ["admin"]],
  ["PUT", "/usuarios/:id", "auth", "/usuarios/:id", ["admin"]],
  ["PATCH", "/usuarios/:id/estado", "auth", "/usuarios/:id/estado", ["admin"]],
].map(([metodo, patron, destino, rutaDestino, acceso]) => ({ metodo, patron, destino, rutaDestino, acceso, ...compilar(patron) }));

function compilar(patron) {
  const claves = [];
  const fuente = patron.replace(/:([a-zA-Z]+)/g, (_c, clave) => {
    claves.push(clave);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${fuente}/?$`), claves };
}

/** Busca la ruta. Devuelve { ruta, destinoRuta } o { existeOtroMetodo } o null. */
export function resolver(metodo, ruta) {
  let otroMetodo = false;
  for (const r of RUTAS) {
    const m = r.regex.exec(ruta);
    if (!m) continue;
    if (r.metodo !== metodo) {
      otroMetodo = true;
      continue;
    }
    let destinoRuta = r.rutaDestino;
    r.claves.forEach((clave, i) => {
      destinoRuta = destinoRuta.replace(`:${clave}`, encodeURIComponent(decodeURIComponent(m[i + 1])));
    });
    return { ruta: r, destinoRuta };
  }
  return otroMetodo ? { existeOtroMetodo: true } : null;
}

export function permitido(acceso, usuario) {
  if (acceso === "publico" || acceso === "webhook") return true;
  if (!usuario) return false;
  if (acceso === "sesion") return true;
  return acceso.includes(usuario.rol);
}
