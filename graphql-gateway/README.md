# Poke Fresh — API GraphQL

Backend GraphQL para el sitio de Poke Fresh: carta, armador de bowls, carrito y órdenes.

## Cómo correrlo

```bash
npm install
npm start
```

Playground en `http://localhost:4000/graphql`.

Los datos viven en memoria (`src/data/store.js`) y se reinician con el servidor. Los resolvers nunca acceden a esos arreglos directamente: cuando conectemos la base de datos, se reemplaza el cuerpo de las funciones de `db` y el resto del proyecto queda igual.

## Estructura

```
src/
  index.js                     servidor Express + Apollo
  graphql/typeDefs.js          esquema
  graphql/resolvers.js         resolvers, validación de entrada y errores
  graphql/loaders.js           DataLoader (uno por request)
  graphql/limiteProfundidad.js regla de validación anti-abuso
  dominio/bowl.js              reglas de armado y cálculo de precio
  data/store.js                catálogo y acceso a datos
```

## Consultas por pantalla

### Página de menú — una sola consulta

La carta completa, agrupada por sección, con el mismo orden que muestra la página:

```graphql
query PaginaMenu {
  menu {
    categoria
    titulo
    items {
      id
      nombre
      descripcion
      precio
      disponible
    }
  }
}
```

### Armador de bowl

Al abrir el armador, se traen las opciones y las reglas juntas:

```graphql
query DatosArmador {
  tamanos { id nombre precio salsasIncluidas toppingsIncluidos }
  bases: itemsMenu(categoria: BASE) { id nombre descripcion precio disponible }
  proteinas: itemsMenu(categoria: PROTEINA) { id nombre descripcion precio disponible }
  salsas: itemsMenu(categoria: SALSA) { id nombre descripcion precio disponible }
  toppings: itemsMenu(categoria: TOPPING) { id nombre descripcion precio disponible }
  reglasBowl { maxBases maxProteinas recargoProteinaExtra recargoToppingExtra }
}
```

Y en cada cambio de selección, el precio en vivo sin tocar el carrito:

```graphql
query Cotizar($bowl: BowlInput!) {
  cotizarBowl(bowl: $bowl) {
    precio
    resumen
    desglose { concepto monto }
  }
}
```

Variables:

```json
{
  "bowl": {
    "tamanoId": "grande",
    "baseIds": ["base_quinoa", "base_verdes"],
    "proteinaIds": ["pro_salmon", "pro_atun"],
    "salsaIds": ["sal_ponzu", "sal_goma"],
    "toppingIds": ["top_palta"]
  }
}
```

### Carrito

```graphql
mutation Agregar($bowl: BowlInput!) {
  agregarBowl(bowl: $bowl) {
    id
    total
  }
}
```

Sin `carritoId` se crea un carrito nuevo; hay que guardar el `id` que devuelve y mandarlo en las siguientes llamadas.

El carrito mezcla bowls armados y productos de carta, así que las líneas son una unión y se leen con fragmentos:

```graphql
query VerCarrito($id: ID!) {
  carrito(id: $id) {
    total
    cantidadItems
    lineas {
      __typename
      ... on LineaBowl {
        id
        cantidad
        subtotal
        bowl { resumen precio }
      }
      ... on LineaItem {
        id
        cantidad
        subtotal
        item { nombre }
      }
    }
  }
}
```

### Checkout

```graphql
mutation Confirmar($id: ID!) {
  crearOrden(
    carritoId: $id
    cliente: { nombre: "Kevin", telefono: "+56912345678", email: "kevin@correo.cl" }
    modoEntrega: DELIVERY
    direccion: "Av. Siempre Viva 123"
  ) {
    id
    total
    estado
    lineas { descripcion cantidad precioUnitario subtotal }
  }
}
```

## Decisiones de diseño

**El bowl es una configuración, no un producto.** Lo que va al carrito no tiene id de catálogo: es una combinación de tamaño, bases, proteínas, salsas y toppings. Por eso `BowlInput` recibe ids de ingredientes y el servidor arma y cotiza el resultado.

**El precio nunca viene del cliente.** `cotizarBowl` lo calcula en el servidor a partir de la selección. Si el frontend enviara el total, cualquiera podría pedir un bowl de $1 desde la consola del navegador. La misma función se usa para el precio en vivo del armador, para agregar al carrito y para cerrar la orden, así que los tres siempre coinciden.

**"Mitad y mitad" es una regla, no un ingrediente.** En la carta aparece como una tarjeta más, pero en el modelo es simplemente elegir dos bases, con el recargo definido en `reglas.recargoSegundaBase`. Modelarlo como ingrediente habría obligado a inventar un producto que no existe en la cocina.

**Un solo endpoint, una consulta por pantalla.** La página de menú entera sale de `menu`, y el armador trae opciones y reglas en una sola llamada. Con REST serían seis o siete requests, o un endpoint a medida por pantalla.

**Las reglas se consultan, no se duplican.** `reglasBowl` expone los límites y recargos para que el frontend deshabilite botones y muestre avisos sin tener las mismas constantes copiadas en el cliente. Si mañana cambia el recargo, cambia en un solo lugar.

**Precios congelados en la orden.** `OrdenLinea` guarda descripción y precio al momento de la compra. Si después cambia la carta, el historial de la orden no se altera.

**DataLoader contra el problema N+1.** Los ingredientes se resuelven por lotes con un loader nuevo en cada request, para que la caché no se comparta entre clientes.

**Límite de profundidad.** Como el cliente decide la forma de la consulta, una anidación larga puede volverse cara. La regla en `limiteProfundidad.js` rechaza operaciones de más de 8 niveles.

**Errores con código.** Cada error de negocio lleva `extensions.code` (`NOT_FOUND`, `SELECCION_INVALIDA`, `NO_DISPONIBLE`, `CARRITO_VACIO`, `BAD_USER_INPUT`) para que el frontend reaccione sin leer el texto del mensaje.

## Pendiente para las próximas semanas

- Conectar `src/data/store.js` a la base de datos real.
- Agregar `imagenUrl` a `ItemMenu` cuando las imágenes estén subidas.
- Autenticación: hoy cualquiera que sepa el id de un carrito puede modificarlo.
- Horarios de las promociones (el combo de mediodía hoy no valida la hora).
- Tests de integración sobre el armador y el checkout.
