import { GraphQLError } from "graphql";
import { db, reglas } from "../data/store.js";
import { cotizarBowl, describirBowl } from "../dominio/bowl.js";

const error = (mensaje, codigo) =>
  new GraphQLError(mensaje, { extensions: { code: codigo } });

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO_VALIDO = /^\+?[\d\s]{8,15}$/;

/** Obtiene el carrito indicado, o crea uno si no vino id. */
function obtenerCarritoEditable(carritoId) {
  const carrito = carritoId ? db.obtenerCarrito(carritoId) : db.crearCarrito();

  if (!carrito) {
    throw error(`No existe el carrito ${carritoId}.`, "NOT_FOUND");
  }
  if (carrito.cerrado) {
    throw error("El carrito ya fue convertido en orden.", "CARRITO_CERRADO");
  }

  return carrito;
}

/** Resuelve una línea guardada (solo ids) a su forma completa con precios. */
function expandirLinea(linea) {
  if (linea.tipo === "BOWL") {
    const bowl = cotizarBowl(linea.entrada);
    return {
      __tipo: "BOWL",
      id: linea.id,
      cantidad: linea.cantidad,
      bowl,
      subtotal: bowl.precio * linea.cantidad,
    };
  }

  const item = db.itemPorId(linea.itemId);
  return {
    __tipo: "ITEM",
    id: linea.id,
    cantidad: linea.cantidad,
    item,
    subtotal: item.precio * linea.cantidad,
  };
}

export const resolvers = {
  Query: {
    menu: () => db.secciones(),

    itemsMenu: (_padre, { categoria }) => db.itemsPorCategoria(categoria),

    tamanos: () => db.listarTamanos(),

    reglasBowl: () => reglas,

    // Toda la validación y el precio viven en el dominio, no acá.
    cotizarBowl: (_padre, { bowl }) => cotizarBowl(bowl),

    carrito: (_padre, { id }) => db.obtenerCarrito(id),

    orden: (_padre, { id }) => db.obtenerOrden(id),
  },

  Bowl: {
    resumen: (bowl) => describirBowl(bowl),
  },

  LineaCarrito: {
    // GraphQL necesita saber cuál miembro de la unión es cada línea.
    __resolveType: (linea) => (linea.__tipo === "BOWL" ? "LineaBowl" : "LineaItem"),
  },

  Carrito: {
    lineas: (carrito) => carrito.lineas.map(expandirLinea),

    total: (carrito) =>
      carrito.lineas.reduce((suma, linea) => suma + expandirLinea(linea).subtotal, 0),

    cantidadItems: (carrito) =>
      carrito.lineas.reduce((suma, linea) => suma + linea.cantidad, 0),
  },

  Mutation: {
    agregarBowl: (_padre, { carritoId, bowl, cantidad }) => {
      if (cantidad < 1 || cantidad > 20) {
        throw error("La cantidad debe estar entre 1 y 20.", "BAD_USER_INPUT");
      }

      const carrito = obtenerCarritoEditable(carritoId);

      // Se cotiza antes de guardar: si la selección es inválida, el carrito
      // no queda con basura adentro.
      cotizarBowl(bowl);

      carrito.lineas.push({
        id: db.nuevoId("lin"),
        tipo: "BOWL",
        cantidad,
        entrada: bowl,
      });

      return carrito;
    },

    agregarItem: async (_padre, { carritoId, itemId, cantidad }, { loaders }) => {
      if (cantidad < 1 || cantidad > 20) {
        throw error("La cantidad debe estar entre 1 y 20.", "BAD_USER_INPUT");
      }

      const carrito = obtenerCarritoEditable(carritoId);
      const item = await loaders.item.load(itemId);

      if (!item) {
        throw error(`No existe el item ${itemId}.`, "NOT_FOUND");
      }
      if (!["BEBIDA", "PROMOCION"].includes(item.categoria)) {
        throw error(
          `"${item.nombre}" es un ingrediente: va dentro de un bowl, no suelto.`,
          "SELECCION_INVALIDA",
        );
      }
      if (!item.disponible) {
        throw error(`"${item.nombre}" no está disponible hoy.`, "NO_DISPONIBLE");
      }

      const existente = carrito.lineas.find(
        (linea) => linea.tipo === "ITEM" && linea.itemId === itemId,
      );

      if (existente) {
        existente.cantidad += cantidad;
      } else {
        carrito.lineas.push({ id: db.nuevoId("lin"), tipo: "ITEM", itemId, cantidad });
      }

      return carrito;
    },

    cambiarCantidad: (_padre, { carritoId, lineaId, cantidad }) => {
      if (cantidad < 1 || cantidad > 20) {
        throw error("La cantidad debe estar entre 1 y 20.", "BAD_USER_INPUT");
      }

      const carrito = obtenerCarritoEditable(carritoId);
      const linea = carrito.lineas.find((l) => l.id === lineaId);

      if (!linea) {
        throw error(`No existe la línea ${lineaId} en este carrito.`, "NOT_FOUND");
      }

      linea.cantidad = cantidad;
      return carrito;
    },

    quitarLinea: (_padre, { carritoId, lineaId }) => {
      const carrito = obtenerCarritoEditable(carritoId);
      const antes = carrito.lineas.length;

      carrito.lineas = carrito.lineas.filter((linea) => linea.id !== lineaId);

      if (carrito.lineas.length === antes) {
        throw error(`No existe la línea ${lineaId} en este carrito.`, "NOT_FOUND");
      }

      return carrito;
    },

    crearOrden: (_padre, { carritoId, cliente, modoEntrega, direccion }) => {
      if (!EMAIL_VALIDO.test(cliente.email)) {
        throw error("El email no tiene un formato válido.", "BAD_USER_INPUT");
      }
      if (!TELEFONO_VALIDO.test(cliente.telefono)) {
        throw error("El teléfono no tiene un formato válido.", "BAD_USER_INPUT");
      }
      if (modoEntrega === "DELIVERY" && !direccion?.trim()) {
        throw error("El delivery necesita una dirección.", "BAD_USER_INPUT");
      }

      const carrito = obtenerCarritoEditable(carritoId);

      if (carrito.lineas.length === 0) {
        throw error("No se puede crear una orden con el carrito vacío.", "CARRITO_VACIO");
      }

      // Se recotiza todo recién aquí: los precios y la disponibilidad pudieron
      // cambiar desde que el cliente armó el carrito.
      const lineas = carrito.lineas.map((linea) => {
        const expandida = expandirLinea(linea);

        return {
          descripcion:
            expandida.__tipo === "BOWL"
              ? describirBowl(expandida.bowl)
              : expandida.item.nombre,
          cantidad: expandida.cantidad,
          precioUnitario:
            expandida.__tipo === "BOWL" ? expandida.bowl.precio : expandida.item.precio,
          subtotal: expandida.subtotal,
        };
      });

      carrito.cerrado = true;

      return db.crearOrden({
        id: db.nuevoId("ord"),
        cliente,
        modoEntrega,
        direccion: direccion?.trim() ?? null,
        lineas,
        total: lineas.reduce((suma, linea) => suma + linea.subtotal, 0),
        estado: "RECIBIDA",
        creadaEn: new Date().toISOString(),
      });
    },
  },
};
