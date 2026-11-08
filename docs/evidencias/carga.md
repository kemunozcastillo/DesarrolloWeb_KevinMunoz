# Prueba de carga

Script: `pruebas/carga/carga.mjs` (sin dependencias). Reproducir:

```bash
# en .env agregar LIMITE_POR_MINUTO=100000 (todas las peticiones salen de una IP) y recrear el gateway
docker compose up -d gateway
# la CA de prueba sale del volumen tls; con ella Node verifica el certificado del gateway
docker compose cp tls-init:/tls/ca.pem ./ca.pem
NODE_EXTRA_CA_CERTS=./ca.pem node pruebas/carga/carga.mjs --sitio https://localhost:8080 --segundos 20 --concurrencia 20
# al terminar: quitar esa línea de .env (vuelve el valor por defecto, 300) y recrear el gateway
docker compose up -d gateway
```

## Entorno de esta medición

- **Tipo:** medición (no proyección), el 08-11-2026.
- **Equipo:** PC con Windows 11, AMD Ryzen 7 5800H (16 hilos) y 16 GB de RAM, con Docker Desktop (el motor ve 16 CPU y 15,3 GiB).
- **Sistema:** el `docker-compose.yml` completo, con Mongo, Vault y ActiveMQ reales, las redes `privada` (interna) y `externa`, y **TLS en todos los saltos** (gateway, servicios, Vault, Mongo y ActiveMQ; ver INFORME). El generador de carga corre en el mismo equipo, fuera de Docker, y entra por el puerto 8080 publicado, por HTTPS y verificando el certificado con la CA de prueba; por eso compite por CPU con los contenedores y las latencias incluyen el paso por la red de Docker Desktop.
- **Datos:** los de ejemplo (6 clientes, 80 pedidos, 29 productos) más lo que crean las pruebas de punta a punta.
- **Carga:** 20 conexiones concurrentes, 20 segundos por escenario, sin pausa entre peticiones (el peor caso: cada conexión pide apenas recibe la respuesta anterior).

## Resultados

| Escenario | Peticiones | Por segundo | p50 | p95 | p99 | Errores |
|---|---:|---:|---:|---:|---:|---:|
| `GET /catalogo/items` (anónimo) | 6.339 | 316,4 | 61,4 ms | 91,6 ms | 116,3 ms | 0 % |
| GraphQL `resumenPedido` (cliente; pedidos + pagos + inventario) | 4.195 | 209,1 | 89,1 ms | 146,8 ms | 202,5 ms | 0 % |
| `GET /pedidos?cola=cocina` (cocina) | 5.113 | 254,8 | 77,6 ms | 110,0 ms | 146,7 ms | 0 % |

Uso de recursos (`docker stats --no-stream`, una sola muestra tomada durante el tercer escenario, la cola de cocina; la CPU puede pasar de 100 % porque 100 % es un núcleo):

| Contenedor | CPU | Memoria |
|---|---:|---:|
| pedidos | 108 % | 63 MiB |
| Mongo | 91 % | 359 MiB |
| API Gateway (TLS y reenvío) | 65 % | 130 MiB |
| Auth Service (introspección en cada petición) | 40 % | 73 MiB |
| inventario, clientes, pagos | 0,1 % | 49 a 61 MiB |
| GraphQL Gateway (sin uso en este escenario) | 0 % | 151 MiB |

Con una sola muestra no se pueden sacar conclusiones finas sobre cuánto consume cada pieza; sirve para ver el orden de magnitud y que ningún contenedor se acerca a un límite de memoria.

## Comparación con los objetivos (ver ADR 0001)

| Objetivo | Medido | ¿Cumple? |
|---|---|---|
| p95 < 300 ms en catálogo y colas | 92 y 110 ms | Sí |
| p95 < 500 ms en agregaciones GraphQL | 147 ms | Sí |
| Soportar el pico estimado de 5 peticiones/s (ver ADR) con 0 % de error | 209 a 316 peticiones/s, 0 % de error | Sí, con margen de 42 a 63 veces |

La agregación GraphQL es lo más lento por petición (tres llamadas internas, más la introspección) y la que tiene la cola más larga (p99 de 203 ms), pero cumple el objetivo con holgura frente al pico estimado, por lo que no hace falta un servicio de alta demanda separado ni gRPC (ADR 0001).

## Nota sobre otras mediciones

- Sin TLS, en una sesión anterior y con el mismo equipo, el mismo script midió entre 118 y 157 peticiones/s (rama `Evaluacion-2`). Que con TLS salga más alto no significa que cifrar acelere nada: cada cifra es una sola corrida y este equipo tiene variación de una sesión a otra (el generador de carga corre en la misma máquina). Lo que se afirma es que, con TLS, el sistema cumple los objetivos con 0 % de error; no se afirma ningún costo ni mejora del cifrado, porque no se hizo una comparación controlada.
- En el entorno local sin Docker (`pruebas/local/levantar.sh`, con Mongo y Vault en memoria) se midió entre 242 y 725 peticiones/s. No se usa en este informe: esa configuración no tenía Mongo, Vault ni red de contenedores reales.
