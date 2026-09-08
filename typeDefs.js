export const typeDefs = /* GraphQL */ `
  enum CategoriaMenu {
    BASE
    PROTEINA
    SALSA
    TOPPING
    BEBIDA
    PROMOCION
  }

  """
  Cualquier cosa que aparece en la carta: un ingrediente, una bebida o una promoción.
  """
  type ItemMenu {
    id: ID!
    nombre: String!
    descripcion: String!
    categoria: CategoriaMenu!
    """
    En ingredientes es el recargo sobre el precio del bowl (0 si es estándar).
    En bebidas y promociones es el precio de venta.
    """
    precio: Int!
    disponible: Boolean!
  }

  """
  Una sección de la página de menú: título más sus items. Pedir \`menu\` trae
  la página completa en una sola consulta.
  """
  type SeccionMenu {
    categoria: CategoriaMenu!
    titulo: String!
    items: [ItemMenu!]!
  }

  type Tamano {
    id: ID!
    nombre: String!
    descripcion: String!
    precio: Int!
    salsasIncluidas: Int!
    toppingsIncluidos: Int!
  }

  """
  Límites y recargos del armador. El frontend los consulta para deshabilitar
  botones y mostrar avisos sin tener las reglas duplicadas en el cliente.
  """
  type ReglasBowl {
    maxBases: Int!
    recargoSegundaBase: Int!
    proteinasIncluidas: Int!
    maxProteinas: Int!
    recargoProteinaExtra: Int!
    maxSalsas: Int!
    recargoSalsaExtra: Int!
    maxToppings: Int!
    recargoToppingExtra: Int!
  }

  type LineaPrecio {
    concepto: String!
    monto: Int!
  }

  """
  Un bowl armado, ya validado y cotizado por el servidor.
  """
  type Bowl {
    tamano: Tamano!
    bases: [ItemMenu!]!
    proteinas: [ItemMenu!]!
    salsas: [ItemMenu!]!
    toppings: [ItemMenu!]!
    precio: Int!
    desglose: [LineaPrecio!]!
    resumen: String!
  }

  input BowlInput {
    tamanoId: ID!
    baseIds: [ID!]!
    proteinaIds: [ID!]!
    salsaIds: [ID!] = []
    toppingIds: [ID!] = []
  }

  type LineaBowl {
    id: ID!
    cantidad: Int!
    bowl: Bowl!
    subtotal: Int!
  }

  type LineaItem {
    id: ID!
    cantidad: Int!
    item: ItemMenu!
    subtotal: Int!
  }

  """
  El carrito mezcla bowls armados y productos de carta, por eso la unión:
  el cliente pide los campos de cada caso con fragmentos.
  """
  union LineaCarrito = LineaBowl | LineaItem

  type Carrito {
    id: ID!
    lineas: [LineaCarrito!]!
    total: Int!
    cantidadItems: Int!
  }

  enum ModoEntrega {
    RETIRO
    DELIVERY
  }

  enum EstadoOrden {
    RECIBIDA
    EN_PREPARACION
    LISTA
    ENTREGADA
    CANCELADA
  }

  input ClienteInput {
    nombre: String!
    telefono: String!
    email: String!
  }

  """
  Línea congelada de una orden: guarda descripción y precio al momento de la
  compra, para que un cambio de carta no altere el historial.
  """
  type OrdenLinea {
    descripcion: String!
    cantidad: Int!
    precioUnitario: Int!
    subtotal: Int!
  }

  type Orden {
    id: ID!
    cliente: Cliente!
    modoEntrega: ModoEntrega!
    direccion: String
    lineas: [OrdenLinea!]!
    total: Int!
    estado: EstadoOrden!
    creadaEn: String!
  }

  type Cliente {
    nombre: String!
    telefono: String!
    email: String!
  }

  type Query {
    "Toda la página de menú, agrupada por sección."
    menu: [SeccionMenu!]!
    "Items de una sola categoría, para el armador paso a paso."
    itemsMenu(categoria: CategoriaMenu!): [ItemMenu!]!
    tamanos: [Tamano!]!
    reglasBowl: ReglasBowl!
    """
    Valida y cotiza un bowl sin agregarlo al carrito. El configurador la llama
    en cada cambio para mostrar el precio en vivo.
    """
    cotizarBowl(bowl: BowlInput!): Bowl!
    carrito(id: ID!): Carrito
    orden(id: ID!): Orden
  }

  type Mutation {
    "Si no se envía carritoId se crea uno nuevo y su id viene en la respuesta."
    agregarBowl(carritoId: ID, bowl: BowlInput!, cantidad: Int! = 1): Carrito!
    "Para bebidas y promociones, que no se arman."
    agregarItem(carritoId: ID, itemId: ID!, cantidad: Int! = 1): Carrito!
    cambiarCantidad(carritoId: ID!, lineaId: ID!, cantidad: Int!): Carrito!
    quitarLinea(carritoId: ID!, lineaId: ID!): Carrito!
    crearOrden(
      carritoId: ID!
      cliente: ClienteInput!
      modoEntrega: ModoEntrega!
      direccion: String
    ): Orden!
  }
`;
