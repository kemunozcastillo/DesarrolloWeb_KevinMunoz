# Prueba de carga

Script: `pruebas/carga/carga.mjs` (sin dependencias). Reproducir:

```bash
# en .env agregar LIMITE_POR_MINUTO=100000 (todas las peticiones salen de una IP) y recrear el gateway
docker compose up -d gateway
node pruebas/carga/carga.mjs --sitio http://localhost:8080 --segundos 20 --concurrencia 20
# al terminar: quitar esa línea de .env (vuelve el valor por defecto, 300) y recrear el gateway
docker compose up -d gateway
```

## Entorno de esta medición

- **Tipo:** medición (no proyección), el 08-11-2026.
- **Equipo:** PC con Windows 11, AMD Ryzen 7 5800H (16 hilos) y 16 GB de RAM, con Docker Desktop (el motor ve 16 CPU y 15,3 GiB).
- **Sistema:** el `docker-compose.yml` completo, con Mongo, Vault y ActiveMQ reales y las redes `privada` (interna) y `externa`. El generador de carga corre en el mismo equipo, fuera de Docker, y entra por el puerto 8080 publicado; por eso compite por CPU con los contenedores y las latencias incluyen el paso por la red de Docker Desktop.
- **Datos:** los de ejemplo (6 clientes, 80 pedidos, 29 productos) más lo que crean las pruebas de punta a punta.
- **Carga:** 20 conexiones concurrentes, 20 segundos por escenario, sin pausa entre peticiones (el peor caso: cada conexión pide apenas recibe la respuesta anterior).

## Resultados

| Escenario | Peticiones | Por segundo | p50 | p95 | p99 | Errores |
|---|---:|---:|---:|---:|---:|---:|
| `GET /catalogo/items` (anónimo) | 3.148 | 156,8 | 125,5 ms | 173,7 ms | 203,6 ms | 0 % |
| GraphQL `resumenPedido` (cliente; pedidos + pagos + inventario) | 2.379 | 118,3 | 152,8 ms | 236,7 ms | 583,2 ms | 0 % |
| `GET /pedidos?cola=cocina` (cocina) | 2.791 | 138,7 | 142,9 ms | 191,0 ms | 217,5 ms | 0 % |

Uso de recursos (`docker stats --no-stream`, una sola muestra tomada durante el tercer escenario, la cola de cocina; la CPU puede pasar de 100 % porque 100 % es un núcleo):

| Contenedor | CPU | Memoria |
|---|---:|---:|
| Mongo | 135 % | 346 MiB |
| pedidos | 180 % | 72 MiB |
| API Gateway | 80 % | 113 MiB |
| inventario | 75 % | 69 MiB |
| Auth Service (introspección en cada petición) | 69 % | 85 MiB |
| pagos | 69 % | 56 MiB |
| clientes | 62 % | 50 MiB |
| GraphQL Gateway (casi sin uso en este escenario) | 0,04 % | 119 MiB |

Con una sola muestra no se pueden sacar conclusiones finas sobre cuánto consume cada pieza; sirve para ver el orden de magnitud y que ningún contenedor se acerca a un límite de memoria.

## Comparación con los objetivos (ver ADR 0001)

| Objetivo | Medido | ¿Cumple? |
|---|---|---|
| p95 < 300 ms en catálogo y colas | 174 y 191 ms | Sí |
| p95 < 500 ms en agregaciones GraphQL | 237 ms | Sí |
| Soportar el pico estimado de 5 peticiones/s (ver ADR) con 0 % de error | 118 a 157 peticiones/s, 0 % de error | Sí, con margen de 24 a 31 veces |

La agregación GraphQL es lo más lento por petición (tres llamadas internas, más la introspección) y la que tiene la cola más larga (p99 de 583 ms), pero cumple el objetivo con holgura frente al pico estimado, por lo que no hace falta un servicio de alta demanda separado ni gRPC (ADR 0001).

## Nota sobre una medición anterior

Una primera medición, hecha en el entorno local sin Docker (`pruebas/local/levantar.sh`, con Mongo y Vault simulados en memoria), dio entre 242 y 725 peticiones/s. No se usa en este informe: esa configuración no tenía Mongo, Vault ni red de contenedores reales, así que sus cifras eran más optimistas. Las de arriba son las del sistema completo en Docker.
