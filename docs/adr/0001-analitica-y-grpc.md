# ADR 0001: ¿Servicio de analítica separado y comunicación gRPC?

- **Estado:** aceptada
- **Fecha:** 08-11-2026
- **Contexto del caso:** Poke Fresh (caso 24), un local de poke bowls con venta web, retiro y despacho a 3 km.

## Contexto

La evaluación pide decidir, con una necesidad medida o proyectada, si el caso necesita un servicio de analítica separado de las transacciones y si alguna comunicación interna justifica gRPC (llamadas tipadas, streaming).

### Carga proyectada (proyección, no medición)

| Variable | Valor estimado | Cómo se estimó |
|---|---|---|
| Pedidos por día | 150 (máximo 250 en un viernes) | Local de un solo punto de venta con delivery acotado a 3 km |
| Pico de pedidos | 40 por hora (13:00 a 14:00) | Concentración de almuerzo |
| Peticiones a la API por pedido | ~30 (catálogo, armado, checkout, pago, seguimiento) | Recorrido del frontend medido con `pruebas/e2e/pantallas.py` |
| Visitas que no compran | 10 por cada pedido | Supuesto habitual de comercio electrónico |
| **Pico de peticiones** | **~5 por segundo** | 40 × 30 × 10 / 3600 ≈ 3,3; se redondea hacia arriba |
| Pantallas de cocina y despacho | 2 a 4 equipos consultando cada 8 s | Diseño actual |
| Tamaño de un mensaje | < 10 KB (un pedido con sus líneas) | Medido en las respuestas |
| Datos por año | ~55.000 pedidos, < 100 MB en Mongo | 150 × 365 |
| Reporte de ventas | Lo usan el dueño y el administrador unas pocas veces al día, sobre períodos de hasta un año | Pantalla de reportes |
| Latencia aceptada | p95 < 300 ms en compra, < 500 ms en agregaciones; el reporte puede tardar hasta 2 s | Experiencia de usuario |
| Necesidad de streaming | No. Cocina necesita enterarse de un pedido nuevo en segundos, no en milisegundos | Operación del local |

### Medición

La prueba de carga (`docs/evidencias/carga.md`) midió, con 20 conexiones concurrentes sin pausa: 157 peticiones/s en el catálogo (p95 174 ms), 118 peticiones/s en la agregación GraphQL (p95 237 ms) y 139 peticiones/s en la cola de cocina (p95 191 ms), con 0 % de errores, todo contra el sistema en Docker. Es decir, entre 24 y 31 veces el pico proyectado.

## Alternativas consideradas

1. **Servicio de analítica separado** (por ejemplo, un almacén de datos alimentado por eventos, con agregaciones precalculadas).
2. **gRPC entre servicios** (unary para cotizar y reservar stock; streaming de servidor para avisar a cocina de los pedidos nuevos).
3. **Mantener REST interno y resolver la analítica con el servicio de pedidos y el GraphQL Gateway**, con avisos asíncronos por ActiveMQ.

## Decisión

Se elige la **alternativa 3**:

- **Analítica:** no se crea un servicio separado. El reporte de ventas lo calcula el servicio de pedidos (dueño de las ventas) con una consulta por rango de fechas sobre un índice (`venta.fecha`), y el GraphQL Gateway agrega lo que necesita de otros servicios (categoría de cada producto desde inventario y conciliación con pagos). Con < 100 MB al año, una consulta indexada responde en milisegundos; un subsistema de big data sería costo sin beneficio.
- **gRPC:** no se usa. Las llamadas internas son pocas por petición (2 a 4), con mensajes pequeños y sin streaming; REST con JSON ya cumple la latencia con amplio margen. Los avisos que sí son asíncronos (pedido pagado → cocina, boleta → correo) van por **ActiveMQ** (STOMP), que además desacopla: si el broker o el notificador se caen, el pago se registra igual.
- **Contratos explícitos igual:** cada llamada interna está documentada en el informe (sección 6) y probada; la tipificación que aportaría `.proto` se cubre con validación en el servidor y pruebas de contrato.

## Consecuencias

- Menos piezas que operar (sin servidor gRPC, sin generación de código, sin TLS mutuo adicional entre servicios).
- El aviso a cocina tiene hasta 8 s de demora (consulta periódica de la pantalla). Es aceptable para el local; ActiveMQ ya publica el evento por si en el futuro se quiere empujarlo al navegador (por ejemplo con Server-Sent Events desde el gateway, sin exponer el broker).
- **Cuándo revisar esta decisión:** si el pico real supera 100 peticiones/s, si el reporte pasa de 2 s (p95) o si se abren más locales y se quiere analítica consolidada. En ese caso, el siguiente paso sería un servicio de analítica que consuma los eventos de ActiveMQ en su propia base de lectura, consultado por el GraphQL Gateway; gRPC solo si aparece una llamada interna de alta frecuencia o un flujo de streaming entre servicios.
