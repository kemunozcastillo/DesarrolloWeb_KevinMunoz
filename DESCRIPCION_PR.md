# [PR] Cola de pedidos con ActiveMQ y STOMP

## Qué se hizo

Dos programas en Python que se comunican por la cola `/queue/pedidos` de ActiveMQ usando STOMP en el puerto 61613.

**`productor.py`**
- Recibe con `argparse`: formato, mensaje, id, cliente, monto, host, puerto, usuario y clave.
- Valida el monto con `Decimal`: rechaza negativos, valores que no son números, más de 2 decimales (para evitar confundir `8.990` con ocho mil novecientos noventa) y montos que no caben en el formato fijo.
- Envía el pedido en 4 formatos: texto plano, fijo de 36 caracteres (id 6, cliente 20, monto 10 con 2 decimales), XML con raíz `<pedido>` y un subelemento por campo, y JSON.
- Agrega una cabecera `formato` para que el consumidor sepa cómo leer el mensaje.

**`consumidor.py`**
- Clase `Escuchador(stomp.ConnectionListener)` con `on_error`, `on_disconnected` y `on_message`.
- Suscripción a la cola con `ack="client-individual"`.
- Interpreta cada formato y hace ACK si el mensaje está bien o NACK si viene malo, con el motivo.
- Loop con `sleep(0.5)` hasta Ctrl+C; si se cae la conexión, se reconecta solo.

## Cómo probar

1. Levantar ActiveMQ: `activemq start` desde la carpeta `bin`.
2. `pip install stomp.py`
3. En una terminal: `python consumidor.py`
4. En otra:

```bash
python productor.py --formato texto --mensaje "Hola desde Poke Fresh"
python productor.py --formato fijo --id 101 --cliente "Kevin Muñoz" --monto 8990
python productor.py --formato xml --id 102 --cliente "Ana Rojas" --monto 12400.50
python productor.py --formato json --id 103 --cliente "Luis Pérez" --monto 6990
```

Los mensajes rechazados quedan en `ActiveMQ.DLQ`, visible en la consola web (http://localhost:8161/admin).

## Pruebas

59 pruebas con `pytest`, usando un broker STOMP de prueba que imita el ACK, el NACK y la cola de mensajes muertos de ActiveMQ: validación del monto, los cuatro formatos de ida y vuelta, mensajes malos con NACK, mensajes enviados antes de que el consumidor se conecte, reconexión cuando el broker se cae, y errores de conexión y credenciales.
