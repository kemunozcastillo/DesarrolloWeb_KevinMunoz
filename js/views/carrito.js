PF.vistas = PF.vistas || {};

PF.vistas.carrito = function ({ raiz }) {
  const { avisar, crudo, html, imagen, pintar, precio, titulo } = PF.ui;

  titulo("Carrito");

  const vacio = () => html`
    <div class="pagina pagina--angosta">
      <section class="estado estado--vacio">
        <h1>Tu carrito está vacío</h1>
        <p>Arma tu primer bowl o suma una bebida desde el menú.</p>
        <div class="estado__acciones">
          <a class="boton boton--primario" href="#/arma-tu-bowl">Arma tu bowl</a>
          <a class="boton" href="#/menu">Ver el menú</a>
        </div>
      </section>
    </div>
  `;

  function linea(l) {
    return html`
      <li class="linea" data-linea="${l.id}" data-cantidad="${l.cantidad}">
        ${imagen(l.tipo === "BOWL" ? "hero" : l.tipo === "PROMO" ? l.promo.item.nombre : l.item.nombre, { clase: "linea__foto foto" })}
        <div class="linea__texto">
          <h3>${l.nombre}</h3>
          <p>${l.detalle}</p>
        </div>
        <div class="cantidad" role="group" aria-label="Cantidad de ${l.nombre}">
          <button type="button" data-restar aria-label="Quitar uno" ${crudo(l.cantidad <= 1 ? "disabled" : "")}>−</button>
          <output>${l.cantidad}</output>
          <button type="button" data-sumar aria-label="Agregar uno" ${crudo(l.cantidad >= 20 ? "disabled" : "")}>+</button>
        </div>
        <strong class="linea__subtotal">${precio(l.subtotal)}</strong>
        <button class="enlace-boton" type="button" data-quitar>Quitar</button>
      </li>
    `;
  }

  function mostrar() {
    const carrito = PF.tienda.obtenerCarrito();

    if (carrito.quitadas.length) {
      avisar(`Quitamos ${carrito.quitadas.join(", ")} porque ya no está disponible.`, { tipo: "error", duracion: 5000 });
    }

    if (carrito.lineas.length === 0) {
      pintar(raiz, vacio());
      return;
    }

    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta">
          <h1>Tu carrito</h1>
          <ul class="lineas">${carrito.lineas.map(linea)}</ul>
          <div class="carrito__pie">
            <div class="carrito__total">
              <span>Total</span>
              <strong>${precio(carrito.total)}</strong>
            </div>
            <div class="estado__acciones">
              <a class="boton" href="#/menu">Seguir comprando</a>
              <a class="boton boton--primario" href="#/checkout">Continuar al pago</a>
            </div>
          </div>
        </div>
      `,
    );
  }

  // Un solo listener para todas las líneas. Se registra en la raíz, que
  // sobrevive a la navegación, así que la vista lo retira al salir.
  function alHacerClick(evento) {
    const fila = evento.target.closest("[data-linea]");
    const boton = evento.target.closest("button");
    if (!fila || !boton || boton.disabled) return;

    const id = fila.dataset.linea;
    const cantidad = Number(fila.dataset.cantidad);

    try {
      if (boton.matches("[data-sumar]")) PF.tienda.cambiarCantidad(id, cantidad + 1);
      else if (boton.matches("[data-restar]")) PF.tienda.cambiarCantidad(id, cantidad - 1);
      else if (boton.matches("[data-quitar]")) PF.tienda.quitarLinea(id);
      else return;
    } catch (error) {
      avisar(error.message, { tipo: "error" });
    }

    mostrar();
  }

  mostrar();
  raiz.addEventListener("click", alHacerClick);
  return () => raiz.removeEventListener("click", alHacerClick);
};
