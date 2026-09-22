PF.vistas = PF.vistas || {};

/**
 * Armado de una promoción: #/promo/:id
 *
 * Combo mediodía: un bowl regular y una bebida.
 *   #/promo/promo_combo?base=base_gohan&proteina=pro_salmon&bebida=beb_te
 * Dúo para compartir: dos bowls regulares, cada uno con su prefijo en la URL.
 *   #/promo/promo_duo?b1_base=base_gohan&b1_proteina=pro_pollo&b2_base=...
 */
PF.vistas.promo = function ({ raiz, params, query }) {
  const { avisar, crudo, html, imagen, pintar, precio, titulo } = PF.ui;
  const catalogo = PF.datos.catalogo;

  const item = catalogo.obtener(params.id);
  const config = PF.tienda.PROMOS[params.id];

  if (!item || item.categoria !== "PROMOCION" || !config || !item.disponible) {
    titulo("Promoción");
    const motivo = !item ? "Esta promoción ya no existe." : !item.disponible ? "Esta promoción no está disponible hoy." : "Esta promoción no se arma.";

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta">
          <section class="estado estado--vacio">
            <h1>${motivo}</h1>
            <p>Revisa las demás promociones del menú.</p>
            <a class="boton boton--primario" href="#/menu?categoria=promociones">Ver promociones</a>
          </section>
        </div>
      `,
    );
    return;
  }

  titulo(item.nombre);

  const varios = config.bowls > 1;
  const prefijos = Array.from({ length: config.bowls }, (_, i) => (varios ? `b${i + 1}_` : ""));

  // Bebida elegida desde la URL, solo si existe y está disponible.
  const bebidas = catalogo.listar({ categoria: "BEBIDA" });
  const bebidaUrl = query.get("bebida");
  let bebidaId = bebidas.some((b) => b.id === bebidaUrl && b.disponible) ? bebidaUrl : null;

  const pasoBebida = () => html`
    <section class="paso" aria-labelledby="paso-bebida">
      <header class="paso__cabeza">
        <span class="paso__numero" aria-hidden="true">5</span>
        <div>
          <h2 id="paso-bebida">Elige tu bebida</h2>
          <p class="paso__ayuda">Incluida en la promoción.</p>
        </div>
      </header>
      <div class="opciones" data-bebidas>
        ${bebidas.map(
          (b) => html`
            <button type="button" class="opcion" data-bebida="${b.id}" aria-pressed="false" ${crudo(b.disponible ? "" : "disabled")}>
              ${imagen(b.nombre, { clase: "opcion__foto foto" })}
              <span class="opcion__texto">
                <span class="opcion__nombre">${b.nombre}</span>
                <span class="opcion__detalle">${b.disponible ? b.descripcion : "Agotado hoy"}</span>
              </span>
              <span class="opcion__marca" aria-hidden="true"></span>
            </button>
          `,
        )}
      </div>
    </section>
  `;

  pintar(
    raiz,
    html`
      <div class="pagina armador">
        <a class="volver" href="#/menu?categoria=promociones">Volver a promociones</a>
        <h1>${item.nombre}</h1>
        <p class="introduccion">${config.detalle} Lo que agregues sobre lo incluido se suma aparte.</p>

        <div class="armador__cuerpo">
          <div class="armador__pasos">
            ${prefijos.map(
              (_, i) => html`
                <div class="promo__bowl">
                  ${varios ? html`<h2 class="promo__titulo">Bowl ${i + 1}</h2>` : ""}
                  <div data-editor="${i}"></div>
                </div>
              `,
            )}
            ${config.bebida ? pasoBebida() : ""}
          </div>

          <aside class="resumen" aria-labelledby="resumen-titulo">
            <div class="resumen__interior">
              <h2 id="resumen-titulo">Tu promoción</h2>
              <div data-resumen-lista></div>
              <div class="resumen__desglose" data-desglose aria-live="polite"></div>
              <div class="resumen__total">
                <span>Total</span>
                <strong data-total>—</strong>
              </div>
              <p class="resumen__error" data-error role="alert" hidden></p>
              <button class="boton boton--primario boton--ancho" type="button" data-agregar disabled>Agregar al carrito</button>
              <div class="resumen__secundarias">
                <button class="enlace-boton" type="button" data-reiniciar>Empezar de nuevo</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    `,
  );

  const editores = prefijos.map((prefijo, i) =>
    PF.editorBowl.crear({
      contenedor: raiz.querySelector(`[data-editor="${i}"]`),
      query,
      prefijo,
      tamanoFijo: config.tamanoId,
    }),
  );

  const lista = raiz.querySelector("[data-resumen-lista]");
  const desglose = raiz.querySelector("[data-desglose]");
  const total = raiz.querySelector("[data-total]");
  const errorPromo = raiz.querySelector("[data-error]");
  const botonAgregar = raiz.querySelector("[data-agregar]");

  const completa = () => editores.every((e) => e.completo()) && (!config.bebida || bebidaId);
  const seleccion = () => ({ bowls: editores.map((e) => e.entrada()), bebidaId });

  function refrescarBebidas() {
    raiz.querySelectorAll("[data-bebida]").forEach((boton) => {
      boton.setAttribute("aria-pressed", String(boton.dataset.bebida === bebidaId));
    });
  }

  function actualizar() {
    PF.router.actualizarQuery({
      ...Object.assign({}, ...editores.map((e) => e.valoresUrl())),
      bebida: bebidaId,
    });

    refrescarBebidas();

    // Resumen: las filas de cada bowl y la bebida.
    const filas = editores.flatMap((e, i) =>
      e.resumenFilas().map((fila) => ({ ...fila, titulo: varios ? `${fila.titulo} ${i + 1}` : fila.titulo })),
    );
    if (config.bebida) {
      filas.push({ titulo: "Bebida", nombres: bebidaId ? [catalogo.obtener(bebidaId).nombre] : [] });
    }
    pintar(lista, PF.editorBowl.resumen(filas));

    errorPromo.hidden = true;
    botonAgregar.disabled = !completa();

    if (!completa()) {
      const falta = config.bebida ? "Elige base y proteína de tu bowl, y tu bebida, para ver el precio." : "Elige base y proteína de cada bowl para ver el precio.";
      pintar(desglose, html`<p class="pendiente">${falta}</p>`);
      total.textContent = `desde ${precio(item.precio)}`;
      return;
    }

    try {
      const promo = PF.tienda.cotizarPromo(item.id, seleccion());
      pintar(desglose, html`<ul>${promo.desglose.map((l) => html`<li><span>${l.concepto}</span><span>${precio(l.monto)}</span></li>`)}</ul>`);
      total.textContent = precio(promo.precio);
    } catch (error) {
      errorPromo.textContent = error.message;
      errorPromo.hidden = false;
      botonAgregar.disabled = true;
      total.textContent = "—";
    }
  }

  editores.forEach((e) => e.alCambiar(actualizar));

  raiz.querySelector("[data-bebidas]")?.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-bebida]");
    if (!boton || boton.disabled) return;
    // Una sola bebida: tocar la elegida la desmarca, tocar otra la reemplaza.
    bebidaId = boton.dataset.bebida === bebidaId ? null : boton.dataset.bebida;
    actualizar();
  });

  botonAgregar.addEventListener("click", () => {
    try {
      PF.tienda.agregarPromo(item.id, seleccion());
      avisar(`Agregamos ${item.nombre} al carrito.`, { tipo: "exito" });
    } catch (error) {
      avisar(error.message, { tipo: "error" });
    }
  });

  raiz.querySelector("[data-reiniciar]").addEventListener("click", () => {
    bebidaId = null;
    editores.forEach((e) => e.reiniciar()); // cada reinicio dispara actualizar()
    if (!editores.length) actualizar();
  });

  actualizar();
};
