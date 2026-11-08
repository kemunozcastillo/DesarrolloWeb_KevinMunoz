PF.vistas = PF.vistas || {};

/**
 * Administración del menú: listar, crear, editar, activar y eliminar items.
 * Edita el mismo catálogo que lee la tienda, así que los cambios se ven de
 * inmediato en el menú y en el armador.
 *
 *   #/admin?categoria=salsas   listado filtrado
 *   #/admin/nuevo              formulario vacío
 *   #/admin/items/:id          formulario de edición
 */

PF.vistas.admin = function ({ raiz, query, sesion }) {
  const { CATEGORIAS, avisar, categoriaPorEnum, categoriaPorSlug, crudo, html, pintar, precio, titulo } = PF.ui;
  const catalogo = PF.datos.catalogo;

  titulo("Administrar menú");

  const seleccion = categoriaPorSlug(query.get("categoria"));
  const items = catalogo.listar({ categoria: seleccion?.enum });

  function fila(item) {
    return html`
      <tr data-item="${item.id}">
        <td>
          <strong>${item.nombre}</strong>
          <span class="tabla__detalle">${item.descripcion}</span>
        </td>
        <td>${categoriaPorEnum(item.categoria)?.titulo ?? item.categoria}</td>
        <td class="tabla__numero">${precio(item.precio)}</td>
        <td>
          <label class="interruptor interruptor--compacto">
            <input type="checkbox" data-disponible ${crudo(item.disponible ? "checked" : "")} />
            <span>${item.disponible ? "Disponible" : "Agotado"}</span>
          </label>
        </td>
        <td class="tabla__acciones">
          <a class="enlace-boton" href="#/admin/items/${encodeURIComponent(item.id)}">Editar</a>
          <button class="enlace-boton enlace-boton--peligro" type="button" data-eliminar>Eliminar</button>
        </td>
      </tr>
    `;
  }

  const tabla = items.length
    ? html`
        <div class="tabla-envoltura">
          <table class="tabla">
            <thead>
              <tr><th>Item</th><th>Categoría</th><th class="tabla__numero">Precio</th><th>Estado</th><th><span class="visualmente-oculto">Acciones</span></th></tr>
            </thead>
            <tbody>${items.map(fila)}</tbody>
          </table>
        </div>
      `
    : html`
        <section class="estado estado--vacio">
          <h2>No hay items${seleccion ? ` en ${seleccion.titulo.toLowerCase()}` : ""}</h2>
          <p>Agrega uno nuevo desde el botón de arriba.</p>
          <a class="boton" href="#/admin/nuevo">Agregar item</a>
        </section>
      `;

  const esAdmin = sesion.perfil === "ADMIN";

  pintar(
    raiz,
    PF.ui.panel({
      sesion,
      activa: "/admin",
      contenido: html`
        <div class="admin__cabeza">
          <h1>Productos</h1>
          <a class="boton boton--primario" href="#/admin/nuevo">Agregar item</a>
        </div>
        <p class="nota-admin">La disponibilidad y los precios se ven al instante en el menú y en el armador.</p>
        <div class="admin__herramientas">
          <label class="selector">
            <span>Categoría</span>
            <select data-categoria>
              <option value="">Todas</option>
              ${CATEGORIAS.map((c) => html`<option value="${c.slug}" ${crudo(seleccion?.slug === c.slug ? "selected" : "")}>${c.titulo}</option>`)}
            </select>
          </label>
          ${esAdmin ? html`<button class="enlace-boton" type="button" data-restaurar>Restaurar datos de ejemplo</button>` : ""}
        </div>
        <div data-tabla>${tabla}</div>
      `,
    }),
  );

  // Cambiar de categoría es una navegación: el botón atrás la deshace.
  raiz.querySelector("[data-categoria]").addEventListener("change", (evento) => {
    const valor = evento.target.value;
    PF.router.navegar(valor ? `/admin?categoria=${valor}` : "/admin");
  });

  raiz.querySelector("[data-restaurar]")?.addEventListener("click", async () => {
    if (!confirm("¿Volver a los datos de ejemplo? Se borran los productos, clientes, usuarios y pedidos creados, y se cierra la sesión.")) return;
    await PF.ejemplo.restaurar();
    avisar("Restauramos los datos de ejemplo. Ingresa de nuevo.", { tipo: "exito" });
    PF.router.navegar("/ingresar");
  });

  const contenedor = raiz.querySelector("[data-tabla]");

  contenedor.addEventListener("change", (evento) => {
    const casilla = evento.target.closest("[data-disponible]");
    if (!casilla) return;

    try {
      const item = catalogo.actualizar(casilla.closest("[data-item]").dataset.item, { disponible: casilla.checked });
      casilla.nextElementSibling.textContent = item.disponible ? "Disponible" : "Agotado";
    } catch (error) {
      casilla.checked = !casilla.checked;
      avisar(error.message, { tipo: "error" });
    }
  });

  contenedor.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-eliminar]");
    if (!boton) return;

    const filaHtml = boton.closest("[data-item]");
    const nombre = filaHtml.querySelector("strong").textContent;
    if (!confirm(`¿Eliminar "${nombre}" del menú? Esta acción no se puede deshacer.`)) return;

    try {
      catalogo.eliminar(filaHtml.dataset.item);
      filaHtml.remove();
      avisar(`Eliminamos ${nombre} del menú.`, { tipo: "exito" });
    } catch (error) {
      avisar(error.message, { tipo: "error" });
    }
  });
};

PF.vistas.adminFormulario = function ({ raiz, params, sesion }) {
  const { CATEGORIAS, avisar, categoriaPorEnum, crudo, html, pintar, titulo } = PF.ui;
  const catalogo = PF.datos.catalogo;

  const esNuevo = !params.id;
  const item = esNuevo ? null : catalogo.obtener(params.id);

  titulo(esNuevo ? "Nuevo item" : "Editar item");

  if (!esNuevo && !item) {
    pintar(
      raiz,
      html`
        <div class="pagina pagina--angosta">
          <section class="estado estado--error">
            <h1>No encontramos ese item</h1>
            <p>Puede que se haya eliminado.</p>
            <a class="boton" href="#/admin">Volver al listado</a>
          </section>
        </div>
      `,
    );
    return;
  }

  const valor = (campo, porDefecto = "") => item?.[campo] ?? porDefecto;

  pintar(
    raiz,
    html`
    ${PF.ui.panel({ sesion, activa: "/admin", contenido: html`
        <a class="volver" href="#/admin">Volver a productos</a>
        <h1>${esNuevo ? "Nuevo item" : `Editar ${item.nombre}`}</h1>

        <form class="formulario-admin" novalidate>
          <div class="campo">
            <label for="f-nombre">Nombre</label>
            <input id="f-nombre" name="nombre" required minlength="2" maxlength="80" value="${valor("nombre")}" />
          </div>
          <div class="campo">
            <label for="f-descripcion">Descripción</label>
            <input id="f-descripcion" name="descripcion" required minlength="2" maxlength="200" value="${valor("descripcion")}" />
          </div>
          <div class="campo-doble">
            <div class="campo">
              <label for="f-categoria">Categoría</label>
              <select id="f-categoria" name="categoria">
                ${CATEGORIAS.map((c) => html`<option value="${c.enum}" ${crudo(valor("categoria", "BASE") === c.enum ? "selected" : "")}>${c.titulo}</option>`)}
              </select>
            </div>
            <div class="campo">
              <label for="f-precio">Precio en pesos</label>
              <input id="f-precio" name="precio" type="number" min="0" max="100000" step="10" required value="${valor("precio", 0)}" />
              <p class="campo__ayuda" data-ayuda-precio></p>
            </div>
          </div>
          <label class="interruptor">
            <input type="checkbox" name="disponible" ${crudo(valor("disponible", true) ? "checked" : "")} />
            <span>Disponible hoy</span>
          </label>
          <p class="checkout__error" data-error role="alert" hidden></p>
          <div class="estado__acciones estado__acciones--izquierda">
            <a class="boton" href="#/admin">Cancelar</a>
            <button class="boton boton--primario" type="submit">${esNuevo ? "Agregar item" : "Guardar cambios"}</button>
          </div>
        </form>
    ` })}
    `,
  );

  const form = raiz.querySelector("form");
  const error = raiz.querySelector("[data-error]");

  // Las bases tienen precio fijo: su campo de precio se bloquea en 0.
  const AYUDAS_PRECIO = {
    BASE: "Las bases tienen precio fijo; cada base extra suma lo mismo.",
    BEBIDA: "Precio de venta.",
    PROMOCION: "Precio de venta de la promoción.",
  };

  function ajustarPrecio() {
    const categoria = form.elements.categoria.value;
    const esBase = categoria === "BASE";
    form.elements.precio.disabled = esBase;
    if (esBase) form.elements.precio.value = 0;
    raiz.querySelector("[data-ayuda-precio]").textContent =
      AYUDAS_PRECIO[categoria] ?? "Recargo por ingrediente premium; 0 si es estándar.";
  }

  form.elements.categoria.addEventListener("change", ajustarPrecio);
  ajustarPrecio();

  form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    error.hidden = true;

    // La validación nativa cubre largo mínimo y rango de precio.
    if (!form.reportValidity()) return;

    const datos = {
      nombre: form.elements.nombre.value,
      descripcion: form.elements.descripcion.value,
      categoria: form.elements.categoria.value,
      precio: Number(form.elements.precio.value),
      disponible: form.elements.disponible.checked,
    };

    try {
      const guardado = esNuevo ? catalogo.crear(datos) : catalogo.actualizar(item.id, datos);
      avisar(esNuevo ? `Agregamos ${guardado.nombre} al menú.` : "Guardamos los cambios.", { tipo: "exito" });
      PF.router.navegar(`/admin?categoria=${categoriaPorEnum(guardado.categoria).slug}`);
    } catch (fallo) {
      error.textContent = fallo.message;
      error.hidden = false;
    }
  });
};
