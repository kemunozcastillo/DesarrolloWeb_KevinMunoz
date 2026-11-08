# Pruebas de punta a punta

Ejecutadas el 08-11-2026 12:25 contra `http://localhost:8080`. 19 de 19 correctas.
El detalle de cada petición (con su X-Request-Id para buscarla en los logs) está en `e2e-resultados.json`.

| Caso | Prueba | Entrada | Identidad | Esperado | Obtenido | Componente que lo verifica | Resultado |
|---|---|---|---|---|---|---|---|
| 7.1 | Acceso anónimo al catálogo | GET /catalogo/items | anónimo | 200, sin stock ni datos internos | 200, 29 productos, ninguno trae stock | Gateway (ruta pública) + inventario | ✅ |
| 7.2 | Operación protegida sin sesión | GET /pedidos | anónimo | 401 SIN_SESION | 401 SIN_SESION | Gateway | ✅ |
| 7.3 | Administración desde un rol sin permiso | DELETE /catalogo/items/top_mango; GET /clientes; GET /reportes/ventas | cocina, dueño, cliente | 403 en las tres | cocina DELETE 403, dueño DELETE 403, cliente /clientes 403, cocina reportes 403 | Gateway (matriz de rutas) + inventario | ✅ |
| 7.4 | Cabeceras de identidad falsificadas | GET /clientes con X-Usuario-Rol: admin | cliente | 403 (el gateway descarta la cabecera) | 403: la identidad la pone el gateway, no el navegador | Gateway | ✅ |
| 10.1 | Compra completa: pedido con precio calculado en el servidor | POST /pedidos con precioUnitario: 1 en la línea | cliente | 201, total = precio del catálogo | 201 PF-00081, total 7890 (el 1 enviado se ignoró) | Pedidos + inventario + clientes | ✅ |
| 7.5 | Consulta de un pedido ajeno (REST y GraphQL) | GET /pedidos/{id}; resumenPedido(id) | otro cliente | 404 sin datos; GraphQL null | REST 404 sin datos; GraphQL resumenPedido = null; la dueña sí lo ve (200) | Pedidos (propiedad del recurso) + GraphQL Gateway | ✅ |
| 7.6 | Pago con datos alterados desde el frontend | POST /pagos {monto: 1}; POST /pagos/notificacion sin firma y con firma falsa | cliente | monto = total del pedido; notificaciones 401 | monto cobrado 7890 (no 1); notificación sin firma 401, firma falsa 401; pedido sigue PENDIENTE_PAGO | Pagos (firma HMAC, monto del pedido) | ✅ |
| 10.2 | Pago duplicado (doble clic) | POST /pagos dos veces con la misma Idempotency-Key | cliente | el mismo pago | mismo pago PAG-37F8EA452841 | Pagos (idempotencia) | ✅ |
| 10.3 | Pago aprobado en la pasarela y notificación firmada | POST pasarela /pagar/{token} APROBADO (dos veces) | cliente (navegador en Servipag) | pedido PAGADO con boleta; el segundo envío no hace nada | PAGADO, venta N° 79, boleta N° 79, ref. SVP-78958231; un solo paso PAGADO | Pasarela -> gateway -> pagos -> pedidos -> ActiveMQ | ✅ |
| 10.4 | Flujo de cocina y despacho con permisos | aceptar/terminar (cocina), despachar/entregar (despacho), y cruzados | cocina, despacho | estados en orden; cruzados 403 | despacho→aceptar 403, cocina→despachar 403; pasos [200, 409, 200, 200, 200]; cocina ve solo nombre y teléfono; final ENTREGADO | Gateway + pedidos | ✅ |
| 8.1 | Agregación GraphQL desde la pantalla del pedido | resumenPedido(id) con pedido, pagos y productos | cliente | datos de pedidos + pagos + inventario en una respuesta | pedido + pago APROBADO + 4 categorías de productos; campo cliente negado al cliente (PROHIBIDO) | GraphQL Gateway | ✅ |
| 8.2 | Límites GraphQL | consulta de costo alto; misPedidos(primeros: 500) | cliente | rechazadas antes de ejecutar | costo: «La consulta cuesta 11102 y el máximo permitido es 1000.»; página >50: BAD_USER_INPUT | GraphQL Gateway | ✅ |
| 8.3 | Reporte con agregación (admin/dueño) | reporteVentas(desde, hasta) | dueño; cocina | dueño: categorías y conciliación; cocina: PROHIBIDO | dueño: 24 ventas, 5 categorías, 24 pagos aprobados; cocina: PROHIBIDO | GraphQL Gateway + pedidos + pagos + inventario | ✅ |
| 10.5 | Reserva y recuperación de stock | stock=1; pedido de 2 (409); pedido de 1; anular | admin, cliente | 409 SIN_STOCK; stock 0; anular devuelve a 1 | pedido de 2: 409 SIN_STOCK; pedido de 1: stock 0 y el catálogo lo muestra agotado; anulación: stock vuelve a 1 | Inventario (reservas) + pedidos | ✅ |
| 10.6 | Anular un pedido pagado devuelve el pago | pedido pagado; POST /pedidos/{id}/anular | cliente | ANULADO, venta anulada, pago DEVUELTO | PF-00083: ANULADO, venta anulada, pago DEVUELTO | Pedidos + pagos + pasarela + inventario | ✅ |
| 6.1 | Ruta interna no publicada | POST /internos/pedidos/{id}/pago-confirmado | admin | 404 | 404 RUTA_INEXISTENTE | Gateway (matriz de rutas) | ✅ |
| 7.7 | CSRF: petición desde otro sitio | POST /pedidos con Origin ajeno y la cookie | cliente | 403 ORIGEN_NO_PERMITIDO | 403 ORIGEN_NO_PERMITIDO | Gateway | ✅ |
| 7.8 | Cookie de sesión protegida | POST /auth/login | cliente | HttpOnly, SameSite, Path=/api; token fuera del cuerpo | HttpOnly; SameSite=Lax; Path=/api; el token no viaja en el cuerpo; tras logout el mismo token responde 401 | Gateway | ✅ |
| 7.11 | Límite de intentos de login | 25 logins seguidos con clave incorrecta | anónimo | bloqueo (429) antes del intento 25 | 401 en los primeros 5; 429 desde el intento 6 | Auth Service (5 intentos) + gateway (20/min por IP) | ✅ |
