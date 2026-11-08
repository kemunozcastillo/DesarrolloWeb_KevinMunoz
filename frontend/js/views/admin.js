PF.vistas = PF.vistas || {};

/**
 * Administración del menú: listar, crear, editar, activar y eliminar items,
 * con su stock. Los cambios van al microservicio de inventario y se ven en el
 * menú y en el armador. Solo el administrador puede eliminar (lo exigen el
 * gateway y el servicio, no solo este botón).
 *
 *   #/admin?categoria=salsas   listado filtrado
 *   #/admin/nuevo              formulario vacío
 *   #/admin/items/:id          formulario de edición
 */

PF.vistas.admin = async function ({ raiz, query, sesion }) {
  const { CATEGORIAS, avisar, categoriaPorEnum, categoriaPorSlug, crudo, html, pintar, precio, titulo } = PF.ui;
  const catalogo = PF.datos.catalogo;

  titulo("Administrar menú");
  await PF.datos.refrescar(); // stock al día

  const seleccion = categoriaPorSlug(query.get("categoria"));
  const items = catalogo.listar({ categoria: seleccion?.enum });
  const esAdmin = sesion.perfil === "ADMIN";

  function fila(item) {
    return html`
      <tr data-item="${item.id}">
        <td>
          <strong>${item.nombre}</strong>
          <span class="tabla__detalle">${item.descripcion}</span>
        </td>
        <td>${categoriaPorEnum(item.categoria)?.titulo ?? item.categoria}</td>
        <td class="tabla__numero">${precio(item.precio)}</td>
        <td class="tabla__numero">${item.stock === null || item.stock === undefined ? "Sin control" : item.stock === 0 ? html`<span class="etiqueta etiqueta--aviso">Sin stock</span>` : item.stock}</td>
        <td>
          <label class="interruptor interruptor--compacto">
            <input type="checkbox" data-disponible ${crudo(item.activo ? "checked" : "")} />
            <span>${item.activo ? "Disponible" : "Agotado"}</span>
          </label>
        </td>
        <td class="tabla__acciones">
          <a class="enlace-boton" href="#/admin/items/${encodeURIComponent(item.id)}">Editar</a>
          ${esAdmin ? html`<button class="enlace-boton enlace-boton--peligro" type="button" data-eliminar>Eliminar</button>` : ""}
        </td>
      </tr>
    `;
  }

  const tabla = items.length
    ? html`
        <div class="tabla-envoltura">
          <table class="tabla">
            <thead>
              <tr><th>Item</th><th>Categoría</th><th class="tabla__numero">Precio</th><th class="tabla__numero">Stock</th><th>Estado</th><th><span class="visualmente-oculto">Acciones</span></th></tr>
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
        <p class="nota-admin">La disponibilidad, el stock y los precios se ven en el menú y en el armador. Un producto sin stock aparece agotado aunque esté marcado como disponible.</p>
        <div class="admin__herramientas">
          <label class="selector">
            <span>Categoría</span>
            <select data-categoria>
              <option value="">Todas</option>
              ${CATEGORIAS.map((c) => html`<option value="${c.slug}" ${crudo(seleccion?.slug === c.slug ? "selected" : "")}>${c.titulo}</option>`)}
            </select>
          </label>
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

  const contenedor = raiz.querySelector("[data-tabla]");

  contenedor.addEventListener("change", async (evento) => {
    const casilla = evento.target.closest("[data-disponible]");
    if (!casilla) return;

    try {
      const item = await catalogo.actualizar(casilla.closest("[data-item]").dataset.item, { disponible: casilla.checked });
      casilla.nextElementSibling.textContent = item.activo ? "Disponible" : "Agotado";
    } catch (error) {
      casilla.checked = !casilla.checked;
      avisar(error.message, { tipo: "error" });
    }
  });

  contenedor.addEventListener("click", async (evento) => {
    const boton = evento.target.closest("[data-eliminar]");
    if (!boton) return;

    const filaHtml = boton.closest("[data-item]");
    const nombre = filaHtml.querySelector("strong").textContent;
    if (!confirm(`¿Eliminar "${nombre}" del menú? Esta acción no se puede deshacer.`)) return;

    try {
      await catalogo.eliminar(filaHtml.dataset.item);
      filaHtml.remove();
      avisar(`Eliminamos ${nombre} del menú.`, { tipo: "exito" });
    } catch (error) {
      avisar(error.message, { tipo: "error" });
    }
  });
};

PF.vistas.adminFormulario = async function ({ raiz, params, sesion }) {
  const { CATEGORIAS, avisar, categoriaPorEnum, crudo, html, pintar, titulo } = PF.ui;
  const catalogo = PF.datos.catalogo;

  const esNuevo = !params.id;
  const item = esNuevo ? null : await PF.api.get(`/catalogo/items/${encodeURIComponent(params.id)}`).catch((e) => (e.estado === 404 ? null : Promise.reject(e)));

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
          <div class="campo">
            <label for="f-stock">Stock (porciones o unidades)</label>
            <input id="f-stock" name="stock" type="number" min="0" max="100000" step="1" value="${item?.stock ?? ""}" />
            <p class="campo__ayuda">Vacío si no se controla (por ejemplo, salsas que se reponen a granel). Cada pedido lo descuenta y una anulación lo devuelve.</p>
          </div>
          <label class="interruptor">
            <input type="checkbox" name="disponible" ${crudo(valor("activo", true) ? "checked" : "")} />
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

  form.addEventListener("submit", async (evento) => {
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
      stock: form.elements.stock.value === "" ? null : Number(form.elements.stock.value),
    };

    const boton = form.querySelector('[type="submit"]');
    boton.disabled = true;
    try {
      const guardado = esNuevo ? await catalogo.crear(datos) : await catalogo.actualizar(item.id, datos);
      avisar(esNuevo ? `Agregamos ${guardado.nombre} al menú.` : "Guardamos los cambios.", { tipo: "exito" });
      PF.router.navegar(`/admin?categoria=${categoriaPorEnum(guardado.categoria).slug}`);
    } catch (fallo) {
      error.textContent = fallo.message;
      error.hidden = false;
      boton.disabled = false;
    }
  });
};
