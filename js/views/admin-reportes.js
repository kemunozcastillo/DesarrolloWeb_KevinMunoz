PF.vistas = PF.vistas || {};

/**
 * Reporte de ventas por período, para el dueño y el administrador.
 *   #/admin/reportes?desde=2026-09-01&hasta=2026-09-21
 */
PF.vistas.adminReportes = function ({ raiz, query, sesion }) {
  const { crudo, html, pintar, precio, titulo, fechaHora, fechaCorta, panel, descargar } = PF.ui;
  const P = PF.pedidos;

  titulo("Reporte de ventas");

  const dia = (fecha) => P.diaLocal(fecha.toISOString());
  const haceDias = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return dia(d);
  };
  const hoy = dia(new Date());
  const inicioMes = (() => {
    const d = new Date();
    d.setDate(1);
    return dia(d);
  })();

  const fechaValida = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(valor ?? "") && !Number.isNaN(Date.parse(valor));
  let desde = fechaValida(query.get("desde")) ? query.get("desde") : haceDias(6);
  let hasta = fechaValida(query.get("hasta")) ? query.get("hasta") : hoy;
  if (desde > hasta) [desde, hasta] = [hasta, desde];

  const RANGOS = [
    { texto: "Hoy", desde: hoy, hasta: hoy },
    { texto: "Últimos 7 días", desde: haceDias(6), hasta: hoy },
    { texto: "Últimos 30 días", desde: haceDias(29), hasta: hoy },
    { texto: "Este mes", desde: inicioMes, hasta: hoy },
  ];

  const r = P.reporte(desde, hasta);
  const maximo = Math.max(1, ...r.porDia.map((d) => d.monto));
  const etiquetaDia = (valor) => {
    const [a, m, d] = valor.split("-");
    return `${d}/${m}`;
  };

  pintar(
    raiz,
    panel({
      sesion,
      activa: "/admin/reportes",
      contenido: html`
        <div class="admin__cabeza">
          <h1>Reporte de ventas</h1>
          <div class="estado__acciones no-imprimir">
            <button class="boton" type="button" data-csv ${crudo(r.ventas.length ? "" : "disabled")}>Descargar CSV</button>
            <button class="boton" type="button" data-imprimir>Imprimir</button>
          </div>
        </div>

        <form class="admin__herramientas no-imprimir" data-periodo novalidate>
          <label class="selector"><span>Desde</span><input type="date" name="desde" value="${desde}" max="${hoy}" /></label>
          <label class="selector"><span>Hasta</span><input type="date" name="hasta" value="${hasta}" max="${hoy}" /></label>
          <button class="boton" type="submit">Consultar</button>
          <div class="rangos">
            ${RANGOS.map((g) => html`<a href="#/admin/reportes?desde=${g.desde}&hasta=${g.hasta}" ${crudo(g.desde === desde && g.hasta === hasta ? 'aria-current="true"' : "")}>${g.texto}</a>`)}
          </div>
        </form>

        <p class="reporte__periodo">Período: ${fechaCorta(`${desde}T12:00:00`)} al ${fechaCorta(`${hasta}T12:00:00`)}</p>

        <section class="tarjetas-resumen" aria-label="Totales del período">
          <div><span>Monto vendido</span><strong>${precio(r.monto)}</strong></div>
          <div><span>Ventas</span><strong>${r.cantidad}</strong></div>
          <div><span>Ticket promedio</span><strong>${precio(r.promedio)}</strong></div>
          <div><span>Anuladas</span><strong>${r.anuladas}</strong><small>${precio(r.montoAnulado)} devueltos</small></div>
        </section>

        ${r.porDia.length <= 62
          ? html`
              <section class="grafico" aria-label="Monto vendido por día">
                <h2 class="subtitulo">Monto por día</h2>
                <div class="grafico__barras" style="--columnas: ${r.porDia.length}">
                  ${r.porDia.map(
                    (d) => html`
                      <div class="grafico__columna" title="${etiquetaDia(d.dia)}: ${precio(d.monto)}, ${d.cantidad} venta(s)">
                        <span class="grafico__barra" style="height: ${Math.round((d.monto / maximo) * 100)}%"></span>
                        <span class="grafico__etiqueta">${etiquetaDia(d.dia)}</span>
                      </div>
                    `,
                  )}
                </div>
              </section>
            `
          : ""}

        <div class="reporte__dos">
          <section>
            <h2 class="subtitulo">Por tipo de entrega</h2>
            <table class="tabla tabla--compacta">
              <tbody>${r.porEntrega.map((m) => html`<tr><td>${m.nombre}</td><td class="tabla__numero">${m.cantidad}</td><td class="tabla__numero">${precio(m.monto)}</td></tr>`)}</tbody>
            </table>
          </section>
          <section>
            <h2 class="subtitulo">Lo más vendido</h2>
            ${r.masVendidos.length
              ? html`<table class="tabla tabla--compacta"><tbody>${r.masVendidos.map((p) => html`<tr><td>${p.nombre}</td><td class="tabla__numero">${p.cantidad} u.</td><td class="tabla__numero">${precio(p.monto)}</td></tr>`)}</tbody></table>`
              : html`<p class="pendiente">Sin ventas en el período.</p>`}
          </section>
        </div>

        <h2 class="subtitulo">Detalle de ventas</h2>
        ${r.ventas.length
          ? html`
              <div class="tabla-envoltura">
                <table class="tabla">
                  <thead><tr><th>Venta</th><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Boleta</th><th class="tabla__numero">Total</th></tr></thead>
                  <tbody>
                    ${r.ventas.map(
                      (p) => html`
                        <tr class="${p.venta.anulada ? "fila-anulada" : ""}">
                          <td>N° ${p.venta.numero}${p.venta.anulada ? " (anulada)" : ""}</td>
                          <td>${fechaHora(p.venta.fecha)}</td>
                          <td><a href="#/orden/${p.id}">${p.id}</a></td>
                          <td>${p.cliente.nombre}</td>
                          <td><a href="#/boleta/${p.boleta.numero}">N° ${p.boleta.numero}</a></td>
                          <td class="tabla__numero">${precio(p.total)}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            `
          : html`<p class="pendiente">No hay ventas entre esas fechas.</p>`}
      `,
    }),
  );

  const form = raiz.querySelector("[data-periodo]");
  form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const d = form.elements.desde.value;
    const h = form.elements.hasta.value;
    if (!fechaValida(d) || !fechaValida(h)) {
      PF.ui.avisar("Elige ambas fechas.", { tipo: "error" });
      return;
    }
    PF.router.navegar(`/admin/reportes?desde=${d}&hasta=${h}`);
  });

  raiz.querySelector("[data-imprimir]").addEventListener("click", () => window.print());

  raiz.querySelector("[data-csv]").addEventListener("click", () => {
    const celda = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const filas = [
      ["Venta", "Fecha", "Pedido", "Cliente", "RUN", "Boleta", "Entrega", "Estado", "Total"],
      ...r.ventas.map((p) => [
        p.venta.numero,
        fechaHora(p.venta.fecha),
        p.id,
        p.cliente.nombre,
        PF.cuentas.formatearRun(p.cliente.run),
        p.boleta.numero,
        p.modoEntrega === "DELIVERY" ? "Despacho" : "Retiro",
        p.venta.anulada ? "Anulada" : "Vigente",
        p.total,
      ]),
    ];
    // Punto y coma: es el separador que Excel en español abre sin configurar nada.
    descargar(`ventas_${desde}_${hasta}.csv`, filas.map((f) => f.map(celda).join(";")).join("\r\n"));
  });
};
