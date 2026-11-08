# GraphQL Gateway

Servicio privado (solo lo llama el API Gateway, en `/api/v1/graphql`). No tiene base de datos: combina lo que responden los microservicios, pasándoles la identidad del usuario para que cada uno aplique sus reglas.

- `resumenPedido(id)`: pedido + pagos + productos (+ contacto del cliente, solo admin). Lo usa la pantalla del pedido.
- `misPedidos(primeros, despuesDe)`: paginado, máximo 50.
- `reporteVentas(desde, hasta)`: unidades por categoría y conciliación con pagos. Lo usa la pantalla de reportes.

Límites: profundidad 6, costo 1000, 3 s por llamada a cada servicio, DataLoader para no repetir llamadas, errores parciales si un servicio falla.

Pruebas: `npm test`.
