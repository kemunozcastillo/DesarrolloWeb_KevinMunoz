/**
 * Cuentas del sistema: clientes, usuarios internos y sesión.
 *
 * Perfiles internos (usuarios del restaurante). El cajero virtual del caso
 * no es una persona: es el sistema, que registra la venta y emite la boleta
 * cuando la plataforma de pago confirma.
 *   ADMIN     administrador: mantenedores, pedidos y reportes
 *   DUENO     dueño: reportes de ventas y productos
 *   COCINA    cocina: acepta los pedidos pagados y los marca listos
 *   DESPACHO  encargado de despacho: asigna chofer y registra la entrega
 * Los clientes tienen su propia ficha y solo acceden a la tienda y a sus pedidos.
 *
 * Importante: esto es una simulación en el navegador. Las claves se guardan
 * con hash y sal, y la sesión expira por inactividad, pero todo vive en
 * localStorage: cualquiera con acceso al navegador puede leerlo. En un
 * sistema real estas reglas corren en el servidor.
 */

PF.cuentas = (function () {
  const { ErrorDatos, leer, guardar } = PF.datos;
  const error = (mensaje, codigo = "BAD_USER_INPUT") => new ErrorDatos(mensaje, codigo);

  const PERFILES = {
    ADMIN: "Administrador",
    DUENO: "Dueño",
    COCINA: "Cocina",
    DESPACHO: "Encargado de despacho",
  };

  const MINUTOS_SESION = 30;
  const MAX_INTENTOS = 5;
  const MINUTOS_BLOQUEO = 5;

  // -------------------------------------------------------------------------
  // Hash de claves
  // -------------------------------------------------------------------------

  /**
   * SHA-256 en JavaScript puro. Se usa solo si el navegador no expone
   * crypto.subtle (algunos lo restringen al abrir la página desde el disco).
   * Las constantes se derivan de los primos, como indica el estándar.
   */
  function sha256Js(texto) {
    const primos = [];
    for (let n = 2; primos.length < 64; n++) if (primos.every((p) => n % p)) primos.push(n);
    const fraccion = (x) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
    const K = primos.map((p) => fraccion(Math.cbrt(p)));
    const H = primos.slice(0, 8).map((p) => fraccion(Math.sqrt(p)));

    const bytes = [...new TextEncoder().encode(texto)];
    const largoBits = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (largoBits >>> (i * 8)) & 0xff);

    const rotar = (x, n) => (x >>> n) | (x << (32 - n));

    for (let bloque = 0; bloque < bytes.length; bloque += 64) {
      const w = new Array(64);
      for (let i = 0; i < 16; i++) {
        const j = bloque + i * 4;
        w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotar(w[i - 15], 7) ^ rotar(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotar(w[i - 2], 17) ^ rotar(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }

      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotar(e, 6) ^ rotar(e, 11) ^ rotar(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotar(a, 2) ^ rotar(a, 13) ^ rotar(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => (H[i] = (H[i] + v) >>> 0));
    }

    return H.map((v) => v.toString(16).padStart(8, "0")).join("");
  }

  async function sha256(texto) {
    if (window.crypto?.subtle) {
      try {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch {
        /* se usa la versión en JavaScript */
      }
    }
    return sha256Js(texto);
  }

  const nuevaSal = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

  async function hashClave(clave, sal) {
    return sha256(`${sal}:${clave}`);
  }

  // -------------------------------------------------------------------------
  // Validaciones
  // -------------------------------------------------------------------------

  /** Normaliza "12.345.678-5" a "12345678-5". Devuelve null si el formato no sirve. */
  function normalizarRun(valor) {
    const limpio = String(valor ?? "").replace(/[.\s]/g, "").toUpperCase();
    const coincidencia = /^(\d{7,8})-?([\dK])$/.exec(limpio);
    return coincidencia ? `${coincidencia[1]}-${coincidencia[2]}` : null;
  }

  /** Verifica el dígito verificador con el algoritmo módulo 11. */
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
    const esperado = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
    return dv === esperado;
  }

  /** "12345678-5" -> "12.345.678-5" */
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

  function edad(fechaNacimiento) {
    const nacimiento = new Date(`${fechaNacimiento}T00:00:00`);
    const hoy = new Date();
    let anos = hoy.getFullYear() - nacimiento.getFullYear();
    const cumplio = hoy.getMonth() > nacimiento.getMonth() || (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() >= nacimiento.getDate());
    if (!cumplio) anos -= 1;
    return anos;
  }

  const SEXOS = { F: "Femenino", M: "Masculino", O: "Otro", N: "Prefiero no decirlo" };

  // -------------------------------------------------------------------------
  // Almacenamiento
  // -------------------------------------------------------------------------

  const leerClientes = () => leer("clientes", []);
  const guardarClientes = (lista) => guardar("clientes", lista);
  const leerUsuarios = () => leer("usuarios", []);
  const guardarUsuarios = (lista) => guardar("usuarios", lista);

  const nuevoId = (prefijo) => `${prefijo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const correoNormalizado = (email) => String(email ?? "").trim().toLowerCase();

  function correoEnUso(email, { excepto = null } = {}) {
    const correo = correoNormalizado(email);
    return (
      leerClientes().some((c) => c.email === correo && c.id !== excepto) ||
      leerUsuarios().some((u) => u.email === correo && u.id !== excepto)
    );
  }

  /** Quita los datos sensibles antes de entregar una ficha a una vista. */
  const publico = ({ hash, sal, codigoVerificacion, ...resto }) => resto;

  // -------------------------------------------------------------------------
  // Clientes
  // -------------------------------------------------------------------------

  /** Valida y limpia los datos de la ficha. Mismas reglas para registro web y admin. */
  function validarFichaCliente(datos, { excepto = null } = {}) {
    const ficha = {
      run: normalizarRun(datos.run),
      nombre: String(datos.nombre ?? "").trim().replace(/\s+/g, " "),
      direccion: String(datos.direccion ?? "").trim(),
      region: datos.region,
      provincia: datos.provincia,
      comuna: datos.comuna,
      fechaNacimiento: datos.fechaNacimiento,
      sexo: datos.sexo,
      email: correoNormalizado(datos.email),
      telefono: String(datos.telefono ?? "").trim(),
    };

    if (!ficha.run || !runValido(ficha.run)) throw error("El RUN no es válido. Revisa el dígito verificador.");
    if (leerClientes().some((c) => c.run === ficha.run && c.id !== excepto)) throw error("Ya existe un cliente con ese RUN.", "DUPLICADO");
    if (ficha.nombre.split(" ").length < 2 || ficha.nombre.length > 120) throw error("Escribe nombre y apellido.");
    if (ficha.direccion.length < 5) throw error("Escribe la dirección con calle y número.");
    if (!PF.geografia.esValida(ficha.region, ficha.provincia, ficha.comuna)) throw error("Elige región, provincia y comuna.");
    if (!ficha.fechaNacimiento || Number.isNaN(Date.parse(ficha.fechaNacimiento))) throw error("Indica la fecha de nacimiento.");
    if (edad(ficha.fechaNacimiento) < 14 || edad(ficha.fechaNacimiento) > 110) throw error("Revisa la fecha de nacimiento.");
    if (!SEXOS[ficha.sexo]) throw error("Elige una opción en sexo.");
    if (!EMAIL_VALIDO.test(ficha.email)) throw error("El correo no tiene un formato válido.");
    if (correoEnUso(ficha.email, { excepto })) throw error("Ese correo ya está registrado.", "DUPLICADO");
    if (!TELEFONO_VALIDO.test(ficha.telefono)) throw error("El teléfono debe ser un celular chileno, por ejemplo +56 9 1234 5678.");

    return ficha;
  }

  /**
   * Simula el envío del código de verificación por la API de mensajería.
   * Un frontend no puede comprobar que un correo existe ni enviarlo de verdad:
   * el código se guarda y se muestra en pantalla como si hubiera llegado.
   */
  function emitirCodigo(cliente) {
    cliente.codigoVerificacion = String(Math.floor(100000 + Math.random() * 900000));
    cliente.codigoEmitidoEn = new Date().toISOString();
    return cliente.codigoVerificacion;
  }

  async function registrarCliente(datos, { origen = "WEB" } = {}) {
    const ficha = validarFichaCliente(datos);
    validarClave(datos.clave);

    const sal = nuevaSal();
    const cliente = {
      id: nuevoId("cli"),
      ...ficha,
      sal,
      hash: await hashClave(datos.clave, sal),
      emailVerificado: false,
      activo: true,
      origen, // WEB o ADMIN: el caso permite registrar en el local o en el sitio
      creadoEn: new Date().toISOString(),
    };
    const codigo = emitirCodigo(cliente);

    const lista = leerClientes();
    lista.push(cliente);
    guardarClientes(lista);

    return { cliente: publico(cliente), codigo };
  }

  function verificarCorreo(email, codigo) {
    const lista = leerClientes();
    const cliente = lista.find((c) => c.email === correoNormalizado(email));

    if (!cliente) throw error("No encontramos una cuenta con ese correo.", "NOT_FOUND");
    if (cliente.emailVerificado) return publico(cliente);
    if (String(codigo).trim() !== cliente.codigoVerificacion) throw error("El código no coincide. Revisa el correo más reciente.");

    const horas = (Date.now() - Date.parse(cliente.codigoEmitidoEn)) / 36e5;
    if (horas > 24) throw error("El código venció. Pide uno nuevo.", "VENCIDO");

    cliente.emailVerificado = true;
    delete cliente.codigoVerificacion;
    guardarClientes(lista);
    return publico(cliente);
  }

  function reenviarCodigo(email) {
    const lista = leerClientes();
    const cliente = lista.find((c) => c.email === correoNormalizado(email));
    if (!cliente) throw error("No encontramos una cuenta con ese correo.", "NOT_FOUND");
    if (cliente.emailVerificado) throw error("Ese correo ya está verificado.");

    const codigo = emitirCodigo(cliente);
    guardarClientes(lista);
    return codigo;
  }

  /**
   * Devuelve el último código enviado a un correo. Existe solo para la
   * simulación: la pantalla de verificación lo muestra como si fuera el
   * correo recibido. Con una API de mensajería real, esta función no existiría.
   */
  function codigoSimulado(email) {
    return leerClientes().find((c) => c.email === correoNormalizado(email) && !c.emailVerificado)?.codigoVerificacion ?? null;
  }

  /** Clave temporal para los clientes que registra el administrador en el local. */
  function claveTemporal() {
    const letras = "abcdefghjkmnpqrstuvwxyz";
    const azar = crypto.getRandomValues(new Uint8Array(6));
    return `${[...azar.slice(0, 4)].map((b) => letras[b % letras.length]).join("")}${1000 + ((azar[4] << 8) | azar[5]) % 9000}`;
  }

  async function cambiarClaveCliente(id, actual, nueva) {
    const lista = leerClientes();
    const cliente = lista.find((c) => c.id === id);
    if (!cliente) throw error("No existe ese cliente.", "NOT_FOUND");
    if ((await hashClave(actual, cliente.sal)) !== cliente.hash) throw error("La contraseña actual no es correcta.");
    validarClave(nueva);

    cliente.sal = nuevaSal();
    cliente.hash = await hashClave(nueva, cliente.sal);
    guardarClientes(lista);
  }

  function actualizarCliente(id, datos) {
    const lista = leerClientes();
    const cliente = lista.find((c) => c.id === id);
    if (!cliente) throw error("No existe ese cliente.", "NOT_FOUND");

    const ficha = validarFichaCliente({ ...cliente, ...datos }, { excepto: id });
    const cambioCorreo = ficha.email !== cliente.email;
    Object.assign(cliente, ficha);

    // Un correo nuevo debe verificarse de nuevo antes de volver a comprar.
    let codigo = null;
    if (cambioCorreo) {
      cliente.emailVerificado = false;
      codigo = emitirCodigo(cliente);
    }

    guardarClientes(lista);
    return { cliente: publico(cliente), codigo };
  }

  function cambiarEstadoCliente(id, activo) {
    const lista = leerClientes();
    const cliente = lista.find((c) => c.id === id);
    if (!cliente) throw error("No existe ese cliente.", "NOT_FOUND");
    cliente.activo = activo;
    guardarClientes(lista);
    return publico(cliente);
  }

  const listarClientes = () => leerClientes().map(publico);
  const obtenerCliente = (id) => {
    const cliente = leerClientes().find((c) => c.id === id);
    return cliente ? publico(cliente) : null;
  };

  // -------------------------------------------------------------------------
  // Usuarios internos
  // -------------------------------------------------------------------------

  function validarFichaUsuario(datos, { excepto = null } = {}) {
    const ficha = {
      nombre: String(datos.nombre ?? "").trim().replace(/\s+/g, " "),
      email: correoNormalizado(datos.email),
      perfil: datos.perfil,
    };

    if (ficha.nombre.length < 3) throw error("Escribe el nombre del usuario.");
    if (!EMAIL_VALIDO.test(ficha.email)) throw error("El correo no tiene un formato válido.");
    if (correoEnUso(ficha.email, { excepto })) throw error("Ese correo ya está en uso.", "DUPLICADO");
    if (!PERFILES[ficha.perfil]) throw error("Elige un perfil.");

    return ficha;
  }

  async function crearUsuario(datos) {
    const ficha = validarFichaUsuario(datos);
    validarClave(datos.clave);

    const sal = nuevaSal();
    const usuario = { id: nuevoId("usr"), ...ficha, sal, hash: await hashClave(datos.clave, sal), activo: true, creadoEn: new Date().toISOString() };

    const lista = leerUsuarios();
    lista.push(usuario);
    guardarUsuarios(lista);
    return publico(usuario);
  }

  async function actualizarUsuario(id, datos, { actorId }) {
    const lista = leerUsuarios();
    const usuario = lista.find((u) => u.id === id);
    if (!usuario) throw error("No existe ese usuario.", "NOT_FOUND");

    const ficha = validarFichaUsuario({ ...usuario, ...datos }, { excepto: id });

    // Evita quedarse sin administradores activos por error.
    const quedaSinAdmin = usuario.perfil === "ADMIN" && ficha.perfil !== "ADMIN" && lista.filter((u) => u.perfil === "ADMIN" && u.activo).length === 1;
    if (quedaSinAdmin) throw error("Debe quedar al menos un administrador activo.");
    if (id === actorId && ficha.perfil !== usuario.perfil) throw error("No puedes cambiar tu propio perfil.");

    Object.assign(usuario, ficha);

    if (datos.clave) {
      validarClave(datos.clave);
      usuario.sal = nuevaSal();
      usuario.hash = await hashClave(datos.clave, usuario.sal);
    }

    guardarUsuarios(lista);
    return publico(usuario);
  }

  function cambiarEstadoUsuario(id, activo, { actorId }) {
    const lista = leerUsuarios();
    const usuario = lista.find((u) => u.id === id);
    if (!usuario) throw error("No existe ese usuario.", "NOT_FOUND");
    if (id === actorId && !activo) throw error("No puedes desactivar tu propia cuenta.");
    if (!activo && usuario.perfil === "ADMIN" && lista.filter((u) => u.perfil === "ADMIN" && u.activo).length === 1) {
      throw error("Debe quedar al menos un administrador activo.");
    }

    usuario.activo = activo;
    guardarUsuarios(lista);
    return publico(usuario);
  }

  const listarUsuarios = () => leerUsuarios().map(publico);
  const obtenerUsuario = (id) => {
    const usuario = leerUsuarios().find((u) => u.id === id);
    return usuario ? publico(usuario) : null;
  };

  // -------------------------------------------------------------------------
  // Sesión
  // -------------------------------------------------------------------------

  /**
   * La sesión vive en sessionStorage, que es propio de cada pestaña: así una
   * pestaña puede ser el cliente y otra la cocina, como dos equipos distintos.
   * Los datos (pedidos, cuentas) sí se comparten entre pestañas.
   */
  function leerSesion(clave, porDefecto) {
    try {
      const texto = sessionStorage.getItem(`pokefresh:${clave}`);
      return texto === null ? porDefecto : JSON.parse(texto);
    } catch {
      return porDefecto;
    }
  }

  function guardarSesion(clave, valor) {
    try {
      if (valor === null) sessionStorage.removeItem(`pokefresh:${clave}`);
      else sessionStorage.setItem(`pokefresh:${clave}`, JSON.stringify(valor));
    } catch {
      /* sin storage, la sesión no sobrevive a una recarga */
    }
  }

  const suscriptores = new Set();
  const notificar = () => suscriptores.forEach((funcion) => funcion(sesionActual()));

  function alCambiarSesion(funcion) {
    suscriptores.add(funcion);
  }

  /**
   * Inicia sesión con correo y contraseña. Busca primero en los usuarios
   * internos y después en los clientes. Tras varios intentos fallidos el
   * correo queda bloqueado unos minutos.
   */
  async function ingresar(email, clave) {
    const correo = correoNormalizado(email);
    const intentos = leer("intentos", {});
    const registro = intentos[correo];

    if (registro?.bloqueadoHasta && Date.now() < registro.bloqueadoHasta) {
      const minutos = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
      throw error(`Demasiados intentos. Espera ${minutos} minuto(s) y vuelve a intentar.`, "BLOQUEADO");
    }

    const usuario = leerUsuarios().find((u) => u.email === correo);
    const cliente = usuario ? null : leerClientes().find((c) => c.email === correo);
    const cuenta = usuario ?? cliente;
    const coincide = cuenta ? (await hashClave(clave, cuenta.sal)) === cuenta.hash : false;

    if (!coincide) {
      const fallidos = (registro?.fallidos ?? 0) + 1;
      intentos[correo] = { fallidos, bloqueadoHasta: fallidos >= MAX_INTENTOS ? Date.now() + MINUTOS_BLOQUEO * 60000 : null };
      guardar("intentos", intentos);
      // El mismo mensaje para correo inexistente y clave incorrecta: no se
      // revela qué correos están registrados.
      throw error("Correo o contraseña incorrectos.", "CREDENCIALES");
    }

    delete intentos[correo];
    guardar("intentos", intentos);

    if (!cuenta.activo) throw error("Esta cuenta está desactivada. Contacta al restaurante.", "INACTIVA");
    if (cliente && !cliente.emailVerificado) throw error("Verifica tu correo antes de ingresar.", "SIN_VERIFICAR");

    const sesion = {
      tipo: usuario ? "USUARIO" : "CLIENTE",
      id: cuenta.id,
      perfil: usuario ? usuario.perfil : "CLIENTE",
      nombre: cuenta.nombre,
      expira: Date.now() + MINUTOS_SESION * 60000,
    };

    guardarSesion("sesion", sesion);
    notificar();
    return sesion;
  }

  function salir() {
    guardarSesion("sesion", null);
    notificar();
  }

  /** Devuelve la sesión vigente o null. Una sesión vencida se cierra sola. */
  function sesionActual() {
    const sesion = leerSesion("sesion", null);
    if (!sesion) return null;

    if (Date.now() > sesion.expira) {
      guardarSesion("sesion", null);
      guardarSesion("sesionVencida", true);
      return null;
    }

    // La cuenta pudo desactivarse o eliminarse mientras la sesión seguía abierta.
    const cuenta = sesion.tipo === "USUARIO" ? leerUsuarios().find((u) => u.id === sesion.id) : leerClientes().find((c) => c.id === sesion.id);
    if (!cuenta || !cuenta.activo) {
      guardarSesion("sesion", null);
      return null;
    }

    return sesion;
  }

  /** Extiende la sesión con cada actividad; se llama al navegar y al hacer clic. */
  function renovarSesion() {
    const sesion = leerSesion("sesion", null);
    if (sesion && Date.now() <= sesion.expira) {
      sesion.expira = Date.now() + MINUTOS_SESION * 60000;
      guardarSesion("sesion", sesion);
    }
  }

  /** Indica una sola vez si la última sesión se cerró por inactividad. */
  function sesionVencio() {
    const vencio = leerSesion("sesionVencida", false);
    if (vencio) guardarSesion("sesionVencida", null);
    return vencio;
  }

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
    hashClave,
    nuevaSal,
    sha256Js,
    registrarCliente,
    verificarCorreo,
    reenviarCodigo,
    codigoSimulado,
    claveTemporal,
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
    ingresar,
    salir,
    sesionActual,
    renovarSesion,
    sesionVencio,
    alCambiarSesion,
  };
})();
