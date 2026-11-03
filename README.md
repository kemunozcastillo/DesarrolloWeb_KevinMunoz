# Poke Fresh: cola de pedidos con ActiveMQ

Dos programas en Python que se comunican por una cola de mensajes de ActiveMQ usando STOMP (puerto 61613):

- `productor.py` envía un pedido a la cola `/queue/pedidos` en uno de cuatro formatos.
- `consumidor.py` escucha la cola, interpreta cada mensaje y responde ACK si está bien o NACK si viene malo.

```
productor.py ──STOMP──> ActiveMQ  /queue/pedidos ──STOMP──> consumidor.py
                                     │                          │
                                     └── ActiveMQ.DLQ <── NACK ──┘
```

## Instalación

**1. ActiveMQ.** Descargar ActiveMQ Classic desde https://activemq.apache.org/components/classic/download/, descomprimir y levantarlo desde la carpeta `bin`:

```bash
cd apache-activemq-<versión>/bin
activemq start
```

En Windows, si `activemq start` no funciona, usar `activemq.bat start`. Necesita Java instalado.

La consola web queda en http://localhost:8161/admin (usuario `admin`, clave `admin`). Ahí se ven la cola `pedidos` y los mensajes rechazados en `ActiveMQ.DLQ`. El conector STOMP en el puerto 61613 viene activado por defecto.

**2. La librería:**

```bash
pip install stomp.py
```

## Uso

Primero se deja corriendo el consumidor en una terminal:

```bash
python consumidor.py
```

Y en otra se mandan pedidos:

```bash
python productor.py --formato texto --mensaje "Hola desde Poke Fresh"
python productor.py --formato fijo  --id 101 --cliente "Kevin Muñoz" --monto 8990
python productor.py --formato xml   --id 102 --cliente "Ana Rojas"   --monto 12400.50
python productor.py --formato json  --id 103 --cliente "Luis Pérez"  --monto 6990
```

El consumidor muestra cada mensaje:

```
Escuchando /queue/pedidos en localhost:61613. Ctrl+C para salir.
[ACK]  texto texto: "Hola desde Poke Fresh"
[ACK]  fijo  pedido 000101, cliente Kevin Muñoz, monto $8.990,00
[ACK]  xml   pedido 000102, cliente Ana Rojas, monto $12.400,50
[ACK]  json  pedido 000103, cliente Luis Pérez, monto $6.990,00
```

Se detiene con Ctrl+C.

### Argumentos

| Argumento | Productor | Consumidor | Por defecto |
|---|---|---|---|
| `--formato` | `texto`, `fijo`, `xml` o `json` (obligatorio) | | |
| `--mensaje` | texto a enviar en formato `texto` | | |
| `--id` | id del pedido, hasta 6 dígitos | | |
| `--cliente` | nombre, hasta 20 caracteres | | |
| `--monto` | monto con punto decimal | | |
| `--host` | sí | sí | `localhost` |
| `--puerto` | sí | sí | `61613` |
| `--usuario` | sí | sí | `admin` |
| `--clave` | sí | sí | `admin` |

## Formatos

| Formato | Ejemplo |
|---|---|
| `texto` | `Hola desde Poke Fresh` |
| `fijo` | `000101Kevin Muñoz            8990.00` |
| `xml` | `<pedido><id>101</id><cliente>Kevin Muñoz</cliente><monto>8990.00</monto></pedido>` |
| `json` | `{"id": "101", "cliente": "Kevin Muñoz", "monto": "8990.00"}` |

El formato fijo tiene siempre 36 caracteres:

```
000101Kevin Muñoz            8990.00
|-6--||--------20--------||---10---|
  id        cliente          monto
```

El id se rellena con ceros a la izquierda, el cliente con espacios a la derecha y el monto con espacios a la izquierda, siempre con 2 decimales.

El productor agrega una cabecera `formato` a cada mensaje, para que el consumidor sepa cómo leerlo. Si llega un mensaje sin esa cabecera (por ejemplo, enviado a mano desde la consola web), el consumidor deduce el formato por el contenido.

## El monto

El monto se valida con `Decimal` y no con `float`, porque `float` no guarda bien los decimales: en Python, `0.1 + 0.2` da `0.30000000000000004`.

- Se escribe con punto decimal y sin separador de miles: `8990` o `8990.50`.
- Ojo con `8.990`: para Python eso es 8 con 99 centavos, no ocho mil novecientos noventa. Por eso el productor rechaza montos con más de 2 decimales en vez de redondearlos.
- También se rechazan los montos negativos, los que no son números y los que no caben en 10 caracteres (el máximo es 9999999.99).
- En JSON el monto va entre comillas, como texto, para que al leerlo no pase por `float`.

Si un dato está mal, el productor muestra el error y no se conecta a ActiveMQ.

## ACK y NACK

El consumidor se suscribe con `ack="client-individual"`: cada mensaje se confirma por separado.

- **ACK**: el mensaje se interpretó bien y ActiveMQ lo borra de la cola.
- **NACK**: el mensaje viene malo. ActiveMQ lo saca de la cola y lo manda a `ActiveMQ.DLQ`, la cola de mensajes muertos, donde se puede revisar desde la consola web.

Un mensaje recibe NACK si, por ejemplo:
- en formato fijo no tiene 36 caracteres, el id no son dígitos o el monto no tiene 2 decimales;
- el XML está mal formado, no tiene la raíz `<pedido>` o le falta un campo;
- el JSON está mal formado, no es un objeto o le falta un campo;
- el monto no es un número válido.

```
[NACK] el formato fijo debe tener 36 caracteres y tiene 11. Recibido: '000106Corto'
[NACK] al XML le falta: monto. Recibido: '<pedido><id>107</id></pedido>'
```

Si un mensaje queda sin confirmar porque el consumidor se cerró antes, ActiveMQ lo vuelve a entregar la próxima vez que alguien se conecte. Los mensajes enviados mientras no hay ningún consumidor también esperan en la cola.

## El Escuchador

`consumidor.py` tiene la clase `Escuchador`, que hereda de `stomp.ConnectionListener` y recibe los eventos de la conexión:

- `on_message`: interpreta el mensaje y hace ACK o NACK.
- `on_error`: muestra los errores que manda ActiveMQ.
- `on_disconnected`: avisa que se cortó la conexión. El loop principal, que revisa cada 0,5 segundos, intenta reconectarse cada 5 segundos hasta que ActiveMQ vuelve.

## Pruebas

```bash
pip install -r requirements.txt
pytest
```

Son 59 pruebas. No necesitan ActiveMQ: usan un broker STOMP de prueba (`tests/broker_falso.py`) que imita cómo ActiveMQ maneja el ACK, el NACK y la cola de mensajes muertos. Revisan la validación del monto, los cuatro formatos de ida y vuelta, los mensajes malos, la reconexión cuando el broker se cae y los errores de conexión.

Las pruebas de punta a punta simulan un Ctrl+C, y en Windows eso funciona distinto, así que ahí se saltan. Las demás corren igual.

## Archivos

```
productor.py              envía pedidos
consumidor.py             recibe e interpreta pedidos
tests/broker_falso.py     broker STOMP para las pruebas
tests/test_mensajeria.py  pruebas
requirements.txt
```
