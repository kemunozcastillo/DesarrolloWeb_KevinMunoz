/**
 * Datos del sitio: catálogo inicial, tamaños, reglas de armado y la capa de
 * guardado en localStorage.
 *
 * El catálogo se copia a localStorage la primera vez que se abre el sitio.
 * Desde ahí, la página de administración lo edita y la tienda lo lee, así
 * que un cambio en el admin se ve de inmediato en el menú.
 */

PF.datos = (function () {
  // `precio` significa distinto según la categoría:
  //   - BASE: no se usa; todas las bases tienen el mismo precio
  //   - PROTEINA, SALSA, TOPPING: recargo por ingrediente premium, 0 si es estándar
  //   - BEBIDA y PROMOCION: precio de venta
  const CATALOGO_INICIAL = [
    { id: "base_gohan", categoria: "BASE", nombre: "Arroz gohan", descripcion: "Arroz blanco japonés con vinagre de arroz", precio: 0, disponible: true },
    { id: "base_integral", categoria: "BASE", nombre: "Arroz integral", descripcion: "Grano entero, textura más firme", precio: 0, disponible: true },
    { id: "base_quinoa", categoria: "BASE", nombre: "Quinoa", descripcion: "Alta en proteína, sin gluten", precio: 0, disponible: true },
    { id: "base_verdes", categoria: "BASE", nombre: "Mix de hojas verdes", descripcion: "Lechuga, rúcula y espinaca", precio: 0, disponible: true },
    { id: "base_soba", categoria: "BASE", nombre: "Fideos soba", descripcion: "Trigo sarraceno, servidos fríos", precio: 0, disponible: true },

    { id: "pro_salmon", categoria: "PROTEINA", nombre: "Salmón fresco", descripcion: "Cortado en cubos, marinado suave", precio: 0, disponible: true },
    { id: "pro_atun", categoria: "PROTEINA", nombre: "Atún", descripcion: "Grado sashimi, corte del día", precio: 1500, disponible: true },
    { id: "pro_pollo", categoria: "PROTEINA", nombre: "Pollo teriyaki", descripcion: "Grillado y glaseado", precio: 0, disponible: true },
    { id: "pro_camaron", categoria: "PROTEINA", nombre: "Camarón", descripcion: "Cocido, con toque de limón", precio: 1000, disponible: true },
    { id: "pro_tofu", categoria: "PROTEINA", nombre: "Tofu marinado", descripcion: "Opción vegana, shoyu y jengibre", precio: 0, disponible: true },
    { id: "pro_kanikama", categoria: "PROTEINA", nombre: "Kanikama", descripcion: "Clásico, suave y dulce", precio: 0, disponible: true },

    { id: "sal_ponzu", categoria: "SALSA", nombre: "Ponzu", descripcion: "Cítrica y ligera, la más clásica", precio: 0, disponible: true },
    { id: "sal_shoyu", categoria: "SALSA", nombre: "Shoyu", descripcion: "Soya con sésamo, sabor profundo", precio: 0, disponible: true },
    { id: "sal_spicy", categoria: "SALSA", nombre: "Spicy mayo", descripcion: "Cremosa con picante medio", precio: 0, disponible: true },
    { id: "sal_goma", categoria: "SALSA", nombre: "Goma", descripcion: "Base de sésamo tostado, suave", precio: 0, disponible: true },
    { id: "sal_teriyaki", categoria: "SALSA", nombre: "Teriyaki", descripcion: "Dulce y espesa", precio: 0, disponible: true },
    { id: "sal_maracuya", categoria: "SALSA", nombre: "Maracuyá", descripcion: "Ácida y fresca, para bowls de pollo", precio: 0, disponible: true },

    { id: "top_palta", categoria: "TOPPING", nombre: "Palta", descripcion: "En láminas, media unidad", precio: 900, disponible: true },
    { id: "top_mango", categoria: "TOPPING", nombre: "Mango", descripcion: "En cubos, dulce y firme", precio: 0, disponible: true },
    { id: "top_sesamo", categoria: "TOPPING", nombre: "Sésamo tostado", descripcion: "Blanco y negro", precio: 0, disponible: true },
    { id: "top_edamame", categoria: "TOPPING", nombre: "Edamame", descripcion: "Porotos de soya con sal marina", precio: 0, disponible: true },
    { id: "top_wakame", categoria: "TOPPING", nombre: "Alga wakame", descripcion: "Ensalada marinada", precio: 0, disponible: true },
    { id: "top_crispy", categoria: "TOPPING", nombre: "Cebolla crispy", descripcion: "Frita, crocante", precio: 0, disponible: true },

    { id: "beb_limonada", categoria: "BEBIDA", nombre: "Limonada de menta", descripcion: "500 ml, recién hecha", precio: 2500, disponible: true },
    { id: "beb_te", categoria: "BEBIDA", nombre: "Té verde frío", descripcion: "Sin azúcar añadida", precio: 2200, disponible: true },
    { id: "beb_agua", categoria: "BEBIDA", nombre: "Agua mineral", descripcion: "Con o sin gas, 500 ml", precio: 1500, disponible: true },
    { id: "beb_lata", categoria: "BEBIDA", nombre: "Bebida en lata", descripcion: "350 ml, varias opciones", precio: 1800, disponible: false },

    { id: "promo_combo", categoria: "PROMOCION", nombre: "Combo mediodía", descripcion: "Bowl regular más bebida, de lunes a viernes hasta las 16:00", precio: 8990, disponible: true },
    { id: "promo_duo", categoria: "PROMOCION", nombre: "Dúo para compartir", descripcion: "Dos bowls regulares con 15% de descuento", precio: 11900, disponible: true },
  ];

  // Cada tamaño fija el precio base y cuántas salsas y toppings incluye.
  const TAMANOS = [
    { id: "regular", nombre: "Regular", descripcion: "Porción individual", precio: 6990, salsasIncluidas: 2, toppingsIncluidos: 3 },
    { id: "grande", nombre: "Grande", descripcion: "Más porción, más salsas y toppings incluidos", precio: 9490, salsasIncluidas: 3, toppingsIncluidos: 4 },
  ];

  // Reglas de armado en un solo objeto: cambiar un recargo es editar una línea.
  const REGLAS = {
    basesIncluidas: 1,
    maxBases: 3,
    recargoBaseExtra: 500,
    proteinasIncluidas: 1,
    maxProteinas: 3,
    recargoProteinaExtra: 2500,
    maxSalsas: 4,
    recargoSalsaExtra: 500,
    maxToppings: 6,
    recargoToppingExtra: 700,
  };

  /**
   * Qué se arma en cada promoción. El precio sale del catálogo (se edita en
   * la administración); aquí solo va la composición. Una promoción creada
   * desde el admin que no esté en esta lista se vende como producto simple.
   */
  const PROMOS = {
    promo_combo: { bowls: 1, bebida: true, tamanoId: "regular", detalle: "Arma tu bowl regular y elige tu bebida." },
    promo_duo: { bowls: 2, bebida: false, tamanoId: "regular", detalle: "Arma los dos bowls regulares a tu gusto." },
  };

  // -------------------------------------------------------------------------
  // localStorage
  // -------------------------------------------------------------------------

  const PREFIJO = "pokefresh:";

  function leer(clave, porDefecto) {
    try {
      const texto = localStorage.getItem(PREFIJO + clave);
      return texto === null ? porDefecto : JSON.parse(texto);
    } catch {
      // Storage deshabilitado o dato corrupto: se trabaja con el valor por defecto.
      return porDefecto;
    }
  }

  function guardar(clave, valor) {
    try {
      localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    } catch {
      /* sin storage, los datos duran lo que dure la pestaña */
    }
  }

  function borrar(clave) {
    try {
      localStorage.removeItem(PREFIJO + clave);
    } catch {
      /* nada que borrar */
    }
  }

  // -------------------------------------------------------------------------
  // Catálogo (lo edita el admin, lo lee la tienda)
  // -------------------------------------------------------------------------

  class ErrorDatos extends Error {
    constructor(mensaje, codigo) {
      super(mensaje);
      this.codigo = codigo;
    }
  }

  // Copia de trabajo en memoria para no releer localStorage en cada acceso.
  let catalogo = leer("catalogo", null) ?? structuredClone(CATALOGO_INICIAL);

  function persistir() {
    guardar("catalogo", catalogo);
  }

  /** Mismas reglas que la API REST de FastAPI, para que el admin se comporte igual. */
  function validarItem(datos, idPropio = null) {
    const nombre = String(datos.nombre ?? "").trim();
    const descripcion = String(datos.descripcion ?? "").trim();
    const precio = Number(datos.precio);

    if (nombre.length < 2 || nombre.length > 80) {
      throw new ErrorDatos("El nombre debe tener entre 2 y 80 caracteres.", "BAD_USER_INPUT");
    }
    if (descripcion.length < 2 || descripcion.length > 200) {
      throw new ErrorDatos("La descripción debe tener entre 2 y 200 caracteres.", "BAD_USER_INPUT");
    }
    if (!PF.ui.CATEGORIAS.some((c) => c.enum === datos.categoria)) {
      throw new ErrorDatos("La categoría no es válida.", "BAD_USER_INPUT");
    }
    if (!Number.isInteger(precio) || precio < 0 || precio > 100000) {
      throw new ErrorDatos("El precio debe ser un entero entre 0 y 100.000.", "BAD_USER_INPUT");
    }

    const repetido = catalogo.find(
      (item) => item.id !== idPropio && item.nombre.toLowerCase() === nombre.toLowerCase(),
    );
    if (repetido) {
      throw new ErrorDatos(`Ya existe un item llamado "${repetido.nombre}".`, "DUPLICADO");
    }

    // Las bases tienen precio fijo: su precio individual no se usa.
    const precioFinal = datos.categoria === "BASE" ? 0 : precio;

    return { nombre, descripcion, categoria: datos.categoria, precio: precioFinal, disponible: Boolean(datos.disponible) };
  }

  const PREFIJOS_ID = { BASE: "base", PROTEINA: "pro", SALSA: "sal", TOPPING: "top", BEBIDA: "beb", PROMOCION: "promo" };

  const catalogoApi = {
    listar({ categoria } = {}) {
      return categoria ? catalogo.filter((item) => item.categoria === categoria) : [...catalogo];
    },

    obtener(id) {
      return catalogo.find((item) => item.id === id) ?? null;
    },

    crear(datos) {
      const limpio = validarItem(datos);
      const base = `${PREFIJOS_ID[limpio.categoria]}_${PF.ui.slug(limpio.nombre).replace(/-/g, "_")}`;

      let id = base;
      let n = 2;
      while (catalogo.some((item) => item.id === id)) id = `${base}_${n++}`;

      const item = { id, ...limpio };
      catalogo.push(item);
      persistir();
      return item;
    },

    actualizar(id, cambios) {
      const indice = catalogo.findIndex((item) => item.id === id);
      if (indice === -1) throw new ErrorDatos(`No existe el item ${id}.`, "NOT_FOUND");

      const limpio = validarItem({ ...catalogo[indice], ...cambios }, id);
      catalogo[indice] = { id, ...limpio };
      persistir();
      return catalogo[indice];
    },

    eliminar(id) {
      const antes = catalogo.length;
      catalogo = catalogo.filter((item) => item.id !== id);
      if (catalogo.length === antes) throw new ErrorDatos(`No existe el item ${id}.`, "NOT_FOUND");
      persistir();
    },

    restaurar() {
      catalogo = structuredClone(CATALOGO_INICIAL);
      persistir();
    },
  };

  return {
    TAMANOS,
    REGLAS,
    PROMOS,
    ErrorDatos,
    leer,
    guardar,
    borrar,
    catalogo: catalogoApi,
  };
})();
