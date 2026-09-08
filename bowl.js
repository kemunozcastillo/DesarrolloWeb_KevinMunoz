import { GraphQLError } from "graphql";
import { db, reglas } from "../data/store.js";

const error = (mensaje, codigo) =>
  new GraphQLError(mensaje, { extensions: { code: codigo } });

/**
 * Resuelve los ids de una selección y valida que existan, estén disponibles
 * y pertenezcan a la categoría correcta.
 */
function resolverSeleccion(ids, categoria, etiqueta) {
  return ids.map((id) => {
    const item = db.itemPorId(id);

    if (!item) {
      throw error(`No existe el ingrediente ${id}.`, "NOT_FOUND");
    }
    if (item.categoria !== categoria) {
      throw error(`"${item.nombre}" no es ${etiqueta}.`, "SELECCION_INVALIDA");
    }
    if (!item.disponible) {
      throw error(`"${item.nombre}" no está disponible hoy.`, "NO_DISPONIBLE");
    }

    return item;
  });
}

function sinRepetidos(ids, etiqueta) {
  if (new Set(ids).size !== ids.length) {
    throw error(`Hay ${etiqueta} repetidos en la selección.`, "SELECCION_INVALIDA");
  }
}

/**
 * Valida un bowl armado por el cliente y calcula su precio.
 *
 * Devuelve también el desglose, para que el configurador del frontend pueda
 * mostrar de dónde sale cada peso en vez de un total sin explicación.
 *
 * El precio SIEMPRE se calcula aquí, nunca se recibe del cliente: si el front
 * lo enviara, cualquiera podría pedir un bowl de $1 desde la consola.
 */
export function cotizarBowl(entrada) {
  const { tamanoId, baseIds, proteinaIds, salsaIds = [], toppingIds = [] } = entrada;

  const tamano = db.tamanoPorId(tamanoId);
  if (!tamano) {
    throw error(`No existe el tamaño ${tamanoId}.`, "NOT_FOUND");
  }

  // --- Cantidades ---
  if (baseIds.length < 1 || baseIds.length > reglas.maxBases) {
    throw error(
      `El bowl lleva entre 1 y ${reglas.maxBases} bases.`,
      "SELECCION_INVALIDA",
    );
  }
  if (proteinaIds.length < 1 || proteinaIds.length > reglas.maxProteinas) {
    throw error(
      `El bowl lleva entre 1 y ${reglas.maxProteinas} proteínas.`,
      "SELECCION_INVALIDA",
    );
  }
  if (salsaIds.length > reglas.maxSalsas) {
    throw error(`Máximo ${reglas.maxSalsas} salsas por bowl.`, "SELECCION_INVALIDA");
  }
  if (toppingIds.length > reglas.maxToppings) {
    throw error(`Máximo ${reglas.maxToppings} toppings por bowl.`, "SELECCION_INVALIDA");
  }

  sinRepetidos(baseIds, "bases");
  sinRepetidos(proteinaIds, "proteínas");
  sinRepetidos(salsaIds, "salsas");
  sinRepetidos(toppingIds, "toppings");

  // --- Ingredientes ---
  const bases = resolverSeleccion(baseIds, "BASE", "una base");
  const proteinas = resolverSeleccion(proteinaIds, "PROTEINA", "una proteína");
  const salsas = resolverSeleccion(salsaIds, "SALSA", "una salsa");
  const toppings = resolverSeleccion(toppingIds, "TOPPING", "un topping");

  // --- Precio ---
  const desglose = [{ concepto: `Bowl ${tamano.nombre}`, monto: tamano.precio }];

  if (bases.length === 2) {
    desglose.push({ concepto: "Mitad y mitad", monto: reglas.recargoSegundaBase });
  }

  const proteinasExtra = Math.max(0, proteinas.length - reglas.proteinasIncluidas);
  if (proteinasExtra > 0) {
    desglose.push({
      concepto: `Proteína extra x${proteinasExtra}`,
      monto: proteinasExtra * reglas.recargoProteinaExtra,
    });
  }

  const salsasExtra = Math.max(0, salsas.length - tamano.salsasIncluidas);
  if (salsasExtra > 0) {
    desglose.push({
      concepto: `Salsa extra x${salsasExtra}`,
      monto: salsasExtra * reglas.recargoSalsaExtra,
    });
  }

  const toppingsExtra = Math.max(0, toppings.length - tamano.toppingsIncluidos);
  if (toppingsExtra > 0) {
    desglose.push({
      concepto: `Topping extra x${toppingsExtra}`,
      monto: toppingsExtra * reglas.recargoToppingExtra,
    });
  }

  // Ingredientes premium: el recargo va aparte de los límites por cantidad.
  for (const item of [...bases, ...proteinas, ...salsas, ...toppings]) {
    if (item.precio > 0) {
      desglose.push({ concepto: `${item.nombre} (premium)`, monto: item.precio });
    }
  }

  const precio = desglose.reduce((suma, linea) => suma + linea.monto, 0);

  return { tamano, bases, proteinas, salsas, toppings, precio, desglose };
}

/** Texto legible del bowl, para guardarlo en la orden y mostrarlo en cocina. */
export function describirBowl(bowl) {
  const partes = [
    `Bowl ${bowl.tamano.nombre}`,
    bowl.bases.map((b) => b.nombre).join(" + "),
    bowl.proteinas.map((p) => p.nombre).join(" + "),
  ];

  if (bowl.salsas.length) partes.push(bowl.salsas.map((s) => s.nombre).join(", "));
  if (bowl.toppings.length) partes.push(bowl.toppings.map((t) => t.nombre).join(", "));

  return partes.join(" · ");
}
