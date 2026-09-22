/**
 * Punto de entrada: carga los datos de ejemplo, define las rutas con su
 * acceso, conecta la cabecera (cuenta y carrito) y arranca el router.
 */

(async function () {
  const { definir, definirNoEncontrada, definirSinPermiso, iniciar } = PF.router;
  const { html, pintar, accesoDe } = PF.ui;
  const v = PF.vistas;

  // La primera vez se crean las cuentas y ventas de ejemplo (usa hash de claves, que es asíncrono).
  await PF.ejemplo.inicializar();

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

  cuenta.addEventListener("click", (evento) => {
    if (!evento.target.closest("[data-salir]")) return;
    PF.cuentas.salir();
    PF.ui.avisar("Cerraste sesión.", { tipo: "exito" });
    PF.router.navegar("/");
  });

  PF.cuentas.alCambiarSesion(pintarCuenta);

  // --- Cabecera: carrito ---------------------------------------------------------------
  const contador = document.querySelector("[data-carrito-cuenta]");
  PF.tienda.alCambiarCarrito((cantidad) => {
    contador.textContent = cantidad;
    contador.hidden = cantidad === 0;
  });

  // --- Aviso de pedidos nuevos en cocina ------------------------------------------------
  // Sin servidor no hay notificaciones entre equipos: el aviso llega a las
  // otras pestañas del mismo navegador, a través del evento "storage".

  let conocidos = new Set(PF.pedidos.porAceptar().map((p) => p.id));

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
    const cantidad = PF.pedidos.porAceptar().length;
    let insignia = enlace.querySelector(".panel__cuenta");
    if (!cantidad) return insignia?.remove();
    if (!insignia) {
      insignia = document.createElement("span");
      insignia.className = "panel__cuenta";
      enlace.append(" ", insignia);
    }
    insignia.textContent = cantidad;
  }

  function revisarPedidosNuevos() {
    const actuales = PF.pedidos.porAceptar();
    const nuevos = actuales.filter((p) => !conocidos.has(p.id));
    conocidos = new Set(actuales.map((p) => p.id));

    const sesion = PF.cuentas.sesionActual();
    if (!nuevos.length || !["COCINA", "ADMIN"].includes(sesion?.perfil)) return;

    PF.ui.avisar(nuevos.length === 1 ? `Nuevo pedido ${nuevos[0].id} para cocina.` : `${nuevos.length} pedidos nuevos para cocina.`, { tipo: "exito", duracion: 6000 });
    if (sesion.perfil === "COCINA") sonar();
  }

  // Pantallas que muestran pedidos en vivo y se repintan si cambian en otra pestaña.
  const RUTAS_EN_VIVO = ["/admin/cocina", "/admin/despacho", "/admin/caja", "/orden/", "/mis-pedidos"];

  // Otra pestaña cambió el carrito o los pedidos: se refleja aquí también.
  // La sesión no se comparte: cada pestaña tiene la suya.
  window.addEventListener("storage", (evento) => {
    if (evento.key === "pokefresh:carrito") PF.tienda.notificar();

    if (evento.key === "pokefresh:pedidos") {
      revisarPedidosNuevos();
      actualizarInsignia();
      const ruta = location.hash.replace(/^#/, "").split("?")[0];
      if (RUTAS_EN_VIVO.some((r) => ruta === r || ruta.startsWith(r))) PF.router.recargar();
    }
  });

  // Cualquier actividad renueva la sesión; sin actividad, expira sola.
  document.addEventListener("click", () => PF.cuentas.renovarSesion(), { passive: true });

  // "Saltar al contenido" no puede usar un ancla (#contenido) porque el hash
  // es la ruta del sitio: mueve el foco con JavaScript.
  document.querySelector("[data-saltar]").addEventListener("click", (evento) => {
    evento.preventDefault();
    document.querySelector("#contenido").focus();
  });

  pintarCuenta(PF.cuentas.sesionActual());
  iniciar(document.querySelector("#contenido"));
  PF.tienda.notificar();
})();
