PF.vistas = PF.vistas || {};

/**
 * Mantenedores de clientes y de usuarios internos (solo administrador).
 *   #/admin/clientes?q=...   #/admin/clientes/nuevo   #/admin/clientes/:id
 *   #/admin/usuarios         #/admin/usuarios/nuevo   #/admin/usuarios/:id
 */

(function () {
  const { avisar, crudo, html, pintar, titulo, fechaCorta, panel } = PF.ui;
  const F = PF.formularios;
  const C = PF.cuentas;

  const interruptor = (activo) => html`
    <label class="interruptor interruptor--compacto">
      <input type="checkbox" data-activo ${crudo(activo ? "checked" : "")} />
      <span>${activo ? "Activo" : "Inactivo"}</span>
    </label>
  `;

  // -------------------------------------------------------------------------
  // Clientes
  // -------------------------------------------------------------------------

  PF.vistas.adminClientes = function ({ raiz, query, sesion }) {
    titulo("Clientes");

    const busqueda = (query.get("q") ?? "").trim().toLowerCase();
    const normal = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const clientes = C.listarClientes()
      .filter((c) => !busqueda || normal(`${c.nombre} ${c.run} ${c.email}`).includes(normal(busqueda)) || c.run.replace("-", "").includes(busqueda.replace(/[.-]/g, "")))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    pintar(
      raiz,
      panel({
        sesion,
        activa: "/admin/clientes",
        contenido: html`
          <div class="admin__cabeza">
            <h1>Clientes</h1>
            <a class="boton boton--primario" href="#/admin/clientes/nuevo">Registrar cliente</a>
          </div>
          <form class="admin__herramientas" data-buscar>
            <label class="selector selector--busqueda">
              <span>Buscar</span>
              <input type="search" name="q" value="${query.get("q") ?? ""}" placeholder="Nombre, RUN o correo" />
            </label>
          </form>
          ${clientes.length
            ? html`
                <div class="tabla-envoltura">
                  <table class="tabla">
                    <thead><tr><th>Cliente</th><th>RUN</th><th>Comuna</th><th>Registro</th><th>Estado</th><th><span class="visualmente-oculto">Acciones</span></th></tr></thead>
                    <tbody>
                      ${clientes.map(
                        (c) => html`
                          <tr data-cliente="${c.id}">
                            <td>
                              <strong>${c.nombre}</strong>
                              <span class="tabla__detalle">${c.email} ${c.emailVerificado ? "" : html`<span class="etiqueta etiqueta--aviso">Sin verificar</span>`}</span>
                            </td>
                            <td>${C.formatearRun(c.run)}</td>
                            <td>${c.comuna}</td>
                            <td>${c.origen === "ADMIN" ? "En el local" : "Sitio web"}, ${fechaCorta(c.creadoEn)}</td>
                            <td>${interruptor(c.activo)}</td>
                            <td class="tabla__acciones"><a class="enlace-boton" href="#/admin/clientes/${c.id}">Editar</a></td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
            : html`<section class="estado estado--vacio"><h2>No hay clientes que coincidan</h2><a class="boton" href="#/admin/clientes">Ver todos</a></section>`}
        `,
      }),
    );

    const buscar = raiz.querySelector("[data-buscar]");
    buscar.addEventListener("submit", (evento) => {
      evento.preventDefault();
      const q = buscar.elements.q.value.trim();
      PF.router.navegar(q ? `/admin/clientes?q=${encodeURIComponent(q)}` : "/admin/clientes");
    });

    raiz.querySelector(".tabla")?.addEventListener("change", (evento) => {
      const casilla = evento.target.closest("[data-activo]");
      if (!casilla) return;
      try {
        const cliente = C.cambiarEstadoCliente(casilla.closest("[data-cliente]").dataset.cliente, casilla.checked);
        casilla.nextElementSibling.textContent = cliente.activo ? "Activo" : "Inactivo";
      } catch (fallo) {
        casilla.checked = !casilla.checked;
        avisar(fallo.message, { tipo: "error" });
      }
    });
  };

  PF.vistas.adminClienteFormulario = function ({ raiz, params, sesion }) {
    const esNuevo = !params.id;
    const cliente = esNuevo ? {} : C.obtenerCliente(params.id);
    titulo(esNuevo ? "Registrar cliente" : "Editar cliente");

    if (!cliente) {
      pintar(raiz, panel({ sesion, activa: "/admin/clientes", contenido: html`<section class="estado estado--vacio"><h1>No encontramos ese cliente</h1><a class="boton" href="#/admin/clientes">Volver</a></section>` }));
      return;
    }

    pintar(
      raiz,
      panel({
        sesion,
        activa: "/admin/clientes",
        contenido: html`
          <a class="volver" href="#/admin/clientes">Volver a clientes</a>
          <h1>${esNuevo ? "Registrar cliente en el local" : `Editar ${cliente.nombre}`}</h1>
          ${esNuevo ? html`<p class="introduccion">El cliente recibirá una contraseña temporal y un código para verificar su correo antes de comprar.</p>` : ""}
          <form class="formulario-admin formulario-ancho" novalidate>
            ${F.fichaCliente(cliente)}
            <p class="checkout__error" data-error role="alert" hidden></p>
            <div class="estado__acciones estado__acciones--izquierda">
              <a class="boton" href="#/admin/clientes">Cancelar</a>
              <button class="boton boton--primario" type="submit">${esNuevo ? "Registrar cliente" : "Guardar cambios"}</button>
            </div>
          </form>
          <div data-resultado></div>
        `,
      }),
    );

    const form = raiz.querySelector("form");
    const error = raiz.querySelector("[data-error]");
    F.conectarUbicacion(form);
    F.formatearRunAlSalir(form.elements.run);

    const correoSimulado = (email, codigo, clave) => html`
      <div class="correo-simulado">
        <p class="correo-simulado__etiqueta">Simulación del correo enviado por la API de mensajería</p>
        <p><strong>Para:</strong> ${email}</p>
        ${clave ? html`<p>Tu contraseña temporal es <strong class="correo-simulado__codigo">${clave}</strong>. Cámbiala en "Mis datos" después de ingresar.</p>` : ""}
        <p>Tu código de verificación es <strong class="correo-simulado__codigo">${codigo}</strong>. Ingrésalo en <a href="#/verificar?email=${encodeURIComponent(email)}">la página de verificación</a>.</p>
      </div>
    `;

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      F.mostrarError(error, "");

      try {
        if (esNuevo) {
          const clave = C.claveTemporal();
          const { cliente: nuevo, codigo } = await C.registrarCliente({ ...F.leerFicha(form) , clave }, { origen: "ADMIN" });
          form.hidden = true;
          pintar(
            raiz.querySelector("[data-resultado]"),
            html`
              <p class="aviso-bloque">Registramos a ${nuevo.nombre}. Le enviamos sus datos de acceso.</p>
              ${correoSimulado(nuevo.email, codigo, clave)}
              <div class="estado__acciones estado__acciones--izquierda">
                <a class="boton" href="#/admin/clientes">Volver a clientes</a>
                <a class="boton boton--primario" href="#/admin/clientes/nuevo" data-otro>Registrar otro</a>
              </div>
            `,
          );
          raiz.querySelector("[data-otro]").addEventListener("click", (e) => {
            e.preventDefault();
            PF.router.recargar();
          });
          return;
        }

        const { cliente: actualizado, codigo } = C.actualizarCliente(cliente.id, F.leerFicha(form));
        if (codigo) {
          pintar(raiz.querySelector("[data-resultado]"), html`<p class="aviso-bloque">Cambió el correo: el cliente debe verificarlo antes de volver a comprar.</p>${correoSimulado(actualizado.email, codigo)}`);
          avisar("Guardamos los cambios.", { tipo: "exito" });
          return;
        }
        avisar("Guardamos los cambios.", { tipo: "exito" });
        PF.router.navegar("/admin/clientes");
      } catch (fallo) {
        F.mostrarError(error, fallo.message);
      }
    });
  };

  // -------------------------------------------------------------------------
  // Usuarios internos
  // -------------------------------------------------------------------------

  PF.vistas.adminUsuarios = function ({ raiz, sesion }) {
    titulo("Usuarios");
    const usuarios = C.listarUsuarios().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    pintar(
      raiz,
      panel({
        sesion,
        activa: "/admin/usuarios",
        contenido: html`
          <div class="admin__cabeza">
            <h1>Usuarios</h1>
            <a class="boton boton--primario" href="#/admin/usuarios/nuevo">Crear usuario</a>
          </div>
          <p class="nota-admin">Cada perfil ve solo sus secciones: cocina los pedidos por preparar, el encargado el despacho, el dueño caja, reportes y productos, y el administrador todo.</p>
          <div class="tabla-envoltura">
            <table class="tabla">
              <thead><tr><th>Usuario</th><th>Perfil</th><th>Estado</th><th><span class="visualmente-oculto">Acciones</span></th></tr></thead>
              <tbody>
                ${usuarios.map(
                  (u) => html`
                    <tr data-usuario="${u.id}">
                      <td><strong>${u.nombre}</strong>${u.id === sesion.id ? " (tú)" : ""}<span class="tabla__detalle">${u.email}</span></td>
                      <td>${C.PERFILES[u.perfil]}</td>
                      <td>${interruptor(u.activo)}</td>
                      <td class="tabla__acciones"><a class="enlace-boton" href="#/admin/usuarios/${u.id}">Editar</a></td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
        `,
      }),
    );

    raiz.querySelector(".tabla").addEventListener("change", (evento) => {
      const casilla = evento.target.closest("[data-activo]");
      if (!casilla) return;
      try {
        const usuario = C.cambiarEstadoUsuario(casilla.closest("[data-usuario]").dataset.usuario, casilla.checked, { actorId: sesion.id });
        casilla.nextElementSibling.textContent = usuario.activo ? "Activo" : "Inactivo";
      } catch (fallo) {
        casilla.checked = !casilla.checked;
        avisar(fallo.message, { tipo: "error" });
      }
    });
  };

  PF.vistas.adminUsuarioFormulario = function ({ raiz, params, sesion }) {
    const esNuevo = !params.id;
    const usuario = esNuevo ? {} : C.obtenerUsuario(params.id);
    titulo(esNuevo ? "Crear usuario" : "Editar usuario");

    if (!usuario) {
      pintar(raiz, panel({ sesion, activa: "/admin/usuarios", contenido: html`<section class="estado estado--vacio"><h1>No encontramos ese usuario</h1><a class="boton" href="#/admin/usuarios">Volver</a></section>` }));
      return;
    }

    pintar(
      raiz,
      panel({
        sesion,
        activa: "/admin/usuarios",
        contenido: html`
          <a class="volver" href="#/admin/usuarios">Volver a usuarios</a>
          <h1>${esNuevo ? "Crear usuario" : `Editar ${usuario.nombre}`}</h1>
          <form class="formulario-admin" novalidate>
            ${F.campo({ nombre: "nombre", etiqueta: "Nombre", valor: usuario.nombre ?? "", autocompletar: "name" })}
            ${F.campo({ nombre: "email", etiqueta: "Correo", tipo: "email", valor: usuario.email ?? "", autocompletar: "email" })}
            ${F.selector({ nombre: "perfil", etiqueta: "Perfil", valor: usuario.perfil ?? "", opciones: Object.entries(C.PERFILES) })}
            ${F.campo({
              nombre: "clave",
              etiqueta: esNuevo ? "Contraseña" : "Contraseña nueva",
              tipo: "password",
              autocompletar: "new-password",
              ayuda: esNuevo ? "Al menos 8 caracteres, con letras y números." : "Déjala en blanco para mantener la actual.",
            })}
            <p class="checkout__error" data-error role="alert" hidden></p>
            <div class="estado__acciones estado__acciones--izquierda">
              <a class="boton" href="#/admin/usuarios">Cancelar</a>
              <button class="boton boton--primario" type="submit">${esNuevo ? "Crear usuario" : "Guardar cambios"}</button>
            </div>
          </form>
        `,
      }),
    );

    const form = raiz.querySelector("form");
    const error = raiz.querySelector("[data-error]");

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      F.mostrarError(error, "");
      const datos = { nombre: form.elements.nombre.value, email: form.elements.email.value, perfil: form.elements.perfil.value, clave: form.elements.clave.value };

      try {
        if (esNuevo) await C.crearUsuario(datos);
        else await C.actualizarUsuario(usuario.id, { ...datos, clave: datos.clave || null }, { actorId: sesion.id });
        avisar(esNuevo ? `Creamos a ${datos.nombre.trim()}.` : "Guardamos los cambios.", { tipo: "exito" });
        PF.router.navegar("/admin/usuarios");
      } catch (fallo) {
        F.mostrarError(error, fallo.message);
      }
    });
  };
})();
