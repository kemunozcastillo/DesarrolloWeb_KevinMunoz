PF.vistas = PF.vistas || {};

/**
 * Confirmación del pedido. Solo para clientes con sesión (el caso exige que
 * las ventas sean a clientes registrados). Los datos de contacto y la
 * dirección salen de la ficha del cliente.
 *   #/checkout?entrega=delivery
 */
PF.vistas.checkout = function ({ raiz, query, sesion }) {
  const { crudo, html, pintar, precio, titulo } = PF.ui;

  titulo("Confirmar pedido");

  const carrito = PF.tienda.obtenerCarrito();
  if (carrito.lineas.length === 0) {
    PF.router.navegar("/carrito", { reemplazar: true });
    return;
  }

  const cliente = PF.cuentas.obtenerCliente(sesion.id);
  const conDespacho = PF.geografia.tieneDespacho(cliente.comuna);

  const modoInicial = conDespacho && query.get("entrega") === "delivery" ? "DELIVERY" : "RETIRO";
  const marcado = (condicion) => crudo(condicion ? "checked" : "");

  pintar(
    raiz,
    html`
      <div class="pagina checkout">
        <form class="checkout__formulario" novalidate>
          <h1>Confirmar pedido</h1>

          <section class="ficha-cliente">
            <div>
              <h2>${cliente.nombre}</h2>
              <p>${cliente.email}</p>
              <p>${cliente.telefono}</p>
            </div>
            <a class="enlace-boton" href="#/mi-cuenta">Editar mis datos</a>
          </section>

          <fieldset class="grupo-campos">
            <legend>Entrega</legend>
            <div class="modos">
              <label class="modo">
                <input type="radio" name="modo" value="RETIRO" ${marcado(modoInicial === "RETIRO")} />
                <span><strong>Retiro en local</strong>Listo en unos 15 minutos después del pago.</span>
              </label>
              <label class="modo ${conDespacho ? "" : "modo--bloqueado"}">
                <input type="radio" name="modo" value="DELIVERY" ${marcado(modoInicial === "DELIVERY")} ${crudo(conDespacho ? "" : "disabled")} />
                <span>
                  <strong>Despacho gratis</strong>
                  ${conDespacho ? `A ${cliente.direccion}, ${cliente.comuna}.` : `${cliente.comuna} está fuera del radio de 3 km.`}
                </span>
              </label>
            </div>
          </fieldset>


          <div class="campo">
            <label for="campo-nota">Indicaciones para el pedido (opcional)</label>
            <textarea id="campo-nota" name="nota" rows="2" maxlength="200" placeholder="Por ejemplo: sin sésamo, timbre malo"></textarea>
          </div>

          <p class="checkout__error" data-error role="alert" hidden></p>
          <button class="boton boton--primario boton--ancho" type="submit">Ir a pagar ${precio(carrito.total)}</button>
          <p class="campo__ayuda checkout__nota">Pagas en Servipag. Con el pago confirmado, tu pedido pasa directo a cocina.</p>
        </form>

        <aside class="resumen resumen--checkout" aria-label="Resumen del pedido">
          <div class="resumen__interior">
            <h2>Tu pedido</h2>
            <ul class="resumen__lineas">
              ${carrito.lineas.map((l) => html`<li><span>${l.cantidad} × ${l.tipo === "ITEM" ? l.nombre : l.tipo === "PROMO" ? `${l.nombre}: ${l.detalle}` : l.detalle}</span><span>${precio(l.subtotal)}</span></li>`)}
              <li><span>Despacho</span><span>Gratis</span></li>
            </ul>
            <div class="resumen__total"><span>Total</span><strong>${precio(carrito.total)}</strong></div>
            <a class="enlace-boton" href="#/carrito">Editar carrito</a>
          </div>
        </aside>
      </div>
    `,
  );

  const form = raiz.querySelector("form");
  const error = raiz.querySelector("[data-error]");

  form.addEventListener("change", (evento) => {
    if (evento.target.name === "modo") PF.router.actualizarQuery({ entrega: evento.target.value === "DELIVERY" ? "delivery" : null });
  });

  form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    PF.formularios.mostrarError(error, "");

    try {
      const pedido = PF.pedidos.crear({
        sesion,
        modoEntrega: form.elements.modo.value,
        nota: form.elements.nota.value,
      });
      PF.router.navegar(`/pago/${pedido.id}`, { reemplazar: true });
    } catch (fallo) {
      PF.formularios.mostrarError(error, fallo.message);
    }
  });
};
