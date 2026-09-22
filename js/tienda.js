/**
 * Lógica de la tienda: armado y precio del bowl, carrito y órdenes.
 *
 * Es la misma lógica que tiene la API GraphQL del backend, portada a
 * JavaScript del navegador para que el sitio funcione sin servidor.
 */

PF.tienda = (function () {
  const { TAMANOS, REGLAS, PROMOS, ErrorDatos, leer, guardar } = PF.datos;
  const catalogo = PF.datos.catalogo;

  const error = (mensaje, codigo) => new ErrorDatos(mensaje, codigo);

  // -------------------------------------------------------------------------
  // Menú
  // -------------------------------------------------------------------------

  function menu() {
    const items = catalogo.listar();
    return PF.ui.CATEGORIAS.map((c) => ({
      categoria: c.enum,
      titulo: c.titulo,
      items: items.filter((item) => item.categoria === c.enum),
    }));
  }

  // -------------------------------------------------------------------------
  // Bowl
  // -------------------------------------------------------------------------

  function resolverSeleccion(ids, categoria, etiqueta) {
    return ids.map((id) => {
      const item = catalogo.obtener(id);

      if (!item) throw error("Uno de los ingredientes ya no está en el menú.", "NOT_FOUND");
      if (item.categoria !== categoria) throw error(`"${item.nombre}" no es ${etiqueta}.`, "SELECCION_INVALIDA");
      if (!item.disponible) throw error(`"${item.nombre}" no está disponible hoy.`, "NO_DISPONIBLE");

      return item;
    });
  }

  function sinRepetidos(ids, etiqueta) {
    if (new Set(ids).size !== ids.length) {
      throw error(`Hay ${etiqueta} repetidos en la selección.`, "SELECCION_INVALIDA");
    }
  }

  /**
   * Valida un bowl y calcula su precio con desglose.
   *
   * La interfaz ya bloquea las opciones al llegar al máximo, pero la
   * validación vive aquí igual: el bowl también puede llegar escrito a mano
   * en la URL, o desde un carrito guardado con un catálogo que después cambió.
   */
  function cotizarBowl({ tamanoId, baseIds, proteinaIds, salsaIds = [], toppingIds = [] }) {
    const tamano = TAMANOS.find((t) => t.id === tamanoId);
    if (!tamano) throw error("El tamaño elegido no existe.", "NOT_FOUND");

    if (baseIds.length < 1 || baseIds.length > REGLAS.maxBases) {
      throw error(`El bowl lleva entre 1 y ${REGLAS.maxBases} bases.`, "SELECCION_INVALIDA");
    }
    if (proteinaIds.length < 1 || proteinaIds.length > REGLAS.maxProteinas) {
      throw error(`El bowl lleva entre 1 y ${REGLAS.maxProteinas} proteínas.`, "SELECCION_INVALIDA");
    }
    if (salsaIds.length > REGLAS.maxSalsas) throw error(`Máximo ${REGLAS.maxSalsas} salsas por bowl.`, "SELECCION_INVALIDA");
    if (toppingIds.length > REGLAS.maxToppings) throw error(`Máximo ${REGLAS.maxToppings} toppings por bowl.`, "SELECCION_INVALIDA");

    sinRepetidos(baseIds, "bases");
    sinRepetidos(proteinaIds, "proteínas");
    sinRepetidos(salsaIds, "salsas");
    sinRepetidos(toppingIds, "toppings");

    const bases = resolverSeleccion(baseIds, "BASE", "una base");
    const proteinas = resolverSeleccion(proteinaIds, "PROTEINA", "una proteína");
    const salsas = resolverSeleccion(salsaIds, "SALSA", "una salsa");
    const toppings = resolverSeleccion(toppingIds, "TOPPING", "un topping");

    const desglose = [{ concepto: `Bowl ${tamano.nombre}`, monto: tamano.precio }];

    const extras = [
      [bases.length - REGLAS.basesIncluidas, "Base extra", REGLAS.recargoBaseExtra],
      [proteinas.length - REGLAS.proteinasIncluidas, "Proteína extra", REGLAS.recargoProteinaExtra],
      [salsas.length - tamano.salsasIncluidas, "Salsa extra", REGLAS.recargoSalsaExtra],
      [toppings.length - tamano.toppingsIncluidos, "Topping extra", REGLAS.recargoToppingExtra],
    ];

    for (const [cantidad, concepto, unitario] of extras) {
      if (cantidad > 0) desglose.push({ concepto: `${concepto} x${cantidad}`, monto: cantidad * unitario });
    }

    // Las bases no tienen recargo premium: todas cuestan lo mismo.
    for (const item of [...proteinas, ...salsas, ...toppings]) {
      if (item.precio > 0) desglose.push({ concepto: `${item.nombre} (premium)`, monto: item.precio });
    }

    const precio = desglose.reduce((suma, linea) => suma + linea.monto, 0);
    return { tamano, bases, proteinas, salsas, toppings, precio, desglose };
  }

  /** "Bowl Regular: Arroz gohan, Salmón fresco, Ponzu" */
  function describirBowl(bowl) {
    const partes = [...bowl.bases, ...bowl.proteinas, ...bowl.salsas, ...bowl.toppings].map((i) => i.nombre);
    return `Bowl ${bowl.tamano.nombre}: ${partes.join(", ")}`;
  }

  // -------------------------------------------------------------------------
  // Promociones
  // -------------------------------------------------------------------------

  const esPromoArmable = (id) => Boolean(PROMOS[id]);

  /**
   * Cotiza una promoción armada. El precio de la promoción cubre el tamaño
   * base de cada bowl y la bebida; lo que se agregue por encima (bases,
   * proteínas, salsas o toppings extra, e ingredientes premium) se cobra
   * aparte, con las mismas reglas del armador.
   */
  function cotizarPromo(promoId, { bowls = [], bebidaId = null }) {
    const item = catalogo.obtener(promoId);
    const config = PROMOS[promoId];

    if (!item || item.categoria !== "PROMOCION") throw error("Esa promoción ya no existe.", "NOT_FOUND");
    if (!config) throw error(`"${item.nombre}" no se arma: se agrega directo desde el menú.`, "SELECCION_INVALIDA");
    if (!item.disponible) throw error(`"${item.nombre}" no está disponible hoy.`, "NO_DISPONIBLE");
    if (bowls.length !== config.bowls) throw error(`Esta promoción lleva ${config.bowls} bowl(s).`, "SELECCION_INVALIDA");

    const desglose = [{ concepto: item.nombre, monto: item.precio }];

    const cotizados = bowls.map((entrada, i) => {
      const bowl = cotizarBowl({ ...entrada, tamanoId: config.tamanoId });
      const prefijo = config.bowls > 1 ? `Bowl ${i + 1}: ` : "";

      // La primera línea es el precio base del bowl, que ya cubre la promoción.
      bowl.desglose.slice(1).forEach((linea) => {
        desglose.push({ concepto: `${prefijo}${linea.concepto}`, monto: linea.monto });
      });

      return bowl;
    });

    let bebida = null;
    if (config.bebida) {
      bebida = bebidaId ? catalogo.obtener(bebidaId) : null;
      if (!bebida) throw error("Elige la bebida de tu promoción.", "SELECCION_INVALIDA");
      if (bebida.categoria !== "BEBIDA") throw error(`"${bebida.nombre}" no es una bebida.`, "SELECCION_INVALIDA");
      if (!bebida.disponible) throw error(`"${bebida.nombre}" no está disponible hoy.`, "NO_DISPONIBLE");
    }

    const precio = desglose.reduce((suma, linea) => suma + linea.monto, 0);
    return { item, config, bowls: cotizados, bebida, precio, desglose };
  }

  /** "Combo mediodía: Bowl Regular: Arroz gohan, Salmón fresco + Té verde frío" */
  function describirPromo(promo) {
    const bowls = promo.bowls.map((b, i) => {
      const descripcion = describirBowl(b);
      return promo.config.bowls > 1 ? descripcion.replace(/^Bowl /, `Bowl ${i + 1}, `) : descripcion;
    });

    const partes = bowls.join(" / ");
    return promo.bebida ? `${partes} + ${promo.bebida.nombre}` : partes;
  }

  // -------------------------------------------------------------------------
  // Carrito
  // -------------------------------------------------------------------------

  const suscriptores = new Set();
  const nuevoId = (prefijo) => `${prefijo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const leerLineas = () => leer("carrito", []);
  const guardarLineas = (lineas) => guardar("carrito", lineas);

  function notificar() {
    const cantidad = leerLineas().reduce((suma, linea) => suma + linea.cantidad, 0);
    suscriptores.forEach((funcion) => funcion(cantidad));
  }

  function alCambiarCarrito(funcion) {
    suscriptores.add(funcion);
    return () => suscriptores.delete(funcion);
  }

  /**
   * Resuelve cada línea guardada contra el catálogo actual. Si un ingrediente
   * se eliminó o se agotó desde que se agregó, la línea se quita y se informa,
   * para no cobrar algo que ya no se puede preparar.
   */
  function obtenerCarrito() {
    const guardadas = leerLineas();
    const lineas = [];
    const quitadas = [];

    for (const linea of guardadas) {
      try {
        if (linea.tipo === "BOWL") {
          const bowl = cotizarBowl(linea.entrada);
          lineas.push({ ...linea, bowl, nombre: "Bowl personalizado", detalle: describirBowl(bowl), unitario: bowl.precio });
        } else if (linea.tipo === "PROMO") {
          const promo = cotizarPromo(linea.promoId, linea);
          lineas.push({ ...linea, promo, nombre: promo.item.nombre, detalle: describirPromo(promo), unitario: promo.precio });
        } else {
          const item = catalogo.obtener(linea.itemId);
          if (!item || !item.disponible) throw error("no disponible", "NO_DISPONIBLE");
          lineas.push({ ...linea, item, nombre: item.nombre, detalle: `${PF.ui.precio(item.precio)} c/u`, unitario: item.precio });
        }
      } catch {
        const nombre = linea.tipo === "BOWL" ? "un bowl" : catalogo.obtener(linea.itemId ?? linea.promoId)?.nombre;
        quitadas.push(nombre ?? "un producto");
      }
    }

    if (quitadas.length) {
      guardarLineas(guardadas.filter((l) => lineas.some((v) => v.id === l.id)));
      notificar();
    }

    lineas.forEach((l) => (l.subtotal = l.unitario * l.cantidad));

    return {
      lineas,
      quitadas,
      total: lineas.reduce((suma, l) => suma + l.subtotal, 0),
      cantidadItems: lineas.reduce((suma, l) => suma + l.cantidad, 0),
    };
  }

  function validarCantidad(cantidad) {
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 20) {
      throw error("La cantidad debe estar entre 1 y 20.", "BAD_USER_INPUT");
    }
  }

  function agregarBowl(entrada, cantidad = 1) {
    validarCantidad(cantidad);
    cotizarBowl(entrada); // si la selección es inválida, no entra al carrito

    const lineas = leerLineas();
    lineas.push({ id: nuevoId("lin"), tipo: "BOWL", cantidad, entrada });
    guardarLineas(lineas);
    notificar();
  }

  function agregarPromo(promoId, { bowls, bebidaId = null }, cantidad = 1) {
    validarCantidad(cantidad);
    const promo = cotizarPromo(promoId, { bowls, bebidaId }); // si es inválida, no entra

    const lineas = leerLineas();
    lineas.push({ id: nuevoId("lin"), tipo: "PROMO", promoId, bowls, bebidaId, cantidad });
    guardarLineas(lineas);
    notificar();
    return promo;
  }

  function agregarItem(itemId, cantidad = 1) {
    validarCantidad(cantidad);

    const item = catalogo.obtener(itemId);
    if (!item) throw error("Ese producto ya no está en el menú.", "NOT_FOUND");
    if (PF.ui.esIngrediente(item.categoria)) {
      throw error(`"${item.nombre}" es un ingrediente: va dentro de un bowl.`, "SELECCION_INVALIDA");
    }
    if (esPromoArmable(itemId)) {
      throw error(`"${item.nombre}" se arma antes de agregarla al carrito.`, "SELECCION_INVALIDA");
    }
    if (!item.disponible) throw error(`"${item.nombre}" no está disponible hoy.`, "NO_DISPONIBLE");

    const lineas = leerLineas();
    const existente = lineas.find((l) => l.tipo === "ITEM" && l.itemId === itemId);

    if (existente) {
      validarCantidad(existente.cantidad + cantidad);
      existente.cantidad += cantidad;
    } else {
      lineas.push({ id: nuevoId("lin"), tipo: "ITEM", itemId, cantidad });
    }

    guardarLineas(lineas);
    notificar();
    return item;
  }

  function cambiarCantidad(lineaId, cantidad) {
    validarCantidad(cantidad);

    const lineas = leerLineas();
    const linea = lineas.find((l) => l.id === lineaId);
    if (!linea) throw error("Esa línea ya no está en el carrito.", "NOT_FOUND");

    linea.cantidad = cantidad;
    guardarLineas(lineas);
    notificar();
  }

  function quitarLinea(lineaId) {
    guardarLineas(leerLineas().filter((l) => l.id !== lineaId));
    notificar();
  }

  function vaciarCarrito() {
    guardarLineas([]);
    notificar();
  }

  return {
    TAMANOS,
    REGLAS,
    PROMOS,
    menu,
    cotizarBowl,
    describirBowl,
    esPromoArmable,
    cotizarPromo,
    describirPromo,
    agregarPromo,
    obtenerCarrito,
    agregarBowl,
    agregarItem,
    cambiarCantidad,
    quitarLinea,
    alCambiarCarrito,
    notificar,
    vaciarCarrito,
  };
})();
