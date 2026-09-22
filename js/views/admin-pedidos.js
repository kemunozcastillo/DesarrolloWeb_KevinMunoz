PF.vistas = PF.vistas || {};

/**
 * Operación diaria del restaurante:
 *   #/admin/pedidos            todos los pedidos, con filtro por estado (administrador)
 *   #/admin/caja               lo recaudado y las ventas del día (dueño)
 *   #/admin/cocina             pedidos pagados en orden de llegada: aceptar y marcar listos
 *   #/admin/despacho           pedidos listos: asignar chofer y registrar la entrega
 *   #/admin/orden/:id          orden de despacho imprimible para cocina
 */

(function () {
  const { avisar, crudo, html, pintar, precio, titulo, fechaHora, etiquetaEstado, panel } = PF.ui;
  const P = PF.pedidos;

  const hoy = () => P.diaLocal(new Date().toISOString());

  // -------------------------------------------------------------------------
  // Pedidos: #/admin/pedidos?estado=PAGADO&q=PF-00012
  // -------------------------------------------------------------------------

  PF.vistas.adminPedidos = function ({ raiz, query, sesion }) {
    titulo("Pedidos");

    const estado = P.ESTADOS[query.get("estado")] ? query.get("estado") : "";
    const busqueda = (query.get("q") ?? "").trim().toLowerCase();

    const pedidos = P.todos().filter(
      (p) =>
        (!estado || p.estado === estado) &&
        (!busqueda || p.id.toLowerCase().includes(busqueda) || p.cliente.nombre.toLowerCase().includes(busqueda)),
    );

    pintar(
      raiz,
      panel({
        sesion,
        activa: "/admin/pedidos",
        contenido: html`
          <h1>Pedidos</h1>
          <form class="admin__herramientas" data-filtros>
            <label class="selector">
              <span>Estado</span>
              <select name="estado">
                <option value="">Todos</option>
                ${Object.entries(P.ESTADOS).map(([valor, texto]) => html`<option value="${valor}" ${crudo(valor === estado ? "selected" : "")}>${texto}</option>`)}
              </select>
            </label>
            <label class="selector selector--busqueda">
              <span>Buscar</span>
              <input type="search" name="q" value="${query.get("q") ?? ""}" placeholder="Número o cliente" />
            </label>
          </form>

          ${pedidos.length
            ? html`
                <div class="tabla-envoltura">
                  <table class="tabla">
                    <thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Entrega</th><th>Estado</th><th class="tabla__numero">Total</th><th><span class="visualmente-oculto">Acciones</span></th></tr></thead>
                    <tbody>
                      ${pedidos.map(
                        (p) => html`
                          <tr data-pedido="${p.id}">
                            <td><a href="#/orden/${p.id}">${p.id}</a></td>
                            <td>${p.cliente.nombre}</td>
                            <td>${fechaHora(p.creadoEn)}</td>
                            <td>${p.modoEntrega === "DELIVERY" ? "Despacho" : "Retiro"}</td>
                            <td>${etiquetaEstado(p.estado)}</td>
                            <td class="tabla__numero">${precio(p.total)}</td>
                            <td class="tabla__acciones">
                              ${p.boleta ? html`<a class="enlace-boton" href="#/boleta/${p.boleta.numero}">Boleta</a>` : ""}
                              ${P.esAnulable(p) ? html`<button class="enlace-boton enlace-boton--peligro" type="button" data-anular>Anular</button>` : ""}
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
            : html`<section class="estado estado--vacio"><h2>No hay pedidos con ese filtro</h2><a class="boton" href="#/admin/pedidos">Ver todos</a></section>`}
        `,
      }),
    );

    // Los filtros viven en la URL; cambiar de estado es una navegación.
    const filtros = raiz.querySelector("[data-filtros]");
    const aplicar = () => {
      const params = new URLSearchParams();
      if (filtros.elements.estado.value) params.set("estado", filtros.elements.estado.value);
      if (filtros.elements.q.value.trim()) params.set("q", filtros.elements.q.value.trim());
      PF.router.navegar(`/admin/pedidos${params.toString() ? `?${params}` : ""}`);
    };
    filtros.elements.estado.addEventListener("change", aplicar);
    filtros.addEventListener("submit", (evento) => {
      evento.preventDefault();
      aplicar();
    });

    raiz.querySelector(".tabla")?.addEventListener("click", async (evento) => {
      if (!evento.target.closest("[data-anular]")) return;
      const id = evento.target.closest("[data-pedido]").dataset.pedido;

      const motivo = await PF.ui.pedirMotivo({ titulo: `Anular el pedido ${id}`, detalle: "Si estaba pagado, la venta queda anulada y se devuelve el pago.", confirmar: "Anular pedido" });
      if (!motivo) return;

      try {
        P.anular(id, sesion, motivo);
        avisar(`Anulamos el pedido ${id}.`, { tipo: "exito" });
        PF.router.recargar();
      } catch (fallo) {
        avisar(fallo.message, { tipo: "error" });
      }
    });
  };

  // -------------------------------------------------------------------------
  // Caja: #/admin/caja
  // -------------------------------------------------------------------------

  /**
   * Consulta de la caja web. No hay nada que confirmar a mano: el cajero
   * virtual es el sistema, que registra cada venta cuando Servipag confirma
   * el pago. El dueño revisa aquí lo recaudado al cierre del día.
   */
  PF.vistas.adminCaja = function ({ raiz, sesion }) {
    titulo("Caja");
    const delDia = P.reporte(hoy(), hoy());

    pintar(
      raiz,
      panel({
        sesion,
        activa: "/admin/caja",
        contenido: html`
          <h1>Caja web</h1>
          <p class="introduccion">Caja ${P.CAJA_WEB}, operada por el cajero virtual: cada pago confirmado por Servipag registra la venta y emite la boleta automáticamente.</p>

          <section class="tarjetas-resumen" aria-label="Resumen del día">
            <div><span>Recaudado hoy</span><strong>${precio(delDia.monto)}</strong></div>
            <div><span>Ventas hoy</span><strong>${delDia.cantidad}</strong></div>
            <div><span>Ticket promedio</span><strong>${precio(delDia.promedio)}</strong></div>
            <div><span>Devuelto por anulaciones</span><strong>${precio(delDia.montoAnulado)}</strong></div>
          </section>

          <h2 class="subtitulo">Ventas de hoy</h2>
          ${delDia.ventas.length
            ? html`
                <div class="tabla-envoltura">
                  <table class="tabla">
                    <thead><tr><th>Venta</th><th>Boleta</th><th>Hora</th><th>Cliente</th><th>Referencia</th><th class="tabla__numero">Total</th></tr></thead>
                    <tbody>
                      ${delDia.ventas.map(
                        (p) => html`
                          <tr class="${p.venta.anulada ? "fila-anulada" : ""}">
                            <td>N° ${p.venta.numero}${p.venta.anulada ? " (anulada)" : ""}</td>
                            <td><a href="#/boleta/${p.boleta.numero}">N° ${p.boleta.numero}</a></td>
                            <td>${new Date(p.venta.fecha).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</td>
                            <td>${p.cliente.nombre}</td>
                            <td>${p.pago.referencia}</td>
                            <td class="tabla__numero">${precio(p.total)}</td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
            : html`<p class="pendiente">Todavía no hay ventas hoy.</p>`}
          <p class="cuenta__alternativa"><a href="#/admin/reportes">Ver el reporte de otro período</a></p>
        `,
      }),
    );
  };

  // -------------------------------------------------------------------------
  // Cocina: #/admin/cocina
  // -------------------------------------------------------------------------

  const hora = (iso) => new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  function espera(iso) {
    const minutos = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (minutos < 60) return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    return minutos % 60 ? `${horas} h ${minutos % 60} min` : `${horas} h`;
  }

  function tarjetaPedido(p, i, acciones) {
    return html`
      <li class="tarjeta-cola ${p.estado === "PAGADO" ? "tarjeta-cola--nueva" : ""}" data-pedido="${p.id}">
        <span class="tarjeta-cola__turno" aria-label="Turno">${i + 1}</span>
        <div class="tarjeta-cola__cuerpo">
          <p><strong>${p.id}</strong> ${etiquetaEstado(p.estado)}</p>
          <p class="tabla__detalle">Pagado a las ${hora(p.venta.fecha)}, hace ${espera(p.venta.fecha)}</p>
          <p class="tabla__detalle">${p.modoEntrega === "DELIVERY" ? `Despacho a ${p.direccion}` : "Retiro en local"}${p.chofer ? `, con ${p.chofer}` : ""}</p>
          <ul class="tarjeta-cola__lineas">${p.lineas.map((l) => html`<li>${l.cantidad} × ${l.descripcion}</li>`)}</ul>
          ${p.nota ? html`<p class="tarjeta-cola__nota">Indicaciones: ${p.nota}</p>` : ""}
        </div>
        <div class="tarjeta-cola__acciones">${acciones}</div>
      </li>
    `;
  }

  PF.vistas.adminCocina = function ({ raiz, sesion }) {
    titulo("Cocina");
    const cola = P.colaCocina();
    const nuevos = cola.filter((p) => p.estado === "PAGADO").length;

    pintar(
      raiz,
      panel({
        sesion,
        activa: "/admin/cocina",
        contenido: html`
          <h1>Cocina</h1>
          <p class="introduccion">Los pedidos llegan solos apenas se confirma el pago, en el orden en que se pagaron. Acepta cada uno para empezar a prepararlo y márcalo listo al terminar.</p>
          ${nuevos ? html`<p class="aviso-bloque" role="status">${nuevos === 1 ? "Hay 1 pedido nuevo esperando" : `Hay ${nuevos} pedidos nuevos esperando`}.</p>` : ""}

          ${cola.length
            ? html`
                <ol class="cola">
                  ${cola.map((p, i) =>
                    tarjetaPedido(
                      p,
                      i,
                      html`
                        <a class="boton" href="#/admin/orden/${p.id}">${p.ordenImpresa ? "Reimprimir orden" : "Imprimir orden"}</a>
                        ${p.estado === "PAGADO"
                          ? html`<button class="boton boton--primario" type="button" data-accion="aceptar">Aceptar pedido</button>`
                          : html`<button class="boton boton--primario" type="button" data-accion="terminar">${p.modoEntrega === "DELIVERY" ? "Listo, a despacho" : "Listo para retiro"}</button>`}
                      `,
                    ),
                  )}
                </ol>
              `
            : html`<section class="estado estado--vacio"><h2>No hay pedidos por preparar</h2><p>Los pedidos aparecen aquí apenas se confirma su pago, con un aviso.</p></section>`}
        `,
      }),
    );

    raiz.querySelector(".cola")?.addEventListener("click", (evento) => {
      const boton = evento.target.closest("[data-accion]");
      if (!boton) return;
      const id = boton.closest("[data-pedido]").dataset.pedido;

      try {
        const pedido = boton.dataset.accion === "aceptar" ? P.aceptar(id, sesion) : P.terminar(id, sesion);
        avisar(`${pedido.id}: ${P.ESTADOS[pedido.estado]}.`, { tipo: "exito" });
        PF.router.recargar();
      } catch (fallo) {
        avisar(fallo.message, { tipo: "error" });
        PF.router.recargar(); // otro puesto pudo tomar el pedido antes
      }
    });
  };

  // -------------------------------------------------------------------------
  // Despacho: #/admin/despacho
  // -------------------------------------------------------------------------

  PF.vistas.adminDespacho = function ({ raiz, sesion }) {
    titulo("Despacho");
    const cola = P.colaDespacho();

    pintar(
      raiz,
      panel({
        sesion,
        activa: "/admin/despacho",
        contenido: html`
          <h1>Despacho</h1>
          <p class="introduccion">Pedidos que cocina marcó listos, en el orden en que quedaron listos. Asigna un chofer a los despachos y registra cada entrega.</p>

          ${cola.length
            ? html`
                <ol class="cola">
                  ${cola.map((p, i) =>
                    tarjetaPedido(
                      p,
                      i,
                      p.estado === "LISTO_DESPACHO"
                        ? html`
                            <select data-chofer aria-label="Chofer para ${p.id}">
                              <option value="">Elige chofer</option>
                              ${P.CHOFERES.map((c) => html`<option value="${c}">${c}</option>`)}
                            </select>
                            <button class="boton boton--primario" type="button" data-accion="despachar">Enviar con chofer</button>
                          `
                        : html`<button class="boton boton--primario" type="button" data-accion="entregar">${p.estado === "LISTO_RETIRO" ? "Marcar retirado" : "Marcar entregado"}</button>`,
                    ),
                  )}
                </ol>
              `
            : html`<section class="estado estado--vacio"><h2>No hay pedidos listos</h2><p>Aparecen aquí cuando cocina los marca listos.</p></section>`}
        `,
      }),
    );

    raiz.querySelector(".cola")?.addEventListener("click", (evento) => {
      const boton = evento.target.closest("[data-accion]");
      if (!boton) return;
      const tarjeta = boton.closest("[data-pedido]");

      try {
        const pedido =
          boton.dataset.accion === "despachar"
            ? P.despachar(tarjeta.dataset.pedido, sesion, tarjeta.querySelector("[data-chofer]").value)
            : P.entregar(tarjeta.dataset.pedido, sesion);
        avisar(`${pedido.id}: ${P.ESTADOS[pedido.estado]}.`, { tipo: "exito" });
        PF.router.recargar();
      } catch (fallo) {
        avisar(fallo.message, { tipo: "error" });
      }
    });
  };

  // -------------------------------------------------------------------------
  // Orden de despacho imprimible: #/admin/orden/:id
  // -------------------------------------------------------------------------

  PF.vistas.ordenDespacho = function ({ raiz, params, sesion }) {
    const pedido = P.obtener(params.id);
    titulo(`Orden de despacho ${params.id}`);
    const volver = sesion.perfil === "DESPACHO" ? "/admin/despacho" : "/admin/cocina";

    if (!pedido || !pedido.venta) {
      pintar(raiz, html`<div class="pagina pagina--angosta"><section class="estado estado--vacio"><h1>No hay orden de despacho para ${params.id}</h1><a class="boton" href="#${volver}">Volver</a></section></div>`);
      return;
    }

    const turno = P.colaCocina().findIndex((p) => p.id === pedido.id) + 1;

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta">
          <div class="no-imprimir estado__acciones estado__acciones--izquierda barra-boleta">
            <a class="volver" href="#${volver}">Volver</a>
            <button class="boton boton--primario" type="button" data-imprimir>Imprimir</button>
          </div>

          <article class="boleta orden-despacho">
            <header class="boleta__cabeza">
              <div>
                <p class="boleta__empresa">Orden de despacho</p>
                <p>Poke Fresh, cocina</p>
              </div>
              <div class="boleta__folio">
                <p><strong>${pedido.id}</strong></p>
                ${turno ? html`<p>Turno ${turno}</p>` : ""}
              </div>
            </header>

            <dl class="boleta__datos">
              <div><dt>Pagado</dt><dd>${fechaHora(pedido.venta.fecha)}</dd></div>
              <div><dt>Cliente</dt><dd>${pedido.cliente.nombre}</dd></div>
              <div><dt>Teléfono</dt><dd>${pedido.cliente.telefono}</dd></div>
              <div><dt>Entrega</dt><dd>${pedido.modoEntrega === "DELIVERY" ? `Despacho a ${pedido.direccion}` : "Retiro en local"}</dd></div>
              ${pedido.chofer ? html`<div><dt>Chofer</dt><dd>${pedido.chofer}</dd></div>` : ""}
            </dl>

            <table class="boleta__detalle">
              <thead><tr><th>Cant.</th><th>Preparación</th></tr></thead>
              <tbody>${pedido.lineas.map((l) => html`<tr><td class="orden-despacho__cantidad">${l.cantidad}</td><td>${l.descripcion}</td></tr>`)}</tbody>
            </table>

            ${pedido.nota ? html`<p class="orden-despacho__nota"><strong>Indicaciones:</strong> ${pedido.nota}</p>` : ""}
            <p class="boleta__pie">Impresa el ${fechaHora(new Date().toISOString())}</p>
          </article>
        </div>
      `,
    );

    raiz.querySelector("[data-imprimir]").addEventListener("click", () => {
      P.marcarImpresa(pedido.id);
      window.print();
    });
  };
})();
