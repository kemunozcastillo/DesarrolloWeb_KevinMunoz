/**
 * Punto de entrada: carga el catálogo y la sesión desde la API, define las
 * rutas con su acceso, conecta la cabecera (cuenta y carrito) y arranca el router.
 */

(async function () {
  const { definir, definirNoEncontrada, definirSinPermiso, iniciar } = PF.router;
  const { html, pintar, accesoDe } = PF.ui;
  const v = PF.vistas;

  // Catálogo y sesión vienen del backend. Si la API no responde, se avisa en vez de mostrar una tienda vacía.
  try {
    await Promise.all([PF.datos.cargar(), PF.cuentas.cargarSesion()]);
  } catch (fallo) {
    pintar(
      document.querySelector("#contenido"),
      html`<div class="pagina pagina--angosta"><section class="estado estado--error"><h1>La tienda no está disponible</h1><p>${fallo.message} Intenta en unos minutos.</p></section></div>`,
    );
    return;
  }

  // --- Tienda (pública) ---------------------------------------------------------
  definir("/", v.inicio);
  definir("/menu", v.menu);
  definir("/arma-tu-bowl", v.armar);
  definir("/promo/:id", v.promo);
  definir("/carrito", v.carrito);
  definir("/ubicacion", v.ubicacion);
  definir("/contacto", v.contacto);
  definir("/ayuda", v.ayuda);

  // --- Cuenta ---------------------------------------------------------------------
  definir("/ingresar", v.ingresar);
  definir("/registro", v.registro);
  definir("/verificar", v.verificar);
  definir("/mi-cuenta", v.miCuenta, { acceso: "CLIENTE" });
  definir("/mis-pedidos", v.misPedidos, { acceso: "CLIENTE" });

  // --- Compra (solo clientes registrados) --------------------------------------------
  definir("/checkout", v.checkout, { acceso: "CLIENTE" });
  definir("/pago/:id", v.pago, { acceso: "CLIENTE" });

  // El pedido y la boleta los ve su cliente y también el personal.
  const clienteOPersonal = ["CLIENTE", "ADMIN", "DUENO", "COCINA", "DESPACHO"];
  definir("/orden/:id", v.orden, { acceso: clienteOPersonal });
  definir("/boleta/:numero", v.boleta, { acceso: clienteOPersonal });

  // --- Panel del restaurante: los perfiles salen de PF.ui.SECCIONES_PANEL --------------
  definir("/admin", v.admin, { acceso: accesoDe("/admin") });
  definir("/admin/nuevo", v.adminFormulario, { acceso: accesoDe("/admin") });
  definir("/admin/items/:id", v.adminFormulario, { acceso: accesoDe("/admin") });
  definir("/admin/pedidos", v.adminPedidos, { acceso: accesoDe("/admin/pedidos") });
  definir("/admin/caja", v.adminCaja, { acceso: accesoDe("/admin/caja") });
  definir("/admin/cocina", v.adminCocina, { acceso: accesoDe("/admin/cocina") });
  definir("/admin/despacho", v.adminDespacho, { acceso: accesoDe("/admin/despacho") });
  definir("/admin/orden/:id", v.ordenDespacho, { acceso: ["ADMIN", "COCINA", "DESPACHO"] });
  definir("/admin/reportes", v.adminReportes, { acceso: accesoDe("/admin/reportes") });
  definir("/admin/clientes", v.adminClientes, { acceso: accesoDe("/admin/clientes") });
  definir("/admin/clientes/nuevo", v.adminClienteFormulario, { acceso: accesoDe("/admin/clientes") });
  definir("/admin/clientes/:id", v.adminClienteFormulario, { acceso: accesoDe("/admin/clientes") });
  definir("/admin/usuarios", v.adminUsuarios, { acceso: accesoDe("/admin/usuarios") });
  definir("/admin/usuarios/nuevo", v.adminUsuarioFormulario, { acceso: accesoDe("/admin/usuarios") });
  definir("/admin/usuarios/:id", v.adminUsuarioFormulario, { acceso: accesoDe("/admin/usuarios") });

  definirNoEncontrada(v.noEncontrada);
  definirSinPermiso(v.sinPermiso);

  // --- Cabecera: cuenta ----------------------------------------------------------------
  const cuenta = document.querySelector("[data-cuenta]");

  function pintarCuenta(sesion) {
    if (!sesion) {
      pintar(cuenta, html`<a class="enlace-cabecera" href="#/ingresar" data-nav="/ingresar">Ingresar</a>`);
      return;
    }

    const primerNombre = sesion.nombre.split(" ")[0];
    const enlace =
      sesion.tipo === "CLIENTE"
        ? html`<a class="enlace-cabecera" href="#/mis-pedidos" data-nav="/mis-pedidos">${primerNombre}</a>`
        : html`<a class="enlace-cabecera" href="#${PF.ui.inicioPanel(sesion.perfil)}" data-nav="/admin">Panel</a>`;

    pintar(cuenta, html`${enlace}<button class="enlace-cabecera enlace-cabecera--boton" type="button" data-salir>Salir</button>`);
  }

  cuenta.addEventListener("click", async (evento) => {
    if (!evento.target.closest("[data-salir]")) return;
    try {
      await PF.cuentas.salir();
    } catch {
      /* la sesión local se cierra igual */
    }
    PF.ui.avisar("Cerraste sesión.", { tipo: "exito" });
    PF.router.navegar("/");
  });

  // Al cambiar de sesión, el catálogo se pide de nuevo: el administrador ve el stock, el público no.
  PF.cuentas.alCambiarSesion((sesion) => {
    pintarCuenta(sesion);
    PF.datos.refrescar().catch(() => {});
  });

  // --- Cabecera: carrito ---------------------------------------------------------------
  const contador = document.querySelector("[data-carrito-cuenta]");
  PF.tienda.alCambiarCarrito((cantidad) => {
    contador.textContent = cantidad;
    contador.hidden = cantidad === 0;
  });

  // --- Pantallas en vivo y aviso de pedidos nuevos en cocina -------------------------------
  // Cocina, despacho y el seguimiento del pedido consultan la API cada pocos
  // segundos. La pantalla solo se vuelve a pintar si algo cambió, para no
  // perder lo que el usuario esté escribiendo o eligiendo.

  let conocidos = null;

  function sonar() {
    try {
      const contexto = (sonar.contexto ??= new AudioContext());
      [0, 0.18].forEach((retraso) => {
        const oscilador = contexto.createOscillator();
        const volumen = contexto.createGain();
        const inicio = contexto.currentTime + retraso;
        oscilador.frequency.value = 880;
        volumen.gain.setValueAtTime(0.12, inicio);
        volumen.gain.exponentialRampToValueAtTime(0.001, inicio + 0.15);
        oscilador.connect(volumen).connect(contexto.destination);
        oscilador.start(inicio);
        oscilador.stop(inicio + 0.15);
      });
    } catch {
      /* sin audio: queda el aviso en pantalla */
    }
  }

  function actualizarInsignia() {
    const enlace = document.querySelector('.panel__nav a[href="#/admin/cocina"]');
    if (!enlace) return;
    const cantidad = PF.ui.pendientesCocina;
    let insignia = enlace.querySelector(".panel__cuenta");
    if (!cantidad) return insignia?.remove();
    if (!insignia) {
      insignia = document.createElement("span");
      insignia.className = "panel__cuenta";
      enlace.append(" ", insignia);
    }
    insignia.textContent = cantidad;
  }

  const firma = (lista) => lista.map((p) => `${p.id}:${p.estado}`).join("|");
  let ultimaFirma = { ruta: null, valor: null };

  /** Qué consultar según la pantalla abierta. */
  function consultaDeRuta(ruta, sesion) {
    if (ruta === "/admin/cocina") return () => PF.pedidos.colaCocina();
    if (ruta === "/admin/despacho") return () => PF.pedidos.colaDespacho();
    if (ruta === "/mis-pedidos" && sesion.tipo === "CLIENTE") return () => PF.pedidos.delCliente();
    const orden = /^\/orden\/([^/]+)$/.exec(ruta);
    if (orden) return async () => [await PF.pedidos.obtener(decodeURIComponent(orden[1]))].filter(Boolean);
    return null;
  }

  async function revisar() {
    const sesion = PF.cuentas.sesionActual();
    if (!sesion || document.hidden) return;
    const ruta = location.hash.replace(/^#/, "").split("?")[0];

    try {
      if (["COCINA", "ADMIN"].includes(sesion.perfil)) {
        const actuales = await PF.pedidos.porAceptar();
        const nuevos = conocidos ? actuales.filter((p) => !conocidos.has(p.id)) : [];
        conocidos = new Set(actuales.map((p) => p.id));
        PF.ui.pendientesCocina = actuales.length;
        actualizarInsignia();
        if (nuevos.length) {
          PF.ui.avisar(nuevos.length === 1 ? `Nuevo pedido ${nuevos[0].id} para cocina.` : `${nuevos.length} pedidos nuevos para cocina.`, { tipo: "exito", duracion: 6000 });
          if (sesion.perfil === "COCINA") sonar();
        }
      }

      const consulta = consultaDeRuta(ruta, sesion);
      if (!consulta) return;
      const valor = firma(await consulta());
      if (ultimaFirma.ruta === ruta && ultimaFirma.valor !== valor) PF.router.recargar();
      ultimaFirma = { ruta, valor };
    } catch {
      /* sin conexión: se reintenta en la próxima vuelta */
    }
  }

  setInterval(revisar, 8000);
  window.addEventListener("hashchange", () => (ultimaFirma = { ruta: null, valor: null }));

  // Otra pestaña cambió el carrito: se refleja aquí también.
  window.addEventListener("storage", (evento) => {
    if (evento.key === "pokefresh:carrito") PF.tienda.notificar();
  });

  // El catálogo se vuelve a pedir cada minuto: precios y disponibilidad al día.
  setInterval(() => PF.datos.refrescar().catch(() => {}), 60_000);

  // "Saltar al contenido" no puede usar un ancla (#contenido) porque el hash
  // es la ruta del sitio: mueve el foco con JavaScript.
  document.querySelector("[data-saltar]").addEventListener("click", (evento) => {
    evento.preventDefault();
    document.querySelector("#contenido").focus();
  });

  pintarCuenta(PF.cuentas.sesionActual());
  iniciar(document.querySelector("#contenido"));
  PF.tienda.notificar();
  revisar();
})();
