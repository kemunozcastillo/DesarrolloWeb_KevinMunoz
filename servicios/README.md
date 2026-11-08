# Microservicios (FastAPI + MongoDB)

Una sola imagen; cada contenedor elige el servicio con `SERVICIO`.

| Servicio | Base | Dueño de |
|---|---|---|
| `inventario` | `pf_inventario` | catálogo, precios, reglas de armado, stock y reservas |
| `clientes` | `pf_clientes` | ficha del cliente (RUN, dirección, contacto) |
| `pedidos` | `pf_pedidos` | pedidos, venta, boleta, colas de cocina y despacho, reporte de ventas |
| `pagos` | `pf_pagos` | intentos de pago, idempotencia, notificaciones de la pasarela, devoluciones |
| `pasarela` | (memoria) | simula a Servipag, el proveedor externo |
| `notificador` | — | consume las colas de ActiveMQ (boletas y avisos a cocina) |

`comun/` tiene lo compartido: lectura de Vault, credencial interna, identidad, llamadas entre servicios y formato de errores.

Pruebas: `pip install -r requirements-dev.txt && pytest`. Datos de ejemplo: `python -m scripts.semilla`.
