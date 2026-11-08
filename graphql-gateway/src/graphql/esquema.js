/**
 * Schema del GraphQL Gateway. Solo lectura: las operaciones que cambian
 * datos (crear pedido, pagar, cambiar estado) van por REST al servicio dueño,
 * que es quien aplica las reglas de negocio. Aquí se COMBINA información.
 *
 * Dos agregaciones, cada una usada por una pantalla del frontend:
 *
 *   resumenPedido   pantalla "Pedido" (#/orden/:id)
 *                   pedidos (estado, líneas) + pagos (intentos y su estado)
 *                   + inventario (producto actual de cada línea)
 *                   + clientes (ficha de contacto, solo para el administrador)
 *
 *   reporteVentas   pantalla "Reporte de ventas" (#/admin/reportes)
 *                   pedidos (ventas) + inventario (categoría de cada producto)
 *                   + pagos (conciliación: venta registrada vs. pago aprobado)
 */
export const typeDefs = /* GraphQL */ `
  type Query {
    "Pedido con sus pagos y productos. El cliente solo puede pedir los suyos."
    resumenPedido(id: ID!): ResumenPedido

    "Pedidos del cliente con sesión, paginados (máximo 50 por página)."
    misPedidos(primeros: Int = 10, despuesDe: String): PaginaPedidos!

    "Reporte de ventas con ventas por categoría y conciliación con pagos. Solo admin y dueño."
    reporteVentas(desde: String!, hasta: String!): ReporteVentas
  }

  type ResumenPedido {
    pedido: Pedido!
    "Intentos de pago del pedido (servicio de pagos). null si pagos no responde."
    pagos: [Pago!]
    "Ficha de contacto del cliente (servicio de clientes). Solo para el administrador."
    cliente: FichaCliente
  }

  type Pedido {
    id: ID!
    estado: String!
    estadoTexto: String!
    modoEntrega: String!
    direccion: String
    total: Int!
    creadoEn: String!
    lineas: [Linea!]!
    boleta: Boleta
  }

  type Linea {
    descripcion: String!
    cantidad: Int!
    precioUnitario: Int!
    subtotal: Int!
    "Productos del inventario que componen la línea, con su estado actual."
    productos: [Producto!]
  }

  type Producto {
    id: ID!
    nombre: String!
    categoria: String!
    disponibleHoy: Boolean!
  }

  type Boleta {
    numero: Int!
    fecha: String!
    total: Int!
  }

  type Pago {
    id: ID!
    estado: String!
    monto: Int!
    medio: String!
    "Referencia de la pasarela."
    referencia: String
    creadoEn: String!
    actualizadoEn: String
  }

  type FichaCliente {
    nombre: String!
    telefono: String!
    email: String!
    comuna: String!
  }

  type PaginaPedidos {
    nodos: [Pedido!]!
    "Cursor para pedir la página siguiente (null si no hay más)."
    siguiente: String
  }

  type ReporteVentas {
    desde: String!
    hasta: String!
    cantidad: Int!
    monto: Int!
    porCategoria: [VentaCategoria!]!
    conciliacion: Conciliacion
  }

  type VentaCategoria {
    categoria: String!
    unidades: Int!
  }

  type Conciliacion {
    ventas: Int!
    pagosAprobados: Int!
    montoVentas: Int!
    montoPagos: Int!
    "Pedidos cuya venta no calza con un pago aprobado (o al revés)."
    pedidosConDiferencia: [ID!]!
  }
`;
