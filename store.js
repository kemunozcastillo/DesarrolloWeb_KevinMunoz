/**
 * Capa de acceso a datos (en memoria).
 *
 * Los resolvers nunca tocan estos arreglos: solo llaman a `db`. Cuando
 * conectemos la base de datos, se reemplaza el cuerpo de estas funciones
 * y el resto del proyecto queda igual.
 */

// `precio` significa distinto según la categoría:
//   - ingredientes (BASE, PROTEINA, SALSA, TOPPING): recargo sobre el bowl, 0 si es estándar
//   - BEBIDA / POSTRE / PROMOCION: precio de venta
const items = [
  // --- Bases ---
  { id: "base_gohan", categoria: "BASE", nombre: "Arroz gohan", descripcion: "Arroz blanco japonés con vinagre de arroz", precio: 0, disponible: true },
  { id: "base_integral", categoria: "BASE", nombre: "Arroz integral", descripcion: "Grano entero, textura más firme", precio: 0, disponible: true },
  { id: "base_quinoa", categoria: "BASE", nombre: "Quinoa", descripcion: "Alta en proteína, sin gluten", precio: 500, disponible: true },
  { id: "base_verdes", categoria: "BASE", nombre: "Mix de hojas verdes", descripcion: "Lechuga, rúcula y espinaca", precio: 0, disponible: true },
  { id: "base_soba", categoria: "BASE", nombre: "Fideos soba", descripcion: "Trigo sarraceno, servidos fríos", precio: 500, disponible: true },

  // --- Proteínas ---
  { id: "pro_salmon", categoria: "PROTEINA", nombre: "Salmón fresco", descripcion: "Cortado en cubos, marinado suave", precio: 0, disponible: true },
  { id: "pro_atun", categoria: "PROTEINA", nombre: "Atún", descripcion: "Grado sashimi, corte del día", precio: 1500, disponible: true },
  { id: "pro_pollo", categoria: "PROTEINA", nombre: "Pollo teriyaki", descripcion: "Grillado y glaseado", precio: 0, disponible: true },
  { id: "pro_camaron", categoria: "PROTEINA", nombre: "Camarón", descripcion: "Cocido, con toque de limón", precio: 1000, disponible: true },
  { id: "pro_tofu", categoria: "PROTEINA", nombre: "Tofu marinado", descripcion: "Opción vegana, shoyu y jengibre", precio: 0, disponible: true },
  { id: "pro_kanikama", categoria: "PROTEINA", nombre: "Kanikama", descripcion: "Clásico, suave y dulce", precio: 0, disponible: true },

  // --- Salsas ---
  { id: "sal_ponzu", categoria: "SALSA", nombre: "Ponzu", descripcion: "Cítrica y ligera, la más clásica", precio: 0, disponible: true },
  { id: "sal_shoyu", categoria: "SALSA", nombre: "Shoyu", descripcion: "Soya con sésamo, sabor profundo", precio: 0, disponible: true },
  { id: "sal_spicy", categoria: "SALSA", nombre: "Spicy mayo", descripcion: "Cremosa con picante medio", precio: 0, disponible: true },
  { id: "sal_goma", categoria: "SALSA", nombre: "Goma", descripcion: "Base de sésamo tostado, suave", precio: 0, disponible: true },
  { id: "sal_teriyaki", categoria: "SALSA", nombre: "Teriyaki", descripcion: "Dulce y espesa", precio: 0, disponible: true },
  { id: "sal_maracuya", categoria: "SALSA", nombre: "Maracuyá", descripcion: "Ácida y fresca, para bowls de pollo", precio: 0, disponible: true },

  // --- Toppings ---
  { id: "top_palta", categoria: "TOPPING", nombre: "Palta", descripcion: "En láminas, media unidad", precio: 900, disponible: true },
  { id: "top_mango", categoria: "TOPPING", nombre: "Mango", descripcion: "En cubos, dulce y firme", precio: 0, disponible: true },
  { id: "top_sesamo", categoria: "TOPPING", nombre: "Sésamo tostado", descripcion: "Blanco y negro", precio: 0, disponible: true },
  { id: "top_edamame", categoria: "TOPPING", nombre: "Edamame", descripcion: "Porotos de soya con sal marina", precio: 0, disponible: true },
  { id: "top_wakame", categoria: "TOPPING", nombre: "Alga wakame", descripcion: "Ensalada marinada", precio: 0, disponible: true },
  { id: "top_crispy", categoria: "TOPPING", nombre: "Cebolla crispy", descripcion: "Frita, crocante", precio: 0, disponible: true },

  // --- Bebidas ---
  { id: "beb_limonada", categoria: "BEBIDA", nombre: "Limonada de menta", descripcion: "500 ml, recién hecha", precio: 2500, disponible: true },
  { id: "beb_te", categoria: "BEBIDA", nombre: "Té verde frío", descripcion: "Sin azúcar añadida", precio: 2200, disponible: true },
  { id: "beb_agua", categoria: "BEBIDA", nombre: "Agua mineral", descripcion: "Con o sin gas, 500 ml", precio: 1500, disponible: true },
  { id: "beb_lata", categoria: "BEBIDA", nombre: "Bebida en lata", descripcion: "350 ml, varias opciones", precio: 1800, disponible: false },

  // --- Promociones ---
  { id: "promo_combo", categoria: "PROMOCION", nombre: "Combo mediodía", descripcion: "Bowl regular + bebida, de lunes a viernes hasta las 16:00", precio: 8990, disponible: true },
  { id: "promo_duo", categoria: "PROMOCION", nombre: "Dúo para compartir", descripcion: "Dos bowls regulares con 15% de descuento", precio: 11900, disponible: true },
];

// Cada tamaño trae su propio precio base y cuántos ingredientes incluye.
const tamanos = [
  { id: "regular", nombre: "Regular", descripcion: "Porción individual", precio: 6990, salsasIncluidas: 2, toppingsIncluidos: 3 },
  { id: "grande", nombre: "Grande", descripcion: "Doble proteína, para buen hambre", precio: 9490, salsasIncluidas: 3, toppingsIncluidos: 4 },
];

/**
 * Reglas de armado del bowl. Están acá y no repartidas en los resolvers
 * para que cambiar una política de precio sea editar un solo objeto.
 */
export const reglas = {
  maxBases: 2,
  recargoSegundaBase: 500, // la tarjeta "Mitad y mitad" del menú
  proteinasIncluidas: 1,
  maxProteinas: 3,
  recargoProteinaExtra: 2500,
  maxSalsas: 4,
  recargoSalsaExtra: 500,
  maxToppings: 6,
  recargoToppingExtra: 700,
};

const SECCIONES = [
  { categoria: "BASE", titulo: "Bases" },
  { categoria: "PROTEINA", titulo: "Proteína" },
  { categoria: "SALSA", titulo: "Salsas" },
  { categoria: "TOPPING", titulo: "Toppings" },
  { categoria: "BEBIDA", titulo: "Bebidas" },
  { categoria: "PROMOCION", titulo: "Promociones" },
];

const carritos = new Map();
const ordenes = new Map();

let secuencia = 100;
const nuevoId = (prefijo) => `${prefijo}_${++secuencia}`;

export const db = {
  // --- Menú ---
  secciones() {
    return SECCIONES.map((seccion) => ({
      ...seccion,
      items: items.filter((item) => item.categoria === seccion.categoria),
    }));
  },

  itemsPorCategoria(categoria) {
    return items.filter((item) => item.categoria === categoria);
  },

  // Recibe muchos ids de una vez: es lo que permite el batching de DataLoader.
  itemsPorIds(ids) {
    return ids.map((id) => items.find((item) => item.id === id) ?? null);
  },

  itemPorId(id) {
    return items.find((item) => item.id === id) ?? null;
  },

  listarTamanos() {
    return tamanos;
  },

  tamanoPorId(id) {
    return tamanos.find((tamano) => tamano.id === id) ?? null;
  },

  // --- Carrito ---
  crearCarrito() {
    const carrito = { id: nuevoId("car"), lineas: [], cerrado: false };
    carritos.set(carrito.id, carrito);
    return carrito;
  },

  obtenerCarrito(id) {
    return carritos.get(id) ?? null;
  },

  // --- Órdenes ---
  crearOrden(orden) {
    ordenes.set(orden.id, orden);
    return orden;
  },

  obtenerOrden(id) {
    return ordenes.get(id) ?? null;
  },

  nuevoId,
};
