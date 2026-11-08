"""
Eventos a ActiveMQ (STOMP), con el mismo formato que el productor de la
semana 13.

Cuando un pedido queda pagado se publican dos mensajes:
  /queue/correos   la boleta para enviar al correo del cliente
  /queue/cocina    aviso de pedido nuevo para la pantalla de cocina

Publicar es "mejor esfuerzo": si ActiveMQ no está, el pedido igual queda
pagado (la cocina lo ve en su pantalla, que consulta cada pocos segundos) y
se deja constancia en el log. Un pago confirmado nunca se pierde porque el
broker esté caído.
"""

import asyncio
import json
import logging

from comun.config import ajustes

registro = logging.getLogger("pedidos.eventos")
logging.getLogger("stomp.py").setLevel(logging.CRITICAL)

# Las pruebas guardan aquí lo que se habría publicado.
publicados: list[tuple[str, dict]] = []


def _enviar(cola: str, cuerpo: dict) -> None:
    import stomp

    a = ajustes()
    conexion = stomp.Connection12([(a.activemq_host, a.activemq_puerto)], reconnect_attempts_max=1, timeout=2)
    if a.activemq_ca:
        conexion.set_ssl(for_hosts=[(a.activemq_host, a.activemq_puerto)], ca_certs=a.activemq_ca)
    conexion.connect(wait=True)
    try:
        conexion.send(
            destination=cola,
            body=json.dumps(cuerpo, ensure_ascii=False),
            content_type="application/json",
            headers={"formato": "json", "persistent": "true"},
        )
    finally:
        conexion.disconnect()


async def publicar(cola: str, cuerpo: dict) -> bool:
    publicados.append((cola, cuerpo))
    if not ajustes().activemq_host:
        return False
    try:
        # stomp.py es bloqueante: se corre fuera del ciclo de eventos.
        await asyncio.wait_for(asyncio.to_thread(_enviar, cola, cuerpo), timeout=3)
        return True
    except Exception as error:  # noqa: BLE001
        registro.warning("no se pudo publicar en %s: %s", cola, error.__class__.__name__)
        return False
