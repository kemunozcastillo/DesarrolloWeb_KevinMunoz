"""
Notificador: consume las colas de ActiveMQ que publica el servicio de pedidos.

  /queue/correos   boletas por enviar al correo del cliente
  /queue/cocina    avisos de pedido pagado

Es el consumidor de la semana 13 llevado al sistema: suscripción con ack
client-individual, ACK si el mensaje se procesó, NACK si venía mal formado
(ActiveMQ lo manda a ActiveMQ.DLQ) y reconexión si el broker se cae.

El envío de correo se simula: se escribe en el log a quién se enviaría.
"""

import json
import logging
import os
import signal
import time

import stomp

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s notificador %(message)s")
logging.getLogger("stomp.py").setLevel(logging.CRITICAL)
registro = logging.getLogger("notificador")

COLAS = ("/queue/correos", "/queue/cocina")


def procesar(destino: str, cuerpo: str) -> str:
    """Devuelve el texto registrado. Lanza ValueError si el mensaje no sirve."""
    datos = json.loads(cuerpo)
    if destino.endswith("correos"):
        if datos.get("tipo") != "BOLETA" or "@" not in str(datos.get("para", "")):
            raise ValueError("correo sin destinatario")
        # El correo completo no va al log: basta el dominio para seguirlo.
        dominio = datos["para"].split("@")[1]
        return f"boleta N° {datos['boleta']} del pedido {datos['pedido']} enviada a ***@{dominio} (simulado)"
    if datos.get("tipo") != "PEDIDO_PAGADO":
        raise ValueError("evento desconocido")
    return f"cocina: nuevo pedido {datos['pedido']} ({datos.get('modoEntrega', '?')})"


class Escuchador(stomp.ConnectionListener):
    def __init__(self, conexion):
        self.conexion = conexion
        self.conectado = True

    def on_message(self, frame):
        destino = frame.headers.get("destination", "")
        try:
            registro.info(procesar(destino, frame.body))
            self.conexion.ack(frame.headers["ack"], frame.headers["subscription"])
        except (ValueError, KeyError, TypeError) as error:
            registro.warning("mensaje inválido en %s (%s): va a la DLQ", destino, error)
            self.conexion.nack(frame.headers["ack"], frame.headers["subscription"])

    def on_disconnected(self):
        self.conectado = False


def conectar():
    host = os.environ.get("ACTIVEMQ_HOST", "localhost")
    puerto = int(os.environ.get("ACTIVEMQ_PUERTO", "61613"))
    conexion = stomp.Connection12([(host, puerto)], reconnect_attempts_max=1)
    escuchador = Escuchador(conexion)
    conexion.set_listener("", escuchador)
    conexion.connect(os.environ.get("ACTIVEMQ_USUARIO", "admin"), os.environ.get("ACTIVEMQ_CLAVE", "admin"), wait=True)
    for i, cola in enumerate(COLAS):
        conexion.subscribe(destination=cola, id=str(i + 1), ack="client-individual")
    registro.info("escuchando %s en %s:%s", ", ".join(COLAS), host, puerto)
    return conexion, escuchador


def main():
    seguir = True

    def detener(*_):
        nonlocal seguir
        seguir = False

    signal.signal(signal.SIGTERM, detener)
    signal.signal(signal.SIGINT, detener)

    conexion, escuchador = None, None
    while seguir:
        if escuchador is None or not escuchador.conectado:
            try:
                conexion, escuchador = conectar()
            except stomp.exception.ConnectFailedException:
                registro.warning("ActiveMQ no responde; reintento en 5 s")
                time.sleep(5)
                continue
        time.sleep(0.5)

    if conexion and conexion.is_connected():
        conexion.disconnect()


if __name__ == "__main__":
    main()
