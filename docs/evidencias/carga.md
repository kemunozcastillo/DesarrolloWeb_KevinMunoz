# Prueba de carga

Script: `pruebas/carga/carga.mjs` (sin dependencias). Reproducir:

```bash
# con el sistema arriba y el límite por IP del gateway subido (todas las peticiones salen de una IP)
node pruebas/carga/carga.mjs --sitio http://localhost:8080 --segundos 20 --concurrencia 20
```

## Entorno de esta medición

- **Tipo:** medición (no proyección), el 08-11-2026.
- **Equipo:** contenedor Linux con 2 vCPU Intel Xeon 2,1 GHz y 8 GB de RAM.
- **Sistema:** el entorno local sin Docker (`pruebas/local/levantar.sh`): los mismos gateway, Auth Service, GraphQL Gateway y microservicios que corren en Docker, pero con Mongo y Vault simulados en memoria. Por eso las latencias son una referencia: con Mongo real hay que repetirla (ver más abajo).
- **Datos:** los de ejemplo (unos 85 pedidos, 29 productos, 7 clientes).
- **Carga:** 20 conexiones concurrentes, 20 segundos por escenario, sin pausa entre peticiones (el peor caso: cada conexión pide apenas recibe la respuesta anterior).

## Resultados

| Escenario | Peticiones | Por segundo | p50 | p95 | p99 | Errores |
|---|---:|---:|---:|---:|---:|---:|
| `GET /catalogo/items` (anónimo) | 14.518 | 725,5 | 25,6 ms | 43,4 ms | 56,4 ms | 0 % |
| GraphQL `resumenPedido` (cliente; pedidos + pagos + inventario) | 4.849 | 242,0 | 76,5 ms | 124,1 ms | 153,4 ms | 0 % |
| `GET /pedidos?cola=cocina` (cocina) | 10.692 | 533,8 | 35,5 ms | 57,6 ms | 68,3 ms | 0 % |

Uso de recursos durante la prueba (`ps`: %CPU es el promedio desde que arrancó cada proceso, así que subestima el pico; memoria residente al final):

| Proceso | %CPU (promedio) | Memoria |
|---|---:|---:|
| API Gateway | 43 % | 185 MB |
| inventario | 62 % | 105 MB |
| pedidos | 32 % | 106 MB |
| GraphQL Gateway | 21 % | 203 MB |
| pagos | 12 % | 104 MB |
| Auth Service (introspección en cada petición) | 11 % | 186 MB |

## Comparación con los objetivos (ver ADR 0001)

| Objetivo | Medido | ¿Cumple? |
|---|---|---|
| p95 < 300 ms en catálogo y colas | 43 y 58 ms | Sí |
| p95 < 500 ms en agregaciones GraphQL | 124 ms | Sí |
| Soportar el pico estimado de 5 peticiones/s (ver ADR) con 0 % de error | 242 a 725 peticiones/s, 0 % de error | Sí, con margen de 48 a 145 veces |

El componente más costoso por petición es la agregación GraphQL (tres llamadas internas, más la introspección). Aun así está muy lejos del pico estimado, por lo que no hace falta un servicio de alta demanda separado ni gRPC (ADR 0001).

## Repetirla en Docker (con Mongo y Vault reales)

```bash
# en .env agregar LIMITE_POR_MINUTO=1000000 y levantar de nuevo el gateway
docker compose up -d gateway
node pruebas/carga/carga.mjs --sitio http://localhost:8080
docker stats --no-stream      # CPU y memoria de cada contenedor
```
