import DataLoader from "dataloader";
import { GraphQLError } from "graphql";

import { ErrorServicio } from "../servicios.js";

const ESTADOS = {
  PENDIENTE_PAGO: "Pendiente de pago",
  PAGADO: "Esperando cocina",
  EN_PREPARACION: "En preparación",
  LISTO_DESPACHO: "Listo para despacho",
  EN_DESPACHO: "En camino",
  LISTO_RETIRO: "Listo para retiro",
  ENTREGADO: "Entregado",
  ANULADO: "Anulado",
};

const MAX_PAGINA = 50;

/** Convierte un error de servicio en un error GraphQL con código, para la respuesta parcial. */
function aGraphQL(error) {
  if (error instanceof ErrorServicio) {
    const code = error.estado === 404 ? "NO_ENCONTRADO" : error.estado === 403 ? "PROHIBIDO" : error.codigo;
    return new GraphQLError(error.message, { extensions: { code, servicio: error.servicio } });
  }
  return error;
}

function exigirRol(ctx, ...roles) {
  if (!roles.includes(ctx.identidad.rol)) {
    throw new GraphQLError("Tu perfil no puede consultar este dato.", { extensions: { code: "PROHIBIDO" } });
  }
}

/**
 * Cargadores por petición (DataLoader): agrupan en UNA llamada lo que los
 * resolvers piden por separado. Un pedido con 6 líneas que mencionan 15
 * productos hace una sola llamada a inventario, no 15.
 */
export function crearCargadores(llamar, ctx) {
  const opciones = { identidad: ctx.identidad, idPeticion: ctx.idPeticion };
  return {
    productos: new DataLoader(
      async (ids) => {
        ctx.llamadas.inventario += 1;
        const lista = await llamar("inventario", "/items", { ...opciones, params: { ids: ids.join(",") } });
        const porId = new Map(lista.map((p) => [p.id, p]));
        return ids.map((id) => porId.get(id) ?? null);
      },
      { maxBatchSize: 100 },
    ),
    pagosPorPedido: new DataLoader(
      async (pedidoIds) => {
        ctx.llamadas.pagos += 1;
        const lista = await llamar("pagos", "/internos/pagos", { ...opciones, params: { ids: pedidoIds.join(",") } });
        return pedidoIds.map((id) => lista.filter((p) => p.pedidoId === id));
      },
      { maxBatchSize: 200 },
    ),
  };
}

const pedido = (p) => ({ ...p, estadoTexto: ESTADOS[p.estado] ?? p.estado, boleta: p.boleta ? { numero: p.boleta.numero, fecha: p.boleta.fecha, total: p.boleta.total } : null });

export const resolvers = {
  Query: {
    async resumenPedido(_raiz, { id }, ctx) {
      try {
        // Pedidos decide si quien pregunta puede ver este pedido (un pedido ajeno responde 404).
        const p = await ctx.llamar("pedidos", `/pedidos/${encodeURIComponent(id)}`, { identidad: ctx.identidad, idPeticion: ctx.idPeticion });
        return { pedido: pedido(p), _clienteId: p.clienteId };
      } catch (error) {
        if (error instanceof ErrorServicio && error.estado === 404) return null;
        throw aGraphQL(error);
      }
    },

    async misPedidos(_raiz, { primeros, despuesDe }, ctx) {
      exigirRol(ctx, "cliente");
      if (primeros < 1 || primeros > MAX_PAGINA) {
        throw new GraphQLError(`"primeros" debe estar entre 1 y ${MAX_PAGINA}.`, { extensions: { code: "BAD_USER_INPUT" } });
      }
      const todos = await ctx.llamar("pedidos", "/pedidos", { identidad: ctx.identidad, idPeticion: ctx.idPeticion }).catch((e) => {
        throw aGraphQL(e);
      });
      const inicio = despuesDe ? todos.findIndex((p) => p.id === despuesDe) + 1 : 0;
      const pagina = todos.slice(inicio, inicio + primeros);
      return { nodos: pagina.map(pedido), siguiente: inicio + primeros < todos.length ? pagina.at(-1).id : null };
    },

    async reporteVentas(_raiz, { desde, hasta }, ctx) {
      exigirRol(ctx, "admin", "dueno");
      const r = await ctx.llamar("pedidos", "/reportes/ventas", { identidad: ctx.identidad, idPeticion: ctx.idPeticion, params: { desde, hasta } }).catch((e) => {
        throw aGraphQL(e);
      });
      return { ...r, _ventas: r.ventas };
    },
  },

  ResumenPedido: {
    async pagos(resumen, _args, ctx) {
      try {
        return await ctx.cargadores.pagosPorPedido.load(resumen.pedido.id);
      } catch (error) {
        // Si pagos no responde, el resto del resumen igual llega (respuesta parcial).
        throw aGraphQL(error);
      }
    },
    async cliente(resumen, _args, ctx) {
      // Autorización por campo: la ficha de contacto completa es solo para el administrador.
      exigirRol(ctx, "admin");
      try {
        return await ctx.llamar("clientes", `/clientes/${encodeURIComponent(resumen._clienteId)}`, { identidad: ctx.identidad, idPeticion: ctx.idPeticion });
      } catch (error) {
        throw aGraphQL(error);
      }
    },
  },

  Linea: {
    async productos(linea, _args, ctx) {
      if (!linea.itemIds?.length) return [];
      try {
        const productos = await ctx.cargadores.productos.loadMany(linea.itemIds);
        return productos.filter((p) => p && !(p instanceof Error)).map((p) => ({ id: p.id, nombre: p.nombre, categoria: p.categoria, disponibleHoy: p.disponible }));
      } catch (error) {
        throw aGraphQL(error);
      }
    },
  },

  ReporteVentas: {
    async porCategoria(reporte, _args, ctx) {
      // Unidades vendidas por categoría: las líneas dicen qué productos llevan; inventario dice su categoría.
      const unidades = new Map();
      const validas = reporte._ventas.filter((v) => !v.venta.anulada);
      const ids = [...new Set(validas.flatMap((v) => v.lineas.flatMap((l) => l.itemIds ?? [])))];
      const productos = ids.length ? await ctx.cargadores.productos.loadMany(ids) : [];
      const categoria = new Map(productos.filter((p) => p && !(p instanceof Error)).map((p) => [p.id, p.categoria]));
      for (const v of validas) {
        for (const l of v.lineas) {
          for (const id of l.itemIds ?? []) {
            const c = categoria.get(id) ?? "SIN_CATEGORIA";
            unidades.set(c, (unidades.get(c) ?? 0) + l.cantidad);
          }
        }
      }
      return [...unidades.entries()].map(([categoria, unidades]) => ({ categoria, unidades })).sort((a, b) => b.unidades - a.unidades);
    },

    async conciliacion(reporte, _args, ctx) {
      const ventas = reporte._ventas.filter((v) => !v.venta.anulada);
      try {
        const pagos = (await ctx.cargadores.pagosPorPedido.loadMany(ventas.map((v) => v.id))).map((l) => (l instanceof Error ? [] : l));
        let montoPagos = 0;
        let aprobados = 0;
        const diferencias = [];
        ventas.forEach((v, i) => {
          const aprobado = pagos[i].find((p) => p.estado === "APROBADO");
          if (aprobado) {
            aprobados += 1;
            montoPagos += aprobado.monto;
          }
          // Las ventas históricas de ejemplo no tienen registro en pagos: también aparecen aquí.
          if (!aprobado || aprobado.monto !== v.total) diferencias.push(v.id);
        });
        return { ventas: ventas.length, pagosAprobados: aprobados, montoVentas: ventas.reduce((s, v) => s + v.total, 0), montoPagos, pedidosConDiferencia: diferencias };
      } catch (error) {
        throw aGraphQL(error);
      }
    },
  },
};
