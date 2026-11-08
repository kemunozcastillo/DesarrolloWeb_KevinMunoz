# Evaluación Unidad 2: backend seguro completo

| | |
|---|---|
| **Caso** | 24, Poke Fresh: venta web de poke bowls con retiro en local y despacho gratis a 3 km |
| **Ramo** | Desarrollo Web, Ingeniería Civil Informática, Facultad de Ingeniería, Universidad Andrés Bello |
| **Integrantes** | Kevin Muñoz Castillo |
| **Docente** | Ernesto Vivanco |
| **Versión del frontend** | 2.0: SPA en HTML, CSS y JavaScript sin frameworks, integrada con la API (rama `Evaluacion-2`). La versión 1.0 (entrega de frontend) guardaba todo en `localStorage`. |
| **Fecha** | 09-11-2026 |

## Índice

- [Contexto del proyecto](#contexto-del-proyecto)
0. [Requisitos y brechas declaradas](#0-requisitos-y-brechas-declaradas)
1. [Servicios y contratos](#1-servicios-y-contratos)
2. [Dominio y límites de los microservicios](#2-dominio-y-límites-de-los-microservicios)
3. [Sistemas, componentes e integración](#3-sistemas-componentes-e-integración)
4. [Stakeholders y matriz de permisos](#4-stakeholders-y-matriz-de-permisos)
5. [API Gateway, políticas y fronteras de confianza](#5-api-gateway-políticas-y-fronteras-de-confianza)
6. [Rutas, secretos, identidades y operaciones GraphQL](#6-rutas-secretos-identidades-y-operaciones-graphql)
7. [Datos sensibles y secretos del cliente](#7-datos-sensibles-y-secretos-del-cliente)
8. [Separación privada y agregaciones GraphQL](#8-separación-privada-y-agregaciones-graphql)
9. [Analítica y gRPC](#9-analítica-y-grpc)
10. [Backend completo e integración verificable](#10-backend-completo-e-integración-verificable)
- [Anexo A. Ejemplos de contrato por operación](#anexo-a-ejemplos-de-contrato-por-operación)

---

## Contexto del proyecto

**Qué es Poke Fresh.** Es un local de poke bowls (cuencos de arroz con pescado o pollo, salsas y toppings) que vende por la web. La persona arma su bowl o elige una promoción, paga en línea y lo retira en el local o, si vive a menos de 3 km, se lo llevan gratis. Dentro del local, cocina ve los pedidos pagados en el orden en que llegan y quien despacha asigna un chofer y registra la entrega. El dueño y el administrador mantienen productos, clientes y usuarios, y revisan las ventas.

**Qué pide el caso y qué pide esta evaluación.** El caso (requisitos R1 a R14, sección 0) ya tenía su frontend, que guardaba todo en el navegador. Esta evaluación pide lo que faltaba para que funcione de verdad: un backend con datos que se guardan, reglas de negocio, usuarios con permisos distintos, pagos con un proveedor externo y protección de los datos personales, todo conectado a las mismas pantallas.

**Qué tan grande es.** Es un solo local. Se estiman unos 150 pedidos al día (hasta 250 un viernes), unos 40 por hora en el almuerzo, es decir, unas 5 peticiones por segundo en el momento de más movimiento (es una proyección; la cuenta está en el ADR 0001). El sistema es pequeño en carga y delicado en datos, porque maneja RUN, direcciones y pagos. Por eso el diseño pone el esfuerzo en la seguridad y la claridad, no en escalar: la prueba de carga midió entre 209 y 316 peticiones por segundo, muy por encima de lo que el local necesita.

**La arquitectura, en un párrafo.** El navegador solo habla con una puerta, el API Gateway, que revisa quién es la persona y qué puede hacer, y recién entonces pasa la petición a un servicio privado (inventario, clientes, pedidos, pagos, autenticación o GraphQL). Los servicios no tienen puertos hacia afuera, cada uno guarda sus datos en su propia base de MongoDB y lee sus secretos de Vault. El pago ocurre en la página de una pasarela externa (aquí simulada), que después avisa al sistema con una notificación firmada.

![Arquitectura en una figura: el navegador entra por el API Gateway; los servicios, MongoDB y Vault están en una red privada](diagramas/arquitectura-simple.png)

**Las decisiones que definen el diseño.**

1. **Una sola puerta y servicios privados.** Lo que no se publica no se puede atacar. El gateway tiene una lista explícita de rutas permitidas; lo que no está en la lista no existe hacia afuera.
2. **Decide el servidor, no el navegador.** El navegador manda lo que la persona eligió; el precio, el total y si un pedido está pagado los calcula y decide el servidor. Un precio o un pago alterado desde la pantalla no tiene ningún efecto.
3. **Cada dato tiene un dueño y cada servicio tiene su propia llave.** Inventario decide los precios, pedidos decide el estado de un pedido, pagos decide el estado de un pago. Cada servicio usa su propia credencial, guardada en Vault, y todos los saltos van cifrados con TLS. Si se filtra una llave, solo abre una puerta.
4. **Lo simple primero.** Los servicios hablan REST; GraphQL se usa solo para juntar lecturas de varios servicios en una pantalla; no hay gRPC ni servicio de analítica aparte porque la carga medida no lo justifica (sección 9).

**Una compra, de punta a punta.** Javiera Morales Díaz es la clienta de prueba que aparece en las capturas. Su compra recorre casi todo el sistema, y entre paréntesis va el número de cada operación (sección 1):

1. Entra a la tienda y mira el menú: el navegador pide el catálogo y las reglas de armado (S01 y S03). No necesita sesión.
2. Ingresa con su correo y su clave (S33). El Auth Service valida la contraseña y el gateway le entrega una cookie que el JavaScript de la página no puede leer.
3. Arma un bowl regular de quinoa, salmón, salsa de goma, mango y edamame, y confirma el pedido (S15). El navegador manda solo qué eligió; inventario calcula el precio ($6.990) y reserva los ingredientes.
4. Paga (S27). El sistema crea el cobro en la pasarela y la lleva a su página; Javiera paga allí y ningún dato de tarjeta pasa por Poke Fresh.
5. La pasarela avisa con una notificación firmada (S29). Si la firma, el monto y el cobro coinciden, pedidos marca el pedido como pagado, registra la venta y emite la boleta (la N° 79 en las capturas). El aviso a cocina y el correo con la boleta salen por una cola de mensajes, sin demorar el pago.
6. Cocina ve el pedido en su cola (S16), lo acepta (S20) y lo marca listo (S21). Javiera retira en el local, así que queda "listo para retiro"; si hubiera pedido despacho, el encargado asignaría un chofer (S22). Al final se registra la entrega (S23).
7. Javiera sigue su pedido en una pantalla que junta el pedido, sus pagos y los productos en una sola consulta (S30) y puede ver su boleta (S18). Si se hubiera arrepentido antes de que cocina aceptara el pedido, lo habría anulado (S25) y el sistema le habría devuelto el pago.

Las capturas de este recorrido están en las secciones 8 y 10, y el detalle técnico de cada llamada, en la secuencia de la sección 3.

**Cómo leer los números y códigos.**

- **R1 a R14:** requisitos del caso (sección 0).
- **S01 a S44:** operaciones del backend, numeradas (sección 1). Cada tabla del informe las nombra con ese número.
- **Sí\*:** en las tablas de permisos significa "permitido, pero solo si se cumple una condición" (por ejemplo, un cliente ve pedidos, pero solo los suyos). Se explica en la sección 4.
- **Caso 7.5, 8.1, 10.4 y similares:** pruebas de punta a punta que se ejecutan contra el sistema funcionando (`pruebas/e2e/casos.py`). El primer número es el módulo de la pauta donde se pide esa prueba. Los resultados están en la sección 7 y en `evidencias/e2e-resultados.md`.

---

## 0. Requisitos y brechas declaradas

Esta sección fija el punto de partida: lo que el caso le pide a la tienda (R1 a R14) y, más abajo, lo que no se pudo hacer como en una empresa real y con qué se reemplazó. Conviene leerla antes que las demás, porque explica por qué hay una pasarela de pago simulada, un correo que se muestra en pantalla o certificados de prueba. Cada brecha tiene tres columnas: qué falta, por qué falta y cómo se cubre.

### Requisitos del caso

| Id | Requisito |
|---|---|
| R1 | Catálogo por categorías (bases, proteínas, salsas, toppings, bebidas, promociones), con dos tamaños y reglas de armado (bases y proteínas incluidas, recargos por extra e ingredientes premium) |
| R2 | Armar un bowl personalizado y ver su precio |
| R3 | Promociones armables (combo con bebida, dúo de bowls) |
| R4 | Carrito de compra |
| R5 | Registro de clientes con RUN, nombre, dirección, región/provincia/comuna, fecha de nacimiento, sexo, correo y teléfono; verificación del correo |
| R6 | Ingreso de clientes y de usuarios internos con perfiles: administrador, dueño, cocina y encargado de despacho |
| R7 | Venta solo a clientes registrados; retiro en local o despacho gratis dentro de 3 km |
| R8 | Pago en línea en Servipag; con el pago confirmado, el cajero virtual registra la venta y emite la boleta electrónica, que se envía al correo |
| R9 | Cocina recibe los pedidos pagados en orden de llegada, con aviso, los acepta y los marca listos |
| R10 | Despacho asigna chofer y registra la entrega; los retiros quedan listos en el local |
| R11 | Anulación con motivo mientras cocina no acepte; si estaba pagado, se devuelve el pago |
| R12 | Mantenedores: productos (precio, disponibilidad, stock), clientes (incluido el registro en el local con clave temporal) y usuarios internos |
| R13 | Caja web del día y reporte de ventas por período, descargable en CSV |
| R14 | Seguimiento del pedido, boleta e historial del cliente |

### Convenciones y punto de partida

- **Público y privado.** Una ruta es *pública* cuando el gateway la publica hacia el navegador, y puede exigir sesión. Un servicio es *privado* cuando solo lo alcanzan componentes autorizados (red `privada`, credencial interna). Son clasificaciones distintas: `pedidos` es un servicio privado y aun así tiene rutas públicas.
- **Dato público y restringido.** Solo los datos del catálogo (nombre, descripción, precio, disponibilidad) son públicos. RUN, dirección, correo, teléfono, fecha de nacimiento, sexo y el historial de pedidos son restringidos aunque aparezcan en pantalla (sección 7).
- **Requisitos y decisiones.** R1 a R14 vienen del caso. Las decisiones de arquitectura (un solo API Gateway, sesiones opacas en un Auth Service, Vault, GraphQL privado, TLS, ADR 0001) son del diseño y se justifican en las secciones 2 a 9.
- **Escritorio y móvil.** Es una sola SPA responsiva: una variación visual no genera un servicio nuevo, y los mismos S01 a S44 sirven a ambos tamaños. Hay capturas de los dos (sección 10).
- **Pantallas y operaciones.** Todas las funciones del caso tienen pantalla; no quedó ninguna brecha de pantalla. Cuatro operaciones existen como contrato pero ninguna pantalla las usa: S19 (el frontend trae su propia lista de choferes, que el servidor igual valida), S28 (los pagos de un pedido se ven con S30), S31 (la lista de pedidos usa S16) y S44 (es para quien opera el sistema).
- **Identificadores.** Cada operación tiene un ID de servicio (S01 a S44) que se repite en la trazabilidad, la matriz de permisos, la matriz de rutas, el UML y la matriz final de requisitos. Los requisitos son R1 a R14 y las pantallas son las rutas del frontend (`#/...`).

### Brechas declaradas

Lo que no se implementa como en producción, por qué, y qué lo reemplaza:

| Brecha | Motivo | Cómo se cubre |
|---|---|---|
| Servipag no tiene un entorno de pruebas abierto | Proveedor externo sin sandbox público | `servicios/pasarela`: simulador con el mismo contrato que una pasarela real (API key del comercio, página de pago, notificación firmada con HMAC, reintentos, devoluciones). El servicio de pagos se integra igual que con una real |
| Correo (código de verificación, boleta) | Sin proveedor de correo | En modo demo el código vuelve en la respuesta y se muestra como "correo simulado"; la boleta se publica en ActiveMQ y el notificador registra el envío. Con `MODO_DEMO=false` no se devuelve |
| Radio de 3 km | Sin servicio de mapas | Se aproxima por comuna (Providencia, Ñuñoa, Santiago, Recoleta y Las Condes), validado en el servidor |
| Certificados de prueba y sin TLS mutuo | Entorno local: no hay una CA pública que emita certificados para `localhost` | Hay TLS en todos los saltos (navegador → gateway, gateway → servicios, servicio → servicio, Vault, Mongo y ActiveMQ) con una CA propia que crea `tls-init` en el arranque. El navegador avisa que esa CA no es de confianza. Los clientes verifican al servidor con la CA, pero no presentan certificado propio (se autentican con credencial: TLS mutuo queda para producción) y las claves privadas están en un volumen compartido de solo lectura, igual que los tokens de Vault. La red privada además sigue siendo `internal`. En producción: certificados de una CA real con renovación automática |
| Desbloqueo de Vault | Entorno de desarrollo | La clave de desbloqueo y el token raíz quedan en un volumen local para que el sistema arranque solo. En producción: auto-unseal con KMS y token raíz revocado |
| Distribución de tokens de Vault | Docker Compose no entrega un archivo distinto a cada contenedor sin un orquestador | Cada servicio tiene su propio token con su propia política, pero todos se escriben en un mismo volumen de solo lectura. En producción, el orquestador (Docker secrets o Kubernetes) monta cada token solo en su contenedor |
| Sesiones del Auth Service | Se guardan en memoria | Un reinicio del Auth Service cierra todas las sesiones (falla segura: hay que volver a ingresar) |
| ActiveMQ sin autenticación | Broker solo accesible en la red privada y solo por STOMP sobre TLS (sin consola web ni otros protocolos) | Si se expone, se activa usuario y clave en el broker y se guardan en Vault |
| Aviso a cocina "en vivo" | Sin WebSocket ni SSE | La pantalla de cocina consulta cada 8 s y avisa con sonido; ActiveMQ ya publica el evento por si se quiere empujar (ver ADR 0001) |
| GitHub Pages | El frontend ahora necesita la API | Se sirve desde el gateway (mismo origen que la API). La versión estática de la entrega anterior sigue en la rama `Front-end` |

---

## 1. Servicios y contratos

Cada cosa que Javiera hace en la tienda (mirar el menú, ingresar, armar su bowl, pagar) necesita algo del backend. Esta sección convierte cada una de esas acciones en un servicio con un número, de S01 a S44, y un contrato: qué recibe, qué responde y qué errores puede dar. Primero se muestra qué pantalla usa cada servicio, después viene la matriz completa, con una fila por operación, y al final hay ejemplos con datos ficticios. Si buscas una operación concreta, parte por la matriz y usa su número.

### Trazabilidad de pantallas

| Pantalla (ruta del frontend) | Requisito | Operaciones | Servicio y endpoint (vía `/api/v1`) | IDs |
|---|---|---|---|---|
| Todas las pantallas (barra superior) | R6 | Saber quién tiene sesión, cerrar sesión | gateway: `GET /auth/sesion`; Auth: `POST /auth/logout` | S35, S34 |
| Inicio, Menú `#/menu`, Arma tu bowl, Promo, Carrito | R1 a R4 | Ver catálogo, tamaños, reglas y promociones | inventario: `GET /catalogo/items`, `GET /catalogo/configuracion` | S01, S03 |
| Ingresar `#/ingresar` | R6 | Login, cuentas de prueba (demo) | gateway + Auth Service: `POST /auth/login`, `GET /auth/config` | S33, S36 |
| Registro `#/registro`, Verificar `#/verificar` | R5 | Crear cuenta, verificar correo, reenviar código | clientes: `POST /clientes/registro`; Auth: `POST /auth/verificar`, `POST /auth/reenviar` | S07, S38, S39 |
| Mis datos `#/mi-cuenta` | R14 | Ver y editar ficha, cambiar clave | clientes: `GET/PUT /clientes/yo`; Auth: `PUT /auth/clave` | S08, S09, S37 |
| Mis pedidos `#/mis-pedidos` | R14 | Historial propio | pedidos: `GET /pedidos` | S16 |
| Confirmar pedido `#/checkout` | R4, R7 | Crear pedido (solo la selección) | pedidos (+ clientes + inventario): `POST /pedidos` | S15 |
| Pago `#/pago/:id` | R8 | Iniciar pago e ir a Servipag | pagos (+ pedidos + pasarela): `POST /pagos` | S27 |
| Pedido `#/orden/:id` | R8, R11, R14 | Seguimiento, pagos, anular | **GraphQL** `resumenPedido`; pedidos: `POST /pedidos/:id/anular` | S30, S25 |
| Boleta `#/boleta/:n` | R8, R14 | Ver e imprimir | pedidos: `GET /pedidos/boleta/:n` | S18 |
| Panel: Pedidos `#/admin/pedidos` | R11 | Filtrar, abrir, anular | pedidos: `GET /pedidos?estado&q`, `GET /pedidos/:id`, `POST /pedidos/:id/anular` | S16, S17, S25 |
| Panel: Cocina `#/admin/cocina` | R9 | Cola, aceptar, marcar listo, orden imprimible | pedidos: `GET /pedidos?cola=cocina`, `POST /pedidos/:id/aceptar`, `/terminar`, `/impresa` | S16, S20, S21, S24 |
| Panel: Despacho `#/admin/despacho` | R10 | Cola, asignar chofer, entregar | pedidos: `GET /pedidos?cola=despacho`, `POST /pedidos/:id/despachar`, `/entregar` | S16, S22, S23 |
| Panel: Caja `#/admin/caja` | R13 | Ventas del día | pedidos: `GET /reportes/ventas` | S26 |
| Panel: Reportes `#/admin/reportes` | R13 | Reporte, CSV, categorías, conciliación | pedidos: `GET /reportes/ventas`; **GraphQL** `reporteVentas` | S26, S32 |
| Panel: Productos `#/admin` | R12 | CRUD, stock, disponibilidad | inventario: `GET/POST/PUT/DELETE /catalogo/items` | S01, S02, S04, S05, S06 |
| Panel: Clientes `#/admin/clientes` | R12 | Listar, registrar en local, editar, activar | clientes: `GET/POST /clientes`, `GET/PUT /clientes/:id`, `PATCH /clientes/:id/estado` | S10, S11, S12, S13, S14 |
| Panel: Usuarios `#/admin/usuarios` | R6, R12 | Listar, crear, editar, activar | Auth: `GET/POST /usuarios`, `PUT /usuarios/:id`, `PATCH /usuarios/:id/estado` | S40, S41, S42, S43 |
| (sin pantalla) | — | Operaciones solo de contrato | `GET /pedidos/configuracion`, `GET /pagos?pedidoId`, GraphQL `misPedidos`, `GET /api/salud` | S19, S28, S31, S44 |
| (la invoca la pasarela, no el navegador) | R8 | Confirmar el pago | pagos: `POST /pagos/notificacion` | S29 |

Los precios, totales y estados de pago nunca los manda el navegador como verdad: el servidor los calcula o los verifica (S15, S27, S29).

### Catálogo de servicios

| Servicio | Tecnología | Responsabilidad | Datos propios | Expuesto | IDs públicos |
|---|---|---|---|---|---|
| API Gateway | Node, Express | Servir el frontend, sesión, autorización por rol, enrutamiento, límites, CSRF | Ninguno | Sí (8080) | S35, S36, S44 (y reenvía todos los demás) |
| Auth Service | Node, Express | Cuentas, contraseñas, sesiones, introspección, verificación de correo, usuarios internos | `pf_auth.cuentas` | No | S33, S34, S37 a S43 |
| GraphQL Gateway | Node, Apollo Server 4 | Agregaciones de lectura entre servicios | Ninguno | No | S30 a S32 |
| inventario | Python, FastAPI | Catálogo, precios, reglas, cotización, stock y reservas | `pf_inventario.items`, `reservas` | No | S01 a S06 |
| clientes | Python, FastAPI | Ficha del cliente | `pf_clientes.clientes` | No | S07 a S14 |
| pedidos | Python, FastAPI | Pedidos, estados, venta, boleta, colas, reporte | `pf_pedidos.pedidos`, `contadores` | No | S15 a S26 |
| pagos | Python, FastAPI | Pagos, idempotencia, notificaciones, devoluciones | `pf_pagos.pagos` | No | S27 a S29 |
| notificador | Python, stomp.py | Consumir `/queue/correos` y `/queue/cocina` | Ninguno | No | — (consume eventos) |
| Pasarela (simulada) | Python, FastAPI | Proveedor externo de pago | Memoria | Sí (9000) | — (la usa el navegador para pagar y pagos por API) |

### Matriz de servicios: una fila por operación

Datos: **Púb.** público, **Rest.** restringido (personal), **Cred.** credencial, **Fin.** financiero. Todas las rutas van bajo `/api/v1`. Errores comunes a todas las rutas con sesión: `401 SIN_SESION` y `403 PROHIBIDO` (rol sin permiso); todos tienen la misma forma (ver más abajo). Los códigos de la columna "Reglas y errores" son los relevantes de cada operación.

| ID | Req. | Pantalla y acción | Propósito | Verbo y ruta | Entrada | Salida | Reglas y errores | Datos | Acceso |
|---|---|---|---|---|---|---|---|---|---|
| S01 | R1 | Menú, Arma tu bowl: cargar productos | Consultar catálogo | `GET /catalogo/items` | `categoria`, `ids` (opcionales; hasta 100) | `200` lista de `{id, categoria, nombre, descripcion, precio, disponible}`; `[]` si no hay | `400` categoría inválida; solo campos permitidos (el stock lo ven admin y dueño) | Púb. | Anónimo |
| S02 | R1, R12 | Panel Productos: abrir un producto | Obtener un producto | `GET /catalogo/items/:id` | `id` | `200` producto | `404 NO_ENCONTRADO` | Púb. | Anónimo |
| S03 | R1 a R3 | Menú, Arma tu bowl, Promo: tamaños, reglas y promociones | Reglas del armado y recargos | `GET /catalogo/configuracion` | — | `200 {tamanos, reglas, promos}` | — | Púb. | Anónimo |
| S04 | R12 | Productos: crear | Agregar un producto | `POST /catalogo/items` | Datos del producto (categoría, nombre, descripción, precio, stock, disponible) | `201` producto | `400` datos inválidos (nombre de 2 a 80 caracteres, precio entero de 0 a 100.000, stock entero o vacío); `409 DUPLICADO` (nombre) | Púb. (stock: interno) | admin, dueño |
| S05 | R12 | Productos: editar precio, disponibilidad y stock | Modificar un producto | `PUT /catalogo/items/:id` | Datos del producto | `200` producto | `400`; `404`; `409` nombre repetido | Púb. (stock: interno) | admin, dueño |
| S06 | R12 | Productos: eliminar | Solicitar la eliminación de un producto | `DELETE /catalogo/items/:id` | `id` | `204` | `404`; solo admin. Los pedidos ya hechos conservan la descripción y el precio copiados | Púb. | admin |
| S07 | R5 | Registro: crear cuenta | Registrar cliente y su cuenta | `POST /clientes/registro` | `{run, nombre, direccion, region, provincia, comuna, fechaNacimiento, sexo, email, telefono, clave}` | `201 {cliente, codigoDemo}` (nunca la clave ni su hash) | `400` ficha o clave débil; `409 DUPLICADO` (RUN o correo); `429` (20 por minuto por IP) | Rest. y Cred. | Anónimo |
| S08 | R14 | Mis datos: ver ficha | Ver la ficha propia | `GET /clientes/yo` | — (la identidad sale de la sesión) | `200` ficha | `403` si no es cliente | Rest. | cliente |
| S09 | R14 | Mis datos: editar ficha | Modificar la ficha propia | `PUT /clientes/yo` | Campos editables (no `run`, `origen` ni `activo`) | `200` ficha | `400`; `409 DUPLICADO` (correo) | Rest. | cliente |
| S10 | R12 | Clientes: listar y buscar | Consultar fichas | `GET /clientes` | `q` (opcional) | `200` lista con `emailVerificado` | `403` | Rest. | admin |
| S11 | R12 | Clientes: registrar en el local | Alta con clave temporal | `POST /clientes` | Ficha (sin clave) | `201 {cliente, claveTemporal}` (la clave solo en modo demo) | `400`; `409 DUPLICADO` | Rest. y Cred. | admin |
| S12 | R12 | Clientes: abrir ficha | Consultar un cliente | `GET /clientes/:id` | `id` | `200` ficha | `404` | Rest. | admin |
| S13 | R12 | Clientes: editar | Modificar un cliente | `PUT /clientes/:id` | Campos de la ficha | `200` ficha | `400`; `404`; `409` | Rest. | admin |
| S14 | R12 | Clientes: activar o desactivar | Cambiar el estado | `PATCH /clientes/:id/estado` | `{activo: bool}` | `200` ficha | `404`; desactivar cierra sus sesiones | Rest. | admin |
| S15 | R4, R7 | Confirmar pedido: crear pedido | Crear el pedido desde la selección | `POST /pedidos` | `Idempotency-Key` (opcional); `{modoEntrega, nota, lineas}` solo con la selección | `201` pedido `PENDIENTE_PAGO` con el total calculado por inventario | `400 FUERA_DE_RADIO`, `400 SELECCION_INVALIDA`; `409 SIN_STOCK`; `403` si no es cliente; `502/504` si inventario o clientes no responden | Rest. y Fin. | cliente |
| S16 | R9, R10, R14 | Mis pedidos, Panel Pedidos, Cocina, Despacho, Caja: listar | Consultar pedidos según el rol | `GET /pedidos` | `estado`, `cola` (`cocina` o `despacho`), `q`, `limite` (1 a 500) | `200` lista filtrada por rol (cocina y despacho ven solo nombre y teléfono del cliente) | `400` parámetro inválido; el cliente solo ve los suyos | Rest. | Con sesión (todos los roles) |
| S17 | R14 | Panel y Cocina: abrir un pedido | Consultar un pedido | `GET /pedidos/:id` | `id` | `200` pedido según el rol | `404` si no es suyo o no existe (no confirma existencia) | Rest. | Con sesión (todos los roles) |
| S18 | R8, R14 | Boleta: ver e imprimir | Consultar la boleta | `GET /pedidos/boleta/:numero` | `numero` | `200` el pedido con su `venta` y su `boleta` (neto, IVA, total) y los datos del comprador según el rol | `404` si no es suya | Rest. y Fin. | cliente, admin, dueño |
| S19 | — | (sin pantalla) | Estados, choferes y caja | `GET /pedidos/configuracion` | — | `200 {estados, choferes, caja, cajero}` | — | Interno | Con sesión (todos los roles) |
| S20 | R9 | Cocina: aceptar | Pasar a preparación | `POST /pedidos/:id/aceptar` | `id` | `200` pedido `EN_PREPARACION` | `409 ESTADO` si no está pagado o ya lo aceptó otro puesto; `404` | Rest. | admin, cocina |
| S21 | R9 | Cocina: marcar listo | Dejar listo | `POST /pedidos/:id/terminar` | `id` | `200` pedido `LISTO_DESPACHO` o `LISTO_RETIRO` | `409 ESTADO`; `404` | Rest. | admin, cocina |
| S22 | R10 | Despacho: asignar chofer | Despachar | `POST /pedidos/:id/despachar` | `{chofer}` (de la lista) | `200` pedido `EN_DESPACHO` | `400` chofer inválido; `409 ESTADO` | Rest. | admin, despacho |
| S23 | R10 | Despacho: registrar entrega | Entregar (o entregar el retiro) | `POST /pedidos/:id/entregar` | `id` | `200` pedido `ENTREGADO` | `409 ESTADO` | Rest. | admin, despacho |
| S24 | R9, R10 | Cocina y Despacho: orden imprimible | Registrar que se imprimió | `POST /pedidos/:id/impresa` | `id` | `204` | `404` | Rest. | admin, cocina, despacho |
| S25 | R11 | Pedido y Panel Pedidos: anular | Anular con motivo | `POST /pedidos/:id/anular` | `{motivo}` (5 a 200 caracteres) | `200` pedido `ANULADO`; si estaba pagado: venta anulada, devolución y stock liberado | `400` motivo; `409 ESTADO` si cocina ya lo aceptó; `404` | Rest. y Fin. | cliente (suyo), admin |
| S26 | R13 | Caja y Reportes: consultar ventas | Reporte por período | `GET /reportes/ventas` | `desde`, `hasta` (AAAA-MM-DD) | `200` resumen (cantidad, monto, promedio, anuladas, por día, por entrega, más vendidos) y el detalle de ventas; el CSV lo arma el frontend con esta respuesta | `400` fechas inválidas o período de más de un año | Rest. y Fin. | admin, dueño |
| S27 | R8 | Pago: ir a pagar | Iniciar el pago en la pasarela | `POST /pagos` | `Idempotency-Key` (obligatoria, 8 a 100 caracteres); `{pedidoId}` | `201` pago con `urlPago` | `400 SIN_IDEMPOTENCIA`; `404` si el pedido no es suyo; `409` si no está pendiente; `502` si la pasarela no responde | Fin. | cliente |
| S28 | — | (sin pantalla) | Consultar los pagos de un pedido | `GET /pagos?pedidoId=` | `pedidoId` | `200` lista de pagos (sin el token de la pasarela) | `404` si el pedido no es visible para quien consulta | Fin. | cliente, admin, dueño |
| S29 | R8 | (la invoca la pasarela) Confirmar el resultado del pago | Notificación firmada | `POST /pagos/notificacion` | `X-Firma`; `{token, orden, monto, estado, referencia}` | `200 {ok, repetido}` | `401 FIRMA_INVALIDA`; `409 MONTO_DISTINTO`; repetida: `repetido: true` sin repetir efectos | Fin. | Sin sesión (firma HMAC) |
| S30 | R8, R14 | Pedido `#/orden/:id`: estado, productos y pagos | Agregar pedido, pagos y productos (y la ficha, solo admin) | `POST /graphql` (`resumenPedido`) | `{query, variables: {id}}` | `200 {data, errors?}`; `resumenPedido: null` si el pedido no es suyo | Error parcial: el campo queda `null` y `errors` dice cuál servicio falló; límites de profundidad, costo y paginación | Rest. y Fin. | Con sesión |
| S31 | — | (sin pantalla) | Historial del cliente paginado | `POST /graphql` (`misPedidos`) | `primeros` (hasta 50), `despuesDe` | `{nodos, siguiente}` | Solo el cliente, solo los suyos | Rest. | cliente |
| S32 | R13 | Reportes: categorías y conciliación | Reporte con productos y pagos | `POST /graphql` (`reporteVentas`) | `desde`, `hasta` | `reporteVentas` con `porCategoria` y `conciliacion` | `PROHIBIDO` si no es admin o dueño | Rest. y Fin. | admin, dueño |
| S33 | R6 | Ingresar | Iniciar sesión | `POST /auth/login` | `{email, clave}` | `200` datos de sesión y cookie `pf_sesion` (HttpOnly, Secure) | `401 CREDENCIALES` (mismo mensaje si el correo no existe); `403 SIN_VERIFICAR` o `INACTIVA`; `429 BLOQUEADO` | Cred. | Anónimo |
| S34 | R6 | Menú de usuario: cerrar sesión | Cerrar sesión | `POST /auth/logout` | Cookie | `204`; la sesión se revoca y la cookie se borra | — | Cred. | Anónimo (usa la cookie si existe) |
| S35 | R6 | Todas: ¿quién soy? | Informar la sesión | `GET /auth/sesion` | Cookie | `200 {tipo, id, perfil, nombre, email, expira}` o `null` | Sin sesión no es un error: responde `null` | Rest. | Anónimo |
| S36 | R6 | Ingresar: cuentas de demostración | Informar el modo demo | `GET /auth/config` | — | `200 {modoDemo, cuentasDemo}` (vacía si `MODO_DEMO=false`) | — | Púb. | Anónimo |
| S37 | R14 | Mis datos: cambiar clave | Cambiar la contraseña | `PUT /auth/clave` | `{actual, nueva}` | `204` | `400 CLAVE_ACTUAL`, `400 CLAVE_DEBIL`; la cuenta sale de la sesión | Cred. | Con sesión |
| S38 | R5 | Verificar: confirmar el código | Verificar el correo | `POST /auth/verificar` | `{email, codigo}` | `200 {verificado: true}` | `400 CODIGO` o `VENCIDO`; no revela si el correo existe; 20 por minuto por IP | Cred. | Anónimo |
| S39 | R5 | Verificar: reenviar el código | Pedir un código nuevo | `POST /auth/reenviar` | `{email}` | `200` (igual exista o no la cuenta) | 20 por minuto por IP | Cred. | Anónimo |
| S40 | R12 | Usuarios: listar | Consultar usuarios internos | `GET /usuarios` | — | `200` lista (sin hash) | `403` | Rest. | admin |
| S41 | R6, R12 | Usuarios: crear | Crear un usuario interno | `POST /usuarios` | `{nombre, email, rol, clave}` | `201` usuario | `400 CLAVE_DEBIL`, perfil inválido | Rest. y Cred. | admin |
| S42 | R12 | Usuarios: editar | Modificar un usuario interno | `PUT /usuarios/:id` | `{nombre, email, rol, clave?}` | `200` usuario; cambiar la clave o el perfil cierra sus sesiones | `400 ULTIMO_ADMIN`, `400 PROPIO_PERFIL`; `404` | Rest. y Cred. | admin |
| S43 | R12 | Usuarios: activar o desactivar | Cambiar el estado | `PATCH /usuarios/:id/estado` | `{activo: bool}` | `200` usuario; al desactivar se cierran sus sesiones | `400 PROPIA_CUENTA`, `400 ULTIMO_ADMIN`; `404` | Rest. | admin |
| S44 | — | (operación de TI) | Estado del sistema | `GET /api/salud` | — | `200 {gateway, vault, auth, ...}` o `503` si algo no responde | Sin datos personales | Púb. | Anónimo |

El cliente no puede fijar precios, totales ni estados: S15 recibe solo la selección y recalcula con inventario; S27 toma el monto del pedido; S29 solo cambia un estado si la firma, el token y el monto coinciden. Esto se prueba en el caso 7.6.

### Por qué estas operaciones y no otras

- **Una operación por cada acción de una pantalla, no por cada tabla.** Si dos pantallas hacen lo mismo, comparten servicio: la lista de pedidos (S16) la usan cinco pantallas, entre ellas "Mis pedidos" de Javiera y la cola de cocina. Una variación visual, como la versión móvil, no genera un servicio nuevo.
- **Casi nada se borra.** Solo S06 elimina, y es la eliminación de un producto que pide el mantenedor. Los pedidos no se borran, se anulan (S25) y conservan su historial; los clientes y los usuarios se desactivan (S14, S43) para no perder lo que hicieron.
- **El navegador manda lo mínimo.** Una selección, un motivo, un identificador. Quién eres no viaja en el cuerpo de la petición: sale de la cookie de sesión, de modo que nadie puede decir "soy otra persona". El precio, el total y el estado de un pago los calcula el servidor.
- **Los errores no dan pistas de más.** Todos tienen la misma forma. Pedir el pedido de otra persona responde "no encontrado", igual que si no existiera, y un login con un correo que no está registrado responde lo mismo que uno con la clave equivocada.

### Ejemplos de contratos

Todos los errores tienen la misma forma: `{"codigo": "NO_ENCONTRADO", "mensaje": "No encontramos ese pedido.", "idPeticion": "..."}`.

**Crear pedido.** El navegador manda solo la selección; el precio lo calcula inventario.

```http
POST /api/v1/pedidos
Cookie: pf_sesion=<token opaco, HttpOnly>
Idempotency-Key: 2f1c0b7e-...

{"modoEntrega": "DELIVERY", "nota": "Sin sésamo",
 "lineas": [{"tipo": "BOWL", "cantidad": 1,
             "entrada": {"tamanoId": "regular", "baseIds": ["base_gohan"], "proteinaIds": ["pro_salmon"],
                         "salsaIds": ["sal_ponzu"], "toppingIds": ["top_palta"]}}]}
```

```json
201 Created
{"id": "PF-00084", "clienteId": "cli_demo_1", "estado": "PENDIENTE_PAGO", "modoEntrega": "DELIVERY",
 "direccion": "Av. Providencia 2133, depto 504, Providencia",
 "lineas": [{"tipo": "BOWL", "descripcion": "Bowl Regular: Arroz gohan, Salmón fresco, Ponzu, Palta",
             "cantidad": 1, "precioUnitario": 7890, "subtotal": 7890,
             "itemIds": ["base_gohan", "pro_salmon", "sal_ponzu", "top_palta"]}],
 "total": 7890, "pago": {"medio": "SERVIPAG", "estado": "PENDIENTE"}, "venta": null, "boleta": null,
 "historial": [{"estado": "PENDIENTE_PAGO", "fecha": "2026-11-08T03:15:01.120Z"}]}
```

Errores: `400 FUERA_DE_RADIO`, `400 SELECCION_INVALIDA`, `409 SIN_STOCK`, `401 SIN_SESION`, `403 PROHIBIDO` (no es cliente), `502/504` si inventario o clientes no responden.

**Iniciar pago.**

```http
POST /api/v1/pagos
Idempotency-Key: 9d3e...            (obligatoria)
{"pedidoId": "PF-00084"}
```
```json
201 {"id": "PAG-07A5E9CF2BEF", "pedidoId": "PF-00084", "monto": 7890, "medio": "SERVIPAG",
     "estado": "PENDIENTE", "urlPago": "https://localhost:9000/pagar/<token>"}
```

**Notificación de la pasarela** (sin sesión; la autentica su firma).

```http
POST /api/v1/pagos/notificacion
X-Firma: <hex de HMAC-SHA256(cuerpo, secreto_firma)>
{"token": "...", "orden": "PAG-07A5E9CF2BEF", "monto": 7890, "estado": "APROBADO", "referencia": "SVP-99801681"}
```
`200 {"ok": true, "repetido": false}`; repetida: `{"repetido": true}`; sin firma o firma falsa: `401 FIRMA_INVALIDA`; monto distinto: `409 MONTO_DISTINTO`.

**Cambiar estado (cocina).** `POST /api/v1/pedidos/PF-00084/aceptar` → `200` con el pedido en `EN_PREPARACION`; si otro puesto ya lo aceptó: `409 ESTADO`.

**Login.**

```http
POST /api/v1/auth/login
{"email": "cliente@correo.cl", "clave": "Cliente2026"}
```
```
200  Set-Cookie: pf_sesion=<token>; Path=/api; HttpOnly; SameSite=Lax; Max-Age=28800
{"tipo": "CLIENTE", "id": "cli_demo_1", "perfil": "CLIENTE", "nombre": "Javiera Morales Díaz",
 "email": "cliente@correo.cl", "expira": "2026-11-08T03:45:01.000Z"}
```
Errores: `401 CREDENCIALES` (mismo mensaje si el correo no existe), `403 SIN_VERIFICAR`, `403 INACTIVA`, `429 BLOQUEADO`.

**Consultar catálogo (S01), anónimo.** Solo campos públicos; el stock no sale.

```http
GET /api/v1/catalogo/items?categoria=PROTEINA
```
```json
200 [{"id": "pro_salmon", "categoria": "PROTEINA", "nombre": "Salmón fresco", "descripcion": "Cortado en cubos, marinado suave", "precio": 0, "disponible": true},
     {"id": "pro_atun", "categoria": "PROTEINA", "nombre": "Atún", "descripcion": "Grado sashimi, corte del día", "precio": 1500, "disponible": true}]
```
`400` si la categoría no existe; `[]` si no hay productos. (`precio` es el precio o recargo del producto según su categoría.)

**Registrar cliente (S07).** Datos ficticios; la respuesta nunca incluye la clave.

```http
POST /api/v1/clientes/registro
{"run": "12.345.678-5", "nombre": "Ana Prueba Soto", "direccion": "Av. Italia 1500", "region": "Región Metropolitana de Santiago",
 "provincia": "Santiago", "comuna": "Ñuñoa", "fechaNacimiento": "1995-03-10", "sexo": "F",
 "email": "ana.prueba@correo.cl", "telefono": "+56 9 1111 2222", "clave": "<clave de 8 o más caracteres, con letras y números>"}
```
```json
201 {"cliente": {"id": "cli_3fa9c01b22de", "run": "12345678-5", "nombre": "Ana Prueba Soto", "comuna": "Ñuñoa", "email": "ana.prueba@correo.cl",
                 "activo": true, "origen": "WEB", "tieneDespacho": true, "emailVerificado": false},
     "codigoDemo": "482915"}
```
Errores: `400` (ficha inválida o clave débil), `409 DUPLICADO` (RUN o correo ya registrados), `429` (más de 20 intentos por minuto desde la misma IP). `codigoDemo` solo viene con `MODO_DEMO=true`; abreviamos la ficha en este ejemplo.

**Asignar chofer (S22), despacho.**

```http
POST /api/v1/pedidos/PF-00084/despachar
{"chofer": "Andrea Muñoz"}
```
`200` con el pedido en `EN_DESPACHO`; `400` si el chofer no está en la lista; `409 ESTADO` si el pedido no estaba listo para despacho; `403` para cualquier rol distinto de despacho y admin.

**Anular pedido (S25), cliente.**

```http
POST /api/v1/pedidos/PF-00084/anular
{"motivo": "Me equivoqué de dirección"}
```
```json
200 {"id": "PF-00084", "estado": "ANULADO",
     "anulacion": {"motivo": "Me equivoqué de dirección", "fecha": "2026-11-08T03:20:14.002Z", "por": "Javiera Morales Díaz", "devolucion": true}}
```
El pedido y su historial se conservan; abreviamos el resto del pedido. `409 ESTADO` si cocina ya lo aceptó; `404` si el pedido no es suyo.

El contrato completo de cada servicio Python se puede ver en su OpenAPI (`/docs` dentro de la red privada) y el del GraphQL Gateway en la sección 8.

---

## 2. Dominio y límites de los microservicios

Antes de repartir el trabajo entre servicios hay que saber qué cosas existen en la tienda: clientes, pedidos, productos, pagos, boletas. Esta sección las dibuja como clases UML y explica cómo se relacionan (por ejemplo, un cliente tiene cero o más pedidos y un pedido tiene entre una y treinta líneas). Después muestra qué servicio expone cada operación y por qué los límites entre servicios están donde están. Las multiplicidades se leen así: "1 a 0..*" significa que un elemento se relaciona con ninguno o con muchos del otro lado.

![UML del dominio: clases, atributos y multiplicidades](diagramas/dominio.png)

![UML de los servicios públicos: operaciones con su ID y dependencias de las clases del dominio](diagramas/servicios.png)

Editables (Mermaid): [`diagramas/dominio.mmd`](diagramas/dominio.mmd) y [`diagramas/servicios.mmd`](diagramas/servicios.mmd). Las dos figuras forman un solo UML: la segunda muestra los servicios y qué clases de la primera usa cada uno.

### Leyenda de notación y correspondencia con los servicios

- Una caja con `<<service ...>>` es un servicio público: lista sus operaciones, cada una con el ID del módulo 1. El resto de las cajas son clases del dominio.
- Una línea con rombo relleno es composición (la línea no existe sin el pedido: `Pedido` contiene sus líneas y sus pasos). Una línea simple es una asociación, con la multiplicidad en ambos extremos (`1`, `0..1`, `0..*`, `1..*`).
- Una flecha punteada (`..>`) es una dependencia de uso: el servicio usa o lee esa clase. No significa que exista una instancia del servicio por cada registro.

| Clase `<<service>>` | Sistema | Operaciones (ID) | Clases del dominio que usa |
|---|---|---|---|
| CatalogoService | inventario | S01 a S06 | Producto, Reserva |
| ClientesService | clientes | S07 a S14 | Cliente |
| PedidosService | pedidos | S15 a S26 | Pedido, LineaPedido, Paso, Venta, Boleta |
| PagosService | pagos | S27 a S29 | Pago |
| AuthService | Auth Service | S33, S34, S37 a S43 | Cuenta |
| GraphQLGateway | GraphQL Gateway | S30 a S32 | Pedido, Pago, Producto (solo lectura) |
| (API Gateway, sección 5) | gateway | S35, S36, S44 | — |

### Cardinalidades y su regla de negocio

| Relación | Cardinalidad | Regla |
|---|---|---|
| Cuenta – Cliente | 1 a 0..1 | Toda ficha de cliente tiene exactamente una cuenta de rol cliente; las cuentas del personal no tienen ficha |
| Cliente – Pedido | 1 a 0..* | Solo clientes registrados compran (R7); un cliente puede no tener pedidos |
| Pedido – LineaPedido | 1 a 1..30 | Un pedido sin líneas no se crea; máximo 30 líneas y 20 unidades por línea (límite de abuso) |
| LineaPedido – Producto | 0..* a 1..* | Un bowl se compone de 2 o más productos (1 a 3 bases, 1 a 3 proteínas, hasta 4 salsas y 6 toppings); una bebida es 1 producto |
| Pedido – Paso (historial) | 1 a 1..* | Todo pedido nace con el paso PENDIENTE_PAGO; cada cambio de estado agrega un paso |
| Pedido – Venta | 1 a 0..1 | La venta se registra solo cuando el pago se confirma, una sola vez |
| Venta – Boleta | 1 a 1 | El cajero virtual emite una boleta por venta (R8) |
| Pedido – Pago | 1 a 0..* | Puede haber intentos rechazados; a lo sumo uno aprobado |
| Pedido – Reserva | 1 a 0..1 | La reserva de stock se crea al confirmar el pedido y se libera al anular |

### Decisiones de modelado

- **Carrito y pedido son cosas distintas.** El carrito existe solo en el navegador (`localStorage`) y es una selección sin precios confiables; el servidor no lo conoce. El pedido nace en S15, cuando el servidor cotiza y reserva. Por eso no hay una clase Carrito en el backend. No se modela un borrador de pedido: un pedido sin líneas no se crea (multiplicidad `1..30`).
- **Qué pasa con el historial si un producto deja de estar disponible.** Cada línea copia la descripción, el precio unitario y los `itemIds` al crear el pedido, y se relaciona con `Producto` solo por id. Desactivar o eliminar un producto (S05, S06) no cambia pedidos ni boletas ya emitidos. En el GraphQL, `Linea.productos` entrega solo los productos que aún existen (los demás se omiten) y el reporte por categoría los cuenta como `SIN_CATEGORIA`.
- **Qué se conserva y qué sale.** Internamente se guardan, por ejemplo, la clave de idempotencia y el consumo de stock del pedido, el `actor` de cada paso, el hash de la contraseña y el token de la pasarela; ninguno sale en una respuesta (sección de DTO, a continuación). El diagrama no muestra un campo solo porque exista en la base.

### Separación de DTO

Cada servicio decide qué campos devuelve según quién pregunta, separando el documento guardado del objeto que viaja:

- **inventario:** el público recibe `id, categoria, nombre, descripcion, precio, disponible` (disponible = activo y con stock). `stock` y `activo` solo para admin y dueño.
- **pedidos:** cocina y despacho reciben del cliente solo `nombre` y `telefono`; el cliente recibe el historial sin el `actor` (quién del personal hizo cada paso); nunca salen `idempotencia` ni `consumo`.
- **pagos:** nunca salen el `token` de la pasarela ni la clave de idempotencia; `urlPago` solo mientras el pago está pendiente.
- **Auth Service:** nunca devuelve `hash` ni el código de verificación (se guarda solo su hash).
- **clientes:** la ficha no guarda contraseña; la cuenta (en Auth) no guarda RUN ni dirección.

### Por qué estos límites

| Servicio | Cohesión | Acoplamiento | Propiedad de datos | Evolución |
|---|---|---|---|---|
| inventario | Todo lo que define qué se vende y a qué precio | Lo consultan pedidos y GraphQL; no llama a nadie | Productos, stock, reservas | Cambiar recargos o agregar tamaños no toca pedidos |
| clientes | Datos personales del comprador | Llama a Auth para crear la cuenta | Fichas | Puede crecer (direcciones múltiples) sin tocar pedidos |
| pedidos | Ciclo de vida de la compra y documentos de venta | Llama a clientes, inventario y pagos | Pedidos, ventas, boletas | Nuevos estados o canales sin tocar pagos |
| pagos | Integración con el proveedor externo y dinero | Llama a pedidos y a la pasarela | Pagos | Cambiar de pasarela sin tocar pedidos |
| Auth Service | Credenciales y sesiones | Lo llaman gateway y clientes | Cuentas | Cambiar a OAuth/OIDC sin tocar los servicios |

Cada servicio modifica solo su base. Las colaboraciones usan contratos explícitos (sección 6).

---

## 3. Sistemas, componentes e integración

Cuatro sistemas se reparten el negocio: inventario (qué se vende y cuánto queda), pedidos (qué pasó con cada compra), clientes (quién compra) y pagos (el dinero). La regla de esta sección es que cada dato tenga un solo dueño, que es quien decide su estado oficial. La matriz dice qué hace cada sistema, de quién depende, con qué llave se lo llama y qué ocurre si falla; la secuencia de más abajo cuenta la compra de Javiera paso a paso.

### Matriz de sistemas

Los cuatro sistemas mínimos del caso son microservicios privados, cada uno con su base y su usuario de Mongo. Cada uno decide el estado oficial de sus datos; los demás lo consultan por contrato.

| Sistema | Responsabilidad | Datos bajo su autoridad (estado oficial) | Servicios asociados | Dependencias | Contrato de integración | Credencial o identidad | Respuesta ante fallos |
|---|---|---|---|---|---|---|---|
| inventory (`inventario`) | Catálogo, precios, reglas de armado, cotización, stock y reservas | Producto, su precio y su disponibilidad; reservas (decide si hay unidades) | S01 a S06 | Ninguna: no llama a nadie | REST público (S01 a S06) y de integración: `POST /internos/cotizar`, `POST /internos/reservas`, `POST /internos/reservas/:pedido/liberar` | Recibe `X-Credencial-Interna` (`internos/inventario`); usuario de Mongo propio | Si no responde, pedidos no crea el pedido (`502/504`): nunca confirma sin cotizar. La reserva descuenta el stock ítem por ítem con la condición `stock >= cantidad` y, si uno no alcanza, devuelve lo ya descontado (`409 SIN_STOCK`); es idempotente por pedido, se libera al anular y liberar dos veces devuelve el stock una sola vez |
| orders (`pedidos`) | Creación y ciclo de vida del pedido, venta, boleta, colas de cocina y despacho, reporte | Estado del pedido, venta y boleta (decide si un pedido está pagado, en preparación o entregado) | S15 a S26 | inventario (cotizar, reservar, liberar), clientes (ficha), pagos (devolución), ActiveMQ (publica) | REST público; interno `POST /internos/pedidos/:id/pago-confirmado`; eventos STOMP `/queue/correos` y `/queue/cocina` | Recibe `internos/pedidos`; usa las credenciales de inventario, clientes y pagos para llamarlos | Inventario o clientes caídos: `502/504`, no se crea nada. Falla de ActiveMQ: el pago se registra igual y el aviso queda en el log. Confirmar dos veces el mismo pago no hace nada la segunda vez |
| clients (`clientes`) | Registro, perfil y acceso autorizado a los datos del cliente | Ficha personal y si está activa (la cuenta y su verificación las decide Auth) | S07 a S14 | Auth Service (crear cuenta, cambiar estado, ver verificación) | REST público; interno `GET /internos/clientes/:id` (lo usa pedidos) | Recibe `internos/clientes`; ante Auth usa `internos/auth-clientes` (Basic, solo `/cuentas`) | Si Auth falla al registrar, se borra la ficha recién creada (compensación) y se responde el error. Si clientes no responde, pedidos responde `502/504` |
| payments (`pagos`) | Iniciar pagos, comprobar el resultado y relacionarse con el proveedor | Estado y monto del pago (el estado del *pedido* lo decide pedidos) | S27 a S29 | pedidos (propiedad, monto y confirmación), pasarela (crear la transacción y devolver) | REST público; webhook firmado; interno `POST /internos/devoluciones` y `GET /internos/pagos` | Recibe `internos/pagos`; ante la pasarela usa `pasarela/comercio` (`api_key`) y verifica `secreto_firma` | Pasarela caída al iniciar: `502`. Si pedidos no responde al confirmar, se responde `502` y la pasarela reintenta (3 veces); la repetida reintenta solo el aviso a pedidos |

**Quién autoriza el cambio de estado de un pago.** El aviso del proveedor se verifica en cuatro pasos: (1) firma HMAC-SHA256 del cuerpo exacto con el `secreto_firma` que está en Vault; (2) el `token` y la orden corresponden a un pago registrado; (3) el monto coincide con el del pago (y pedidos vuelve a exigir que sea el total del pedido); (4) el cambio se aplica con una condición atómica (`estado: PENDIENTE` en el mismo `update`), de modo que una notificación repetida responde `repetido: true` sin registrar otra venta. Solo entonces pagos avisa a pedidos, y **pedidos es el único que cambia el estado del pedido a `PAGADO`**, emite la boleta y registra la venta. El frontend no decide nunca que un pedido está pagado: solo muestra lo que devuelve el servidor.

**orders e inventory.** Pedidos consulta a inventario, antes de aceptar el pedido, el precio y la disponibilidad de cada ítem (`cotizar`) y reserva las unidades (`reservas`). Si inventario no responde en 4 s, el pedido no se crea. Para no confirmar unidades que ya no existen, cada ítem se descuenta con una condición sobre el stock en la misma operación de actualización (`stock >= cantidad`), de modo que dos compras simultáneas no se llevan la misma unidad; si un ítem no alcanza, se devuelve lo ya descontado y el cliente recibe `SIN_STOCK`.

### Estados del pedido y quién los cambia

| Desde | Hacia | Operación (ID) | Quién |
|---|---|---|---|
| (nuevo) | PENDIENTE_PAGO | S15 | cliente |
| PENDIENTE_PAGO | PAGADO | confirmación de pago (interna, desde S29) | pagos, con la credencial de pagos; el monto debe coincidir |
| PAGADO | EN_PREPARACION | S20 | cocina, admin |
| EN_PREPARACION | LISTO_DESPACHO o LISTO_RETIRO | S21 | cocina, admin |
| LISTO_DESPACHO | EN_DESPACHO | S22 | despacho, admin |
| EN_DESPACHO o LISTO_RETIRO | ENTREGADO | S23 | despacho, admin |
| PENDIENTE_PAGO o PAGADO | ANULADO | S25 | cliente (suyo), admin |

### Servicios propios y proveedores externos

| Pieza | Propia o externa | Qué hace | Cómo se prueba |
|---|---|---|---|
| Despacho | Propia (dentro de pedidos) | Cola, chofer y entrega; comparte el estado del pedido, por eso no se separa en otro servicio | Caso 10.4 |
| Boleta y cajero virtual | Propia (dentro de pedidos) | La venta y la boleta se emiten en la misma operación atómica que confirma el pago | Casos 10.2 y 10.3 |
| Mensajería | Propia (ActiveMQ + notificador) | Boleta al correo y aviso a cocina, sin bloquear el pago | Log del notificador |
| Pasarela de pagos (Servipag) | **Externa, simulada** | Cobrar, notificar y devolver | Casos 7.6, 10.2 y 10.3 |
| Correo | **Externo, simulado** | Entregar el correo; en modo demo se muestra en pantalla | Brecha declarada |

### Sistemas de soporte

| Sistema | Tipo | Protocolo | Lo usa | Datos que intercambia | Si falla |
|---|---|---|---|---|---|
| MongoDB 7 | Persistencia | Mongo wire sobre TLS, usuario por servicio | Auth, inventario, clientes, pedidos, pagos | Documentos de cada servicio | El servicio responde 500; `/salud` lo informa |
| HashiCorp Vault 1.18 | Secretos | HTTPS (KV v2) con token por servicio | Todos los servicios | Credenciales, pepper, claves | Se usa lo leído hasta 5 min; después 503 (no se deja pasar a nadie) |
| ActiveMQ Classic 6 | Mensajería | STOMP 1.2 sobre TLS | pedidos (publica), notificador (consume) | Boleta para correo, aviso a cocina | El pago se registra igual; queda en el log |
| Pasarela (Servipag) | Externo | HTTPS + API key; notificación con HMAC | pagos | Transacción, resultado, devolución | Pagar responde 502; la pasarela reintenta la notificación 3 veces |

### Mapa de componentes y despliegue

![Mapa de componentes](diagramas/componentes.png)

Leyenda: las flechas continuas son llamadas entre componentes (todas por TLS 1.2 o superior); `Basic` es HTTP Basic con un secreto de Vault, `API key` es la clave del comercio ante la pasarela y `webhook HMAC` es la notificación firmada; las líneas punteadas son la lectura de secretos en Vault, cada componente con su propio token; `STOMP` es la mensajería hacia ActiveMQ. El detalle de qué se verifica en cada salto está en la tabla de fronteras de confianza (sección 5).

Modelo C4 (`docs/diagramas/poke-fresh.dsl`): 25 vistas, validadas con el comando `validate` de Structurizr (imagen `structurizr/structurizr`) y exportables a Mermaid. Incluye C1 (contexto con la pasarela externa), C2 (contenedores, con recortes de catálogo, pedidos y pagos, y secretos), C3 de API Gateway, GraphQL Gateway, Auth Service y pedidos, vistas dinámicas de los flujos de los casos de validación (catálogo y su recuperación, pedido y su reintento, pedido propio y ajeno, sesión expirada, GraphQL con éxito, con error parcial y sobre el límite, pago, confirmación firmada y notificación falsa) y dos despliegues: `Docker_Compose` (el entregado) y `Local_Sin_Docker` (pruebas, con Mongo, Vault y ActiveMQ en memoria). Para verlo: pegar el archivo en https://structurizr.com/dsl o usar el CLI. No hay imágenes renderizadas de estas vistas en el repositorio; los `.png` de arriba siguen siendo los diagramas de referencia del informe.

Despliegue (`docker-compose.yml`): 15 contenedores en dos redes (`tls-init`, `vault-init` y `semilla` son de un solo uso: crean los certificados, los secretos y los datos de ejemplo, respectivamente). `privada` es `internal: true` (sin puertos al equipo ni salida a Internet). Solo el gateway (8080) y la pasarela simulada (9000) publican puertos.

### Secuencia de integración: compra completa

![Secuencia de compra](diagramas/secuencia-compra.png)

### Idempotencia del pago

- **Crear pedido:** `Idempotency-Key` opcional; el frontend genera una por visita a la pantalla de confirmación. Un doble clic devuelve el mismo pedido (índice único `idempotencia`).
- **Iniciar pago:** `Idempotency-Key` obligatoria; misma clave → mismo pago. Si ya hay un pago pendiente para el pedido, se reutiliza.
- **Notificación:** se aplica con una condición atómica (`estado: PENDIENTE` en el mismo `update`). Una repetida responde `repetido: true` sin volver a registrar la venta. Si pedidos no respondió la primera vez, la repetida reintenta solo ese aviso.
- **Confirmación en pedidos:** si llega dos veces el mismo `pagoId`, la segunda no hace nada; el monto debe ser exactamente el total.
- **Reservas de stock:** una por pedido; liberar dos veces devuelve el stock una sola vez.

Probado en `servicios/tests/test_pedidos_y_pagos.py` y en los casos 10.2 y 10.3 de punta a punta.

---

## 4. Stakeholders y matriz de permisos

Un sistema seguro no solo pregunta quién eres, también qué puedes hacer. Aquí se describe quiénes usan Poke Fresh (clientes, personal del local, la pasarela de pago, el equipo de TI) y qué puede hacer cada uno con cada servicio. Para cada operación hay una decisión por rol y, cuando corresponde, una condición: por ejemplo, un cliente puede ver pedidos, pero solo los suyos.

### Stakeholders

| Stakeholder | Interés | Qué puede hacer | Qué protege el sistema de él |
|---|---|---|---|
| Visitante | Ver el menú y precios | Catálogo, registrarse | Datos de clientes y pedidos |
| Cliente | Comprar, seguir su pedido | Sus pedidos, su ficha, pagar, anular antes de cocina | Pedidos y datos de otros clientes; fijar precios o confirmar pagos |
| Administrador | Operar todo el local | Todo el panel | Desactivarse a sí mismo o dejar el local sin administrador |
| Dueño | Ventas y productos | Reportes, caja, productos (sin eliminar) | Datos de clientes y gestión de usuarios |
| Cocina | Preparar en orden | Cola de cocina, aceptar, terminar | Reportes, RUN y correo de los clientes |
| Encargado de despacho | Entregar | Cola de despacho, chofer, entrega | Reportes, RUN y correo |
| Servipag | Cobrar | Notificar resultados firmados | Notificar sin la firma, o con otro monto |
| Equipo de TI | Operar y auditar | **Sin permisos operativos** en la aplicación: no tiene rol ni cuenta; recibe información por los logs con `X-Request-Id` y `/api/salud` (S44) | Ver contraseñas, tokens o cuerpos en los logs |



### Partes interesadas, roles e identidades técnicas

| Categoría | Quiénes | Cómo se representan |
|---|---|---|
| Roles de usuario (con permisos operativos) | Cliente, administrador, dueño, cocina, encargado de despacho | Cuentas en el Auth Service con un perfil; el gateway aplica el rol y el servicio dueño aplica la propiedad |
| Parte interesada sin permisos operativos | Equipo de TI | Sin cuenta ni rol. Recibe información por logs y `/api/salud`; nunca por la API de negocio. Ver contraseñas o tokens en los logs está excluido |
| Identidades técnicas | Servipag (webhook), gateway, cada servicio, notificador | Servipag se autentica con la firma del cuerpo; los componentes internos, con su credencial de servicio y su token de Vault (sección 6) |
| Visitante | Quien aún no ingresa | Sin identidad: solo operaciones públicas (S01 a S03, S07, S33, S35, S36, S38, S39) |

La autenticación (quién eres) la hace el Auth Service por introspección del token; la autorización (qué puedes hacer) la decide el gateway por rol y el servicio dueño por propiedad y estado.

### Por qué los permisos son así

- **Cada rol recibe lo mínimo que necesita para hacer su trabajo.** Cocina necesita saber qué preparar y a quién avisar: ve el nombre y el teléfono del cliente, pero no su RUN ni su correo. Despacho ve su cola y la dirección de entrega. El dueño mira ventas y productos, pero no administra usuarios.
- **Hay dos candados, no uno.** El gateway comprueba el rol (un cliente no puede entrar al panel de cocina) y el servicio dueño del dato vuelve a comprobar la regla fina, como que un pedido sea de quien lo pide. Si alguien llegara a un servicio por otro camino, el segundo candado igual diría que no.
- **Un pedido ajeno se responde como inexistente.** Cuando un cliente pide el pedido de otra persona, el servicio contesta 404 y no 403: un "prohibido" confirmaría que ese pedido existe.
- **Siempre queda alguien a cargo.** El sistema no deja desactivar al último administrador ni que alguien cambie su propio perfil, para que nadie se quede sin acceso por un error.
- **Ocultar un botón no es un permiso.** Lo que importa es lo que el backend responde, y por eso las pruebas de la sección 7 se hacen contra el backend, no contra la pantalla.

### Permisos por rol y servicio

Decisión por rol y por ID de servicio (la ruta y el verbo son los del módulo 1). **Sí**: permitido. **Sí\***: permitido solo si se cumple la condición de la última columna. **No**: denegado (el gateway responde 403, o 401 si no hay sesión). El control grueso (rol) lo aplica el gateway con la matriz de rutas; la condición la aplica el servicio dueño del dato y se vuelve a comprobar ahí. Esta tabla se generó leyendo `gateway/src/rutas.js`, así que no puede contradecir al código.

| ID | Verbo y ruta (`/api/v1`) | Visitante | Cliente | Cocina | Despacho | Dueño | Admin | Servipag | Alcance y condición |
|---|---|---|---|---|---|---|---|---|---|
| S01 | `GET /catalogo/items` | Sí | Sí | Sí | Sí | Sí | Sí | No | Stock y `activo` solo se ven como admin o dueño |
| S02 | `GET /catalogo/items/:id` | Sí | Sí | Sí | Sí | Sí | Sí | No | Igual que S01 |
| S03 | `GET /catalogo/configuracion` | Sí | Sí | Sí | Sí | Sí | Sí | No | — |
| S04 | `POST /catalogo/items` | No | No | No | No | Sí | Sí | No | Nombre único; precio y stock válidos |
| S05 | `PUT /catalogo/items/:id` | No | No | No | No | Sí | Sí | No | Nombre único; precio y stock válidos |
| S06 | `DELETE /catalogo/items/:id` | No | No | No | No | No | Sí | No | Solo admin (inventario lo vuelve a comprobar) |
| S07 | `POST /clientes/registro` | Sí | Sí | Sí | Sí | Sí | Sí | No | RUN con dígito verificador y único; correo único; clave fuerte |
| S08 | `GET /clientes/yo` | No | Sí* | No | No | No | No | No | Solo su ficha (`X-Usuario-Sujeto`) |
| S09 | `PUT /clientes/yo` | No | Sí* | No | No | No | No | No | Solo su ficha; no cambia RUN ni estado |
| S10 | `GET /clientes` | No | No | No | No | No | Sí | No | — |
| S11 | `POST /clientes` | No | No | No | No | No | Sí | No | RUN y correo únicos; clave temporal generada por el servidor |
| S12 | `GET /clientes/:id` | No | No | No | No | No | Sí | No | — |
| S13 | `PUT /clientes/:id` | No | No | No | No | No | Sí | No | — |
| S14 | `PATCH /clientes/:id/estado` | No | No | No | No | No | Sí | No | Desactivar cierra sus sesiones |
| S15 | `POST /pedidos` | No | Sí* | No | No | No | No | No | Cuenta activa; despacho solo en las comunas de reparto; precio de inventario; stock |
| S16 | `GET /pedidos` | No | Sí* | Sí* | Sí* | Sí | Sí | No | Cliente: solo los suyos. Cocina y despacho: solo su cola |
| S17 | `GET /pedidos/:id` | No | Sí* | Sí* | Sí* | Sí | Sí | No | Cliente: solo si es suyo (si no, 404). Cocina: solo pagados. Despacho: solo listos, en camino o entregados |
| S18 | `GET /pedidos/boleta/:numero` | No | Sí* | No | No | Sí | Sí | No | Cliente: solo la suya |
| S19 | `GET /pedidos/configuracion` | No | Sí | Sí | Sí | Sí | Sí | No | — |
| S20 | `POST /pedidos/:id/aceptar` | No | No | Sí* | No | No | Sí* | No | Solo desde PAGADO; condición atómica |
| S21 | `POST /pedidos/:id/terminar` | No | No | Sí* | No | No | Sí* | No | Solo desde EN_PREPARACION; condición atómica |
| S22 | `POST /pedidos/:id/despachar` | No | No | No | Sí* | No | Sí* | No | Solo desde LISTO_DESPACHO; chofer de la lista |
| S23 | `POST /pedidos/:id/entregar` | No | No | No | Sí* | No | Sí* | No | Solo desde EN_DESPACHO o LISTO_RETIRO |
| S24 | `POST /pedidos/:id/impresa` | No | No | Sí | Sí | No | Sí | No | — |
| S25 | `POST /pedidos/:id/anular` | No | Sí* | No | No | No | Sí* | No | Cliente: solo el suyo. Solo en PENDIENTE_PAGO o PAGADO; motivo de 5 a 200 caracteres |
| S26 | `GET /reportes/ventas` | No | No | No | No | Sí | Sí | No | Período máximo de un año |
| S27 | `POST /pagos` | No | Sí* | No | No | No | No | No | Pedido suyo y pendiente (lo decide pedidos); monto del pedido; `Idempotency-Key` |
| S28 | `GET /pagos` | No | Sí* | No | No | Sí | Sí | No | Pedidos decide si puede ver ese pedido |
| S29 | `POST /pagos/notificacion` | No | No | No | No | No | No | Sí (firma) | Firma HMAC válida; token y monto coinciden |
| S30 | `POST /graphql` `resumenPedido` | No | Sí* | Sí* | Sí* | Sí | Sí | No | Cliente: solo si el pedido es suyo. Cocina y despacho: según su cola. Campo `cliente`: solo admin |
| S31 | `POST /graphql` `misPedidos` | No | Sí* | No | No | No | No | No | Solo los pedidos del propio cliente |
| S32 | `POST /graphql` `reporteVentas` | No | No | No | No | Sí | Sí | No | Solo admin y dueño |
| S33 | `POST /auth/login` | Sí | Sí | Sí | Sí | Sí | Sí | No | 20 por minuto por IP; bloqueo por correo tras 5 intentos fallidos |
| S34 | `POST /auth/logout` | Sí | Sí | Sí | Sí | Sí | Sí | No | — |
| S35 | `GET /auth/sesion` | Sí | Sí | Sí | Sí | Sí | Sí | No | Sin sesión responde `null` |
| S36 | `GET /auth/config` | Sí | Sí | Sí | Sí | Sí | Sí | No | Sin cuentas de demostración si `MODO_DEMO=false` |
| S37 | `PUT /auth/clave` | No | Sí | Sí | Sí | Sí | Sí | No | La cuenta sale de la sesión, no del cuerpo |
| S38 | `POST /auth/verificar` | Sí | Sí | Sí | Sí | Sí | Sí | No | 20 por minuto por IP; no revela si el correo existe |
| S39 | `POST /auth/reenviar` | Sí | Sí | Sí | Sí | Sí | Sí | No | 20 por minuto por IP; respuesta igual exista o no el correo |
| S40 | `GET /usuarios` | No | No | No | No | No | Sí | No | — |
| S41 | `POST /usuarios` | No | No | No | No | No | Sí | No | Clave fuerte; perfil válido |
| S42 | `PUT /usuarios/:id` | No | No | No | No | No | Sí* | No | Siempre queda un admin activo; nadie cambia su propio perfil |
| S43 | `PATCH /usuarios/:id/estado` | No | No | No | No | No | Sí* | No | Siempre queda un admin activo; nadie desactiva su propia cuenta |
| S44 | `GET /api/salud` | Sí | Sí | Sí | Sí | Sí | Sí | No | Sin datos personales |

La columna Servipag es la identidad técnica de la pasarela: no tiene sesión ni rol; su único permiso es S29, autenticado con la firma del cuerpo. Las identidades técnicas internas (gateway, servicios, notificador) no figuran aquí porque no usan estas rutas públicas: se autentican entre sí con las credenciales de la sección 6.

**Verbos por recurso.** "No aplicable" significa que la operación no existe (404 o 405), no que se deniegue:

| Recurso | GET | POST | PUT | DELETE | PATCH |
|---|---|---|---|---|---|
| Producto | Permitido (campos públicos) | admin, dueño | admin, dueño | Solo admin | No aplicable |
| Cliente (ficha) | Cliente (la suya), admin | Público (registro); admin (en el local) | Cliente (la suya), admin | No aplicable: se desactiva, no se borra | admin (activar o desactivar) |
| Pedido | Con condición por rol | Cliente (crear); roles operativos (cambios de estado) | No aplicable: un pedido no se reemplaza | No aplicable: se anula con S25 y el registro se conserva | No aplicable |
| Pago | Cliente, admin, dueño | Cliente (iniciar); Servipag (notificar) | No aplicable | No aplicable | No aplicable |
| Usuario interno | admin | admin | admin | No aplicable: se desactiva | admin |
| Sesión | Cualquiera (informa quién es) | Público (ingresar y salir) | Con sesión (cambiar clave) | No aplicable | No aplicable |

**Anulación e historial.** Anular un pedido no borra nada: el pedido pasa a `ANULADO` con un nuevo paso en su historial (quién, cuándo y el motivo), la venta se marca anulada, se registra la devolución del pago y la reserva de stock se libera. Las ventas anuladas siguen apareciendo en el reporte como anuladas.

**Ocultar un botón no es un permiso.** Cocina no ve el botón de anular, y aunque llamara a S25 con su cookie la matriz de rutas lo rechaza con 403 (probado por rol en `gateway/test`; en Docker, casos 7.3 y 7.4). Lo comprobado contra el backend está en la sección 7.

### Condiciones por ruta (control grueso del gateway y regla fina del servicio)

La columna "Gateway" es el control grueso (rol); "Condición en el servicio" es la regla fina que aplica el dueño del dato.

| ID | Verbo | Ruta (`/api/v1`) | Gateway | Condición en el servicio |
|---|---|---|---|---|
| S01 a S03 | GET | `/catalogo/items[/:id]`, `/catalogo/configuracion` | Público | Stock solo si admin o dueño |
| S04, S05 | POST, PUT | `/catalogo/items[/:id]` | admin, dueño | Validación de nombre, precio, stock; nombre único |
| S06 | DELETE | `/catalogo/items/:id` | admin | Solo admin (también en inventario) |
| S07 | POST | `/clientes/registro` | Público (20/min por IP) | RUN válido y único, correo único, clave fuerte |
| S08, S09 | GET, PUT | `/clientes/yo` | cliente | Solo su ficha (`X-Usuario-Sujeto`); no cambia RUN ni estado |
| S10, S11 | GET, POST | `/clientes` | admin | Alta en el local con clave temporal |
| S12 a S14 | GET, PUT, PATCH | `/clientes/:id[/estado]` | admin | Desactivar cierra sus sesiones |
| S15 | POST | `/pedidos` | cliente | Cuenta activa; despacho solo en radio; precio de inventario; stock |
| S16 | GET | `/pedidos` | todos los roles | Cliente: solo los suyos. Cocina: solo su cola. Despacho: solo la suya |
| S17 | GET | `/pedidos/:id` | todos los roles | Cliente: solo si es suyo (si no, 404). Cocina: solo pagados. Despacho: solo listos/en camino/entregados |
| S18 | GET | `/pedidos/boleta/:n` | cliente, admin, dueño | Cliente: solo la suya |
| S20, S21 | POST | `/pedidos/:id/aceptar`, `/terminar` | admin, cocina | Desde PAGADO / EN_PREPARACION, condición atómica |
| S22, S23 | POST | `/pedidos/:id/despachar`, `/entregar` | admin, despacho | Chofer válido; estado correcto |
| S25 | POST | `/pedidos/:id/anular` | cliente, admin | Cliente: solo el suyo. Solo en PENDIENTE_PAGO o PAGADO; motivo obligatorio |
| S26 | GET | `/reportes/ventas` | admin, dueño | Período máximo de un año |
| S27 | POST | `/pagos` | cliente | Idempotency-Key; pedido suyo y pendiente (lo decide pedidos); monto del pedido |
| S28 | GET | `/pagos?pedidoId` | cliente, admin, dueño | Pedidos decide si puede ver ese pedido |
| S29 | POST | `/pagos/notificacion` | Sin sesión | Firma HMAC válida, token y monto coinciden |
| S30 a S32 | POST | `/graphql` | Con sesión | Autorización por campo y por recurso (sección 8) |
| S38, S39 | POST | `/auth/verificar`, `/auth/reenviar` | Público (20/min por IP) | No revela si el correo existe |
| S37 | PUT | `/auth/clave` | Con sesión | La cuenta sale de la sesión, no del cuerpo |
| S40 a S43 | GET, POST, PUT, PATCH | `/usuarios[...]` | admin | Siempre queda un admin activo; nadie cambia su propio perfil |

La tabla de arriba ("Permisos por rol y servicio") es la decisión por rol; esta resume, por ruta, qué decide el gateway y qué decide el servicio.

---

## 5. API Gateway, políticas y fronteras de confianza

Esta sección responde cómo se impide que alguien llegue a los servicios sin pasar por los controles. El API Gateway es la única puerta; el UML muestra sus piezas, las fronteras de confianza explican qué se revisa cada vez que una petición cruza de una zona a otra (del navegador al gateway, del gateway a un servicio, de un servicio a Vault) y al final se siguen dos solicitudes concretas, una autorizada y una denegada.

### UML del gateway y sus políticas

![UML del gateway](diagramas/gateway.png)

- **RouteDefinition** (`gateway/src/rutas.js`): 36 filas; lo que no está, responde 404. Las rutas `/internos/*` de los servicios nunca se publican.
- **AuthenticationPolicy** (`sesion.js`): cookie `pf_sesion` HttpOnly; introspección en el Auth Service en cada petición.
- **AuthorizationPolicy** (`rutas.js: permitido`): público, sesión, webhook o lista de roles.
- **ServiceTarget** (`reenvio.js`): arma cabeceras nuevas, agrega la credencial del destino y la identidad, reenvía el cuerpo exacto; 502 si no responde, 504 si tarda más de 8 s.
- **SecretProvider** (`vault.js`): lee de Vault con el token del gateway, guarda 30 s.
- **GraphQLGateway, Schema, Resolver, DataLoader, LimitesConsulta**: en `graphql-gateway/` (sección 8).
- No hay clientes gRPC (ADR 0001).

### Cuántos gateways y por qué

Hay **un API Gateway externo** (puerto 8080) y, detrás de él, el **GraphQL Gateway privado**. No hay un segundo gateway público. Las políticas distintas (anónimo, cliente, personal, webhook) se separan con la columna de acceso de la matriz de rutas, que es lo que pide un solo gateway para separar rutas mediante políticas. Un segundo gateway, por ejemplo solo para el panel administrativo, duplicaría el contenedor, la superficie de ataque y las copias de CSRF, límites y sesión, sin una necesidad concreta: con 44 operaciones y un solo equipo, la ganancia sería nula. El GraphQL Gateway no es un segundo gateway público: es un servicio de agregación sin puerto publicado que hereda la sesión del primero (sección 8).

### Clasificación de rutas

| Clase | Operaciones | Observación |
|---|---|---|
| Externas anónimas | 12: S01, S02, S03, S07, S29, S33, S34, S35, S36, S38, S39, S44 | Una ruta pública de red no implica datos públicos: S35 devuelve la sesión si existe y S29 solo acepta una firma válida |
| Externas autenticadas | 18: S08, S09, S15, S16, S17, S18, S19, S20, S21, S22, S23, S24, S25, S27, S28, S30, S31, S37 | Pueden transportar datos restringidos para un usuario autorizado (sus pedidos, su ficha) |
| Administrativas (admin o dueño) | 14: S04, S05, S06, S10, S11, S12, S13, S14, S26, S32, S40, S41, S42, S43 | Mantenedores y reportes |
| Internas (nunca publicadas) | 11 | Inventario: cotizar, reservar y liberar. Clientes: ficha por id. Pedidos: confirmar pago. Pagos: devoluciones y pagos por pedido. Auth: introspección, crear cuenta, cambiar cuenta de un cliente y estado de verificación |

### Fronteras de confianza

![Fronteras de confianza](diagramas/fronteras.png)

| Frontera | Qué se verifica al cruzarla |
|---|---|
| Navegador → gateway | TLS (HTTPS con HSTS), sesión (cookie + introspección), rol, origen (CSRF), límite por IP, tamaño del cuerpo (100 KB). Se descartan `X-Usuario-*`, `X-Credencial-Interna`, `Authorization` y la cookie antes de reenviar |
| Pasarela → gateway → pagos | Firma HMAC del cuerpo exacto, token y monto |
| Gateway → servicio | Credencial interna del servicio de destino (cada servicio tiene la suya) |
| Servicio → servicio | Credencial del destino + identidad del usuario original (el destino aplica sus reglas) |
| Servicio → Vault | Token propio con política de solo lectura en sus rutas |
| Servicio → Mongo | Usuario propio con `readWrite` solo en su base, sobre TLS |
| Todos los saltos | TLS 1.2 o superior: el cliente verifica el certificado del servidor con la CA de prueba (en Node, `NODE_EXTRA_CA_CERTS`; en Python, `SSL_CERT_FILE`; en Mongo, `tlsCAFile`). Un intento en claro contra un servicio interno se rechaza (caso 7.12 y comprobación manual) |

### Decisiones de separación

- El frontend se sirve desde el gateway: misma origen que la API, la cookie viaja sin CORS y puede ser `SameSite`.
- El gateway no tiene reglas de negocio: solo el control grueso. La propiedad del recurso la decide el servicio dueño (así no se puede saltar llamando por GraphQL).
- El GraphQL Gateway está detrás del API Gateway, no al lado: hereda sesión, límites y CSRF.
- Pagos es el único servicio privado en la red `externa`, porque es el único que habla con el proveedor.

### Recorrido de una petición autorizada y una denegada

![Secuencia denegada](diagramas/secuencia-denegada.png)

**Autorizada:** la cocina acepta el pedido PF-00084. Navegador → `POST /api/v1/pedidos/PF-00084/aceptar` con su cookie → el gateway introspecciona (rol `cocina`) → la matriz permite `admin, cocina` → lee de Vault la credencial de pedidos → reenvía con `X-Usuario-Rol: cocina` → pedidos verifica la credencial, que el rol sea cocina o admin, que el pedido esté PAGADO (en el mismo `update`) y registra el paso con el nombre de quien lo hizo → `200`. Evidencia: caso 10.4.

**Denegada:** otro cliente pide el mismo pedido. El gateway lo deja pasar (los clientes pueden ver pedidos), pero pedidos compara `X-Usuario-Sujeto` con el dueño y responde 404, sin confirmar que existe. Por GraphQL ocurre lo mismo, porque el GraphQL Gateway reenvía la identidad. Si alguien en la red privada llama directo a pedidos con `X-Usuario-Rol: admin`, recibe 403 por no tener la credencial interna. Evidencia: casos 7.5 y 7.9.

---

## 6. Rutas, secretos, identidades y operaciones GraphQL

Cada petición que llega de afuera debe terminar en el servicio correcto, y cada servicio necesita una forma de demostrar quién es. Aquí está el mapa completo: qué ruta pública va a qué servicio, con qué control y con qué credencial; qué secretos existen, quién los usa y cómo se cambian; y qué operaciones ofrece GraphQL. Las credenciales se nombran por su ubicación en Vault, nunca por su valor.

### Cómo se piensan las llaves

La imagen que sirve aquí es la de un edificio con muchas puertas. Cada servicio tiene su propia llave y esa llave no abre las demás: si alguien consigue la de pagos, solo entra a pagos. El gateway es el único que lleva varias llaves, porque su trabajo es llamar a todos, y por eso es la pieza más vigilada. Los tres tipos de identidad que aparecen en esta sección son distintos entre sí: la **persona** se identifica con su cookie de sesión, un **servicio** con su credencial interna, y la **pasarela** con la firma de sus avisos.

Las llaves no están escritas en el código ni en el repositorio: viven en Vault, y `vault-init`, el contenedor que corre una sola vez al arrancar, las crea al azar. Cada servicio recibe un token que solo le permite leer sus propias rutas, y cada uno tiene su propio usuario de base de datos. Una limitación que está declarada entre las brechas de la sección 0: en Docker Compose los tokens de todos los servicios se escriben en un mismo volumen de solo lectura, en vez de montarse cada uno solo en su contenedor; lo que protege es que cada token solo puede leer sus propias rutas de Vault. En producción lo resolvería el orquestador (Docker secrets o Kubernetes). Si Vault deja de responder, el sistema se cierra en vez de abrirse: después de unos minutos de gracia, los servicios responden 503 y no dejan pasar a nadie.

### Matriz de rutas

Cada fila es una operación del módulo 1 (mismo ID). Lo que no está en esta tabla no existe hacia afuera (404). Las rutas `/internos/*` de los servicios nunca se publican. Se generó leyendo `gateway/src/rutas.js`, que tiene 36 filas (S30 a S32 comparten la de `/graphql`); a ellas se suman 6 operaciones que resuelve el propio gateway (S33 a S37 y S44). Controles que se aplican a **todas** las rutas, además de los de la columna: HTTPS con HSTS, límite general por IP, origen permitido en los verbos que cambian datos (CSRF), cuerpo de hasta 100 KB, plazo de 8 s (504 si se vence, 502 si el servicio no responde), errores con la misma forma y `X-Request-Id` en los logs. Antes de reenviar, el gateway descarta `X-Usuario-*`, `X-Credencial-Interna`, `Authorization` y la cookie, y agrega solo la identidad verificada y la credencial del destino.

| ID | Gateway | Verbo | Ruta externa (`/api/v1`) | Acceso y rol | Sistema y ruta destino | Controles propios | Referencia de credencial |
|---|---|---|---|---|---|---|---|
| S01 | gateway externo | GET | `/catalogo/items` | Público | inventario: `/items` | Filtros validados (400) | `internos/inventario` |
| S02 | gateway externo | GET | `/catalogo/items/:id` | Público | inventario: `/items/:id` | — | `internos/inventario` |
| S03 | gateway externo | GET | `/catalogo/configuracion` | Público | inventario: `/configuracion` | — | `internos/inventario` |
| S04 | gateway externo | POST | `/catalogo/items` | admin, dueño | inventario: `/items` | Validación de producto | `internos/inventario` |
| S05 | gateway externo | PUT | `/catalogo/items/:id` | admin, dueño | inventario: `/items/:id` | Validación de producto | `internos/inventario` |
| S06 | gateway externo | DELETE | `/catalogo/items/:id` | admin | inventario: `/items/:id` | Solo admin en gateway e inventario | `internos/inventario` |
| S07 | gateway externo | POST | `/clientes/registro` | Público | clientes: `/clientes/registro` | 20/min por IP; validación de ficha | `internos/clientes` |
| S08 | gateway externo | GET | `/clientes/yo` | cliente | clientes: `/clientes/yo` | Propiedad | `internos/clientes` |
| S09 | gateway externo | PUT | `/clientes/yo` | cliente | clientes: `/clientes/yo` | Propiedad | `internos/clientes` |
| S10 | gateway externo | GET | `/clientes` | admin | clientes: `/clientes` | — | `internos/clientes` |
| S11 | gateway externo | POST | `/clientes` | admin | clientes: `/clientes` | Clave temporal | `internos/clientes` |
| S12 | gateway externo | GET | `/clientes/:id` | admin | clientes: `/clientes/:id` | — | `internos/clientes` |
| S13 | gateway externo | PUT | `/clientes/:id` | admin | clientes: `/clientes/:id` | — | `internos/clientes` |
| S14 | gateway externo | PATCH | `/clientes/:id/estado` | admin | clientes: `/clientes/:id/estado` | Cierra sesiones al desactivar | `internos/clientes` |
| S15 | gateway externo | POST | `/pedidos` | cliente | pedidos: `/pedidos` | `Idempotency-Key`; precio de inventario | `internos/pedidos` |
| S16 | gateway externo | GET | `/pedidos` | Todos los roles | pedidos: `/pedidos` | Propiedad y filtro por rol | `internos/pedidos` |
| S17 | gateway externo | GET | `/pedidos/:id` | Todos los roles | pedidos: `/pedidos/:id` | Propiedad y filtro por rol | `internos/pedidos` |
| S18 | gateway externo | GET | `/pedidos/boleta/:numero` | cliente, admin, dueño | pedidos: `/pedidos/boleta/:numero` | Propiedad | `internos/pedidos` |
| S19 | gateway externo | GET | `/pedidos/configuracion` | Todos los roles | pedidos: `/pedidos-config` | — | `internos/pedidos` |
| S20 | gateway externo | POST | `/pedidos/:id/aceptar` | admin, cocina | pedidos: `/pedidos/:id/aceptar` | Estado atómico | `internos/pedidos` |
| S21 | gateway externo | POST | `/pedidos/:id/terminar` | admin, cocina | pedidos: `/pedidos/:id/terminar` | Estado atómico | `internos/pedidos` |
| S22 | gateway externo | POST | `/pedidos/:id/despachar` | admin, despacho | pedidos: `/pedidos/:id/despachar` | Estado atómico | `internos/pedidos` |
| S23 | gateway externo | POST | `/pedidos/:id/entregar` | admin, despacho | pedidos: `/pedidos/:id/entregar` | Estado atómico | `internos/pedidos` |
| S24 | gateway externo | POST | `/pedidos/:id/impresa` | admin, cocina, despacho | pedidos: `/pedidos/:id/impresa` | — | `internos/pedidos` |
| S25 | gateway externo | POST | `/pedidos/:id/anular` | cliente, admin | pedidos: `/pedidos/:id/anular` | Propiedad, estado y motivo | `internos/pedidos` |
| S26 | gateway externo | GET | `/reportes/ventas` | admin, dueño | pedidos: `/reportes/ventas` | Período ≤ 1 año | `internos/pedidos` |
| S27 | gateway externo | POST | `/pagos` | cliente | pagos: `/pagos` | `Idempotency-Key` obligatoria; propiedad vía pedidos | `internos/pagos` |
| S28 | gateway externo | GET | `/pagos` | cliente, admin, dueño | pagos: `/pagos` | Propiedad vía pedidos | `internos/pagos` |
| S29 | gateway externo | POST | `/pagos/notificacion` | Sin sesión (firma de la pasarela) | pagos: `/pagos/notificacion` | Firma HMAC; se reenvía sin identidad de usuario | `internos/pagos`; firma con `pasarela/comercio` (`secreto_firma`) |
| S30 | gateway externo | POST | `/graphql` `resumenPedido` | Con sesión | GraphQL Gateway: `/graphql` | Profundidad ≤ 6, costo ≤ 1.000, paginación ≤ 50 | `internos/graphql` |
| S31 | gateway externo | POST | `/graphql` `misPedidos` | Con sesión | GraphQL Gateway: `/graphql` | Profundidad, costo y paginación | `internos/graphql` |
| S32 | gateway externo | POST | `/graphql` `reporteVentas` | Con sesión | GraphQL Gateway: `/graphql` | Profundidad, costo y paginación | `internos/graphql` |
| S33 | gateway externo | POST | `/auth/login` | Público | Auth Service: `/login` | 20/min por IP; bloqueo por correo | `internos/auth-gateway` (Basic) |
| S34 | gateway externo | POST | `/auth/logout` | Público | Auth Service: `/logout` | Borra la cookie | `internos/auth-gateway` (Basic) |
| S35 | gateway externo | GET | `/auth/sesion` | Público | gateway (no reenvía) | Respuesta del propio gateway | — |
| S36 | gateway externo | GET | `/auth/config` | Público | gateway (no reenvía) | Respuesta del propio gateway | — |
| S37 | gateway externo | PUT | `/auth/clave` | Con sesión | Auth Service: `/clave` | Cuenta tomada de la sesión | `internos/auth-gateway` (Basic) |
| S38 | gateway externo | POST | `/auth/verificar` | Público | Auth Service: `/verificacion` | 20/min por IP; respuesta uniforme | `internos/auth-gateway` (Basic) |
| S39 | gateway externo | POST | `/auth/reenviar` | Público | Auth Service: `/verificacion/reenviar` | 20/min por IP; respuesta uniforme | `internos/auth-gateway` (Basic) |
| S40 | gateway externo | GET | `/usuarios` | admin | Auth Service: `/usuarios` | — | `internos/auth-gateway` (Basic) |
| S41 | gateway externo | POST | `/usuarios` | admin | Auth Service: `/usuarios` | Clave fuerte | `internos/auth-gateway` (Basic) |
| S42 | gateway externo | PUT | `/usuarios/:id` | admin | Auth Service: `/usuarios/:id` | Último admin y propio perfil protegidos | `internos/auth-gateway` (Basic) |
| S43 | gateway externo | PATCH | `/usuarios/:id/estado` | admin | Auth Service: `/usuarios/:id/estado` | Último admin y propia cuenta protegidos | `internos/auth-gateway` (Basic) |
| S44 | gateway externo | GET | `/api/salud` | Público | gateway: `GET /salud` de cada servicio y de Vault | Sin datos personales; consulta cada `/salud` con 2 s de plazo | — |

Las referencias de credencial son rutas simbólicas en Vault (`secret/poke-fresh/...`), no valores. Los tres GraphQL (S30 a S32) comparten la ruta `POST /graphql`: el gateway solo exige sesión y **cada operación y cada campo se autoriza dentro del GraphQL Gateway** (tabla de la sección 8); que la ruta esté permitida no autoriza todas sus operaciones.

### Inventario simbólico de secretos

Referencias, nunca valores. Todos los genera `vault-init` al azar (256 bits) y viven en Vault (`secret/`, KV v2), salvo `MONGO_ROOT_CLAVE`. Ninguno está en el repositorio, en el JavaScript del navegador, en capturas ni en logs. Cada servicio lee solo los suyos: su token de Vault tiene una política de solo lectura sobre esas rutas.

| Referencia | Tipo | Emisor | Consumidor (política) | Finalidad | Ubicación segura | Alcance | Rotación y revocación |
|---|---|---|---|---|---|---|---|
| `poke-fresh/internos/inventario` (`credencial`) | Credencial de servicio | `vault-init` | gateway, inventario, pedidos, graphql | Llamar a inventario | Vault | Solo inventario | Borrar el secreto y volver a correr `vault-init`; los servicios lo leen en ≤ 30 s |
| `poke-fresh/internos/clientes` (`credencial`) | Credencial de servicio | `vault-init` | gateway, clientes, pedidos, graphql | Llamar a clientes | Vault | Solo clientes | Igual |
| `poke-fresh/internos/pedidos` (`credencial`) | Credencial de servicio | `vault-init` | gateway, pedidos, pagos, graphql | Llamar a pedidos | Vault | Solo pedidos | Igual |
| `poke-fresh/internos/pagos` (`credencial`) | Credencial de servicio | `vault-init` | gateway, pagos, pedidos, graphql | Llamar a pagos | Vault | Solo pagos | Igual |
| `poke-fresh/internos/graphql` (`credencial`) | Credencial de servicio | `vault-init` | gateway, graphql | Llamar al GraphQL Gateway | Vault | Solo graphql | Igual |
| `poke-fresh/internos/auth-gateway` (`secreto`) | Secreto compartido (Basic) | `vault-init` | gateway, auth | El gateway ante el Auth Service | Vault | Rutas de sesión y usuarios del Auth Service | Rotar: el gateway lo relee en ≤ 30 s |
| `poke-fresh/internos/auth-clientes` (`secreto`) | Secreto compartido (Basic) | `vault-init` | clientes, auth | El servicio de clientes ante el Auth Service | Vault | Solo `/cuentas` (crear y cambiar cuentas de cliente) | Rotar |
| `poke-fresh/auth` (`pepper`) | Pepper de contraseñas | `vault-init` (una sola vez) | auth | Se mezcla con la clave antes de scrypt | Vault | Hashes de contraseñas | **No se rota a la ligera**: obliga a pedir cambio de contraseña a todos. Por eso `vault-init` nunca lo regenera |
| `poke-fresh/pasarela/comercio` (`api_key`, `secreto_firma`) | Claves del comercio ante el proveedor | `vault-init` en la demostración; el proveedor en producción | pagos, pasarela | Crear transacciones y firmar o verificar notificaciones | Vault | Operar la cuenta del comercio (nunca llega al navegador) | Pedir claves nuevas al proveedor y actualizar el secreto |
| `poke-fresh/mongo/<servicio>` (`usuario`, `clave`) | Credencial de base de datos | `vault-init` | ese servicio (y `semilla` la suya) | Conectarse a su base | Vault | `readWrite` solo en su base | Cambiar la clave en Vault y correr `vault-init` (actualiza el usuario en Mongo) |
| Token de Vault de cada servicio | Token con TTL 720 h | Vault, vía `vault-init` | ese servicio | Leer sus rutas | Volumen de solo lectura (ver «Distribución de tokens de Vault» en las brechas de la sección 0) | Solo lectura de sus rutas | Revocarlo en Vault; `vault-init` emite uno nuevo |
| `MONGO_ROOT_CLAVE` | Secreto de arranque | La persona que opera | mongo, vault-init | Crear los usuarios por servicio | `.env` fuera del repo | Administrar Mongo (ningún servicio la usa) | Cambiarla en Mongo y en `.env` |
| Certificados TLS y CA de prueba | Certificados | `tls-init` | todos los servicios | Cifrar y autenticar cada salto | Volúmenes `tls` (certificados) y `tls-ca` (clave de la CA, solo `tls-init`) | Un certificado por componente | Borrar el volumen `tls` y recrear: se emiten nuevos |

**Si una clave se filtra:** se revoca o borra el secreto afectado y se corre `vault-init`; solo se ve comprometido lo que esa referencia permite (la columna Alcance), porque no hay un secreto común a todos los sistemas. Una credencial de pagos solo sirve para pagos; la de base de datos de un servicio no abre las de otro; el navegador nunca recibe ninguna.

**Si Vault no responde:** cada servicio sigue usando lo leído durante 5 minutos (`VAULT_GRACIA_SEGUNDOS`) y después responde 503 (falla cerrada). El gateway responde 503 `SECRETOS_NO_DISPONIBLES`. Probado en el caso 10.7.

### Identidades

| Identidad | Cómo se prueba | Dónde se valida |
|---|---|---|
| Usuario (cliente o personal) | Cookie con token opaco | Auth Service (introspección), por el gateway |
| Gateway ante servicios | `X-Credencial-Interna` del destino | Cada servicio, contra Vault |
| Gateway / clientes ante Auth | HTTP Basic (sobre HTTPS) con su secreto | Auth Service, contra Vault, y solo sus rutas |
| Servicio ante otro servicio | Credencial del destino + identidad del usuario original | El destino |
| Pasarela ante pagos | Firma HMAC del cuerpo | pagos |
| Pagos ante la pasarela | `X-Api-Key` | pasarela |
| Servicio ante Vault | Token con política propia | Vault |
| Servicio ante Mongo | Usuario y clave propios | Mongo (`authSource` = su base) |

### Operaciones GraphQL

| Operación | Tipo | Quién | Servicios que combina | Pantalla |
|---|---|---|---|---|
| `resumenPedido(id)` | query | dueño del pedido y personal | pedidos, pagos, inventario (+ clientes para admin) | `#/orden/:id` |
| `misPedidos(primeros, despuesDe)` | query | cliente | pedidos | (disponible; la lista usa REST) |
| `reporteVentas(desde, hasta)` | query | admin, dueño | pedidos, inventario, pagos | `#/admin/reportes` |

No hay mutaciones en GraphQL: los cambios van por REST al servicio dueño, que aplica las reglas transaccionales.

### Métodos gRPC

No aplica: no se implementó gRPC. La justificación, con los argumentos a favor y en contra y la evaluación de cada flujo, está en la sección 9 ("gRPC: por qué sí y por qué no") y en el [ADR 0001](adr/0001-analitica-y-grpc.md).

---

## 7. Datos sensibles y secretos del cliente

No todos los datos valen lo mismo: el nombre de un bowl es público, pero el RUN, la dirección o el historial de pedidos de Javiera no lo son. Esta sección clasifica cada dato, decide quién puede verlo y cómo se protege, aclara que el sistema no guarda secretos de los clientes (ni datos de tarjeta) y termina con las pruebas que se ejecutaron contra el sistema funcionando.

### Clasificación de datos

| Dato o credencial | Finalidad | Clasificación | Sistema custodio | Roles autorizados | En el frontend | Protección | Retención |
|---|---|---|---|---|---|---|---|
| Nombre, descripción, precio de productos | Vender | Público | inventario | Todos; editar admin/dueño | Menú | Validación en servidor | Mientras exista el producto |
| Stock | Evitar sobreventa | Interno | inventario | admin, dueño | Solo panel | DTO por rol | Siempre actualizado |
| RUN | Boleta e identificación del comprador (caso) | Personal | clientes (y copia en el pedido) | El cliente, admin, dueño | Mis datos, boleta | No sale a cocina ni despacho; no va en logs | Mientras la cuenta exista; en la boleta, lo que exija la ley tributaria |
| Nombre y teléfono | Contacto y entrega | Personal | clientes (copia en el pedido) | Cliente, personal | Panel, orden | Mínimo necesario | Igual |
| Dirección y comuna | Despacho | Personal | clientes (copia si es despacho) | Cliente, admin, cocina y despacho en el pedido | Orden de despacho | No va en el catálogo ni en logs | Igual |
| Correo | Cuenta, boleta | Personal | clientes y Auth | Cliente, admin | Mis datos | No va en logs (el notificador registra solo el dominio) | Igual |
| Fecha de nacimiento, sexo | Requeridos por el caso para el registro | Personal | clientes | Cliente, admin | Mis datos | Nunca salen en pedidos | Igual |
| Contraseña | Autenticar | Credencial | Auth (solo el hash) | Nadie la ve | Formulario | scrypt (N=16384) + sal por cuenta + pepper en Vault; nunca se devuelve | El hash, mientras exista la cuenta |
| Código de verificación | Verificar correo | Credencial temporal | Auth (solo su hash) | El dueño del correo | Correo simulado (modo demo) | SHA-256, vence en 24 h, se borra al usarlo | 24 h |
| Token de sesión | Mantener la sesión | Credencial | Auth (hash) y cookie | El navegador del usuario | Nunca lo ve JavaScript (HttpOnly) | 256 bits, opaco, SameSite, Path=/api | 30 min sin uso u 8 h |
| Pedido, líneas, totales | Vender y preparar | Personal-comercial | pedidos | Dueño del pedido, personal según rol | Orden, panel | Propiedad, DTO por rol | Indefinida (registro de ventas) |
| Pago (monto, estado, referencia) | Cobro y conciliación | Financiero | pagos | Dueño del pedido, admin, dueño | Orden, reportes | Token de pasarela nunca sale; idempotencia | Indefinida |
| Datos de tarjeta | Pagar | Financiero sensible | **Solo la pasarela** | — | Nunca pasan por Poke Fresh | El cliente paga en la página del proveedor | No se guardan |
| Credenciales internas, pepper, claves de Mongo y pasarela | Integración | Secreto | Vault | Cada servicio, solo las suyas | Nunca | Políticas por servicio | Hasta su rotación |

### Decisión sobre secretos del cliente

**No: Poke Fresh no custodia secretos asociados al cliente.** El cliente paga en la página de la pasarela; ningún dato de tarjeta pasa por el navegador de la tienda, el gateway ni los servicios. Lo que se guarda del pago es el monto, el estado y una referencia de la pasarela, que no permite operar la cuenta de nadie. La contraseña del cliente es una credencial, no un secreto custodiado: se guarda su hash irreversible. El token de la transacción (`token` en pagos) es un identificador de la operación con alcance limitado a esa transacción; aun así no se devuelve al navegador. La única clave secreta de pago es la del comercio (`api_key` y `secreto_firma`), que vive en Vault y nunca llega al navegador.

### Recorrido de un dato restringido: el RUN

1. **Captura:** el cliente lo escribe en `#/registro`. El frontend valida el dígito verificador por comodidad.
2. **Transporte:** viaja en el cuerpo de `POST /api/v1/clientes/registro` (por HTTPS; el navegador solo habla con el gateway, y con TLS). El gateway no lo registra en logs (solo método, ruta, estado y rol).
3. **Validación y almacenamiento:** el servicio de clientes vuelve a validar formato, dígito verificador y unicidad (índice único) y lo guarda en `pf_clientes`, normalizado (`16459723-7`).
4. **Uso:** al crear un pedido, pedidos copia nombre, RUN, correo y teléfono en el pedido (la boleta debe mostrar los datos del momento de la venta).
5. **Exposición mínima:** cocina y despacho reciben del pedido solo nombre y teléfono; el RUN lo ven el propio cliente, el administrador y el dueño (boleta y CSV del reporte).
6. **Eliminación o conservación:** al desactivar al cliente, su ficha queda inactiva y su cuenta no puede ingresar. La copia en pedidos y boletas se conserva justificadamente como respaldo tributario de la venta. Una eliminación de la ficha a petición del titular borraría la ficha y la cuenta, conservando solo los documentos de venta.

### Sesiones y tokens

- El token es opaco (no es un JWT): no contiene datos y el Auth Service guarda solo su hash.
- Va en una cookie `HttpOnly; Secure; SameSite=Lax; Path=/api` (solo viaja por HTTPS). El JavaScript de la página no puede leerlo, así que un script inyectado no lo roba.
- Expira a los 30 minutos sin uso (cada petición lo renueva) o a las 8 horas.
- **Revocación inmediata:** logout, desactivar la cuenta, cambiar el correo, el rol o la clave borran las sesiones; la siguiente petición responde 401.
- **Ninguna clave compartida vive en el navegador:** el frontend no tiene API keys ni secretos; todo lo que necesita autenticarse lo hace el gateway.

### Casos de validación ejecutados

Ejecutados contra el backend implementado con `pruebas/e2e/casos.py`. Resultados completos y verificables en [`evidencias/e2e-resultados.md`](evidencias/e2e-resultados.md) y [`e2e-resultados.json`](evidencias/e2e-resultados.json) (con el `X-Request-Id` de cada petición).

| Caso | Entrada | Identidad | Esperado | Obtenido | Lo verifica |
|---|---|---|---|---|---|
| 7.1 Acceso anónimo al catálogo | `GET /catalogo/items` | anónimo | 200 sin stock | 200, 29 productos sin stock | Gateway + inventario |
| 7.2 Operación protegida sin sesión | `GET /pedidos` | anónimo | 401 | 401 SIN_SESION | Gateway |
| 7.3 Administración con rol sin permiso | `DELETE` producto, `GET /clientes`, reportes | cocina, dueño, cliente | 403 | 403 en las cuatro | Gateway + inventario |
| 7.4 Identidad falsificada | `X-Usuario-Rol: admin` | cliente | 403 | 403 | Gateway |
| 7.5 Pedido ajeno | REST y GraphQL | otro cliente | 404 / null | 404 sin datos; `resumenPedido: null` | pedidos |
| 7.6 Pago alterado desde el frontend | `monto: 1`; notificación sin firma / firma falsa | cliente | monto real; 401 | monto 7.890; 401 y 401; pedido sigue pendiente | pagos |
| 7.7 CSRF | `Origin` ajeno | cliente | 403 | 403 ORIGEN_NO_PERMITIDO | Gateway |
| 7.8 Cookie y logout | login, logout | cliente | HttpOnly y Secure; 401 tras logout | Cumple | Gateway + Auth |
| 7.9 Acceso directo al backend | desde un contenedor de la red privada, sin la credencial del destino y con `X-Usuario-Rol: admin` | atacante dentro de la red | 403/401 | pedidos 403, inventario 403, GraphQL 403, Auth 401 | Cada servicio |
| 7.10 Secreto ajeno en Vault | dentro del contenedor de inventario, con su propio token | inventario | 403 | propio 200; pagos 403; pepper 403 | Vault |
| 7.11 Fuerza bruta | 25 logins fallidos | anónimo | bloqueo | 429 desde el intento 6 | Auth + gateway |
| 7.12 Transporte cifrado | GET en claro y por HTTPS | anónimo | sin HTTP en claro; HTTPS con HSTS; certificado verificado con la CA | Cumple | Gateway (TLS) |

**Qué comprobamos.** Revisamos tres cosas. Primero, que no haya secretos en el JavaScript, el HTML ni las capturas: lo único que se muestra son cuentas de prueba, que el gateway informa solo con `MODO_DEMO=true`. Segundo, que cada rol reciba solo los datos que necesita: un cliente no ve pedidos de otro (caso 7.5) y cocina no ve el RUN ni el correo de quien compra (caso 10.4). Tercero, que aunque la tienda esté abierta a Internet, lo que llega al navegador lo decide el servidor según el rol y no la pantalla (casos 7.2 a 7.4).

---

## 8. Separación privada y agregaciones GraphQL

La pantalla del pedido de Javiera muestra el pedido, sus pagos y los productos que compró, y esos datos viven en tres servicios distintos. Para que el navegador no tenga que llamarlos uno por uno (ni pueda hacerlo), existe un GraphQL Gateway privado que los junta en una sola consulta. Esta sección muestra cómo está construido, qué puede ver cada rol, qué límites evitan abusos y la evidencia de que funciona desde la pantalla real.

### Mapa de clasificación

| Servicio | Naturaleza | Responsabilidad | Datos propios | Contrato | Dependencias | Justificación de la separación |
|---|---|---|---|---|---|---|
| inventario | Transaccional | Catálogo, precio, stock | items, reservas | REST | — | Es la fuente de verdad del precio; lo lee la tienda entera |
| clientes | Transaccional | Ficha personal | clientes | REST | Auth | Aísla los datos personales |
| pedidos | Transaccional | Ciclo de vida, venta, boleta, reporte | pedidos | REST + eventos STOMP | inventario, clientes, pagos | Núcleo del negocio |
| pagos | Transaccional / integración | Proveedor externo, dinero | pagos | REST + webhook firmado | pedidos, pasarela | Aísla al proveedor y el riesgo financiero |
| Auth Service | Seguridad | Credenciales y sesiones | cuentas | REST interno | — | Las credenciales no se mezclan con datos de negocio |
| GraphQL Gateway | Agregación | Composición de lecturas | Ninguno | GraphQL | pedidos, pagos, inventario, clientes | Las pantallas de detalle y reportes necesitan datos de varios servicios en una sola llamada |
| notificador | Asíncrono | Correos y avisos | Ninguno | STOMP | ActiveMQ | No bloquea el pago |
| Analítica / alta demanda | — | No se separan | — | — | — | ADR 0001: la carga no lo justifica |

Todos son privados (red `internal`). Vault, Mongo y ActiveMQ tampoco tienen puertos publicados.

### Schema

```graphql
type Query {
  resumenPedido(id: ID!): ResumenPedido
  misPedidos(primeros: Int = 10, despuesDe: String): PaginaPedidos!
  reporteVentas(desde: String!, hasta: String!): ReporteVentas
}
type ResumenPedido { pedido: Pedido!  pagos: [Pago!]  cliente: FichaCliente }
type Pedido { id: ID! clienteId: ID! estado: String! estadoTexto: String! modoEntrega: String!
              direccion: String nota: String chofer: String total: Int! creadoEn: String!
              lineas: [Linea!]! boleta: Boleta anulacion: Anulacion historial: [Paso!]! }
type Linea { descripcion: String! cantidad: Int! precioUnitario: Int! subtotal: Int! productos: [Producto!] }
type Producto { id: ID! nombre: String! categoria: String! disponibleHoy: Boolean! }
type Pago { id: ID! estado: String! monto: Int! medio: String! referencia: String creadoEn: String! actualizadoEn: String }
type FichaCliente { nombre: String! telefono: String! email: String! comuna: String! }
type PaginaPedidos { nodos: [Pedido!]! siguiente: String }
type ReporteVentas { desde: String! hasta: String! cantidad: Int! monto: Int!
                     porCategoria: [VentaCategoria!]! conciliacion: Conciliacion }
type VentaCategoria { categoria: String! unidades: Int! }
type Conciliacion { ventas: Int! pagosAprobados: Int! montoVentas: Int! montoPagos: Int! pedidosConDiferencia: [ID!]! }
# (más Boleta, Anulacion y Paso; ver graphql-gateway/src/graphql/esquema.js)
```

### Resolvers

| Resolver | Llama a | Con qué identidad | Notas |
|---|---|---|---|
| `Query.resumenPedido` | pedidos `GET /pedidos/:id` | la del usuario | 404 de pedidos → `null` |
| `ResumenPedido.pagos` | pagos `GET /internos/pagos?ids=` | — (pedidos ya autorizó el pedido) | DataLoader por pedido; si pagos falla → `null` + error parcial |
| `ResumenPedido.cliente` | clientes `GET /clientes/:id` | la del usuario | Autorización por campo: solo admin |
| `Linea.productos` | inventario `GET /items?ids=` | la del usuario | DataLoader: una llamada para todas las líneas |
| `Query.reporteVentas` | pedidos `GET /reportes/ventas` | la del usuario | Solo admin y dueño |
| `ReporteVentas.porCategoria` | inventario (DataLoader) | — | Unidades por categoría |
| `ReporteVentas.conciliacion` | pagos (DataLoader) | — | Venta vs. pago aprobado |

Ningún resolver accede a una base de datos: solo a las APIs de los servicios. Las reglas transaccionales quedan en el servicio dueño.

### Consulta de prueba y respuesta

```graphql
query ($id: ID!) {
  resumenPedido(id: $id) {
    pedido { id estadoTexto total lineas { descripcion productos { nombre categoria } } }
    pagos { estado monto referencia }
    cliente { email }
  }
}
```

Respuesta como cliente dueño del pedido (los datos son ficticios):

```json
{
  "data": {
    "resumenPedido": {
      "pedido": {
        "id": "PF-00081", "estadoTexto": "Entregado", "total": 7890,
        "lineas": [{ "descripcion": "Bowl Regular: Arroz gohan, Salmón fresco, Ponzu, Palta",
                     "productos": [{ "nombre": "Arroz gohan", "categoria": "BASE" }, { "nombre": "Salmón fresco", "categoria": "PROTEINA" },
                                   { "nombre": "Ponzu", "categoria": "SALSA" }, { "nombre": "Palta", "categoria": "TOPPING" }] }]
      },
      "pagos": [{ "estado": "APROBADO", "monto": 7890, "referencia": "SVP-99801681" }],
      "cliente": null
    }
  },
  "errors": [{ "message": "Tu perfil no puede consultar este dato.", "path": ["resumenPedido", "cliente"], "extensions": { "code": "PROHIBIDO" } }]
}
```

El cliente pidió `cliente { email }` y no lo obtuvo: la selección de campos no sirve para filtrar información restringida.

### Matriz de autorización GraphQL

| Campo | cliente (suyo) | cliente (ajeno) | cocina / despacho | dueño | admin |
|---|---|---|---|---|---|
| `resumenPedido.pedido` | Sí | `null` | Según su cola (lo decide pedidos) | Sí | Sí |
| `resumenPedido.pagos` | Sí | — | Sí | Sí | Sí |
| `resumenPedido.cliente` | PROHIBIDO | — | PROHIBIDO | PROHIBIDO | Sí |
| `Pedido.historial.actor` | `null` (pedidos no lo envía) | — | Sí | Sí | Sí |
| `misPedidos` | Sí (solo los suyos) | — | PROHIBIDO | PROHIBIDO | PROHIBIDO |
| `reporteVentas` | PROHIBIDO | — | PROHIBIDO | Sí | Sí |

### Límites y protecciones

| Protección | Valor | Prueba |
|---|---|---|
| Profundidad máxima | 6 | `graphql-gateway/test` |
| Costo máximo (listas multiplican) | 1.000 | `test` y caso 8.2 (consulta de costo 11.102 rechazada) |
| Paginación | `primeros` ≤ 50, cursor `despuesDe` | `test` y caso 8.2 |
| Tiempo máximo por llamada | 3 s | — |
| Errores parciales | campo `null` + `errors` con `servicio` | `test` (pagos caído) |
| Batching | DataLoader (productos, pagos) | `test`: 2 líneas, 3 productos → 1 llamada |
| Introspección | Desactivada con `NODE_ENV=production` | — |
| Acceso directo | 403 sin credencial interna | `test` y caso 7.9 |
| Cuerpo máximo | 20 KB | — |

### Evidencia desde el frontend

`pruebas/e2e/pantallas.py` recorre la tienda en Chromium contra el sistema levantado. Capturas en `docs/evidencias/pantallas/`:

- `06-pedido-pagado-graphql.png`: la pantalla del pedido muestra la sección "Pagos" (servicio de pagos) junto al pedido (servicio de pedidos), obtenidos con `resumenPedido`.
- `14-pedido-vista-admin.png`: el administrador ve además "Contacto del cliente" (servicio de clientes).
- `11-reportes-graphql.png`: "Unidades por categoría" y "Conciliación con pagos", desde `reporteVentas`.

![Pantalla del pedido (06-pedido-pagado-graphql.png): el pedido, servicio de pedidos, junto a la sección "Pagos", servicio de pagos, obtenidos con resumenPedido](evidencias/pantallas/06-pedido-pagado-graphql.png)

![Vista del administrador (14-pedido-vista-admin.png): además aparece "Contacto del cliente", servicio de clientes, solo para admin](evidencias/pantallas/14-pedido-vista-admin.png)

![Reportes (11-reportes-graphql.png): "Unidades por categoría" y "Conciliación con pagos", desde reporteVentas](evidencias/pantallas/11-reportes-graphql.png)

`recorrido.json` lista las rutas de la API que usó el navegador: todas bajo `/api/v1`; ninguna a un servicio interno.

**Qué comprobamos.** Que la consulta junta de verdad datos de tres o cuatro servicios; que cada servicio mantiene su autoridad (la propiedad del pedido la decide pedidos); que pedir campos de más no filtra datos restringidos (si un cliente pide `cliente { email }`, recibe PROHIBIDO); y que la red privada y los permisos funcionan con el sistema en marcha (casos 7.5, 7.9 y 8.1 a 8.3).

---

## 9. Analítica y gRPC

No toda necesidad de reporte exige un sistema de analítica aparte, ni todo mensaje entre servicios exige gRPC. Esta sección decide con números si hacían falta: primero qué carga tiene el negocio y qué se midió, luego por qué no se implementó cada componente y, por último, las razones a favor y en contra de gRPC.

La decisión, con contexto, alternativas y consecuencias, está en [ADR 0001](adr/0001-analitica-y-grpc.md).

### Matriz de necesidades

| Necesidad | Valor | Proyección / medición | ¿Requiere analítica separada o gRPC? |
|---|---|---|---|
| Volumen de datos | ~55.000 pedidos/año, < 100 MB | Proyección | No |
| Concurrencia en el pico | ~5 peticiones/s | Proyección | No |
| Capacidad medida | 209 a 316 peticiones/s, p95 92 a 147 ms, 0 % de error (en Docker, con TLS) | **Medición** (`evidencias/carga.md`) | No |
| Tamaño de mensaje | < 10 KB | Medición | No |
| Frecuencia del reporte | Pocas veces al día | Proyección | No: consulta indexada en pedidos |
| Latencia aceptada del reporte | ≤ 2 s | Objetivo | Cumple |
| Streaming | No se necesita (aviso a cocina en segundos) | Requisito | No; los avisos asíncronos van por ActiveMQ |

### La prueba de carga

La decisión de no separar un servicio de analítica ni usar gRPC se apoya en una **medición**, no en una proyección. El detalle y los comandos para repetirla están en [`evidencias/carga.md`](evidencias/carga.md).

- **Entorno:** un PC con Windows 11, AMD Ryzen 7 5800H (16 hilos), 16 GB de RAM y Docker Desktop (el motor ve 16 CPU y 15,3 GiB). El generador de carga, `pruebas/carga/carga.mjs`, corre en el mismo equipo, fuera de Docker, y entra por el puerto 8080 por HTTPS verificando el certificado; por eso compite por CPU con los contenedores y las latencias incluyen la red de Docker Desktop.
- **Sistema:** el `docker-compose.yml` completo, con MongoDB, Vault y ActiveMQ reales, las dos redes y TLS en todos los saltos.
- **Datos:** los de ejemplo (6 clientes, 80 pedidos, 29 productos) más lo que crean las pruebas de punta a punta.
- **Carga:** 20 conexiones concurrentes durante 20 segundos por escenario, sin pausa entre peticiones: el peor caso, porque cada conexión pide apenas recibe la respuesta anterior.

| Escenario | Qué mide | Peticiones | Por segundo | p50 | p95 | p99 | Errores |
|---|---|---:|---:|---:|---:|---:|---:|
| `GET /catalogo/items` (anónimo) | Lectura pública del catálogo en inventario, sin sesión | 6.339 | 316,4 | 61,4 ms | 91,6 ms | 116,3 ms | 0 % |
| GraphQL `resumenPedido` (cliente) | Agregación de pedidos, pagos e inventario, con sesión | 4.195 | 209,1 | 89,1 ms | 146,8 ms | 202,5 ms | 0 % |
| `GET /pedidos?cola=cocina` (cocina) | Cola de cocina: sesión, introspección y consulta a MongoDB | 5.113 | 254,8 | 77,6 ms | 110,0 ms | 146,7 ms | 0 % |

**CPU y memoria.** Se registraron con `docker stats`, en una sola muestra tomada durante el tercer escenario (100 % equivale a un núcleo):

| Contenedor | CPU | Memoria |
|---|---:|---:|
| pedidos | 108 % | 63 MiB |
| MongoDB | 91 % | 359 MiB |
| API Gateway (TLS y reenvío) | 65 % | 130 MiB |
| Auth Service (introspección en cada petición) | 40 % | 73 MiB |
| inventario, clientes, pagos | 0,1 % | de 49 a 61 MiB |
| GraphQL Gateway (sin uso en este escenario) | 0 % | 151 MiB |

Con una sola muestra no se pueden sacar conclusiones finas sobre cuánto consume cada pieza: sirve para ver el orden de magnitud y que ningún contenedor se acerca a un límite de memoria. Tampoco permite comparar con otra tecnología.

**Comparación con los objetivos** (ADR 0001):

| Objetivo | Medido | ¿Cumple? |
|---|---|---|
| p95 menor a 300 ms en catálogo y colas | 92 ms y 110 ms | Sí |
| p95 menor a 500 ms en agregaciones GraphQL | 147 ms | Sí |
| Soportar el pico estimado de 5 peticiones por segundo con 0 % de error | De 209 a 316 peticiones por segundo, 0 % de error | Sí, con un margen de 42 a 63 veces |

### Por qué no se implementa cada componente

| Componente | ¿Se implementa? | Requisito del caso y carga que lo justificarían | Por qué no |
|---|---|---|---|
| Servicio de analítica separado | No | Reportes de ventas por período, unas pocas veces al día | Los resuelve una consulta indexada en pedidos (< 100 MB al año) más la agregación GraphQL (S32); un almacén aparte sería costo sin beneficio |
| gRPC unary (cotizar, reservar) | No | 2 a 4 llamadas internas por petición, mensajes de menos de 10 KB | REST con JSON cumple la latencia con margen de 42 a 63 veces el pico |
| gRPC streaming (avisos a cocina) | No | Cocina se entera en segundos, no en milisegundos | La pantalla consulta cada 8 s; el evento ya sale por ActiveMQ, que además recupera lo pendiente tras una desconexión |
| Trabajo largo asíncrono con identificador | No | No hay operaciones largas | El correo y la boleta ya son asíncronos por ActiveMQ y no bloquean el pago |
| Carga y fallos | Sí, medidos | Objetivos de p95 y 0 % de error (ADR 0001) | `evidencias/carga.md` (tres escenarios) y pruebas de servicio caído (`502`), Vault caído (`503`) y error parcial en GraphQL |

### gRPC: por qué sí y por qué no

**Por qué sí podría usarse.** Aporta contratos tipados y generados (`.proto`), plazos y cancelación entre servicios, streaming del servidor con control de flujo, HTTP/2 con mensajes binarios y TLS o TLS mutuo con identidad en metadatos.

**Por qué no se usa en este caso.**

- **Ningún flujo lo necesita.** Todas las llamadas internas son puntuales y pequeñas (menos de 10 KB; de 2 a 4 por petición): cotizar y reservar (una por pedido), ficha del cliente, confirmar un pago y las lecturas del GraphQL con DataLoader. Ninguna es de alta frecuencia ni larga.
- **No hay un requisito de streaming.** Cocina debe enterarse en segundos; el evento sale por ActiveMQ y la pantalla consulta cada 8 s.
- **Lo que daría ya está cubierto:** plazo de 4 s por llamada interna (`502/504`), `X-Request-Id` e identidad propagados, operaciones idempotentes, TLS entre todos los saltos y contratos validados en el servidor con pruebas.
- **El navegador no habla gRPC.** Habría que mantener REST hacia afuera y `.proto` hacia adentro para lo mismo, o agregar un proxy gRPC-Web.
- **Costo de operación:** generación de código en Node y Python, un servidor gRPC junto a cada FastAPI y rehacer `healthcheck`, pruebas y controles de seguridad para otro protocolo.
- **El rendimiento ya cumple:** 209 a 316 peticiones/s con REST y TLS, de 42 a 63 veces el pico proyectado.

**Limitación.** No se midió gRPC contra REST; por eso no se afirma que sea más rápido, más lento ni que consuma más o menos CPU o memoria. La decisión se apoya en que el caso no tiene un requisito que lo justifique y en la capacidad medida del diseño actual.

**Cuándo sería sí.** Un consumidor privado que necesite un flujo continuo de eventos con reanudación (por ejemplo, un monitor de despacho en tiempo real), una llamada interna que supere la capacidad medida, varios equipos o lenguajes que exijan contratos generados, o una operación larga que haya que cancelar. En ese caso: `unary` con plazo de 4 s para cotizar y reservar, un stream del servidor para eventos de pedido con el último evento recibido para reanudar sin duplicar, identidad en metadatos y un adaptador con Server-Sent Events en el gateway para el navegador. Es una propuesta y **no está implementada ni probada**.

El análisis completo, con una evaluación flujo por flujo, está en el [ADR 0001](adr/0001-analitica-y-grpc.md).

**Conclusión:** no se implementa un servicio de analítica separado ni gRPC, porque la carga proyectada es entre 42 y 63 veces menor que la medida y no hay flujos de streaming. La alternativa implementada (reporte en pedidos + agregación GraphQL + eventos por ActiveMQ) cumple los objetivos con la prueba de carga como evidencia. El ADR indica cuándo revisar la decisión.

---

## 10. Backend completo e integración verificable

Aquí se junta todo: qué se entrega, cómo se prueba y qué evidencia hay de que funciona. Las tablas de pruebas dicen qué cubre cada conjunto y cuántas pasaron; las capturas muestran el sistema en uso (escritorio, teléfono y un navegador real); la matriz final relaciona cada requisito del caso con su pantalla, su servicio, su prueba y su evidencia.

### Qué se entrega

| Pieza | Dónde |
|---|---|
| Código del frontend | `frontend/` |
| Código del backend | `gateway/`, `auth-service/`, `graphql-gateway/`, `servicios/` |
| Despliegue reproducible | `docker-compose.yml`, `Dockerfile` de cada componente, `vault/` |
| Persistencia y creación | MongoDB con una base y un usuario por servicio; índices creados al arrancar (`preparar` en cada servicio); datos ficticios con `servicios/scripts/semilla.py` |
| Contratos REST | Sección 1 y OpenAPI de cada servicio |
| Contrato GraphQL | Sección 8 y `graphql-gateway/src/graphql/esquema.js` |
| Contratos gRPC | No aplica (ADR 0001) |
| Pruebas automatizadas | 86 unitarias y de integración + 23 de punta a punta (contra Docker, con TLS) + recorrido de pantallas + carga |
| Instrucciones | `README.md` |

### Pruebas y resultados

| Conjunto | Cantidad | Qué cubre | Resultado |
|---|---:|---|---|
| `servicios/tests` (pytest) | 37 | Reglas de cada servicio, propiedad, cotización, stock, idempotencia, firma, Vault caído (503), servicio caído (502), datos de ejemplo, URI de Mongo con TLS | 37/37 |
| `auth-service/test` | 20 | Login, bloqueo, expiración, revocación, verificación, permisos por cliente, hash y pepper, Vault sellado | 20/20 |
| `gateway/test` | 18 | Matriz de rutas, roles, cabeceras falsificadas, cookie, CSRF, webhook, Vault y servicio caídos, límite, healthcheck, HSTS | 18/18 |
| `graphql-gateway/test` | 11 | Agregación, batching, identidad, autorización por campo, error parcial, límites, paginación | 11/11 |
| `pruebas/e2e/casos.py --docker` | 23 | Casos del módulo 7 y del 10 contra el sistema levantado en Docker, por HTTPS; los casos 7.9, 7.10 y 10.7 se ejecutan dentro de la red privada | 23/23 |
| `pruebas/e2e/pantallas.py` | 16 pantallas de escritorio + 6 móviles | Flujos principales en el navegador, en escritorio (1280×900) y en móvil (375×812, táctil) | Completo, sin errores de consola |
| `pruebas/carga/carga.mjs` | 3 escenarios | Rendimiento contra el sistema en Docker | 0 % de error |

### Evidencia en móvil

El recorrido repite seis pantallas en un teléfono emulado (375×812, táctil), contra el mismo sistema en Docker y las mismas APIs: inicio, menú, checkout, seguimiento del pedido, mis pedidos y despacho (`pantallas/m01-inicio-movil.png` a `m06-despacho-movil.png`). Para cada una el script comprueba que no hay scroll horizontal (`desbordeHorizontalMovil` en `pantallas/recorrido.json`: las seis en `false`). Los flujos de cocina y administración se verificaron solo en escritorio; el resto de los flujos se comparten entre ambos tamaños, porque es la misma SPA con diseño responsivo.

Además, `pruebas/e2e/movil.py` recorre en móvil (390×812, táctil, escala 2) una compra completa por HTTPS: inicio, menú, ingreso, checkout, pago, pasarela, pedido pagado con boleta e historial (`evidencias/movil/01-inicio.png` a `08-mis-pedidos.png`). Comprueba que todas las pantallas se sirven por HTTPS y que ninguna tiene scroll horizontal (`evidencias/movil/recorrido.json`), con 0 errores de consola. Es emulación de teléfono en Chromium, no un dispositivo real.

### Evidencia en navegador real

`evidencias/navegador-real/` tiene 8 capturas de una compra completa hecha en Microsoft Edge por HTTPS (pedido PF-00086, pago aprobado en la pasarela de `https://localhost:9000`, boleta N° 83) y `datos-navegador.json` con el navegador, el protocolo, las URLs visitadas y la cabecera HSTS. Las capturas muestran la página y no la barra de direcciones; el protocolo consta en ese archivo. Antes de capturar se aceptó a mano la advertencia que el antivirus muestra por el certificado de prueba.

### Capturas de la ejecución

Todas salen del sistema levantado en Docker, por HTTPS, con datos ficticios. Las de escritorio y las del teléfono emulado las generan `pruebas/e2e/pantallas.py` y `pruebas/e2e/movil.py`; las del navegador real se tomaron a mano en Edge. Las tres capturas de la sección 8 (pedido con pagos, vista del administrador y reportes) no se repiten aquí.

#### Escritorio (Chromium, 1280×900): compra, cocina, despacho y administración

![Inicio: la tienda pública](evidencias/pantallas/01-inicio.png)
![Menú cargado desde el servicio de inventario](evidencias/pantallas/02-menu-desde-inventario.png)

![Confirmar pedido: solo se manda la selección](evidencias/pantallas/03-checkout.png)
![Pago: el pedido queda pendiente hasta que la pasarela confirme](evidencias/pantallas/04-pago.png)

![Pasarela de pago simulada (Servipag), en el puerto 9000](evidencias/pantallas/05-pasarela-servipag.png)

![Cocina: cola de pedidos pagados, en orden de llegada](evidencias/pantallas/07-cocina.png)
![Despacho: pedidos listos para entregar](evidencias/pantallas/08-despacho.png)

![Seguimiento: el pedido en estado Entregado, con su boleta](evidencias/pantallas/09-seguimiento-entregado.png)

![Mis pedidos: historial del cliente](evidencias/pantallas/10-mis-pedidos.png)

![Administración: productos y stock](evidencias/pantallas/12-productos-stock.png)
![Administración: clientes](evidencias/pantallas/13-clientes.png)

![Registro: verificación de correo (modo demo)](evidencias/pantallas/15-verificacion-correo.png)
![Cliente nuevo con sesión iniciada](evidencias/pantallas/16-cliente-nuevo-con-sesion.png)

#### Teléfono emulado (Chromium, 390×812, táctil): compra completa

![Inicio](evidencias/movil/01-inicio.png)
![Menú](evidencias/movil/02-menu.png)
![Ingreso](evidencias/movil/03-ingreso.png)
![Checkout](evidencias/movil/04-checkout.png)

![Pago](evidencias/movil/05-pago.png)
![Pasarela Servipag](evidencias/movil/06-pasarela-servipag.png)
![Pedido pagado con boleta](evidencias/movil/07-pedido-pagado.png)
![Mis pedidos](evidencias/movil/08-mis-pedidos.png)

Es una emulación en Chromium, no un teléfono real.

#### Navegador real (Microsoft Edge): compra completa por HTTPS

![Inicio](evidencias/navegador-real/01-inicio.jpg)
![Menú](evidencias/navegador-real/02-menu.jpg)

![Ingreso](evidencias/navegador-real/03-ingreso.jpg)
![Checkout](evidencias/navegador-real/04-checkout.jpg)

![Pago](evidencias/navegador-real/05-pago.jpg)
![Pasarela de pago en https://localhost:9000](evidencias/navegador-real/06-pasarela-servipag.jpg)

![Pedido pagado](evidencias/navegador-real/07-pedido-pagado.jpg)
![Mis pedidos](evidencias/navegador-real/08-mis-pedidos.jpg)

Las capturas muestran la página y no la barra de direcciones; el protocolo consta en `evidencias/navegador-real/datos-navegador.json`.

### Matriz requisito, pantalla, servicio, prueba y evidencia

| Req. | Pantalla | Servicio | Prueba | Resultado | Evidencia |
|---|---|---|---|---|---|
| R1 | Menú, Arma tu bowl | inventario (S01 a S03) | `test_catalogo_publico...`, `test_cotizacion...`, caso 7.1 | OK | `pantallas/02-menu-desde-inventario.png` |
| R2 | Arma tu bowl | inventario (S03) | `test_reglas_de_armado...`, caso 10.1 | OK | e2e 10.1 |
| R3 | Promo | inventario (S03) | `test_crear_pedido_calcula_total...` (cotizador de promos en `reglas.py`) | OK | — |
| R4 | Carrito | frontend + inventario (S03, S15) | recorrido de pantallas | OK | `pantallas/03-checkout.png` |
| R5 | Registro, Verificar | clientes + Auth (S07, S38, S39) | `test_registro_crea_ficha...`, `cuenta nueva de cliente...` | OK | `pantallas/15-verificacion-correo.png`, `16-...` |
| R6 | Ingresar, Panel | Auth + gateway (S33 a S36, S40 a S43) | casos 7.3, 7.8, 7.11 | OK | e2e |
| R7 | Confirmar pedido | pedidos + clientes (S15) | `test_despacho_fuera_de_radio`, caso 10.1 | OK | e2e 10.1 |
| R8 | Pago, Pedido, Boleta | pagos + pasarela + pedidos + ActiveMQ (S27, S29, S18) | `test_pago_completo_por_la_pasarela`, casos 7.6, 10.2, 10.3 | OK | `pantallas/04` a `06`; log del notificador |
| R9 | Cocina | pedidos (S16, S20, S21, S24) | `test_flujo_de_cocina_y_despacho...`, caso 10.4 | OK | `pantallas/07-cocina.png` |
| R10 | Despacho | pedidos (S22, S23) | caso 10.4 | OK | `pantallas/08-despacho.png`, `09-...` |
| R11 | Pedido, Panel pedidos | pedidos + pagos + inventario (S25) | `test_anular_pedido_pagado...`, `test_no_se_anula...`, casos 10.5, 10.6 | OK | e2e |
| R12 | Productos, Clientes, Usuarios | inventario, clientes, Auth (S04 a S06, S10 a S14, S40 a S43) | `test_solo_admin_elimina...`, `test_admin_registra_en_local...`, `solo un admin gestiona usuarios...` | OK | `pantallas/12`, `13` |
| R13 | Caja, Reportes | pedidos + GraphQL (S26, S32) | `test_reporte_de_ventas...`, caso 8.3 | OK | `pantallas/11-reportes-graphql.png` |
| R14 | Pedido, Mis pedidos, Boleta | pedidos + GraphQL (S08, S09, S16 a S18, S30) | caso 7.5, 8.1 | OK | `pantallas/09`, `10` |

### Ejemplo de autorización por pedido

Con la misma regla ("un cliente solo ve sus pedidos", aplicada por el servicio de pedidos):

- **Autorizada:** la cliente `cli_demo_1` pide `GET /api/v1/pedidos/PF-00081` → `200` con su pedido.
- **Denegada:** el cliente `cli_demo_2` pide lo mismo → `404 NO_ENCONTRADO`, sin datos del pedido (no confirma ni que existe). Por GraphQL, `resumenPedido` responde `null`.

Ambas en el caso 7.5 (`evidencias/e2e-resultados.json`, con sus `X-Request-Id`, que se pueden buscar en `docker compose logs pedidos`).

### Operación

- **Iniciar y detener:** ver `README.md` (`docker compose up -d --build`, `docker compose down`).
- **Acceso:** `https://localhost:8080` (tienda y API) y `https://localhost:9000` (pasarela). Los certificados los firma una CA de prueba que crea `tls-init`, así que el navegador, o un antivirus que revise HTTPS, mostrará una advertencia en cada puerto; hay que aceptarla en ambos. Si otro programa ocupa el puerto 8080 en IPv4, hay que detenerlo (ver README).
- **Configurar secretos:** solo `.env` con la clave raíz de Mongo; el resto lo crea `vault-init`. Para rotar un secreto: borrarlo en Vault y volver a correr `docker compose up -d` (excepto el pepper).
- **Datos de prueba:** automáticos con `MODO_DEMO=true` (servicio `semilla`).
- **Health checks:** cada servicio tiene `/salud` (estado de Mongo y Vault), usado por Docker; `GET /api/salud` reúne todos.
- **Logs:** una línea por petición con método, ruta, estado, duración, rol y `X-Request-Id`; sin cuerpos, correos ni tokens.
- **Dependencias versionadas:** `package-lock.json` en cada proyecto Node, versiones fijas en `servicios/requirements.txt`, imágenes con versión (`mongo:7.0`, `hashicorp/vault:1.18`, `apache/activemq-classic:6.1.4`).

---

## Anexo A. Ejemplos de contrato por operación

La sección 1 muestra el ejemplo completo de S01, S07, S15, S20, S22, S25, S27, S29 y S33. Este anexo agrega uno para cada operación restante, de modo que las 44 tienen petición y respuesta con datos ficticios. En todos, los errores tienen la forma `{"codigo": "...", "mensaje": "...", "idPeticion": "..."}` y los códigos de la matriz del módulo 1. Se abrevian con `...` los campos que ya se mostraron en otro ejemplo. S30 (`resumenPedido`) tiene su consulta y su respuesta completas en la sección 8.

### Catálogo (inventario)

**S02, obtener un producto** (anónimo).

```http
GET /api/v1/catalogo/items/pro_atun
```
```json
200 {"id": "pro_atun", "categoria": "PROTEINA", "nombre": "Atún", "descripcion": "Grado sashimi, corte del día", "precio": 1500, "disponible": true}
404 {"codigo": "NO_ENCONTRADO", "mensaje": "No existe el item pro_zzz.", "idPeticion": "e2e-4c1d9a0b7e2f"}
```

**S03, reglas del armado** (anónimo).

```http
GET /api/v1/catalogo/configuracion
```
```json
200 {"tamanos": [{"id": "regular", "nombre": "Regular", "descripcion": "Porción individual", "precio": 6990, "salsasIncluidas": 2, "toppingsIncluidos": 3}, ...],
     "reglas": {"basesIncluidas": 1, "maxBases": 3, "recargoBaseExtra": 500, "proteinasIncluidas": 1, "maxProteinas": 3, "recargoProteinaExtra": 2500, ...},
     "promos": {"promo_combo": {"bowls": 1, "bebida": true, "tamanoId": "regular", "detalle": "Arma tu bowl regular y elige tu bebida."}, ...}}
```

**S04, crear un producto** (admin o dueño). Con rol de administración la respuesta incluye `stock` y `activo`.

```http
POST /api/v1/catalogo/items
{"categoria": "TOPPING", "nombre": "Cebolla crispy", "descripcion": "Crocante, para dar textura", "precio": 700, "stock": 50, "disponible": true}
```
```json
201 {"id": "top_cebolla_crispy", "categoria": "TOPPING", "nombre": "Cebolla crispy", "descripcion": "Crocante, para dar textura", "precio": 700, "disponible": true, "stock": 50, "activo": true}
409 {"codigo": "DUPLICADO", "mensaje": "Ya existe un item llamado \"Cebolla crispy\".", "idPeticion": "..."}
```

**S05, modificar un producto** (admin o dueño). Solo se mandan los campos que cambian.

```http
PUT /api/v1/catalogo/items/top_cebolla_crispy
{"precio": 800, "stock": 40}
```
```json
200 {"id": "top_cebolla_crispy", "categoria": "TOPPING", "nombre": "Cebolla crispy", ..., "precio": 800, "disponible": true, "stock": 40, "activo": true}
```

**S06, eliminar un producto** (solo admin).

```http
DELETE /api/v1/catalogo/items/top_cebolla_crispy
```
```json
204 (sin cuerpo)
403 {"codigo": "PROHIBIDO", "mensaje": "Tu perfil no tiene permiso para esta operación.", "idPeticion": "..."}   (si es dueño)
```

### Clientes

**S08, ver la ficha propia** (cliente).

```http
GET /api/v1/clientes/yo
```
```json
200 {"id": "cli_3fa9c01b22de", "run": "12345678-5", "nombre": "Ana Prueba Soto", "direccion": "Av. Italia 1500", "region": "Región Metropolitana de Santiago", "provincia": "Santiago", "comuna": "Ñuñoa", "fechaNacimiento": "1995-03-10", "sexo": "F", "email": "ana.prueba@correo.cl", "telefono": "+56 9 1111 2222", "activo": true, "origen": "WEB", "creadoEn": "2026-11-08T14:02:11.000Z", "tieneDespacho": true}
```

**S09, editar la ficha propia** (cliente). El `run` y el `origen` no se pueden cambiar.

```http
PUT /api/v1/clientes/yo
{"direccion": "Av. Italia 1520", "telefono": "+56 9 1111 3333"}
```
```json
200 {"id": "cli_3fa9c01b22de", ..., "direccion": "Av. Italia 1520", "telefono": "+56 9 1111 3333", ...}
```

**S10, listar y buscar clientes** (admin).

```http
GET /api/v1/clientes?q=ana
```
```json
200 [{"id": "cli_3fa9c01b22de", "run": "12345678-5", "nombre": "Ana Prueba Soto", "direccion": "Av. Italia 1500", "region": "Región Metropolitana de Santiago", "provincia": "Santiago", "comuna": "Ñuñoa", "fechaNacimiento": "1995-03-10", "sexo": "F", "email": "ana.prueba@correo.cl", "telefono": "+56 9 1111 2222", "activo": true, "origen": "WEB", "creadoEn": "2026-11-08T14:02:11.000Z", "tieneDespacho": true, "emailVerificado": true}]
```

**S11, registrar un cliente en el local** (admin). La clave temporal se entrega una sola vez y solo en modo demo.

```http
POST /api/v1/clientes
{"run": "9.876.543-3", "nombre": "Luis Prueba Rojas", "direccion": "Av. Providencia 100", "region": "Región Metropolitana de Santiago", "provincia": "Santiago", "comuna": "Providencia", "fechaNacimiento": "1988-07-21", "sexo": "M", "email": "luis.prueba@correo.cl", "telefono": "+56 9 2222 3333"}
```
```json
201 {"cliente": {"id": "cli_7be41c0d93aa", "run": "9876543-3", "nombre": "Luis Prueba Rojas", ..., "origen": "ADMIN", "emailVerificado": false}, "claveTemporal": "kmpa4821"}
```

**S12, abrir una ficha** (admin).

```http
GET /api/v1/clientes/cli_3fa9c01b22de
```
```json
200 {"id": "cli_3fa9c01b22de", "run": "12345678-5", "nombre": "Ana Prueba Soto", "direccion": "Av. Italia 1500", "region": "Región Metropolitana de Santiago", "provincia": "Santiago", "comuna": "Ñuñoa", "fechaNacimiento": "1995-03-10", "sexo": "F", "email": "ana.prueba@correo.cl", "telefono": "+56 9 1111 2222", "activo": true, "origen": "WEB", "creadoEn": "2026-11-08T14:02:11.000Z", "tieneDespacho": true}
404 {"codigo": "NO_ENCONTRADO", "mensaje": "No existe ese cliente.", "idPeticion": "..."}
```

**S13, editar una ficha** (admin).

```http
PUT /api/v1/clientes/cli_3fa9c01b22de
{"telefono": "+56 9 7000 1111"}
```
```json
200 {"id": "cli_3fa9c01b22de", ..., "telefono": "+56 9 7000 1111", ...}
```

**S14, activar o desactivar** (admin). Al desactivar se cierran las sesiones del cliente.

```http
PATCH /api/v1/clientes/cli_3fa9c01b22de/estado
{"activo": false}
```
```json
200 {"id": "cli_3fa9c01b22de", ..., "activo": false, ...}
```

### Pedidos

**S16, cola de cocina** (cocina). Cocina recibe del cliente solo el nombre y el teléfono.

```http
GET /api/v1/pedidos?cola=cocina
```
```json
200 [{"id": "PF-00084", "estado": "PAGADO", "modoEntrega": "DELIVERY", "total": 7890, "cliente": {"nombre": "Javiera Morales Díaz", "telefono": "+56 9 8123 4567"},
      "lineas": [{"descripcion": "Bowl Regular: Arroz gohan, Salmón fresco, Ponzu, Palta", "cantidad": 1, "subtotal": 7890, ...}], "historial": [...]}]
```

**S17, abrir un pedido** (el cliente dueño; para el cliente el historial no trae quién hizo cada paso).

```http
GET /api/v1/pedidos/PF-00084
```
```json
200 {"id": "PF-00084", "estado": "PAGADO", "total": 7890, ..., "historial": [{"estado": "PENDIENTE_PAGO", "fecha": "2026-11-08T03:15:01.120Z"}, {"estado": "PAGADO", "fecha": "2026-11-08T03:16:40.502Z"}]}
404 {"codigo": "NO_ENCONTRADO", "mensaje": "No encontramos ese pedido.", "idPeticion": "..."}   (ajeno o inexistente: igual respuesta)
```

**S18, ver la boleta** (cliente dueño, admin o dueño).

```http
GET /api/v1/pedidos/boleta/79
```
```json
200 {"id": "PF-00084", "estado": "PAGADO", "total": 7890,
     "venta": {"numero": 79, "caja": "CAJA-WEB-01", "cajero": "Cajero virtual", "fecha": "2026-11-08T03:16:40.502Z", "total": 7890, "anulada": false},
     "boleta": {"numero": 79, "fecha": "2026-11-08T03:16:40.502Z", "neto": 6630, "iva": 1260, "total": 7890, "enviadaA": "cliente@correo.cl"}, ...}
404 {"codigo": "NO_ENCONTRADO", "mensaje": "No encontramos esa boleta.", "idPeticion": "..."}
```

**S19, configuración de pedidos** (con sesión; sin pantalla).

```http
GET /api/v1/pedidos/configuracion
```
```json
200 {"estados": {"PENDIENTE_PAGO": "Pendiente de pago", "PAGADO": "Esperando cocina", ...}, "choferes": ["Luis Contreras", "Andrea Muñoz"], "caja": "CAJA-WEB-01", "cajero": "Cajero virtual"}
```

**S21, marcar el pedido listo** (cocina).

```http
POST /api/v1/pedidos/PF-00084/terminar
```
```json
200 {"id": "PF-00084", "estado": "LISTO_DESPACHO", ...}
409 {"codigo": "ESTADO", "mensaje": "...", "idPeticion": "..."}   (si no estaba en preparación)
```

**S23, registrar la entrega** (despacho).

```http
POST /api/v1/pedidos/PF-00084/entregar
```
```json
200 {"id": "PF-00084", "estado": "ENTREGADO", ...}
```

**S24, registrar que se imprimió la orden** (cocina o despacho).

```http
POST /api/v1/pedidos/PF-00084/impresa
```
```json
204 (sin cuerpo)
```

**S26, reporte de ventas** (admin o dueño). El CSV se arma en el frontend con esta respuesta.

```http
GET /api/v1/reportes/ventas?desde=2026-11-02&hasta=2026-11-08
```
```json
200 {"desde": "2026-11-02", "hasta": "2026-11-08", "cantidad": 22, "monto": 229150, "promedio": 10416, "anuladas": 0, "montoAnulado": 0,
     "porDia": [{"dia": "2026-11-02", "cantidad": 3, "monto": 24500}, ...], "porEntrega": [{"modo": "DELIVERY", "nombre": "Despacho a domicilio", "cantidad": 11, "monto": 108180}, ...],
     "masVendidos": [...], "ventas": [...]}
400 {"codigo": "...", "mensaje": "Indica las fechas como AAAA-MM-DD.", "idPeticion": "..."}
```

### Pagos

**S28, pagos de un pedido** (sin pantalla). El `token` de la pasarela no sale.

```http
GET /api/v1/pagos?pedidoId=PF-00084
```
```json
200 [{"id": "PAG-07A5E9CF2BEF", "pedidoId": "PF-00084", "monto": 7890, "medio": "SERVIPAG", "estado": "APROBADO", "referencia": "SVP-99801681", "creadoEn": "2026-11-08T03:16:02.000Z", "actualizadoEn": "2026-11-08T03:16:40.000Z", "urlPago": null}]
```

### Agregaciones GraphQL

**S31, historial paginado** (cliente; sin pantalla).

```http
POST /api/v1/graphql
{"query": "query ($n: Int) { misPedidos(primeros: $n) { nodos { id estadoTexto total } siguiente } }", "variables": {"n": 2}}
```
```json
200 {"data": {"misPedidos": {"nodos": [{"id": "PF-00084", "estadoTexto": "Esperando cocina", "total": 7890}, {"id": "PF-00081", "estadoTexto": "Entregado", "total": 7890}], "siguiente": "eyJ..."}}}
```

**S32, reporte con categorías y conciliación** (admin o dueño).

```http
POST /api/v1/graphql
{"query": "{ reporteVentas(desde: \"2026-11-02\", hasta: \"2026-11-08\") { cantidad monto porCategoria { categoria unidades } conciliacion { ventas pagosAprobados pedidosConDiferencia } } }"}
```
```json
200 {"data": {"reporteVentas": {"cantidad": 22, "monto": 229150, "porCategoria": [{"categoria": "BASE", "unidades": 25}, ...], "conciliacion": {"ventas": 22, "pagosAprobados": 22, "pedidosConDiferencia": []}}}}
```
Para un cocina: `{"data": {"reporteVentas": null}, "errors": [{"message": "Tu perfil no puede consultar este dato.", "extensions": {"code": "PROHIBIDO"}}]}`.

### Sesión y cuentas

**S34, cerrar sesión.**

```http
POST /api/v1/auth/logout
Cookie: pf_sesion=<token>
```
```json
204 (sin cuerpo; la cookie se borra y el token queda revocado)
```

**S35, saber quién tiene sesión.**

```http
GET /api/v1/auth/sesion
```
```json
200 {"tipo": "CLIENTE", "id": "cli_demo_1", "perfil": "CLIENTE", "nombre": "Javiera Morales Díaz", "email": "cliente@correo.cl", "expira": "2026-11-08T03:45:01.000Z"}
200 null   (sin sesión: no es un error)
```

**S36, modo demostración.**

```http
GET /api/v1/auth/config
```
```json
200 {"modoDemo": true, "cuentasDemo": [{"perfil": "Cliente", "email": "cliente@correo.cl", "clave": "Cliente2026"}, ...]}
200 {"modoDemo": false, "cuentasDemo": []}
```

**S37, cambiar la contraseña** (con sesión).

```http
PUT /api/v1/auth/clave
{"actual": "Cliente2026", "nueva": "OtraClave2027"}
```
```json
204 (sin cuerpo)
400 {"codigo": "CLAVE_ACTUAL", "mensaje": "La contraseña actual no es correcta.", "idPeticion": "..."}
```

**S38, verificar el correo.**

```http
POST /api/v1/auth/verificar
{"email": "ana.prueba@correo.cl", "codigo": "482915"}
```
```json
200 {"verificado": true}
400 {"codigo": "CODIGO", "mensaje": "El código no coincide. Revisa el correo más reciente.", "idPeticion": "..."}
```

**S39, pedir un código nuevo.** La respuesta es la misma exista o no la cuenta.

```http
POST /api/v1/auth/reenviar
{"email": "ana.prueba@correo.cl"}
```
```json
200 {"mensaje": "Si el correo está registrado y sin verificar, enviamos un código nuevo.", "codigoDemo": "731540"}
```

### Usuarios internos

**S40, listar** (admin). Sin hash ni datos de verificación.

```http
GET /api/v1/usuarios
```
```json
200 [{"id": "6d0b8e47-12af-4c93-8b55-9f3e2a7c1d60", "email": "admin@pokefresh.cl", "rol": "admin", "nombre": "Camila Rojas", "activo": true, "emailVerificado": true, "creadoEn": "2026-11-08T14:20:00.000Z"}, ...]
```

**S41, crear** (admin).

```http
POST /api/v1/usuarios
{"nombre": "Pedro Soto", "email": "pedro@pokefresh.cl", "rol": "cocina", "clave": "Cocina2027"}
```
```json
201 {"id": "a3f1c9e2-5b7d-4c6a-9e10-2f8d7b6c4a11", "email": "pedro@pokefresh.cl", "rol": "cocina", "nombre": "Pedro Soto", "activo": true, "emailVerificado": true, "creadoEn": "2026-11-08T14:20:00.000Z"}
400 {"codigo": "CLAVE_DEBIL", "mensaje": "La contraseña debe combinar letras y números.", "idPeticion": "..."}
```

**S42, editar** (admin). Cambiar la clave o el perfil cierra las sesiones de ese usuario.

```http
PUT /api/v1/usuarios/a3f1c9e2-5b7d-4c6a-9e10-2f8d7b6c4a11
{"nombre": "Pedro Soto Vera", "rol": "despacho"}
```
```json
200 {"id": "a3f1c9e2-5b7d-4c6a-9e10-2f8d7b6c4a11", "email": "pedro@pokefresh.cl", "rol": "despacho", "nombre": "Pedro Soto Vera", "activo": true, "emailVerificado": true, "creadoEn": "2026-11-08T14:20:00.000Z"}
400 {"codigo": "ULTIMO_ADMIN", "mensaje": "Debe quedar al menos un administrador activo.", "idPeticion": "..."}
```

**S43, activar o desactivar** (admin).

```http
PATCH /api/v1/usuarios/a3f1c9e2-5b7d-4c6a-9e10-2f8d7b6c4a11/estado
{"activo": false}
```
```json
200 {"id": "a3f1c9e2-5b7d-4c6a-9e10-2f8d7b6c4a11", ..., "activo": false, ...}
400 {"codigo": "PROPIA_CUENTA", "mensaje": "No puedes desactivar tu propia cuenta.", "idPeticion": "..."}
```

### Estado del sistema

**S44, salud** (anónimo; sin datos personales).

```http
GET /api/salud
```
```json
200 {"gateway": "ok", "vault": "ok", "auth": "ok", "graphql": "ok", "inventario": "ok", "clientes": "ok", "pedidos": "ok", "pagos": "ok"}
503 {"gateway": "ok", "vault": "sin respuesta", ...}   (si algo no responde)
```
