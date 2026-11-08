/**
 * Cuentas y sesión, a través de la API.
 *
 * La sesión la lleva el servidor: el gateway guarda un token opaco en una
 * cookie HttpOnly y el Auth Service decide si sigue vigente (30 minutos sin
 * actividad, 8 horas como máximo). Aquí solo se guarda en memoria quién es
 * el usuario, para pintar la cabecera y decidir qué rutas mostrar. Que el
 * botón de una sección no aparezca es comodidad; el permiso real lo revisan
 * el gateway y cada servicio.
 *
 * Perfiles internos:
 *   ADMIN     administrador: mantenedores, pedidos y reportes
 *   DUENO     dueño: reportes de ventas y productos
 *   COCINA    cocina: acepta los pedidos pagados y los marca listos
 *   DESPACHO  encargado de despacho: asigna chofer y registra la entrega
 * Los clientes solo acceden a la tienda y a sus pedidos.
 */

PF.cuentas = (function () {
  const { ErrorDatos } = PF.datos;
  const error = (mensaje, codigo = "BAD_USER_INPUT") => new ErrorDatos(mensaje, codigo);
  const api = PF.api;

  const PERFILES = {
    ADMIN: "Administrador",
    DUENO: "Dueño",
    COCINA: "Cocina",
    DESPACHO: "Encargado de despacho",
  };

  const MINUTOS_SESION = 30;
  const SEXOS = { F: "Femenino", M: "Masculino", O: "Otro", N: "Prefiero no decirlo" };

  // -------------------------------------------------------------------------
  // Validaciones del formulario (el servidor las vuelve a hacer)
  // -------------------------------------------------------------------------

  function normalizarRun(valor) {
    const limpio = String(valor ?? "").replace(/[.\s]/g, "").toUpperCase();
    const coincidencia = /^(\d{7,8})-?([\dK])$/.exec(limpio);
    return coincidencia ? `${coincidencia[1]}-${coincidencia[2]}` : null;
  }

  function runValido(valor) {
    const run = normalizarRun(valor);
    if (!run) return false;
    const [cuerpo, dv] = run.split("-");
    let suma = 0;
    let factor = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
      suma += Number(cuerpo[i]) * factor;
      factor = factor === 7 ? 2 : factor + 1;
    }
    const resto = 11 - (suma % 11);
    return dv === (resto === 11 ? "0" : resto === 10 ? "K" : String(resto));
  }

  function formatearRun(valor) {
    const run = normalizarRun(valor);
    if (!run) return valor;
    const [cuerpo, dv] = run.split("-");
    return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
  }

  const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const TELEFONO_VALIDO = /^\+?56\s?9\s?\d{4}\s?\d{4}$|^9\s?\d{4}\s?\d{4}$/;

  function validarClave(clave) {
    if (String(clave).length < 8) throw error("La contraseña debe tener al menos 8 caracteres.");
    if (!/[a-zA-Z]/.test(clave) || !/\d/.test(clave)) throw error("La contraseña debe combinar letras y números.");
  }

  // -------------------------------------------------------------------------
  // "Correo simulado" (solo en modo demo)
  // -------------------------------------------------------------------------

  /**
   * En modo demo el backend devuelve el código de verificación para mostrarlo
   * en pantalla como si hubiera llegado por correo. Se guarda en
   * sessionStorage solo mientras dura la pestaña. Fuera del modo demo el
   * backend no lo devuelve y esta bandeja queda vacía.
   */
  function guardarCodigo(email, codigo) {
    if (!codigo) return;
    try {
      const bandeja = JSON.parse(sessionStorage.getItem("pokefresh:bandeja") ?? "{}");
      bandeja[String(email).toLowerCase()] = codigo;
      sessionStorage.setItem("pokefresh:bandeja", JSON.stringify(bandeja));
    } catch {
      /* sin storage no se muestra el correo simulado */
    }
  }

  function codigoSimulado(email) {
    try {
      return JSON.parse(sessionStorage.getItem("pokefresh:bandeja") ?? "{}")[String(email).toLowerCase()] ?? null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Clientes
  // -------------------------------------------------------------------------

  async function registrarCliente(datos, { origen = "WEB" } = {}) {
    if (origen === "WEB") validarClave(datos.clave);
    const r = origen === "ADMIN" ? await api.post("/clientes", datos) : await api.post("/clientes/registro", datos);
    guardarCodigo(r.cliente.email, r.codigoDemo);
    return { cliente: r.cliente, codigo: r.codigoDemo, claveTemporal: r.claveTemporal ?? null };
  }

  async function verificarCorreo(email, codigo) {
    await api.post("/auth/verificar", { email, codigo: String(codigo).trim() });
  }

  async function reenviarCodigo(email) {
    const r = await api.post("/auth/reenviar", { email });
    guardarCodigo(email, r.codigoDemo);
    return r.codigoDemo;
  }

  async function cambiarClaveCliente(_id, actual, nueva) {
    validarClave(nueva);
    await api.put("/auth/clave", { actual, nueva });
  }

  /** El cliente edita su propia ficha; el administrador, la de cualquiera. */
  async function actualizarCliente(id, datos) {
    const propia = sesion?.tipo === "CLIENTE";
    const r = await api.put(propia ? "/clientes/yo" : `/clientes/${encodeURIComponent(id)}`, datos);
    if (r.cambioCorreo) guardarCodigo(r.cliente.email, r.codigoDemo);
    return { cliente: r.cliente, codigo: r.cambioCorreo ? r.codigoDemo ?? "enviado" : null };
  }

  const cambiarEstadoCliente = (id, activo) => api.patch(`/clientes/${encodeURIComponent(id)}/estado`, { activo });
  const listarClientes = (q = "") => api.get("/clientes", { q });

  async function obtenerCliente(id) {
    try {
      return sesion?.tipo === "CLIENTE" ? await api.get("/clientes/yo") : await api.get(`/clientes/${encodeURIComponent(id)}`);
    } catch (fallo) {
      if (fallo.estado === 404) return null;
      throw fallo;
    }
  }

  // -------------------------------------------------------------------------
  // Usuarios internos (administrador)
  // -------------------------------------------------------------------------

  const aPerfil = (u) => ({ ...u, perfil: u.rol.toUpperCase() });
  const listarUsuarios = async () => (await api.get("/usuarios")).map(aPerfil);
  const obtenerUsuario = async (id) => (await listarUsuarios()).find((u) => u.id === id) ?? null;

  async function crearUsuario(datos) {
    validarClave(datos.clave);
    return aPerfil(await api.post("/usuarios", { nombre: datos.nombre, email: datos.email, rol: String(datos.perfil).toLowerCase(), clave: datos.clave }));
  }

  async function actualizarUsuario(id, datos) {
    const cuerpo = { nombre: datos.nombre, email: datos.email, rol: String(datos.perfil).toLowerCase() };
    if (datos.clave) cuerpo.clave = datos.clave;
    return aPerfil(await api.put(`/usuarios/${encodeURIComponent(id)}`, cuerpo));
  }

  const cambiarEstadoUsuario = async (id, activo) => aPerfil(await api.patch(`/usuarios/${encodeURIComponent(id)}/estado`, { activo }));

  // -------------------------------------------------------------------------
  // Sesión
  // -------------------------------------------------------------------------

  let sesion = null;
  let vencio = false;
  const suscriptores = new Set();
  const notificar = () => suscriptores.forEach((funcion) => funcion(sesion));
  const alCambiarSesion = (funcion) => suscriptores.add(funcion);

  /** Pregunta al servidor si hay una sesión abierta (al abrir el sitio). */
  async function cargarSesion() {
    try {
      sesion = await api.get("/auth/sesion");
    } catch {
      sesion = null;
    }
    notificar();
    return sesion;
  }

  async function ingresar(email, clave) {
    sesion = await api.post("/auth/login", { email: String(email).trim(), clave });
    vencio = false;
    notificar();
    return sesion;
  }

  async function salir() {
    try {
      await api.post("/auth/logout");
    } finally {
      sesion = null;
      notificar();
    }
  }

  const sesionActual = () => sesion;

  /** El servidor renueva la sesión con cada petición; aquí no hay nada que hacer. */
  const renovarSesion = () => {};

  /** Indica una sola vez si la última sesión se cerró por inactividad. */
  function sesionVencio() {
    const valor = vencio;
    vencio = false;
    return valor;
  }

  // Si una petición responde 401 con sesión abierta, la sesión murió en el servidor.
  api.siSePierdeLaSesion(() => {
    if (!sesion) return;
    sesion = null;
    vencio = true;
    notificar();
    const actual = location.hash.replace(/^#/, "") || "/";
    PF.router.navegar(`/ingresar?volver=${encodeURIComponent(actual)}`, { reemplazar: true });
  });

  return {
    PERFILES,
    SEXOS,
    MINUTOS_SESION,
    runValido,
    normalizarRun,
    formatearRun,
    validarClave,
    EMAIL_VALIDO,
    TELEFONO_VALIDO,
    registrarCliente,
    verificarCorreo,
    reenviarCodigo,
    codigoSimulado,
    cambiarClaveCliente,
    actualizarCliente,
    cambiarEstadoCliente,
    listarClientes,
    obtenerCliente,
    crearUsuario,
    actualizarUsuario,
    cambiarEstadoUsuario,
    listarUsuarios,
    obtenerUsuario,
    cargarSesion,
    ingresar,
    salir,
    sesionActual,
    renovarSesion,
    sesionVencio,
    alCambiarSesion,
  };
})();
