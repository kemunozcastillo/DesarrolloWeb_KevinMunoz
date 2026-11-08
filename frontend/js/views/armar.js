PF.vistas = PF.vistas || {};

/**
 * Armador de bowls. La selección vive en la URL, así que recargar la página
 * o abrir el mismo enlace reconstruye el bowl:
 *   #/arma-tu-bowl?tamano=grande&base=base_gohan,base_quinoa&proteina=pro_salmon
 */
PF.vistas.armar = function ({ raiz, query }) {
  const { avisar, html, pintar, precio, titulo } = PF.ui;

  titulo("Arma tu bowl");

  pintar(
    raiz,
    html`
      <div class="pagina armador">
        <h1>Arma tu bowl</h1>

        <div class="armador__cuerpo">
          <div class="armador__pasos" data-editor></div>

          <aside class="resumen" aria-labelledby="resumen-titulo">
            <div class="resumen__interior">
              <h2 id="resumen-titulo">Tu bowl</h2>
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

  const editor = PF.editorBowl.crear({ contenedor: raiz.querySelector("[data-editor]"), query });

  const lista = raiz.querySelector("[data-resumen-lista]");
  const desglose = raiz.querySelector("[data-desglose]");
  const total = raiz.querySelector("[data-total]");
  const errorBowl = raiz.querySelector("[data-error]");
  const botonAgregar = raiz.querySelector("[data-agregar]");

  function actualizar() {
    PF.router.actualizarQuery(editor.valoresUrl());
    pintar(lista, PF.editorBowl.resumen(editor.resumenFilas()));

    errorBowl.hidden = true;
    botonAgregar.disabled = !editor.completo();

    if (!editor.completo()) {
      pintar(desglose, html`<p class="pendiente">Elige al menos una base y una proteína para ver el precio.</p>`);
      total.textContent = `desde ${precio(editor.tamano().precio)}`;
      return;
    }

    try {
      const bowl = PF.tienda.cotizarBowl(editor.entrada());
      pintar(desglose, html`<ul>${bowl.desglose.map((l) => html`<li><span>${l.concepto}</span><span>${precio(l.monto)}</span></li>`)}</ul>`);
      total.textContent = precio(bowl.precio);
    } catch (error) {
      errorBowl.textContent = error.message;
      errorBowl.hidden = false;
      botonAgregar.disabled = true;
      total.textContent = "—";
    }
  }

  editor.alCambiar(actualizar);

  botonAgregar.addEventListener("click", () => {
    try {
      PF.tienda.agregarBowl(editor.entrada());
      avisar("Agregamos tu bowl al carrito.", { tipo: "exito" });
    } catch (error) {
      avisar(error.message, { tipo: "error" });
    }
  });

  raiz.querySelector("[data-reiniciar]").addEventListener("click", () => editor.reiniciar());

  actualizar();
};
