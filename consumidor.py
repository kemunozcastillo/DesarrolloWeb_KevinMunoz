"""
Consumidor de pedidos de Poke Fresh.

Se suscribe a la cola /queue/pedidos de ActiveMQ por STOMP, interpreta cada
mensaje según su formato (texto, fijo, xml o json) y confirma:

  ACK   el mensaje se interpretó bien: ActiveMQ lo borra de la cola.
  NACK  el mensaje viene malo: ActiveMQ no lo vuelve a entregar a este
        consumidor y lo manda a la cola de mensajes muertos (ActiveMQ.DLQ).

La suscripción usa ack client-individual: cada mensaje se confirma por
separado, y confirmar uno no confirma los anteriores.

Queda escuchando hasta que se corta con Ctrl+C.

  python consumidor.py
  python consumidor.py --host localhost --puerto 61613 --usuario admin --clave admin
"""

import argparse
import json
import logging
import sys
import threading
import time
import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation

import stomp

COLA = "/queue/pedidos"

# stomp.py anota cada intento de conexión fallido como aviso en inglés.
# Los errores se informan aquí, en español, así que se silencian sus avisos.
logging.getLogger("stomp.py").setLevel(logging.CRITICAL)
LARGO_ID, LARGO_CLIENTE, LARGO_MONTO = 6, 20, 10
LARGO_FIJO = LARGO_ID + LARGO_CLIENTE + LARGO_MONTO  # 36


class MensajeInvalido(ValueError):
    """El mensaje no se puede interpretar: se responde con NACK."""


class ErrorConexion(Exception):
    """No se pudo conectar o suscribir al broker."""


# ---------------------------------------------------------------------------
# Validación de los campos
# ---------------------------------------------------------------------------


def leer_monto(valor):
    """Monto como Decimal con exactamente 2 decimales. Nunca pasa por float."""
    # Sin notación científica: "1e3" es un Decimal válido, pero no un monto que alguien escriba.
    if "e" in str(valor).lower():
        raise MensajeInvalido(f'el monto "{valor}" no debe usar notación científica')
    try:
        monto = Decimal(str(valor).strip())
    except InvalidOperation:
        raise MensajeInvalido(f'el monto "{valor}" no es un número')
    if not monto.is_finite() or monto < 0:
        raise MensajeInvalido(f'el monto "{valor}" no es válido')
    if monto.as_tuple().exponent < -2:
        raise MensajeInvalido(f'el monto "{valor}" tiene más de 2 decimales')
    return monto.quantize(Decimal("0.01"))


def armar_pedido(id_pedido, cliente, monto):
    id_pedido = str(id_pedido).strip()
    cliente = str(cliente).strip()

    if not id_pedido.isdigit() or len(id_pedido) > LARGO_ID:
        raise MensajeInvalido(f'el id "{id_pedido}" debe tener entre 1 y {LARGO_ID} dígitos')
    if not cliente:
        raise MensajeInvalido("falta el cliente")
    if len(cliente) > LARGO_CLIENTE:
        raise MensajeInvalido(f"el cliente tiene más de {LARGO_CLIENTE} caracteres")

    return {"id": id_pedido.zfill(LARGO_ID), "cliente": cliente, "monto": leer_monto(monto)}


# ---------------------------------------------------------------------------
# Un intérprete por formato
# ---------------------------------------------------------------------------


def interpretar_texto(cuerpo):
    if not cuerpo.strip():
        raise MensajeInvalido("el mensaje de texto está vacío")
    return {"texto": cuerpo}


def interpretar_fijo(cuerpo):
    if len(cuerpo) != LARGO_FIJO:
        raise MensajeInvalido(f"el formato fijo debe tener {LARGO_FIJO} caracteres y tiene {len(cuerpo)}")

    id_pedido = cuerpo[:LARGO_ID]
    cliente = cuerpo[LARGO_ID : LARGO_ID + LARGO_CLIENTE]
    monto = cuerpo[LARGO_ID + LARGO_CLIENTE :]

    if not id_pedido.isdigit():
        raise MensajeInvalido(f'los primeros {LARGO_ID} caracteres deben ser el id y llegó "{id_pedido}"')
    if "." not in monto or len(monto.strip().split(".")[1]) != 2:
        raise MensajeInvalido(f'el monto "{monto.strip()}" debe llevar 2 decimales')

    return armar_pedido(id_pedido, cliente, monto)


def interpretar_xml(cuerpo):
    # Se rechazan los DOCTYPE: con ellos un XML puede declarar entidades que
    # se expanden a gigabytes (ataque "billion laughs") o leer archivos.
    if "<!DOCTYPE" in cuerpo.upper() or "<!ENTITY" in cuerpo.upper():
        raise MensajeInvalido("el XML no puede traer DOCTYPE ni entidades")

    try:
        raiz = ET.fromstring(cuerpo)
    except ET.ParseError as error:
        raise MensajeInvalido(f"el XML está mal formado ({error})")

    if raiz.tag != "pedido":
        raise MensajeInvalido(f"la raíz del XML debe ser <pedido> y es <{raiz.tag}>")

    campos = {}
    for hijo in raiz:
        if hijo.tag in campos:
            raise MensajeInvalido(f"el campo <{hijo.tag}> está repetido")
        campos[hijo.tag] = hijo.text or ""

    faltan = [c for c in ("id", "cliente", "monto") if c not in campos]
    if faltan:
        raise MensajeInvalido(f"al XML le falta: {', '.join(faltan)}")

    return armar_pedido(campos["id"], campos["cliente"], campos["monto"])


def interpretar_json(cuerpo):
    try:
        # parse_float=Decimal: si el monto viniera como número, no pasa por float.
        datos = json.loads(cuerpo, parse_float=Decimal)
    except json.JSONDecodeError as error:
        raise MensajeInvalido(f"el JSON está mal formado ({error.msg})")

    if not isinstance(datos, dict):
        raise MensajeInvalido("el JSON debe ser un objeto")

    faltan = [c for c in ("id", "cliente", "monto") if c not in datos]
    if faltan:
        raise MensajeInvalido(f"al JSON le falta: {', '.join(faltan)}")

    return armar_pedido(datos["id"], datos["cliente"], datos["monto"])


INTERPRETES = {
    "texto": interpretar_texto,
    "fijo": interpretar_fijo,
    "xml": interpretar_xml,
    "json": interpretar_json,
}


def detectar_formato(cuerpo):
    """
    Respaldo para mensajes que llegan sin la cabecera "formato", por ejemplo
    enviados a mano desde la consola web de ActiveMQ.
    """
    inicio = cuerpo.lstrip()
    if inicio.startswith("<"):
        return "xml"
    if inicio.startswith("{"):
        return "json"
    if len(cuerpo) == LARGO_FIJO and cuerpo[:LARGO_ID].isdigit():
        return "fijo"
    return "texto"


def interpretar(cuerpo, formato=None):
    """Devuelve (formato, datos) o lanza MensajeInvalido."""
    formato = formato or detectar_formato(cuerpo)
    if formato not in INTERPRETES:
        raise MensajeInvalido(f'formato desconocido "{formato}"')
    return formato, INTERPRETES[formato](cuerpo)


def pesos(monto):
    """8990.50 -> "$8.990,50", como se escriben los montos en Chile."""
    entero, decimales = f"{monto:.2f}".split(".")
    return f"${int(entero):,}".replace(",", ".") + f",{decimales}"


def describir(formato, datos):
    if formato == "texto":
        return f'texto: "{datos["texto"]}"'
    return f'pedido {datos["id"]}, cliente {datos["cliente"]}, monto {pesos(datos["monto"])}'


# ---------------------------------------------------------------------------
# Escuchador
# ---------------------------------------------------------------------------


class Escuchador(stomp.ConnectionListener):
    """Recibe los eventos de la conexión: mensajes, errores y desconexión."""

    def __init__(self, conexion):
        self.conexion = conexion
        self.desconectado = threading.Event()
        self.procesados = 0
        self.rechazados = 0
        self.ultimo_error = None
        self.escuchando = False  # True una vez conectado y suscrito

    def on_error(self, frame):
        # Error que manda el broker: credenciales malas, un ACK inválido, etc.
        self.ultimo_error = frame.headers.get("message") or (frame.body or "").strip() or "error sin detalle"
        # Durante la conexión no se imprime: conectar() lo informa al fallar.
        if self.escuchando:
            print(f"[ERROR del broker] {self.ultimo_error}", file=sys.stderr)

    def on_disconnected(self):
        if self.escuchando:
            print("[Desconectado] Se perdió la conexión con ActiveMQ.", file=sys.stderr)
        self.escuchando = False
        self.desconectado.set()

    def on_message(self, frame):
        cuerpo = frame.body if isinstance(frame.body, str) else frame.body.decode("utf-8", errors="replace")
        formato = frame.headers.get("formato")

        try:
            formato, datos = interpretar(cuerpo, formato)
        except MensajeInvalido as error:
            self.rechazados += 1
            print(f"[NACK] {error}. Recibido: {cuerpo[:80]!r}")
            self._confirmar(frame, aceptar=False)
            return
        except Exception as error:  # un error inesperado tampoco debe dejar el mensaje colgado
            self.rechazados += 1
            print(f"[NACK] error inesperado: {error}")
            self._confirmar(frame, aceptar=False)
            return

        self.procesados += 1
        print(f"[ACK]  {formato.ljust(5)} {describir(formato, datos)}")
        self._confirmar(frame, aceptar=True)

    def _confirmar(self, frame, aceptar):
        """
        ACK o NACK del mensaje. En STOMP 1.2 se identifica con la cabecera
        "ack"; en 1.1, con message-id y subscription.
        """
        metodo = self.conexion.ack if aceptar else self.conexion.nack
        if "ack" in frame.headers:
            metodo(frame.headers["ack"])
        else:
            metodo(frame.headers["message-id"], frame.headers["subscription"])


# ---------------------------------------------------------------------------
# Conexión y loop principal
# ---------------------------------------------------------------------------


def conectar(host, puerto, usuario, clave):
    # Un solo intento por llamada: los reintentos los maneja el loop principal.
    conexion = stomp.Connection12([(host, puerto)], heartbeats=(10000, 10000), reconnect_attempts_max=1)
    escuchador = Escuchador(conexion)
    conexion.set_listener("pedidos", escuchador)
    try:
        conexion.connect(usuario, clave, wait=True)
    except stomp.exception.ConnectFailedException:
        if escuchador.ultimo_error:
            raise ErrorConexion(f"ActiveMQ rechazó la conexión: {escuchador.ultimo_error}")
        raise ErrorConexion(f"no se pudo conectar a ActiveMQ en {host}:{puerto}. ¿Está corriendo?")
    conexion.subscribe(destination=COLA, id="pedidos-1", ack="client-individual")
    escuchador.escuchando = True
    return conexion, escuchador


def leer_argumentos(argumentos=None):
    parser = argparse.ArgumentParser(description="Escucha la cola /queue/pedidos de ActiveMQ.")
    parser.add_argument("--host", default="localhost", help="host de ActiveMQ (por defecto localhost)")
    parser.add_argument("--puerto", type=int, default=61613, help="puerto STOMP (por defecto 61613)")
    parser.add_argument("--usuario", default="admin", help="usuario de ActiveMQ (por defecto admin)")
    parser.add_argument("--clave", default="admin", help="clave de ActiveMQ (por defecto admin)")
    return parser.parse_args(argumentos)


def main(argumentos=None):
    args = leer_argumentos(argumentos)

    try:
        conexion, escuchador = conectar(args.host, args.puerto, args.usuario, args.clave)
    except ErrorConexion as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print(f"Escuchando {COLA} en {args.host}:{args.puerto}. Ctrl+C para salir.")

    try:
        while True:
            time.sleep(0.5)

            # Si se cae la conexión, se reintenta cada 5 segundos.
            if escuchador.desconectado.is_set():
                procesados, rechazados = escuchador.procesados, escuchador.rechazados
                try:
                    conexion, escuchador = conectar(args.host, args.puerto, args.usuario, args.clave)
                    escuchador.procesados, escuchador.rechazados = procesados, rechazados
                    print("[Reconectado] Escuchando de nuevo.")
                except ErrorConexion as error:
                    print(f"[Reintentando en 5 s] {error}", file=sys.stderr)
                    time.sleep(5)
    except KeyboardInterrupt:
        print(f"\nCerrando. Procesados: {escuchador.procesados}, rechazados: {escuchador.rechazados}.")
    finally:
        escuchador.escuchando = False  # una salida pedida no es una caída
        if conexion.is_connected():
            conexion.disconnect()

    return 0


if __name__ == "__main__":
    sys.exit(main())
