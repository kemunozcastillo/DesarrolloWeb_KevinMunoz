PF.vistas = PF.vistas || {};

/**
 * Menú completo. Filtros en la URL:
 *   #/menu?categoria=salsas     solo esa sección
 *   #/menu?q=palta&disponibles=1  búsqueda y solo disponibles
 */
PF.vistas.menu = function ({ raiz, query }) {
  const { CATEGORIAS, avisar, categoriaPorSlug, crudo, esIngrediente, html, imagen, pintar, precio, titulo } = PF.ui;

  // Qué parámetro del armador corresponde a cada categoría de ingrediente.
  const PARAMETRO_ARMADOR = { BASE: "base", PROTEINA: "proteina", SALSA: "salsa", TOPPING: "topping" };

  function etiquetaPrecio(item) {
    if (item.categoria === "BASE") return ""; // las bases tienen precio fijo
    if (esIngrediente(item.categoria)) return item.precio > 0 ? `+${precio(item.precio)}` : "";
    return precio(item.precio);
  }

  function accionItem(item) {
    if (!item.disponible) return html`<span class="etiqueta etiqueta--agotado">Agotado hoy</span>`;

    if (esIngrediente(item.categoria)) {
      const parametro = PARAMETRO_ARMADOR[item.categoria];
      return html`<a class="boton boton--suave" href="#/arma-tu-bowl?${parametro}=${encodeURIComponent(item.id)}">Usar en mi bowl</a>`;
    }

    // Las promociones con bowls o bebida a elección se arman en su propia página.
    if (PF.tienda.esPromoArmable(item.id)) {
      return html`<a class="boton boton--suave" href="#/promo/${encodeURIComponent(item.id)}">Armar promoción</a>`;
    }

    return html`<button class="boton boton--suave" type="button" data-agregar="${item.id}">Agregar</button>`;
  }

  function tarjetaItem(item) {
    const extra = etiquetaPrecio(item);

    return html`
      <article
        class="tarjeta tarjeta--item ${item.disponible ? "" : "tarjeta--agotada"}"
        data-texto="${`${item.nombre} ${item.descripcion}`.toLowerCase()}"
        data-disponible="${item.disponible}"
      >
        <div class="tarjeta__cabeza">
          <h3>${item.nombre}</h3>
          ${extra ? html`<span class="precio-item">${extra}</span>` : ""}
        </div>
        <p>${item.descripcion}</p>
        <div class="tarjeta__accion">${accionItem(item)}</div>
        ${imagen(item.nombre)}
      </article>
    `;
  }

  function seccion(datos) {
    const categoria = CATEGORIAS.find((c) => c.enum === datos.categoria);
    if (datos.items.length === 0) return "";

    return html`
      <section class="seccion-menu" data-seccion>
        <h2>${datos.titulo}</h2>
        <div class="rejilla">${datos.items.map(tarjetaItem)}</div>
      </section>
    `;
  }

  titulo("Menú");

  const seleccion = categoriaPorSlug(query.get("categoria"));
  const busquedaInicial = query.get("q") ?? "";
  const soloDisponiblesInicial = query.get("disponibles") === "1";
  const secciones = PF.tienda.menu().filter((s) => !seleccion || s.categoria === seleccion.enum);
  const actual = (slug) => crudo(seleccion?.slug === slug ? 'aria-current="page"' : "");

  pintar(
    raiz,
    html`
      <div class="pagina">
        <nav class="pestanas" aria-label="Categorías del menú">
          <a href="#/menu" ${crudo(!seleccion ? 'aria-current="page"' : "")}>Todo</a>
          ${CATEGORIAS.map((c) => html`<a href="#/menu?categoria=${c.slug}" ${actual(c.slug)}>${c.titulo}</a>`)}
        </nav>

        <div class="filtros">
          <label class="campo-busqueda">
            <span class="visualmente-oculto">Buscar en el menú</span>
            <input type="search" placeholder="Buscar: salmón, palta, sin gluten…" value="${busquedaInicial}" data-busqueda />
          </label>
          <label class="interruptor">
            <input type="checkbox" data-solo-disponibles ${crudo(soloDisponiblesInicial ? "checked" : "")} />
            <span>Solo disponibles hoy</span>
          </label>
        </div>

        <div data-contenido>
          ${secciones.map(seccion)}
          <div class="estado estado--vacio" data-sin-resultados hidden>
            <h2>No encontramos nada con esa búsqueda</h2>
            <p>Prueba con otro ingrediente o revisa todo el menú.</p>
            <button class="boton" type="button" data-limpiar>Borrar búsqueda</button>
          </div>
        </div>
      </div>
    `,
  );

  const contenido = raiz.querySelector("[data-contenido]");
  const campoBusqueda = raiz.querySelector("[data-busqueda]");
  const casillaDisponibles = raiz.querySelector("[data-solo-disponibles]");
  const sinResultados = raiz.querySelector("[data-sin-resultados]");

  // Los filtros se aplican sobre las tarjetas ya pintadas, sin volver a pintar.
  function filtrar() {
    const termino = campoBusqueda.value.trim().toLowerCase();
    const soloDisponibles = casillaDisponibles.checked;
    let visibles = 0;

    contenido.querySelectorAll("[data-seccion]").forEach((bloque) => {
      let enSeccion = 0;

      bloque.querySelectorAll(".tarjeta--item").forEach((tarjeta) => {
        const coincide =
          (!termino || tarjeta.dataset.texto.includes(termino)) &&
          (!soloDisponibles || tarjeta.dataset.disponible === "true");

        tarjeta.hidden = !coincide;
        if (coincide) enSeccion += 1;
      });

      bloque.hidden = enSeccion === 0;
      visibles += enSeccion;
    });

    sinResultados.hidden = visibles > 0;

    // La URL refleja los filtros: el enlace abre la misma vista filtrada.
    PF.router.actualizarQuery({ q: termino, disponibles: soloDisponibles ? "1" : null });
  }

  let temporizador;
  campoBusqueda.addEventListener("input", () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(filtrar, 150);
  });
  casillaDisponibles.addEventListener("change", filtrar);

  raiz.querySelector("[data-limpiar]").addEventListener("click", () => {
    campoBusqueda.value = "";
    filtrar();
    campoBusqueda.focus();
  });

  contenido.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-agregar]");
    if (!boton) return;

    try {
      const item = PF.tienda.agregarItem(boton.dataset.agregar);
      avisar(`Agregamos ${item.nombre} al carrito.`, { tipo: "exito" });
    } catch (error) {
      avisar(error.message, { tipo: "error" });
    }
  });

  filtrar();

  return () => clearTimeout(temporizador);
};
