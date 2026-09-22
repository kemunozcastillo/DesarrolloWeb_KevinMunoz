PF.vistas = PF.vistas || {};

/**
 * Ingreso, registro, verificación de correo, ficha del cliente y su
 * historial de pedidos.
 */

(function () {
  const { avisar, crudo, html, pintar, precio, titulo, fechaHora, etiquetaEstado } = PF.ui;
  const F = PF.formularios;

  /** Adónde ir después de ingresar: la ruta pedida, el panel o el inicio. */
  function destinoTrasIngreso(sesion, query) {
    const volver = query.get("volver");
    if (volver && volver.startsWith("/") && !volver.startsWith("/ingresar")) return volver;
    return sesion.tipo === "USUARIO" ? PF.ui.inicioPanel(sesion.perfil) : "/";
  }

  // -------------------------------------------------------------------------
  // Ingresar: #/ingresar?volver=/checkout
  // -------------------------------------------------------------------------

  PF.vistas.ingresar = function ({ raiz, query, sesion }) {
    titulo("Ingresar");

    if (sesion) {
      PF.router.navegar(destinoTrasIngreso(sesion, query), { reemplazar: true });
      return;
    }

    const vencio = PF.cuentas.sesionVencio();
    const pideSesion = query.get("volver");
    const { USUARIOS, CLIENTE_DEMO } = PF.ejemplo;

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta cuenta">
          <h1>Ingresar</h1>
          ${vencio
            ? html`<p class="aviso-bloque">Tu sesión se cerró tras ${PF.cuentas.MINUTOS_SESION} minutos sin actividad. Ingresa de nuevo.</p>`
            : pideSesion
              ? html`<p class="aviso-bloque">Ingresa con tu cuenta para continuar.</p>`
              : ""}

          <form class="formulario-admin" novalidate>
            ${F.campo({ nombre: "email", etiqueta: "Correo electrónico", tipo: "email", autocompletar: "username" })}
            ${F.campo({ nombre: "clave", etiqueta: "Contraseña", tipo: "password", autocompletar: "current-password" })}
            <p class="checkout__error" data-error role="alert" hidden></p>
            <button class="boton boton--primario boton--ancho" type="submit">Ingresar</button>
          </form>

          <p class="cuenta__alternativa">¿No tienes cuenta? <a href="#/registro${crudo(pideSesion ? `?volver=${encodeURIComponent(pideSesion)}` : "")}">Regístrate</a></p>

          <details class="credenciales">
            <summary>Cuentas de prueba</summary>
            <p>Para revisar el sistema con cada perfil. Haz clic en una para completar el formulario.</p>
            <ul>
              <li><button type="button" class="enlace-boton" data-demo="${CLIENTE_DEMO.email}" data-clave="${CLIENTE_DEMO.clave}">Cliente</button> <code>${CLIENTE_DEMO.email}</code> <code>${CLIENTE_DEMO.clave}</code></li>
              ${USUARIOS.map(
                (u) => html`<li><button type="button" class="enlace-boton" data-demo="${u.email}" data-clave="${u.clave}">${PF.cuentas.PERFILES[u.perfil]}</button> <code>${u.email}</code> <code>${u.clave}</code></li>`,
              )}
            </ul>
          </details>
        </div>
      `,
    );

    const form = raiz.querySelector("form");
    const error = raiz.querySelector("[data-error]");
    const boton = form.querySelector('[type="submit"]');

    raiz.querySelector(".credenciales").addEventListener("click", (evento) => {
      const demo = evento.target.closest("[data-demo]");
      if (!demo) return;
      form.elements.email.value = demo.dataset.demo;
      form.elements.clave.value = demo.dataset.clave;
      boton.focus();
    });

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      F.mostrarError(error, "");

      const email = form.elements.email.value.trim();
      const clave = form.elements.clave.value;
      if (!email || !clave) {
        F.mostrarError(error, "Escribe tu correo y tu contraseña.");
        return;
      }

      boton.disabled = true;
      try {
        const nueva = await PF.cuentas.ingresar(email, clave);
        avisar(`Hola, ${nueva.nombre.split(" ")[0]}.`, { tipo: "exito" });
        PF.router.navegar(destinoTrasIngreso(nueva, query), { reemplazar: true });
      } catch (fallo) {
        if (fallo.codigo === "SIN_VERIFICAR") {
          PF.router.navegar(`/verificar?email=${encodeURIComponent(email)}`);
          return;
        }
        F.mostrarError(error, fallo.message);
        boton.disabled = false;
      }
    });
  };

  // -------------------------------------------------------------------------
  // Registro: #/registro
  // -------------------------------------------------------------------------

  PF.vistas.registro = function ({ raiz, query, sesion }) {
    titulo("Crear cuenta");

    if (sesion) {
      PF.router.navegar("/", { reemplazar: true });
      return;
    }

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta cuenta">
          <h1>Crear cuenta</h1>
          <p class="introduccion">Con tu cuenta puedes comprar en línea y acceder a promociones.</p>
          <form class="formulario-admin formulario-ancho" novalidate>
            ${F.fichaCliente({}, { conClave: true })}
            <p class="checkout__error" data-error role="alert" hidden></p>
            <button class="boton boton--primario" type="submit">Crear cuenta</button>
          </form>
          <p class="cuenta__alternativa">¿Ya tienes cuenta? <a href="#/ingresar">Ingresa</a></p>
        </div>
      `,
    );

    const form = raiz.querySelector("form");
    const error = raiz.querySelector("[data-error]");
    F.conectarUbicacion(form);
    F.formatearRunAlSalir(form.elements.run);

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      F.mostrarError(error, "");

      if (form.elements.clave.value !== form.elements.clave2.value) {
        F.mostrarError(error, "Las contraseñas no coinciden.");
        return;
      }

      try {
        const { cliente } = await PF.cuentas.registrarCliente({ ...F.leerFicha(form), clave: form.elements.clave.value });
        const volver = query.get("volver");
        PF.router.navegar(`/verificar?email=${encodeURIComponent(cliente.email)}${volver ? `&volver=${encodeURIComponent(volver)}` : ""}`);
      } catch (fallo) {
        F.mostrarError(error, fallo.message);
      }
    });
  };

  // -------------------------------------------------------------------------
  // Verificar correo: #/verificar?email=...
  // -------------------------------------------------------------------------

  PF.vistas.verificar = function ({ raiz, query }) {
    titulo("Verifica tu correo");

    const email = query.get("email") ?? "";
    const volver = query.get("volver");

    const bandeja = () => {
      const codigo = PF.cuentas.codigoSimulado(email);
      return codigo
        ? html`
            <div class="correo-simulado" aria-label="Correo simulado">
              <p class="correo-simulado__etiqueta">Simulación del correo enviado por la API de mensajería</p>
              <p><strong>Para:</strong> ${email}</p>
              <p><strong>Asunto:</strong> Tu código de Poke Fresh</p>
              <p>Tu código de verificación es <strong class="correo-simulado__codigo">${codigo}</strong>. Vence en 24 horas.</p>
            </div>
          `
        : "";
    };

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta cuenta">
          <h1>Verifica tu correo</h1>
          <p class="introduccion">Te enviamos un código de 6 dígitos a <strong>${email}</strong>. Escríbelo para activar tu cuenta.</p>
          <div data-bandeja>${bandeja()}</div>
          <form class="formulario-admin" novalidate>
            ${F.campo({ nombre: "codigo", etiqueta: "Código", autocompletar: "one-time-code", atributos: 'inputmode="numeric" maxlength="6"' })}
            <p class="checkout__error" data-error role="alert" hidden></p>
            <div class="estado__acciones estado__acciones--izquierda">
              <button class="boton boton--primario" type="submit">Verificar</button>
              <button class="enlace-boton" type="button" data-reenviar>Enviar un código nuevo</button>
            </div>
          </form>
        </div>
      `,
    );

    const form = raiz.querySelector("form");
    const error = raiz.querySelector("[data-error]");

    form.addEventListener("submit", (evento) => {
      evento.preventDefault();
      F.mostrarError(error, "");

      try {
        PF.cuentas.verificarCorreo(email, form.elements.codigo.value);
        avisar("Correo verificado. Ya puedes ingresar.", { tipo: "exito" });
        PF.router.navegar(`/ingresar${volver ? `?volver=${encodeURIComponent(volver)}` : ""}`, { reemplazar: true });
      } catch (fallo) {
        F.mostrarError(error, fallo.message);
      }
    });

    raiz.querySelector("[data-reenviar]").addEventListener("click", () => {
      try {
        PF.cuentas.reenviarCodigo(email);
        pintar(raiz.querySelector("[data-bandeja]"), bandeja());
        avisar("Te enviamos un código nuevo.", { tipo: "exito" });
      } catch (fallo) {
        F.mostrarError(error, fallo.message);
      }
    });
  };

  // -------------------------------------------------------------------------
  // Mi cuenta: #/mi-cuenta
  // -------------------------------------------------------------------------

  PF.vistas.miCuenta = function ({ raiz, sesion }) {
    titulo("Mi cuenta");
    const cliente = PF.cuentas.obtenerCliente(sesion.id);

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta cuenta">
          <nav class="pestanas pestanas--chicas" aria-label="Tu cuenta">
            <a href="#/mis-pedidos">Mis pedidos</a>
            <a href="#/mi-cuenta" aria-current="page">Mis datos</a>
          </nav>
          <h1>Mis datos</h1>
          <form class="formulario-admin formulario-ancho" data-ficha novalidate>
            ${F.fichaCliente(cliente)}
            <p class="checkout__error" data-error role="alert" hidden></p>
            <button class="boton boton--primario" type="submit">Guardar cambios</button>
          </form>

          <form class="formulario-admin" data-clave novalidate>
            <h2 class="subtitulo">Cambiar contraseña</h2>
            ${F.campo({ nombre: "actual", etiqueta: "Contraseña actual", tipo: "password", autocompletar: "current-password" })}
            ${F.campo({ nombre: "nueva", etiqueta: "Contraseña nueva", tipo: "password", autocompletar: "new-password", ayuda: "Al menos 8 caracteres, con letras y números." })}
            <p class="checkout__error" data-error-clave role="alert" hidden></p>
            <button class="boton" type="submit">Cambiar contraseña</button>
          </form>
        </div>
      `,
    );

    const ficha = raiz.querySelector("[data-ficha]");
    const error = raiz.querySelector("[data-error]");
    F.conectarUbicacion(ficha);
    F.formatearRunAlSalir(ficha.elements.run);

    ficha.addEventListener("submit", (evento) => {
      evento.preventDefault();
      F.mostrarError(error, "");

      try {
        const { cliente: actualizado, codigo } = PF.cuentas.actualizarCliente(sesion.id, F.leerFicha(ficha));
        if (codigo) {
          // Cambiar el correo exige verificarlo de nuevo antes de volver a comprar.
          PF.cuentas.salir();
          avisar("Guardamos tus datos. Verifica tu correo nuevo para volver a ingresar.", { tipo: "exito", duracion: 5000 });
          PF.router.navegar(`/verificar?email=${encodeURIComponent(actualizado.email)}`);
          return;
        }
        avisar("Guardamos tus datos.", { tipo: "exito" });
      } catch (fallo) {
        F.mostrarError(error, fallo.message);
      }
    });

    const formClave = raiz.querySelector("[data-clave]");
    const errorClave = raiz.querySelector("[data-error-clave]");

    formClave.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      F.mostrarError(errorClave, "");
      try {
        await PF.cuentas.cambiarClaveCliente(sesion.id, formClave.elements.actual.value, formClave.elements.nueva.value);
        formClave.reset();
        avisar("Cambiamos tu contraseña.", { tipo: "exito" });
      } catch (fallo) {
        F.mostrarError(errorClave, fallo.message);
      }
    });
  };

  // -------------------------------------------------------------------------
  // Mis pedidos: #/mis-pedidos
  // -------------------------------------------------------------------------

  PF.vistas.misPedidos = function ({ raiz, sesion }) {
    titulo("Mis pedidos");
    const pedidos = PF.pedidos.delCliente(sesion.id);

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta cuenta">
          <nav class="pestanas pestanas--chicas" aria-label="Tu cuenta">
            <a href="#/mis-pedidos" aria-current="page">Mis pedidos</a>
            <a href="#/mi-cuenta">Mis datos</a>
          </nav>
          <h1>Mis pedidos</h1>
          ${pedidos.length
            ? html`
                <ul class="lista-pedidos">
                  ${pedidos.map(
                    (p) => html`
                      <li>
                        <a class="tarjeta-pedido" href="#/orden/${p.id}">
                          <span class="tarjeta-pedido__id">${p.id}</span>
                          <span class="tarjeta-pedido__fecha">${fechaHora(p.creadoEn)}</span>
                          ${etiquetaEstado(p.estado)}
                          <strong class="tarjeta-pedido__total">${precio(p.total)}</strong>
                        </a>
                      </li>
                    `,
                  )}
                </ul>
              `
            : html`
                <section class="estado estado--vacio">
                  <h2>Todavía no tienes pedidos</h2>
                  <p>Arma tu primer bowl y aparecerá aquí.</p>
                  <a class="boton boton--primario" href="#/arma-tu-bowl">Arma tu bowl</a>
                </section>
              `}
        </div>
      `,
    );
  };
})();
