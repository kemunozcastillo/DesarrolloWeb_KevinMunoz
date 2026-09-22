PF.vistas = PF.vistas || {};

/**
 * Pago, seguimiento del pedido y boleta digital.
 */

(function () {
  const { avisar, crudo, html, pintar, precio, titulo, fechaHora, etiquetaEstado } = PF.ui;
  const P = PF.pedidos;

  const noEncontrado = (raiz, id) =>
    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta">
          <section class="estado estado--vacio">
            <h1>No encontramos el pedido ${id}</h1>
            <p>Revisa el enlace o busca el pedido en tu historial.</p>
            <a class="boton" href="#/mis-pedidos">Ver mis pedidos</a>
          </section>
        </div>
      `,
    );

  /** Un cliente solo ve sus pedidos; el personal ve todos. */
  const puedeVer = (pedido, sesion) => sesion.tipo === "USUARIO" || pedido.clienteId === sesion.id;

  // -------------------------------------------------------------------------
  // Pago: #/pago/:id
  // -------------------------------------------------------------------------

  PF.vistas.pago = function ({ raiz, params, sesion }) {
    titulo("Pago");
    const pedido = P.obtener(params.id);

    if (!pedido || pedido.clienteId !== sesion.id) return noEncontrado(raiz, params.id);
    if (pedido.estado !== "PENDIENTE_PAGO") {
      PF.router.navegar(`/orden/${pedido.id}`, { reemplazar: true });
      return;
    }

    const pasarela = html`
      <section class="pasarela" aria-labelledby="pasarela-titulo">
        <p class="pasarela__marca">Servipag <span>Simulación de plataforma de pago externa</span></p>
        <h2 id="pasarela-titulo">Pagar a ${P.EMPRESA.razonSocial}</h2>
        <dl class="pasarela__datos">
          <div><dt>Pedido</dt><dd>${pedido.id}</dd></div>
          <div><dt>Monto</dt><dd><strong>${precio(pedido.total)}</strong></dd></div>
        </dl>
        <div class="estado__acciones estado__acciones--izquierda">
          <button class="boton boton--primario" type="button" data-pagar>Pagar ${precio(pedido.total)}</button>
          <a class="boton" href="#/orden/${pedido.id}">Pagar más tarde</a>
        </div>
      </section>
    `;

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta">
          <h1>Pago del pedido ${pedido.id}</h1>
          <p class="introduccion">Con el pago confirmado, tu pedido pasa directo a cocina.</p>
          ${pasarela}
          <p class="cuenta__alternativa"><a href="#/orden/${pedido.id}">Ver el pedido</a></p>
        </div>
      `,
    );

    raiz.querySelector("[data-pagar]")?.addEventListener("click", (evento) => {
      evento.currentTarget.disabled = true;
      try {
        const pagado = P.pagarEnLinea(pedido.id, sesion);
        avisar(`Pago confirmado. Enviamos la boleta N° ${pagado.boleta.numero} a ${pagado.boleta.enviadaA}.`, { tipo: "exito", duracion: 5000 });
        PF.router.navegar(`/orden/${pedido.id}`, { reemplazar: true });
      } catch (fallo) {
        avisar(fallo.message, { tipo: "error" });
        evento.currentTarget.disabled = false;
      }
    });
  };

  // -------------------------------------------------------------------------
  // Seguimiento: #/orden/:id
  // -------------------------------------------------------------------------

  const PASOS = {
    DELIVERY: ["PENDIENTE_PAGO", "PAGADO", "EN_PREPARACION", "LISTO_DESPACHO", "EN_DESPACHO", "ENTREGADO"],
    RETIRO: ["PENDIENTE_PAGO", "PAGADO", "EN_PREPARACION", "LISTO_RETIRO", "ENTREGADO"],
  };

  function lineaDeTiempo(pedido) {
    if (pedido.estado === "ANULADO") return "";
    const pasos = PASOS[pedido.modoEntrega];
    const actual = pasos.indexOf(pedido.estado);

    return html`
      <ol class="linea-tiempo" aria-label="Avance del pedido">
        ${pasos.map((estado, i) => html`<li class="${i < actual ? "hecho" : i === actual ? "actual" : ""}" ${crudo(i === actual ? 'aria-current="step"' : "")}>${P.ESTADOS[estado]}</li>`)}
      </ol>
    `;
  }

  PF.vistas.orden = function ({ raiz, params, sesion }) {
    const pedido = P.obtener(params.id);
    titulo(`Pedido ${params.id}`);

    if (!pedido || !puedeVer(pedido, sesion)) return noEncontrado(raiz, params.id);

    const esCliente = sesion.tipo === "CLIENTE";
    const puedeAnular = P.esAnulable(pedido) && (esCliente || sesion.perfil === "ADMIN");
    const entrega = pedido.modoEntrega === "DELIVERY" ? `Despacho gratis a ${pedido.direccion}` : "Retiro en el local";

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta">
          <a class="volver" href="#${esCliente ? "/mis-pedidos" : "/admin/pedidos"}">${esCliente ? "Mis pedidos" : "Pedidos"}</a>
          <section class="orden">
            ${etiquetaEstado(pedido.estado)}
            <h1>Pedido ${pedido.id}</h1>
            <p class="orden__meta">Creado el ${fechaHora(pedido.creadoEn)}<br />${entrega}.</p>
            ${lineaDeTiempo(pedido)}

            ${pedido.estado === "PENDIENTE_PAGO" && esCliente
              ? html`<p class="aviso-bloque">Falta el pago. <a href="#/pago/${pedido.id}">Ir a pagar</a></p>`
              : ""}
            ${pedido.estado === "ANULADO"
              ? html`<p class="aviso-bloque aviso-bloque--anulado">Anulado el ${fechaHora(pedido.anulacion.fecha)} por ${pedido.anulacion.por}. Motivo: ${pedido.anulacion.motivo}.${pedido.anulacion.devolucion ? " Devolvimos el pago al medio original." : ""}</p>`
              : ""}
            ${pedido.chofer && pedido.estado === "EN_DESPACHO" ? html`<p class="aviso-bloque">Va en camino con ${pedido.chofer}.</p>` : ""}

            <ul class="resumen__lineas orden__lineas">
              ${pedido.lineas.map((l) => html`<li><span>${l.cantidad} × ${l.descripcion}</span><span>${precio(l.subtotal)}</span></li>`)}
              <li><span>Despacho</span><span>Gratis</span></li>
            </ul>
            <div class="resumen__total"><span>Total</span><strong>${precio(pedido.total)}</strong></div>
            ${pedido.nota ? html`<p class="orden__nota">Indicaciones: ${pedido.nota}</p>` : ""}

            <div class="estado__acciones estado__acciones--izquierda">
              ${pedido.boleta ? html`<a class="boton" href="#/boleta/${pedido.boleta.numero}">Ver boleta N° ${pedido.boleta.numero}</a>` : ""}
              ${puedeAnular ? html`<button class="boton boton--peligro" type="button" data-anular>Anular pedido</button>` : ""}
            </div>
          </section>

          ${!esCliente
            ? html`
                <section class="historial">
                  <h2>Historial</h2>
                  <ol>
                    ${pedido.historial.map((h) => html`<li><time>${fechaHora(h.fecha)}</time> <strong>${P.ESTADOS[h.estado]}</strong>, ${h.actor}${h.nota ? `: ${h.nota}` : ""}</li>`)}
                  </ol>
                </section>
              `
            : ""}
        </div>
      `,
    );

    raiz.querySelector("[data-anular]")?.addEventListener("click", async () => {
      const motivo = await PF.ui.pedirMotivo({
        titulo: `Anular el pedido ${pedido.id}`,
        detalle: pedido.estado === "PAGADO" ? "El pedido ya está pagado y esperando cocina: al anularlo, la venta queda anulada y se devuelve el pago." : "",
        confirmar: "Anular pedido",
      });
      if (!motivo) return;

      try {
        P.anular(pedido.id, sesion, motivo);
        avisar("Anulamos el pedido.", { tipo: "exito" });
        PF.router.recargar();
      } catch (fallo) {
        avisar(fallo.message, { tipo: "error" });
      }
    });
  };

  // -------------------------------------------------------------------------
  // Boleta digital: #/boleta/:numero
  // -------------------------------------------------------------------------

  PF.vistas.boleta = function ({ raiz, params, sesion }) {
    const pedido = P.porBoleta(params.numero);
    titulo(`Boleta ${params.numero}`);

    if (!pedido || !puedeVer(pedido, sesion)) {
      pintar(raiz, html`<div class="pagina pagina--angosta"><section class="estado estado--vacio"><h1>No encontramos esa boleta</h1><a class="boton" href="#/">Ir al inicio</a></section></div>`);
      return;
    }

    const b = pedido.boleta;

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta">
          <div class="no-imprimir estado__acciones estado__acciones--izquierda barra-boleta">
            <a class="volver" href="#/orden/${pedido.id}">Volver al pedido</a>
            <button class="boton" type="button" data-imprimir>Imprimir o guardar PDF</button>
          </div>

          <article class="boleta" aria-label="Boleta electrónica">
            <header class="boleta__cabeza">
              <div>
                <p class="boleta__empresa">${P.EMPRESA.razonSocial}</p>
                <p>${P.EMPRESA.giro}</p>
                <p>${P.EMPRESA.direccion}</p>
              </div>
              <div class="boleta__folio">
                <p>R.U.T. ${P.EMPRESA.rut}</p>
                <p><strong>BOLETA ELECTRÓNICA</strong></p>
                <p>N° ${String(b.numero).padStart(6, "0")}</p>
              </div>
            </header>

            <dl class="boleta__datos">
              <div><dt>Fecha</dt><dd>${fechaHora(b.fecha)}</dd></div>
              <div><dt>Cliente</dt><dd>${pedido.cliente.nombre}</dd></div>
              <div><dt>RUN</dt><dd>${PF.cuentas.formatearRun(pedido.cliente.run)}</dd></div>
              <div><dt>Pedido</dt><dd>${pedido.id}</dd></div>
              <div><dt>Venta</dt><dd>N° ${pedido.venta.numero}, ${pedido.venta.caja}</dd></div>
              <div><dt>Emitida por</dt><dd>${pedido.venta.cajero}</dd></div>
            </dl>

            <table class="boleta__detalle">
              <thead><tr><th>Cant.</th><th>Detalle</th><th class="tabla__numero">P. unit.</th><th class="tabla__numero">Total</th></tr></thead>
              <tbody>
                ${pedido.lineas.map((l) => html`<tr><td>${l.cantidad}</td><td>${l.descripcion}</td><td class="tabla__numero">${precio(l.precioUnitario)}</td><td class="tabla__numero">${precio(l.subtotal)}</td></tr>`)}
                <tr><td>1</td><td>Despacho</td><td class="tabla__numero">${precio(0)}</td><td class="tabla__numero">${precio(0)}</td></tr>
              </tbody>
            </table>

            <dl class="boleta__totales">
              <div><dt>Monto neto</dt><dd>${precio(b.neto)}</dd></div>
              <div><dt>IVA (19%)</dt><dd>${precio(b.iva)}</dd></div>
              <div class="boleta__total"><dt>Total</dt><dd>${precio(b.total)}</dd></div>
            </dl>

            ${pedido.venta.anulada ? html`<p class="boleta__anulada">VENTA ANULADA: ${pedido.anulacion?.motivo ?? ""}</p>` : ""}
            <p class="boleta__pie">Enviada a ${b.enviadaA} (envío simulado). Documento de ejemplo sin validez tributaria.</p>
          </article>
        </div>
      `,
    );

    raiz.querySelector("[data-imprimir]").addEventListener("click", () => window.print());
  };
})();
