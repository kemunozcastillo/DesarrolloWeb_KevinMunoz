/**
 * Editor de bowl reutilizable: pinta los pasos (tamaño, bases, proteínas,
 * salsas y toppings), maneja la selección y avisa cuando cambia.
 *
 * Lo usan el armador (un bowl, con tamaño a elegir) y la página de
 * promociones (uno o dos bowls con tamaño fijo). Cada editor lee y escribe
 * su parte de la URL con un prefijo propio, así dos editores en la misma
 * página no se pisan: el Dúo usa `b1_base=...` y `b2_base=...`.
 */

PF.editorBowl = (function () {
  const { crudo, html, imagen, pintar, precio } = PF.ui;
  const { TAMANOS, REGLAS } = PF.datos;
  const catalogo = PF.datos.catalogo;

  const tamanoDe = (id) => TAMANOS.find((t) => t.id === id);

  function definirGrupos(tamano) {
    return [
      {
        clave: "base",
        categoria: "BASE",
        titulo: "Elige tu base",
        etiqueta: "Base",
        maximo: REGLAS.maxBases,
        ayuda: `Incluye ${REGLAS.basesIncluidas}. Cada base extra suma ${precio(REGLAS.recargoBaseExtra)}.`,
      },
      {
        clave: "proteina",
        categoria: "PROTEINA",
        titulo: "Agrega tu proteína",
        etiqueta: "Proteína",
        maximo: REGLAS.maxProteinas,
        ayuda: `Incluye ${REGLAS.proteinasIncluidas}. Cada proteína extra suma ${precio(REGLAS.recargoProteinaExtra)}.`,
      },
      {
        clave: "salsa",
        categoria: "SALSA",
        titulo: "Salsas",
        etiqueta: "Salsas",
        maximo: REGLAS.maxSalsas,
        ayuda: `El tamaño ${tamano.nombre.toLowerCase()} incluye ${tamano.salsasIncluidas}. Cada salsa extra suma ${precio(REGLAS.recargoSalsaExtra)}.`,
      },
      {
        clave: "topping",
        categoria: "TOPPING",
        titulo: "Toppings",
        etiqueta: "Toppings",
        maximo: REGLAS.maxToppings,
        ayuda: `El tamaño ${tamano.nombre.toLowerCase()} incluye ${tamano.toppingsIncluidos}. Cada topping extra suma ${precio(REGLAS.recargoToppingExtra)}.`,
      },
    ];
  }

  /** Recargo premium, si tiene. Las bases tienen precio fijo: nunca lo muestran. */
  const recargo = (item) => (item.categoria !== "BASE" && item.precio > 0 ? `+${precio(item.precio)}` : "");

  function opcionIngrediente(item, clave) {
    const extra = recargo(item);

    return html`
      <button type="button" class="opcion" data-grupo="${clave}" data-id="${item.id}" aria-pressed="false" ${crudo(item.disponible ? "" : "disabled")}>
        ${imagen(item.nombre, { clase: "opcion__foto foto" })}
        <span class="opcion__texto">
          <span class="opcion__nombre">
            ${item.nombre}
            ${extra && item.disponible ? html`<span class="opcion__recargo">${extra}</span>` : ""}
          </span>
          <span class="opcion__detalle">${item.disponible ? item.descripcion : "Agotado hoy"}</span>
        </span>
        <span class="opcion__marca" aria-hidden="true"></span>
      </button>
    `;
  }

  /**
   * @param contenedor    elemento donde se pintan los pasos
   * @param query         URLSearchParams de la ruta, para el estado inicial
   * @param prefijo       prefijo de las claves en la URL ("" o "b1_", "b2_")
   * @param tamanoFijo    id de tamaño si no se puede elegir (promociones)
   * @param numeroInicial número del primer paso
   */
  function crear({ contenedor, query, prefijo = "", tamanoFijo = null, numeroInicial = 1 }) {
    const clave = (nombre) => `${prefijo}${nombre}`;
    const idPaso = (nombre) => `paso-${prefijo}${nombre}`;
    const oyentes = new Set();

    // --- Estado inicial desde la URL, depurado ------------------------------
    // Un id inexistente, agotado o que pase el máximo se descarta, y la URL
    // se corrige sola en el primer cambio.

    const tamanoUrl = query.get(clave("tamano"));
    const seleccion = { tamano: tamanoFijo ?? (tamanoDe(tamanoUrl) ? tamanoUrl : TAMANOS[0].id) };
    let grupos = definirGrupos(tamanoDe(seleccion.tamano));

    for (const grupo of grupos) {
      const validos = new Set(
        catalogo.listar({ categoria: grupo.categoria }).filter((i) => i.disponible).map((i) => i.id),
      );
      const ids = [...new Set(PF.router.leerLista(query, clave(grupo.clave)))].filter((id) => validos.has(id));
      seleccion[grupo.clave] = ids.slice(0, grupo.maximo);
    }

    // --- Plantillas ---------------------------------------------------------

    const numero = (i) => numeroInicial + i;

    const pasoTamano = () => html`
      <section class="paso" aria-labelledby="${idPaso("tamano")}">
        <header class="paso__cabeza">
          <span class="paso__numero" aria-hidden="true">${numero(0)}</span>
          <div>
            <h2 id="${idPaso("tamano")}">Tamaño</h2>
            <p class="paso__ayuda">El tamaño fija el precio base y cuántas salsas y toppings incluye.</p>
          </div>
        </header>
        <div class="opciones-tamano" role="radiogroup" aria-labelledby="${idPaso("tamano")}">
          ${TAMANOS.map(
            (t) => html`
              <label class="opcion-tamano">
                <input type="radio" name="${clave("tamano")}" value="${t.id}" data-tamano />
                <span class="opcion-tamano__nombre">${t.nombre}</span>
                <span class="opcion-tamano__detalle">${t.descripcion}</span>
                <span class="opcion-tamano__precio">${precio(t.precio)}</span>
              </label>
            `,
          )}
        </div>
      </section>
    `;

    const paso = (grupo, i) => html`
      <section class="paso" aria-labelledby="${idPaso(grupo.clave)}">
        <header class="paso__cabeza">
          <span class="paso__numero" aria-hidden="true">${i}</span>
          <div>
            <h2 id="${idPaso(grupo.clave)}">${grupo.titulo}</h2>
            <p class="paso__ayuda" data-ayuda="${grupo.clave}">${grupo.ayuda}</p>
          </div>
          <span class="paso__contador" data-contador="${grupo.clave}" aria-live="polite"></span>
        </header>
        <div class="opciones">
          ${catalogo.listar({ categoria: grupo.categoria }).map((item) => opcionIngrediente(item, grupo.clave))}
        </div>
      </section>
    `;

    const desplazamiento = tamanoFijo ? 0 : 1;

    pintar(
      contenedor,
      html`
        ${tamanoFijo ? "" : pasoTamano()}
        ${grupos.map((grupo, i) => paso(grupo, numero(i + desplazamiento)))}
      `,
    );

    // --- Refrescar el estado pintado -------------------------------------------

    function refrescar() {
      contenedor.querySelectorAll("[data-tamano]").forEach((radio) => {
        radio.checked = radio.value === seleccion.tamano;
      });

      for (const grupo of grupos) {
        const elegidos = seleccion[grupo.clave];
        const lleno = elegidos.length >= grupo.maximo;

        contenedor.querySelectorAll(`.opcion[data-grupo="${grupo.clave}"]`).forEach((boton) => {
          const item = catalogo.obtener(boton.dataset.id);
          const marcado = elegidos.includes(boton.dataset.id);

          boton.setAttribute("aria-pressed", String(marcado));
          // Al llegar al máximo, lo no elegido se bloquea en vez de dejar
          // que la validación rechace la selección después.
          boton.disabled = !item.disponible || (lleno && !marcado);
        });

        contenedor.querySelector(`[data-contador="${grupo.clave}"]`).textContent = `${elegidos.length} de ${grupo.maximo}`;
        contenedor.querySelector(`[data-ayuda="${grupo.clave}"]`).textContent = grupo.ayuda;
      }
    }

    function avisar() {
      refrescar();
      oyentes.forEach((funcion) => funcion());
    }

    // --- Eventos -------------------------------------------------------------------

    contenedor.addEventListener("change", (evento) => {
      if (!evento.target.matches("[data-tamano]")) return;
      seleccion.tamano = evento.target.value;
      grupos = definirGrupos(tamanoDe(seleccion.tamano));
      avisar();
    });

    contenedor.addEventListener("click", (evento) => {
      const boton = evento.target.closest(".opcion[data-grupo]");
      if (!boton || boton.disabled) return;

      const { grupo, id } = boton.dataset;
      const elegidos = seleccion[grupo];
      seleccion[grupo] = elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id];
      avisar();
    });

    refrescar();

    // --- API del editor --------------------------------------------------------------

    return {
      /** La selección en el formato que espera PF.tienda.cotizarBowl. */
      entrada: () => ({
        tamanoId: seleccion.tamano,
        baseIds: [...seleccion.base],
        proteinaIds: [...seleccion.proteina],
        salsaIds: [...seleccion.salsa],
        toppingIds: [...seleccion.topping],
      }),

      completo: () => seleccion.base.length > 0 && seleccion.proteina.length > 0,

      tamano: () => tamanoDe(seleccion.tamano),

      /** Claves y valores para PF.router.actualizarQuery. */
      valoresUrl: () => ({
        [clave("tamano")]: tamanoFijo ? null : seleccion.tamano,
        [clave("base")]: seleccion.base,
        [clave("proteina")]: seleccion.proteina,
        [clave("salsa")]: seleccion.salsa,
        [clave("topping")]: seleccion.topping,
      }),

      /** Filas para el resumen: [{ titulo, nombres }]. */
      resumenFilas: () => [
        ...(tamanoFijo ? [] : [{ titulo: "Tamaño", nombres: [tamanoDe(seleccion.tamano).nombre] }]),
        ...grupos.map((g) => ({ titulo: g.etiqueta, nombres: seleccion[g.clave].map((id) => catalogo.obtener(id).nombre) })),
      ],

      reiniciar() {
        if (!tamanoFijo) seleccion.tamano = TAMANOS[0].id;
        grupos = definirGrupos(tamanoDe(seleccion.tamano));
        for (const grupo of grupos) seleccion[grupo.clave] = [];
        avisar();
      },

      alCambiar(funcion) {
        oyentes.add(funcion);
      },
    };
  }

  /** Lista de definición para el resumen lateral. */
  function resumen(filas) {
    return html`
      <dl class="resumen__lista">
        ${filas.map(
          (fila) => html`
            <div>
              <dt>${fila.titulo}</dt>
              <dd>${fila.nombres.length ? fila.nombres.join(", ") : html`<span class="pendiente">Sin elegir</span>`}</dd>
            </div>
          `,
        )}
      </dl>
    `;
  }

  return { crear, resumen };
})();
