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

La prueba de carga (`docs/evidencias/carga.md`) midió, con 20 conexiones concurrentes sin pausa: 316 peticiones/s en el catálogo (p95 92 ms), 209 peticiones/s en la agregación GraphQL (p95 147 ms) y 255 peticiones/s en la cola de cocina (p95 110 ms), con 0 % de errores, todo contra el sistema en Docker y con TLS. Es decir, entre 42 y 63 veces el pico proyectado.

## Alternativas consideradas

1. **Servicio de analítica separado** (por ejemplo, un almacén de datos alimentado por eventos, con agregaciones precalculadas).
2. **gRPC entre servicios** (unary para cotizar y reservar stock; streaming de servidor para avisar a cocina de los pedidos nuevos).
3. **Mantener REST interno y resolver la analítica con el servicio de pedidos y el GraphQL Gateway**, con avisos asíncronos por ActiveMQ.

## Análisis de gRPC: por qué sí y por qué no

### Qué aportaría gRPC (argumentos a favor)

- **Contrato tipado y generado.** Un `.proto` define mensajes y métodos, y genera cliente y servidor en Node y en Python, sin escribir a mano la validación del formato de cada llamada.
- **Plazos y cancelación nativos.** Cada llamada lleva un *deadline* que se propaga entre servicios, y el cliente puede cancelar.
- **Streaming.** El servidor puede enviar una secuencia de eventos por una sola conexión (por ejemplo, pedidos nuevos a un consumidor privado), con control de flujo.
- **Transporte eficiente.** HTTP/2 multiplexa llamadas en una conexión y Protocol Buffers ocupa menos bytes que JSON.
- **Seguridad.** Admite TLS y TLS mutuo, y la identidad del llamador viaja en metadatos, con autorización por método.

### Por qué no se usa en este caso (argumentos en contra)

| Razón | Detalle en Poke Fresh |
|---|---|
| **No hay un flujo que lo necesite** | Se revisó cada comunicación interna (tabla siguiente): todas son llamadas puntuales y pequeñas (menos de 10 KB), de 2 a 4 por petición. Ninguna es de alta frecuencia, de larga duración ni requiere enviar una secuencia continua de mensajes |
| **El streaming no es un requisito** | El único flujo "en vivo" del caso es el aviso a cocina, que debe llegar en segundos, no en milisegundos. Ya se publica como evento en ActiveMQ y la pantalla consulta cada 8 s |
| **Los plazos, la cancelación y la idempotencia ya están cubiertos** | Cada llamada interna tiene un plazo de 4 s (`502/504` si se vence), propaga `X-Request-Id` e identidad, y las operaciones críticas son idempotentes (reserva, confirmación de pago, notificación) |
| **El navegador no habla gRPC** | El frontend necesita HTTP/JSON a través del gateway (o gRPC-Web con un proxy adicional). Usar gRPC solo entre servicios obliga a mantener dos contratos para lo mismo, uno REST hacia afuera y otro `.proto` hacia adentro |
| **Costo de operación** | Habría que generar código en dos lenguajes (Node y Python), agregar un servidor gRPC junto a cada FastAPI, y rehacer los `healthcheck`, las pruebas (hoy `httpx` y `node:test` sobre HTTP) y el recorrido de seguridad (credencial interna, TLS) para un protocolo distinto |
| **El rendimiento ya cumple con margen** | El sistema medido con REST y TLS soporta de 209 a 316 peticiones/s con 0 % de error, de 42 a 63 veces el pico proyectado. No hay un problema de CPU, memoria o latencia que gRPC deba resolver |

**Limitación de esta decisión.** No se midió gRPC contra REST: no hay una comparación controlada, así que **no se afirma que gRPC sea más lento, más rápido ni más costoso en CPU o memoria**. La decisión se apoya en que el caso no tiene un requisito que lo justifique y en la capacidad medida del diseño actual, no en un benchmark de gRPC.

### Evaluación por flujo interno

| Flujo | Modalidad si fuera gRPC | Frecuencia y tamaño | ¿Justifica gRPC? |
|---|---|---|---|
| pedidos → inventario: cotizar y reservar | Unary | Una vez por pedido (~150 al día); menos de 10 KB | No: REST ya es idempotente y con plazo |
| pedidos → clientes: ficha del comprador | Unary | Una vez por pedido | No |
| pagos → pedidos: confirmar pago | Unary | Una vez por pago | No: hoy es idempotente y se reintenta |
| pagos → pasarela | Fuera de nuestro control | Contrato REST y firma HMAC del proveedor | No aplica: es un tercero (simulado) |
| GraphQL → servicios (lecturas agregadas) | Unary con lotes | 2 a 4 llamadas por consulta, agrupadas con DataLoader | No |
| Aviso de pedido pagado → cocina | Streaming de servidor | Eventos esporádicos; tolera segundos de demora | No: ActiveMQ ya desacopla y reentrega |
| Reporte de ventas | Unary | Pocas veces al día | No |

### Cuándo la respuesta sería sí

Se implementaría gRPC si ocurre alguno de estos casos: (1) un consumidor privado necesita un **flujo continuo** de eventos con reanudación tras una desconexión (por ejemplo, un monitor de despacho con el estado de cada pedido en tiempo real); (2) una llamada interna supera la capacidad medida del REST, o su costo de CPU o memoria se vuelve el cuello de botella; (3) hay varios equipos o lenguajes que necesitan un contrato estricto y generado; (4) aparece una operación larga que conviene cancelar.

Cómo se haría, sin implementarlo ahora: un `.proto` por sistema con los mismos mensajes que hoy viajan en JSON; `unary` con *deadline* de 4 s para cotizar y reservar; un `stream` de servidor para eventos de pedido, con el identificador del último evento recibido para reanudar sin duplicar efectos; la identidad del usuario y la credencial del servicio en metadatos, sobre el mismo TLS actual (con TLS mutuo si se agrega); y, para el navegador, un adaptador en el gateway con Server-Sent Events, sin exponer gRPC. Este esquema es una propuesta de diseño y **no está implementado ni probado**.

## Decisión

Se elige la **alternativa 3**:

- **Analítica:** no se crea un servicio separado. El reporte de ventas lo calcula el servicio de pedidos (dueño de las ventas) con una consulta por rango de fechas sobre un índice (`venta.fecha`), y el GraphQL Gateway agrega lo que necesita de otros servicios (categoría de cada producto desde inventario y conciliación con pagos). Con < 100 MB al año, una consulta indexada responde en milisegundos; un subsistema de big data sería costo sin beneficio.
- **gRPC:** no se usa (ver el análisis de por qué sí y por qué no, más arriba). Las llamadas internas son pocas por petición (2 a 4), con mensajes pequeños y sin streaming; REST con JSON ya cumple la latencia con amplio margen. Los avisos que sí son asíncronos (pedido pagado → cocina, boleta → correo) van por **ActiveMQ** (STOMP), que además desacopla: si el broker o el notificador se caen, el pago se registra igual.
- **Contratos explícitos igual:** cada llamada interna está documentada en el informe (sección 6) y probada; la tipificación que aportaría `.proto` se cubre con validación en el servidor y pruebas de contrato.

## Consecuencias

- Menos piezas que operar (sin servidor gRPC, sin generación de código, sin TLS mutuo adicional entre servicios).
- El aviso a cocina tiene hasta 8 s de demora (consulta periódica de la pantalla). Es aceptable para el local; ActiveMQ ya publica el evento por si en el futuro se quiere empujarlo al navegador (por ejemplo con Server-Sent Events desde el gateway, sin exponer el broker).
- **Cuándo revisar esta decisión:** si el pico real supera 100 peticiones/s, si el reporte pasa de 2 s (p95) o si se abren más locales y se quiere analítica consolidada. En ese caso, el siguiente paso sería un servicio de analítica que consuma los eventos de ActiveMQ en su propia base de lectura, consultado por el GraphQL Gateway; gRPC solo si aparece una llamada interna de alta frecuencia o un flujo de streaming entre servicios.
