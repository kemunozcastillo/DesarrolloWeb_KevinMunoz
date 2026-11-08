workspace "Poke Fresh" "Backend seguro de Poke Fresh (caso 24), modelado en C4 con Structurizr DSL." {

    // Adaptacion del modelo de referencia "PlataformaComercial_Despliegue.dsl" a la implementacion
    // entregada (docker-compose.yml). Todo lo que aparece aqui existe en el repositorio:
    // los nombres de los componentes citan el archivo donde viven. Se abre en https://structurizr.com/dsl
    // o con el CLI de Structurizr (structurizr-cli validate -workspace poke-fresh.dsl).
    // Las relaciones de respuesta son explicitas porque las vistas dinamicas las siguen paso a paso.

    !identifiers hierarchical

    model {
        visitante = person "Visitante" "Persona que mira el menu y arma un bowl sin iniciar sesion."
        cliente = person "Cliente" "Persona registrada que compra, paga y sigue sus pedidos."
        personal = person "Personal del local" "Cocina, despacho, administrador y dueno; cada rol ve solo lo suyo."

        servipag = softwareSystem "Pasarela de pago (Servipag)" "Proveedor externo. En el proyecto lo simula servicios/pasarela con el mismo contrato: API key, pagina de pago, notificacion firmada con HMAC, reintentos y devoluciones." {
            tags "SistemaExterno"
        }

        sistema = softwareSystem "Poke Fresh" "Tienda web de poke bowls con retiro en local y despacho a 3 km: catalogo, pedidos, pagos y operacion de cocina y despacho." {
            tags "SistemaEvaluado"

            frontend = container "Frontend responsivo" "SPA en HTML, CSS y JavaScript sin frameworks; la sirve el API Gateway." "frontend/" {
                tags "Frontend"
            }

            apiGateway = container "API Gateway" "Unica entrada a la API (puerto 8080): sirve el frontend, valida sesion, rol, origen y limites, y reenvia solo las rutas de la matriz." "Node, Express (gateway/)" {
                tags "Gateway"

                // C3 - Componentes internos del API Gateway.
                httpEntry = component "Entrada HTTP y frontend" "Recibe las peticiones, asigna X-Request-Id y sirve los archivos estaticos con CSP." "gateway/src/app.js" {
                    tags "EntradaC3"
                }
                limitsAndOrigin = component "Limites y origen" "Limite de peticiones por IP y por minuto, rechazo de origenes ajenos (CSRF) y tamano maximo del cuerpo." "gateway/src/limites.js, app.js" {
                    tags "ControlC3"
                }
                sessionPolicy = component "Politica de sesion" "Login con cookie HttpOnly y SameSite, introspeccion de la sesion en cada peticion, logout." "gateway/src/sesion.js, cliente-auth.js" {
                    tags "ControlC3"
                }
                routeMatrix = component "Matriz de rutas y roles" "Lista explicita de rutas, verbos y roles permitidos; lo que no esta responde 404. Las rutas internas no se publican." "gateway/src/rutas.js" {
                    tags "AplicacionC3"
                }
                forwarder = component "Reenvio a servicios" "Arma cabeceras nuevas (descarta X-Usuario-* y credenciales del navegador), agrega la credencial interna del destino y la identidad verificada." "gateway/src/reenvio.js" {
                    tags "IntegracionC3"
                }
                secretProvider = component "Proveedor de secretos" "Lee de Vault con el token del gateway y guarda lo leido 30 segundos." "gateway/src/vault.js" {
                    tags "IntegracionC3"
                }
                errorMapper = component "Traductor de errores" "502 si el servicio no responde, 504 si tarda mas de 8 s, 503 si Vault no esta disponible; sin detalles internos." "gateway/src/reenvio.js" {
                    tags "ErrorC3"
                }
            }

            authService = container "Auth Service" "Cuentas, contrasenas, sesiones, introspeccion y verificacion de correo. Lo llaman solo el gateway y clientes, cada uno con su secreto." "Node, Express (auth-service/)" {
                tags "Seguridad"

                // C3 - Componentes internos del Auth Service.
                identityApi = component "API de identidad" "login, introspect, logout, cambio de clave, verificacion de correo y usuarios internos." "auth-service/src/app.js" {
                    tags "EntradaC3"
                }
                sessionStore = component "Almacen de sesiones" "Token aleatorio de 256 bits sin contenido; vigencia, revocacion y cierre al desactivar una cuenta." "auth-service/src/sesiones.js" {
                    tags "AplicacionC3"
                }
                credentialsVerifier = component "Verificador de credenciales" "Hash adaptativo scrypt con sal por cuenta y pepper de Vault; bloqueo tras 5 intentos." "auth-service/src/claves.js" {
                    tags "ControlC3"
                }
                accountsRepo = component "Repositorio de cuentas" "Correo, rol, a quien representa y hash de la clave; nunca la clave ni el codigo en claro." "auth-service/src/cuentas.js" {
                    tags "PersistenciaC3"
                }
                secretsClient = component "Cliente de secretos" "Obtiene de Vault el pepper y las credenciales de sus dos clientes." "auth-service/src/vault.js" {
                    tags "IntegracionC3"
                }
            }

            secretManager = container "HashiCorp Vault" "Guarda los secretos (KV v2). Cada servicio tiene su token con una politica de solo lectura sobre sus rutas." "Vault 1.18" {
                tags "Seguridad"
            }

            graphqlGateway = container "GraphQL Gateway" "Agregaciones de solo lectura (resumen de pedido y reportes). Esta detras del API Gateway: hereda sesion, limites y CSRF." "Node, Apollo Server 4 (graphql-gateway/)" {
                tags "Gateway"

                // C3 - Componentes internos del GraphQL Gateway.
                graphqlEndpoint = component "Endpoint GraphQL" "Recibe la operacion con la credencial interna de graphql y la identidad ya verificada." "graphql-gateway/src/app.js" {
                    tags "EntradaC3"
                }
                queryLimits = component "Limites de consulta" "Rechaza antes de ejecutar las consultas demasiado profundas o de costo alto, y las paginas mayores a 50." "graphql-gateway/src/graphql/limiteProfundidad.js, limiteCosto.js" {
                    tags "ControlC3"
                }
                fieldAccess = component "Autorizacion por campo" "Niega los campos que el rol no puede ver (por ejemplo, datos del cliente al propio cliente)." "graphql-gateway/src/graphql/resolvers.js" {
                    tags "ControlC3"
                }
                resolvers = component "Resolvers" "Resuelven resumenPedido, misPedidos y reporteVentas combinando varios servicios." "graphql-gateway/src/graphql/resolvers.js" {
                    tags "AplicacionC3"
                }
                serviceConnectors = component "Conectores de servicios" "Llaman a pedidos, pagos, inventario y clientes con su credencial y la identidad del usuario; agrupan las llamadas repetidas." "graphql-gateway/src/servicios.js" {
                    tags "IntegracionC3"
                }
                responseComposer = component "Compositor de respuestas" "Conserva el error de un campo sin presentar un resultado parcial como completo." "graphql-gateway/src/graphql/resolvers.js" {
                    tags "ErrorC3"
                }
            }

            inventory = container "inventario" "Catalogo, precios, reglas de armado, cotizacion, stock y reservas. Es la autoridad del precio." "Python, FastAPI (servicios/inventario)" {
                tags "Privado"
            }

            clients = container "clientes" "Ficha del cliente (RUN, direccion, contacto). Solo el dueno de la ficha y el personal autorizado la ven." "Python, FastAPI (servicios/clientes)" {
                tags "Privado"
            }

            orders = container "pedidos" "Ciclo de vida del pedido, estados, venta, boleta, colas de cocina y despacho y reporte. Decide quien ve cada pedido." "Python, FastAPI (servicios/pedidos)" {
                tags "Privado"

                // C3 - Componentes internos de pedidos.
                ordersApi = component "API de pedidos" "Recibe las llamadas del gateway, del GraphQL Gateway y la confirmacion de pagos." "servicios/pedidos/main.py" {
                    tags "EntradaC3"
                }
                accessPolicy = component "Politica de acceso a pedidos" "Rol y pertenencia: un cliente solo ve sus pedidos; si no, 404 sin confirmar que existe." "servicios/pedidos/main.py (puede_ver)" {
                    tags "ControlC3"
                }
                idempotency = component "Control de idempotencia" "Indice unico por clave: un doble clic devuelve el mismo pedido." "servicios/pedidos/main.py (crear_pedido)" {
                    tags "ControlC3"
                }
                orderWorkflow = component "Reglas del pedido" "Calcula el total en el servidor, controla las transiciones de estado y registra quien hizo cada paso." "servicios/pedidos/main.py" {
                    tags "AplicacionC3"
                }
                inventoryAdapter = component "Adaptador de inventario" "Cotiza con los precios del servidor y reserva o libera stock." "servicios/comun/internos.py" {
                    tags "IntegracionC3"
                }
                clientsAdapter = component "Adaptador de clientes" "Consulta la ficha para validar la comuna de despacho." "servicios/comun/internos.py" {
                    tags "IntegracionC3"
                }
                paymentAdapter = component "Adaptador de pagos" "Consulta el pago de un pedido y pide la devolucion al anular." "servicios/comun/internos.py" {
                    tags "IntegracionC3"
                }
                eventPublisher = component "Publicador de eventos" "Publica la boleta y el aviso a cocina en las colas de ActiveMQ." "servicios/pedidos/eventos.py" {
                    tags "IntegracionC3"
                }
                ordersRepo = component "Repositorio de pedidos" "Persiste pedidos, contadores y claves de operacion." "servicios/pedidos/main.py" {
                    tags "PersistenciaC3"
                }
            }

            payments = container "pagos" "Inicio del pago, comprobacion del resultado y relacion con el proveedor. Idempotente; es el unico servicio privado que sale a la red externa." "Python, FastAPI (servicios/pagos)" {
                tags "Privado"
            }

            broker = container "ActiveMQ" "Mensajeria asincrona (STOMP): colas de correos y de cocina." "ActiveMQ Classic 6" {
                tags "Mensajeria"
            }

            notifier = container "notificador" "Consume las colas; en modo demo deja la boleta y el aviso en su log en vez de enviar correo." "Python, stomp.py (servicios/notificador)" {
                tags "Privado"
            }

            dbAuth = container "Datos de identidad" "Base pf_auth: cuentas. Las sesiones viven en memoria del Auth Service." "MongoDB (usuario propio)" {
                tags "BaseDatos"
            }

            dbInventory = container "Datos de inventario" "Base pf_inventario: items y reservas." "MongoDB (usuario propio)" {
                tags "BaseDatos"
            }

            dbClients = container "Datos de clientes" "Base pf_clientes: fichas." "MongoDB (usuario propio)" {
                tags "BaseDatos"
            }

            dbOrders = container "Datos de pedidos" "Base pf_pedidos: pedidos y contadores." "MongoDB (usuario propio)" {
                tags "BaseDatos"
            }

            dbPayments = container "Datos de pagos" "Base pf_pagos: pagos." "MongoDB (usuario propio)" {
                tags "BaseDatos"
            }
        }

        // ---------------------------------------------------------------------------
        // Relaciones de contexto (C1)
        // ---------------------------------------------------------------------------
        visitante -> sistema "Mira el menu y arma un bowl"
        cliente -> sistema "Compra, paga y sigue sus pedidos"
        personal -> sistema "Prepara, despacha y administra segun su rol"
        sistema -> servipag "Crea ordenes de pago y recibe la notificacion firmada" "HTTP + API key"
        servipag -> sistema "Notifica el resultado del pago" "HTTP + firma HMAC"
        cliente -> servipag "Paga en la pagina del proveedor" "Navegador web"

        // ---------------------------------------------------------------------------
        // Relaciones entre actores, contenedores y sistemas
        // ---------------------------------------------------------------------------
        visitante -> sistema.frontend "Mira el menu" "Navegador web"
        cliente -> sistema.frontend "Compra y sigue sus pedidos" "Navegador web"
        personal -> sistema.frontend "Opera segun su rol" "Navegador web"
        sistema.frontend -> sistema.apiGateway "Envia las solicitudes de la interfaz" "HTTP + cookie HttpOnly (HTTPS en produccion)"

        sistema.apiGateway -> sistema.authService "Login e introspeccion de la sesion" "HTTP/JSON, Basic"
        sistema.apiGateway -> sistema.inventory "Enruta catalogo y stock" "HTTP/JSON, credencial interna"
        sistema.apiGateway -> sistema.clients "Enruta fichas de clientes" "HTTP/JSON, credencial interna"
        sistema.apiGateway -> sistema.orders "Enruta pedidos" "HTTP/JSON, credencial interna"
        sistema.apiGateway -> sistema.payments "Enruta pagos y la notificacion firmada" "HTTP/JSON, credencial interna"
        sistema.apiGateway -> sistema.graphqlGateway "Enruta consultas GraphQL" "HTTP/GraphQL, credencial interna"
        sistema.apiGateway -> sistema.secretManager "Lee las credenciales de cada destino" "HTTP KV v2, token propio"
        sistema.apiGateway -> servipag "Responde la notificacion de pago" "HTTP"
        servipag -> sistema.apiGateway "Notifica el resultado del pago (ruta sin sesion)" "HTTP + firma HMAC"

        sistema.authService -> sistema.secretManager "Lee pepper y credenciales de sus clientes" "HTTP KV v2, token propio"
        sistema.graphqlGateway -> sistema.secretManager "Lee las credenciales de los servicios" "HTTP KV v2, token propio"
        sistema.inventory -> sistema.secretManager "Lee su usuario de Mongo y credenciales" "HTTP KV v2, token propio"
        sistema.clients -> sistema.secretManager "Lee su usuario de Mongo y credenciales" "HTTP KV v2, token propio"
        sistema.orders -> sistema.secretManager "Lee su usuario de Mongo y credenciales" "HTTP KV v2, token propio"
        sistema.payments -> sistema.secretManager "Lee su usuario de Mongo, la API key y la clave de firma" "HTTP KV v2, token propio"

        sistema.clients -> sistema.authService "Crea la cuenta al registrar un cliente" "HTTP/JSON, Basic"

        sistema.orders -> sistema.inventory "Cotiza y reserva o libera stock" "HTTP/JSON, credencial interna"
        sistema.orders -> sistema.clients "Consulta la ficha para validar el despacho" "HTTP/JSON, credencial interna"
        sistema.orders -> sistema.payments "Consulta el pago y pide la devolucion al anular" "HTTP/JSON, credencial interna"
        sistema.payments -> sistema.orders "Lee el pedido y confirma el pago" "HTTP/JSON, credencial interna"
        sistema.orders -> sistema.broker "Publica la boleta y el aviso a cocina" "STOMP"
        sistema.notifier -> sistema.broker "Consume las colas de correos y de cocina" "STOMP"
        sistema.payments -> servipag "Crea la orden de pago y pide devoluciones" "HTTP + API key"

        sistema.graphqlGateway -> sistema.orders "Consulta pedidos (el servicio decide la propiedad)" "HTTP/JSON, credencial interna"
        sistema.graphqlGateway -> sistema.payments "Consulta los pagos del pedido" "HTTP/JSON, credencial interna"
        sistema.graphqlGateway -> sistema.inventory "Consulta productos y categorias" "HTTP/JSON, credencial interna"
        sistema.graphqlGateway -> sistema.clients "Consulta la ficha (solo roles autorizados)" "HTTP/JSON, credencial interna"

        sistema.authService -> sistema.dbAuth "Lee y escribe cuentas" "Mongo, usuario propio"
        sistema.inventory -> sistema.dbInventory "Lee y escribe items y reservas" "Mongo, usuario propio"
        sistema.clients -> sistema.dbClients "Lee y escribe fichas" "Mongo, usuario propio"
        sistema.orders -> sistema.dbOrders "Lee y escribe pedidos" "Mongo, usuario propio"
        sistema.payments -> sistema.dbPayments "Lee y escribe pagos" "Mongo, usuario propio"

        // Paso C3-1: API Gateway.
        sistema.frontend -> sistema.apiGateway.httpEntry "Invoca la API" "HTTP"
        servipag -> sistema.apiGateway.httpEntry "Notifica el resultado del pago" "HTTP + firma HMAC"
        sistema.apiGateway.httpEntry -> sistema.apiGateway.limitsAndOrigin "Pasa la peticion"
        sistema.apiGateway.limitsAndOrigin -> sistema.apiGateway.sessionPolicy "Pasa la peticion dentro del limite y con origen valido"
        sistema.apiGateway.sessionPolicy -> sistema.authService "Introspecciona la sesion" "HTTP/JSON, Basic"
        sistema.apiGateway.sessionPolicy -> sistema.apiGateway.routeMatrix "Entrega la identidad verificada"
        sistema.apiGateway.routeMatrix -> sistema.apiGateway.forwarder "Entrega la ruta permitida"
        sistema.apiGateway.routeMatrix -> sistema.apiGateway.errorMapper "Informa ruta inexistente o rol sin permiso"
        sistema.apiGateway.forwarder -> sistema.apiGateway.secretProvider "Pide la credencial del destino"
        sistema.apiGateway.secretProvider -> sistema.secretManager "Lee el secreto" "HTTP KV v2, token propio"
        sistema.apiGateway.forwarder -> sistema.inventory "Reenvia a inventario" "HTTP/JSON"
        sistema.apiGateway.forwarder -> sistema.clients "Reenvia a clientes" "HTTP/JSON"
        sistema.apiGateway.forwarder -> sistema.orders "Reenvia a pedidos" "HTTP/JSON"
        sistema.apiGateway.forwarder -> sistema.payments "Reenvia a pagos" "HTTP/JSON"
        sistema.apiGateway.forwarder -> sistema.graphqlGateway "Reenvia a GraphQL" "HTTP/GraphQL"
        sistema.apiGateway.forwarder -> sistema.apiGateway.errorMapper "Informa fallo o demora del destino"

        // Paso C3-2: GraphQL Gateway.
        sistema.apiGateway -> sistema.graphqlGateway.graphqlEndpoint "Remite la operacion con la identidad verificada" "HTTP/GraphQL"
        sistema.graphqlGateway.graphqlEndpoint -> sistema.graphqlGateway.queryLimits "Verifica esquema, profundidad y costo"
        sistema.graphqlGateway.queryLimits -> sistema.graphqlGateway.fieldAccess "Entrega la consulta valida"
        sistema.graphqlGateway.fieldAccess -> sistema.graphqlGateway.resolvers "Autoriza campos y recursos"
        sistema.graphqlGateway.resolvers -> sistema.graphqlGateway.serviceConnectors "Pide datos a los servicios"
        sistema.graphqlGateway.serviceConnectors -> sistema.orders "Consulta pedidos" "HTTP/JSON"
        sistema.graphqlGateway.serviceConnectors -> sistema.payments "Consulta pagos" "HTTP/JSON"
        sistema.graphqlGateway.serviceConnectors -> sistema.inventory "Consulta productos" "HTTP/JSON"
        sistema.graphqlGateway.serviceConnectors -> sistema.clients "Consulta la ficha" "HTTP/JSON"
        sistema.graphqlGateway.resolvers -> sistema.graphqlGateway.responseComposer "Entrega datos y errores"

        // Paso C3-3: Auth Service.
        sistema.apiGateway -> sistema.authService.identityApi "Login e introspeccion" "HTTP/JSON, Basic"
        sistema.clients -> sistema.authService.identityApi "Crea la cuenta del cliente" "HTTP/JSON, Basic"
        sistema.authService.identityApi -> sistema.authService.sessionStore "Crea, consulta y revoca sesiones"
        sistema.authService.identityApi -> sistema.authService.credentialsVerifier "Verifica la clave en el login"
        sistema.authService.credentialsVerifier -> sistema.authService.accountsRepo "Lee la cuenta y su hash"
        sistema.authService.credentialsVerifier -> sistema.authService.secretsClient "Pide el pepper"
        sistema.authService.secretsClient -> sistema.secretManager "Lee el secreto" "HTTP KV v2, token propio"
        sistema.authService.accountsRepo -> sistema.dbAuth "Lee y escribe cuentas" "Mongo, usuario propio"

        // Paso C3-4: pedidos.
        sistema.apiGateway -> sistema.orders.ordersApi "Enruta operaciones de pedidos" "HTTP/JSON"
        sistema.graphqlGateway -> sistema.orders.ordersApi "Consulta pedidos permitidos" "HTTP/JSON"
        sistema.payments -> sistema.orders.ordersApi "Confirma el pago del pedido" "HTTP/JSON"
        sistema.orders.ordersApi -> sistema.orders.accessPolicy "Comprueba rol y propiedad del pedido"
        sistema.orders.accessPolicy -> sistema.orders.orderWorkflow "Encamina las lecturas autorizadas"
        sistema.orders.accessPolicy -> sistema.orders.idempotency "Autoriza la escritura"
        sistema.orders.idempotency -> sistema.orders.ordersRepo "Busca la operacion previa por clave"
        sistema.orders.idempotency -> sistema.orders.orderWorkflow "Ejecuta solo la operacion admisible"
        sistema.orders.orderWorkflow -> sistema.orders.inventoryAdapter "Cotiza y reserva stock"
        sistema.orders.orderWorkflow -> sistema.orders.clientsAdapter "Valida la comuna de despacho"
        sistema.orders.orderWorkflow -> sistema.orders.paymentAdapter "Consulta o devuelve el pago"
        sistema.orders.orderWorkflow -> sistema.orders.eventPublisher "Publica boleta y aviso a cocina"
        sistema.orders.orderWorkflow -> sistema.orders.ordersRepo "Persiste el cambio de estado"
        sistema.orders.inventoryAdapter -> sistema.inventory "Invoca el contrato de inventario" "HTTP/JSON"
        sistema.orders.clientsAdapter -> sistema.clients "Invoca el contrato de clientes" "HTTP/JSON"
        sistema.orders.paymentAdapter -> sistema.payments "Invoca el contrato de pagos" "HTTP/JSON"
        sistema.orders.eventPublisher -> sistema.broker "Publica en las colas" "STOMP"
        sistema.orders.ordersRepo -> sistema.dbOrders "Lee y escribe pedidos y claves" "Mongo, usuario propio"

        // ---------------------------------------------------------------------------
        // Respuestas explicitas: las vistas dinamicas siguen cada paso de ida y de vuelta.
        // Son relaciones de comunicacion, no prueban nada por si solas (las pruebas estan en pruebas/).
        // ---------------------------------------------------------------------------
        sistema.frontend -> visitante "Presenta resultados y errores" "Interfaz web"
        sistema.frontend -> cliente "Presenta resultados y errores" "Interfaz web"
        sistema.apiGateway -> sistema.frontend "Devuelve respuestas y errores controlados" "HTTP"
        sistema.authService -> sistema.apiGateway "Responde la introspeccion" "HTTP/JSON"
        sistema.inventory -> sistema.apiGateway "Responde consultas de inventario" "HTTP/JSON"
        sistema.orders -> sistema.apiGateway "Responde operaciones de pedidos" "HTTP/JSON"
        sistema.payments -> sistema.apiGateway "Responde operaciones de pagos" "HTTP/JSON"
        sistema.graphqlGateway -> sistema.apiGateway "Devuelve el resultado compuesto o el error" "HTTP/GraphQL"
        servipag -> sistema.frontend "Redirige al cliente de vuelta al pedido" "Navegador web"

        sistema.dbInventory -> sistema.inventory "Devuelve resultados" "Mongo"
        sistema.dbClients -> sistema.clients "Devuelve resultados" "Mongo"
        sistema.dbOrders -> sistema.orders "Devuelve resultados" "Mongo"
        sistema.dbPayments -> sistema.payments "Devuelve resultados" "Mongo"
        sistema.inventory -> sistema.orders "Responde cotizacion y reserva" "HTTP/JSON"
        sistema.clients -> sistema.orders "Responde la ficha" "HTTP/JSON"
        sistema.orders -> sistema.graphqlGateway "Devuelve datos autorizados de pedidos" "HTTP/JSON"
        sistema.payments -> sistema.graphqlGateway "Devuelve los pagos del pedido" "HTTP/JSON"
        sistema.inventory -> sistema.graphqlGateway "Devuelve productos" "HTTP/JSON"
        sistema.clients -> sistema.graphqlGateway "Devuelve la ficha autorizada" "HTTP/JSON"
        servipag -> sistema.payments "Responde con el token y la URL de pago" "HTTP/JSON"
        sistema.broker -> sistema.notifier "Entrega los mensajes" "STOMP"

        sistema.graphqlGateway.queryLimits -> sistema.graphqlGateway.graphqlEndpoint "Reporta el rechazo de la consulta"
        sistema.graphqlGateway.graphqlEndpoint -> sistema.apiGateway "Responde el error de validacion" "HTTP/GraphQL"
        sistema.dbOrders -> sistema.orders.ordersRepo "Devuelve resultados" "Mongo"
        sistema.orders.ordersRepo -> sistema.orders.idempotency "Devuelve la operacion ya registrada"
        sistema.orders.idempotency -> sistema.orders.ordersApi "Devuelve el resultado existente sin ejecutar de nuevo"
        sistema.orders.ordersApi -> sistema.apiGateway "Devuelve la respuesta de pedidos" "HTTP/JSON"

        // ---------------------------------------------------------------------------
        // Despliegue 1: el que se entrega (docker-compose.yml, 14 contenedores en dos redes).
        // ---------------------------------------------------------------------------
        compose = deploymentEnvironment "Docker_Compose" {
            deploymentNode "Equipo del usuario" "Navegador que muestra la tienda y la pagina de pago." "Equipo cliente" {
                tags "ZonaCliente"
                deploymentNode "Navegador web" "Ejecuta el frontend; no es un servidor." "Navegador" {
                    containerInstance sistema.frontend
                }
            }
            deploymentNode "Docker Desktop (proyecto poke-fresh)" "docker compose up -d --build. Solo se publican los puertos 8080 y 9000." "Docker Compose" {
                tags "ZonaEntorno"
                deploymentNode "Redes externa y privada" "Contenedores conectados a las dos redes. Publican 8080 (gateway) y 9000 (pasarela)." "Redes de Docker" {
                    tags "ZonaPublica"
                    deploymentNode "Contenedor gateway" "Puerto 8080 publicado; sirve el frontend." "poke-fresh-gateway (Node)" {
                        containerInstance sistema.apiGateway
                    }
                    deploymentNode "Contenedor pasarela" "Puerto 9000 publicado; simula al proveedor externo." "poke-fresh-servicios (FastAPI)" {
                        softwareSystemInstance servipag
                    }
                    deploymentNode "Contenedor pagos" "Unico servicio privado con salida a la red externa, para hablar con la pasarela." "poke-fresh-servicios (FastAPI)" {
                        containerInstance sistema.payments
                    }
                }
                deploymentNode "Red privada (internal: true)" "Sin puertos publicados ni salida a Internet; el navegador no la alcanza." "Red de Docker" {
                    tags "ZonaPrivada"
                    deploymentNode "Contenedor auth" "Auth Service." "poke-fresh-auth (Node)" {
                        containerInstance sistema.authService
                    }
                    deploymentNode "Contenedor graphql" "GraphQL Gateway." "poke-fresh-graphql (Node)" {
                        containerInstance sistema.graphqlGateway
                    }
                    deploymentNode "Contenedores inventario, clientes y pedidos" "Un contenedor por servicio; comparten la imagen." "poke-fresh-servicios (FastAPI)" {
                        containerInstance sistema.inventory
                        containerInstance sistema.clients
                        containerInstance sistema.orders
                    }
                    deploymentNode "Contenedor notificador" "Consumidor de las colas." "poke-fresh-servicios (Python)" {
                        containerInstance sistema.notifier
                    }
                    deploymentNode "Contenedor activemq" "Broker de mensajes." "apache/activemq-classic:6.1.4" {
                        containerInstance sistema.broker
                    }
                    deploymentNode "Contenedor vault" "Secretos; se desbloquea con vault-init." "hashicorp/vault:1.18" {
                        tags "ZonaSecretos"
                        containerInstance sistema.secretManager
                    }
                    deploymentNode "Contenedor mongo" "Un solo motor, una base y un usuario por servicio; datos en un volumen." "mongo:7.0" {
                        tags "ZonaDatos"
                        containerInstance sistema.dbAuth
                        containerInstance sistema.dbInventory
                        containerInstance sistema.dbClients
                        containerInstance sistema.dbOrders
                        containerInstance sistema.dbPayments
                    }
                    infrastructureNode "vault-init" "Contenedor de un solo uso: inicializa Vault, crea secretos, politicas, un token por servicio y un usuario de Mongo por servicio." "Exited (0)"
                    infrastructureNode "semilla" "Contenedor de un solo uso: carga los datos de ejemplo con MODO_DEMO=true." "Exited (0)"
                }
            }
        }

        // ---------------------------------------------------------------------------
        // Despliegue 2: entorno local sin Docker, usado para probar (pruebas/local/levantar.sh).
        // Con Mongo, Vault y ActiveMQ simulados en memoria; no demuestra aislamiento de red.
        // ---------------------------------------------------------------------------
        local = deploymentEnvironment "Local_Sin_Docker" {
            deploymentNode "Equipo de desarrollo" "Todos los procesos en una misma maquina." "Estacion de trabajo" {
                tags "ZonaLocal"
                deploymentNode "Navegador local" "Frontend SPA." "Navegador" {
                    containerInstance sistema.frontend
                }
                deploymentNode "Procesos de la aplicacion" "Los mismos gateway, Auth Service, GraphQL Gateway y servicios que corren en Docker." "Procesos Node y Python" {
                    containerInstance sistema.apiGateway
                    containerInstance sistema.authService
                    containerInstance sistema.graphqlGateway
                    containerInstance sistema.inventory
                    containerInstance sistema.clients
                    containerInstance sistema.orders
                    containerInstance sistema.payments
                    containerInstance sistema.notifier
                    softwareSystemInstance servipag
                }
                deploymentNode "Simulados en memoria" "Reemplazos de Mongo, Vault y ActiveMQ con el mismo contrato; los datos no persisten." "Procesos de pruebas/local" {
                    containerInstance sistema.secretManager
                    containerInstance sistema.broker
                    containerInstance sistema.dbAuth
                    containerInstance sistema.dbInventory
                    containerInstance sistema.dbClients
                    containerInstance sistema.dbOrders
                    containerInstance sistema.dbPayments
                }
            }
        }
    }

    views {
        systemContext sistema "C1_Contexto" "Actores, el sistema y el proveedor de pago." {
            title "C1 - Contexto de Poke Fresh"
            include *
            autoLayout lr
        }

        container sistema "C2_Contenedores" "Aplicaciones, mensajeria y almacenes de datos de Poke Fresh." {
            title "C2 - Contenedores de Poke Fresh"
            include *
            autoLayout lr
        }

        // Vistas adicionales: recortes del mismo modelo, no otros sistemas.
        container sistema "C2_Catalogo" "Recorrido estructural de la consulta del catalogo (ruta publica)." {
            include visitante sistema.frontend sistema.apiGateway sistema.inventory sistema.dbInventory
            autoLayout lr
        }

        container sistema "C2_Pedidos_y_Pagos" "Recorrido estructural de la compra: pedido, stock, pago, boleta." {
            include cliente sistema.frontend sistema.apiGateway sistema.authService sistema.orders sistema.inventory sistema.clients sistema.payments servipag sistema.broker sistema.notifier sistema.dbOrders sistema.dbPayments
            autoLayout lr
        }

        container sistema "C2_Secretos" "Quien lee secretos de Vault: cada consumidor con su propio token." {
            include sistema.secretManager sistema.apiGateway sistema.authService sistema.graphqlGateway sistema.inventory sistema.clients sistema.orders sistema.payments
            autoLayout lr
        }

        component sistema.apiGateway "C3_API_Gateway" "Componentes internos del punto de entrada HTTP." {
            title "C3 - API Gateway"
            include *
            autoLayout lr
        }

        component sistema.graphqlGateway "C3_GraphQL" "Validacion, autorizacion y agregacion de datos." {
            title "C3 - GraphQL Gateway"
            include *
            autoLayout lr
        }

        component sistema.authService "C3_Auth_Service" "Identidad, sesiones, credenciales y secretos." {
            title "C3 - Auth Service"
            include *
            autoLayout lr
        }

        component sistema.orders "C3_Pedidos" "Autorizacion, idempotencia, reglas y persistencia de pedidos." {
            title "C3 - pedidos"
            include *
            autoLayout lr
        }

        // ===============================================================================
        // VISTAS DINAMICAS (los casos de validacion del Modulo 7 y del 10 las ejecutan)
        // ===============================================================================

        dynamic sistema "D_F01_Catalogo_Exito" "Caso 7.1: consulta anonima del catalogo; no pasa por el Auth Service." {
            title "F01 - Consulta del catalogo: exito"
            1: visitante -> sistema.frontend "Abre el menu"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/catalogo/items"
            3: sistema.apiGateway -> sistema.inventory "Ruta publica: reenvia con la credencial interna, sin identidad"
            4: sistema.inventory -> sistema.dbInventory "Busca los items publicados"
            5: sistema.dbInventory -> sistema.inventory "Devuelve los items"
            6: sistema.inventory -> sistema.apiGateway "Responde el catalogo sin stock exacto"
            7: sistema.apiGateway -> sistema.frontend "Devuelve el listado"
            8: sistema.frontend -> visitante "Muestra los productos"
            autoLayout lr
        }

        dynamic sistema "D_F01_Catalogo_Recuperacion" "Caso 10.7 y servicio caido: error controlado y nuevo intento." {
            title "F01 - Catalogo: servicio caido y recuperacion"
            1: visitante -> sistema.frontend "Abre el menu"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/catalogo/items"
            3: sistema.apiGateway -> sistema.inventory "Reenvia; el servicio no responde"
            4: sistema.apiGateway -> sistema.frontend "502 (o 504 pasados 8 s): error controlado"
            5: sistema.frontend -> visitante "Muestra el error sin inventar datos"
            6: visitante -> sistema.frontend "Reintenta cuando el servicio vuelve"
            7: sistema.frontend -> sistema.apiGateway "GET /api/v1/catalogo/items"
            8: sistema.apiGateway -> sistema.inventory "Reenvia"
            9: sistema.inventory -> sistema.apiGateway "Responde el catalogo"
            10: sistema.apiGateway -> sistema.frontend "Devuelve el listado"
            11: sistema.frontend -> visitante "Muestra los productos"
            autoLayout lr
        }

        dynamic sistema "D_F02_Pedido_Exito" "Caso 10.1: el servidor calcula el total; el precio que envia el navegador se ignora." {
            title "F02 - Crear pedido: exito"
            1: cliente -> sistema.frontend "Confirma el pedido"
            2: sistema.frontend -> sistema.apiGateway "POST /api/v1/pedidos con Idempotency-Key y cookie"
            3: sistema.apiGateway -> sistema.authService "Introspecciona la sesion"
            4: sistema.authService -> sistema.apiGateway "Sesion valida: rol cliente y sujeto"
            5: sistema.apiGateway -> sistema.orders "Reenvia con credencial interna e identidad verificada"
            6: sistema.orders -> sistema.inventory "Cotiza con los precios del servidor y reserva stock"
            7: sistema.inventory -> sistema.orders "Total calculado y reserva hecha (o 409 SIN_STOCK)"
            8: sistema.orders -> sistema.clients "Consulta la ficha para validar la comuna de despacho"
            9: sistema.clients -> sistema.orders "Devuelve la ficha"
            10: sistema.orders -> sistema.dbOrders "Guarda el pedido PENDIENTE_PAGO y la clave"
            11: sistema.dbOrders -> sistema.orders "Confirma la escritura"
            12: sistema.orders -> sistema.apiGateway "201 con numero y total"
            13: sistema.apiGateway -> sistema.frontend "Responde la operacion"
            14: sistema.frontend -> cliente "Muestra el pedido pendiente de pago"
            autoLayout lr
        }

        dynamic sistema "D_F02_Pedido_Reintento" "Caso 10.2: doble clic; la misma clave devuelve el mismo pedido." {
            title "F02 - Crear pedido: reintento sin duplicar"
            1: cliente -> sistema.frontend "Hace doble clic en Confirmar"
            2: sistema.frontend -> sistema.apiGateway "POST /api/v1/pedidos con la misma Idempotency-Key"
            3: sistema.apiGateway -> sistema.orders "Reenvia la solicitud repetida"
            4: sistema.orders -> sistema.dbOrders "Busca la clave y el resultado previo"
            5: sistema.dbOrders -> sistema.orders "Devuelve el pedido ya registrado"
            6: sistema.orders -> sistema.apiGateway "Devuelve el mismo pedido; no crea otro"
            7: sistema.apiGateway -> sistema.frontend "Devuelve el numero anterior"
            8: sistema.frontend -> cliente "Muestra el pedido existente"
            autoLayout lr
        }

        dynamic sistema.orders "D_F02_Idempotencia_C3" "Detalle de la solicitud repetida dentro de pedidos." {
            title "F02 - Idempotencia: componentes de pedidos"
            1: sistema.apiGateway -> sistema.orders.ordersApi "Entrega el POST repetido con la clave"
            2: sistema.orders.ordersApi -> sistema.orders.accessPolicy "Verifica rol y permisos"
            3: sistema.orders.accessPolicy -> sistema.orders.idempotency "Autoriza la escritura"
            4: sistema.orders.idempotency -> sistema.orders.ordersRepo "Busca la clave"
            5: sistema.orders.ordersRepo -> sistema.dbOrders "Consulta la operacion ya persistida"
            6: sistema.dbOrders -> sistema.orders.ordersRepo "Devuelve el pedido"
            7: sistema.orders.ordersRepo -> sistema.orders.idempotency "Entrega el resultado existente"
            8: sistema.orders.idempotency -> sistema.orders.ordersApi "Devuelve el resultado sin ejecutar las reglas"
            9: sistema.orders.ordersApi -> sistema.apiGateway "Devuelve el mismo pedido"
            autoLayout lr
        }

        dynamic sistema "D_F03_Pedido_Propio" "Caso 7.5 (parte autorizada): el cliente ve su pedido." {
            title "F03 - Consulta protegida: pedido propio"
            1: cliente -> sistema.frontend "Abre su pedido"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/pedidos/PF-00081"
            3: sistema.apiGateway -> sistema.authService "Comprueba la sesion"
            4: sistema.authService -> sistema.apiGateway "Sesion valida"
            5: sistema.apiGateway -> sistema.orders "Pide el pedido con la identidad del usuario"
            6: sistema.orders -> sistema.dbOrders "Busca el pedido"
            7: sistema.dbOrders -> sistema.orders "Devuelve el pedido"
            8: sistema.orders -> sistema.apiGateway "El sujeto coincide con el dueno: 200"
            9: sistema.apiGateway -> sistema.frontend "Devuelve el pedido"
            10: sistema.frontend -> cliente "Muestra numero y estado"
            autoLayout lr
        }

        dynamic sistema "D_F03_Pedido_Ajeno" "Caso 7.5 (parte denegada): un pedido ajeno responde 404 sin datos." {
            title "F03 - Consulta protegida: pedido ajeno"
            1: cliente -> sistema.frontend "Intenta abrir el pedido de otro cliente"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/pedidos/PF-00081"
            3: sistema.apiGateway -> sistema.authService "Comprueba la sesion"
            4: sistema.authService -> sistema.apiGateway "Sesion valida (no da acceso al pedido)"
            5: sistema.apiGateway -> sistema.orders "Pide el pedido con la identidad del usuario"
            6: sistema.orders -> sistema.dbOrders "Busca el pedido"
            7: sistema.dbOrders -> sistema.orders "Devuelve el pedido"
            8: sistema.orders -> sistema.apiGateway "El sujeto no es el dueno: 404 NO_ENCONTRADO, sin datos"
            9: sistema.apiGateway -> sistema.frontend "Entrega el error conforme al contrato"
            10: sistema.frontend -> cliente "Muestra el rechazo sin datos ajenos"
            autoLayout lr
        }

        dynamic sistema "D_F03_Sesion_Expirada" "Caso 7.2 y 7.8: sin sesion valida el gateway rechaza antes de llegar al servicio." {
            title "F03 - Sesion expirada o ausente: rechazo temprano"
            1: cliente -> sistema.frontend "Consulta un pedido con la sesion expirada"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/pedidos"
            3: sistema.apiGateway -> sistema.authService "Introspecciona la sesion"
            4: sistema.authService -> sistema.apiGateway "active: false"
            5: sistema.apiGateway -> sistema.frontend "401 SIN_SESION y borra la cookie"
            6: sistema.frontend -> cliente "Pide ingresar de nuevo sin mostrar el pedido"
            autoLayout lr
        }

        dynamic sistema "D_F04_GraphQL_Exito" "Caso 8.1: la pantalla del pedido combina pedidos, pagos e inventario." {
            title "F04 - GraphQL: agregacion exitosa"
            1: cliente -> sistema.frontend "Abre el seguimiento del pedido"
            2: sistema.frontend -> sistema.apiGateway "POST /api/v1/graphql resumenPedido"
            3: sistema.apiGateway -> sistema.authService "Introspecciona la sesion"
            4: sistema.authService -> sistema.apiGateway "Sesion valida"
            5: sistema.apiGateway -> sistema.graphqlGateway "Entrega la operacion con credencial interna e identidad"
            6: sistema.graphqlGateway -> sistema.orders "Pide el pedido (pedidos decide si es del usuario)"
            7: sistema.orders -> sistema.graphqlGateway "Devuelve el pedido autorizado"
            8: sistema.graphqlGateway -> sistema.payments "Pide los pagos del pedido"
            9: sistema.payments -> sistema.graphqlGateway "Devuelve los pagos"
            10: sistema.graphqlGateway -> sistema.inventory "Pide las descripciones de los productos, por lotes"
            11: sistema.inventory -> sistema.graphqlGateway "Devuelve los productos"
            12: sistema.graphqlGateway -> sistema.apiGateway "Compone la respuesta"
            13: sistema.apiGateway -> sistema.frontend "Entrega el resultado autorizado"
            14: sistema.frontend -> cliente "Muestra pedido, pago y productos"
            autoLayout lr
        }

        dynamic sistema "D_F04_GraphQL_Error_Parcial" "Un servicio falla: el campo trae su error y no se presenta como dato completo." {
            title "F04 - GraphQL: un servicio falla"
            1: cliente -> sistema.frontend "Abre el seguimiento del pedido"
            2: sistema.frontend -> sistema.apiGateway "POST /api/v1/graphql resumenPedido"
            3: sistema.apiGateway -> sistema.graphqlGateway "Entrega la operacion permitida"
            4: sistema.graphqlGateway -> sistema.orders "Pide el pedido"
            5: sistema.orders -> sistema.graphqlGateway "Devuelve el pedido"
            6: sistema.graphqlGateway -> sistema.payments "Pide los pagos; el servicio no responde"
            7: sistema.graphqlGateway -> sistema.apiGateway "Devuelve el pedido y el error del campo de pagos"
            8: sistema.apiGateway -> sistema.frontend "Transmite el resultado con su error"
            9: sistema.frontend -> cliente "Informa que los pagos no se pudieron cargar"
            autoLayout lr
        }

        dynamic sistema.graphqlGateway "D_F04_GraphQL_Limite_C3" "Caso 8.2: se rechaza antes de ejecutar resolvers o llamar a servicios." {
            title "F04 - GraphQL: la consulta excede el limite"
            1: sistema.apiGateway -> sistema.graphqlGateway.graphqlEndpoint "Envia una consulta de costo 11102 (maximo 1000)"
            2: sistema.graphqlGateway.graphqlEndpoint -> sistema.graphqlGateway.queryLimits "Calcula profundidad y costo"
            3: sistema.graphqlGateway.queryLimits -> sistema.graphqlGateway.graphqlEndpoint "Rechaza la consulta"
            4: sistema.graphqlGateway.graphqlEndpoint -> sistema.apiGateway "Devuelve el error sin llamar a los servicios"
            autoLayout lr
        }

        dynamic sistema "D_F05_Pago_Inicio" "Casos 7.6 y 10.2: el monto lo pone el servidor; la misma clave devuelve el mismo pago." {
            title "F05 - Iniciar el pago"
            1: cliente -> sistema.frontend "Pulsa Pagar"
            2: sistema.frontend -> sistema.apiGateway "POST /api/v1/pagos con Idempotency-Key"
            3: sistema.apiGateway -> sistema.authService "Introspecciona la sesion"
            4: sistema.authService -> sistema.apiGateway "Sesion valida"
            5: sistema.apiGateway -> sistema.payments "Reenvia con credencial interna e identidad"
            6: sistema.payments -> sistema.orders "Lee el pedido: total y estado"
            7: sistema.orders -> sistema.payments "Total y PENDIENTE_PAGO (el monto del navegador se ignora)"
            8: sistema.payments -> servipag "Crea la orden de pago con la API key"
            9: servipag -> sistema.payments "Devuelve el token y la URL de pago"
            10: sistema.payments -> sistema.dbPayments "Guarda el pago PENDIENTE"
            11: sistema.dbPayments -> sistema.payments "Confirma la escritura"
            12: sistema.payments -> sistema.apiGateway "Devuelve la URL de la pasarela"
            13: sistema.apiGateway -> sistema.frontend "Responde la operacion"
            14: sistema.frontend -> cliente "Lo lleva a la pagina de pago"
            autoLayout lr
        }

        dynamic sistema "D_F05_Pago_Confirmacion" "Caso 10.3: notificacion firmada; el estado de pago lo decide el servidor, no el navegador." {
            title "F05 - Confirmacion del pago, venta y boleta"
            1: cliente -> servipag "Paga en la pagina del proveedor"
            2: servipag -> sistema.apiGateway "Notificacion con firma HMAC (ruta sin sesion)"
            3: sistema.apiGateway -> sistema.payments "Reenvia el cuerpo exacto y la firma"
            4: sistema.payments -> sistema.dbPayments "Verifica firma, token y monto; PENDIENTE pasa a APROBADO en una sola operacion"
            5: sistema.dbPayments -> sistema.payments "Confirma el cambio"
            6: sistema.payments -> sistema.orders "Confirma el pago: pasa a PAGADO, registra venta y boleta"
            7: sistema.orders -> sistema.broker "Publica la boleta y el aviso a cocina"
            8: sistema.broker -> sistema.notifier "Entrega los mensajes"
            9: sistema.orders -> sistema.payments "Responde la confirmacion"
            10: sistema.payments -> sistema.apiGateway "200 (repetido: true si ya estaba aprobado)"
            11: sistema.apiGateway -> servipag "Responde la notificacion"
            12: servipag -> sistema.frontend "Redirige al cliente de vuelta al pedido"
            autoLayout lr
        }

        dynamic sistema "D_F05_Pago_Notificacion_Falsa" "Caso 7.6: una notificacion sin firma valida no cambia el pedido." {
            title "F05 - Notificacion de pago con firma falsa"
            1: servipag -> sistema.apiGateway "Notificacion sin firma o con firma falsa"
            2: sistema.apiGateway -> sistema.payments "Reenvia el cuerpo y la firma recibida"
            3: sistema.payments -> sistema.apiGateway "401: firma no valida; el pedido sigue PENDIENTE_PAGO"
            4: sistema.apiGateway -> servipag "Responde 401"
            autoLayout lr
        }

        // ===============================================================================
        // VISTAS DE DESPLIEGUE
        // ===============================================================================
        deployment sistema compose "DEP_Docker_Compose" "El despliegue entregado: contenedores y redes de docker-compose.yml." {
            title "Despliegue - Docker Compose (entregado)"
            include *
            autoLayout lr
        }

        deployment sistema local "DEP_Local_Sin_Docker" "Entorno local de pruebas con Mongo, Vault y ActiveMQ en memoria." {
            title "Despliegue - Local sin Docker (pruebas)"
            include *
            autoLayout lr
        }

        styles {
            element "Deployment Node" {
                background #E9EFF5
                color #213F56
                stroke #8FA5B7
            }
            element "Infrastructure Node" {
                shape roundedbox
                background #EDF0F3
                color #334454
            }
            element "ZonaCliente" {
                background #F1F5F9
                color #173B5D
            }
            element "ZonaEntorno" {
                background #F4F6F8
                color #213F56
            }
            element "ZonaPublica" {
                background #DCEAF7
                color #173B5D
            }
            element "ZonaPrivada" {
                background #E5EEE8
                color #20513D
            }
            element "ZonaDatos" {
                background #ECEAF2
                color #463D64
            }
            element "ZonaSecretos" {
                background #EEE5E1
                color #68483C
            }
            element "ZonaLocal" {
                background #F0F3F6
                color #243F56
            }
            element "Person" {
                shape person
                background #56718A
                color #FFFFFF
            }
            element "Software System" {
                shape roundedbox
                background #0C527A
                color #FFFFFF
            }
            element "SistemaEvaluado" {
                background #173B5D
                color #FFFFFF
            }
            element "SistemaExterno" {
                background #F1EDE7
                color #544633
                stroke #A89D8A
            }
            element "Container" {
                shape roundedbox
                background #E3ECF5
                color #173B5D
            }
            element "Frontend" {
                shape webbrowser
                background #CDE5F7
                color #153E5B
            }
            element "Gateway" {
                background #2B6289
                color #FFFFFF
            }
            element "Seguridad" {
                background #3F6171
                color #FFFFFF
            }
            element "Privado" {
                background #D5E8EF
                color #173B5D
            }
            element "Mensajeria" {
                shape pipe
                background #E9E2F2
                color #4A3666
            }
            element "BaseDatos" {
                shape cylinder
                background #E5EAF0
                color #243F56
            }
            element "Component" {
                shape roundedbox
                background #EDF3F7
                color #173B5D
            }
            element "EntradaC3" {
                background #D3E9F7
                color #153F62
            }
            element "ControlC3" {
                background #DBE4EC
                color #213F56
            }
            element "AplicacionC3" {
                background #D7E9DE
                color #20533E
            }
            element "IntegracionC3" {
                background #E9E2F2
                color #4A3666
            }
            element "PersistenciaC3" {
                background #E9EBEE
                color #334454
            }
            element "ErrorC3" {
                background #F2E6DB
                color #70462C
            }
            relationship "Relationship" {
                color #60758A
                thickness 2
            }
        }
    }
}
