/**
 * Cliente de la API. Todo pasa por el API Gateway, en el mismo origen que la
 * página (/api/v1): la cookie de sesión es HttpOnly y viaja sola, así que
 * este código nunca ve ni guarda el token.
 *
 * Ningún secreto vive en el navegador. El precio de un pedido, la
 * confirmación de un pago y los permisos los decide el backend: aquí solo se
 * muestran los resultados.
 */

PF.api = (function () {
  const BASE = "/api/v1";

  class ErrorApi extends Error {
    constructor(mensaje, codigo, estado) {
      super(mensaje);
      this.codigo = codigo;
      this.estado = estado;
    }
  }

  /** Lo llama cuentas.js: qué hacer si una petición descubre que la sesión murió. */
  let alPerderSesion = () => {};
  const siSePierdeLaSesion = (funcion) => (alPerderSesion = funcion);

  /** Clave de idempotencia para operaciones que no deben repetirse (crear pedido, pagar). */
  const claveIdempotencia = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  async function pedir(metodo, ruta, { cuerpo, consulta, cabeceras = {} } = {}) {
    const qs = consulta ? `?${new URLSearchParams(Object.entries(consulta).filter(([, v]) => v !== undefined && v !== null && v !== ""))}` : "";
    let respuesta;
    try {
      respuesta = await fetch(`${BASE}${ruta}${qs}`, {
        method: metodo,
        credentials: "same-origin",
        headers: { Accept: "application/json", ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}), ...cabeceras },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      });
    } catch {
      throw new ErrorApi("No pudimos conectarnos con el servidor. Revisa tu conexión.", "SIN_CONEXION", 0);
    }

    const datos = respuesta.status === 204 ? null : await respuesta.json().catch(() => null);
    if (respuesta.ok) return datos;

    const codigo = datos?.codigo ?? `HTTP_${respuesta.status}`;
    if (respuesta.status === 401 && ruta !== "/auth/login" && ruta !== "/auth/sesion") alPerderSesion(codigo);
    throw new ErrorApi(datos?.mensaje ?? "Ocurrió un error. Intenta de nuevo.", codigo, respuesta.status);
  }

  /**
   * Consulta GraphQL. Devuelve `data` y deja los errores parciales en
   * `errores` (por ejemplo, si el servicio de pagos no respondió, el resto
   * del resumen llega igual).
   */
  async function graphql(query, variables = {}) {
    const r = await pedir("POST", "/graphql", { cuerpo: { query, variables } });
    return { datos: r?.data ?? null, errores: r?.errors ?? [] };
  }

  return {
    ErrorApi,
    pedir,
    graphql,
    claveIdempotencia,
    siSePierdeLaSesion,
    get: (ruta, consulta) => pedir("GET", ruta, { consulta }),
    post: (ruta, cuerpo, opciones = {}) => pedir("POST", ruta, { cuerpo, ...opciones }),
    put: (ruta, cuerpo) => pedir("PUT", ruta, { cuerpo }),
    patch: (ruta, cuerpo) => pedir("PATCH", ruta, { cuerpo }),
    eliminar: (ruta) => pedir("DELETE", ruta),
  };
})();
