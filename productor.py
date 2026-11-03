"""
Productor de pedidos de Poke Fresh.

Envía un pedido a la cola /queue/pedidos de ActiveMQ por STOMP, en uno de
cuatro formatos:

  texto   el mensaje tal cual
  fijo    36 caracteres: id (6) + cliente (20) + monto (10, con 2 decimales)
  xml     <pedido><id/><cliente/><monto/></pedido>
  json    {"id": ..., "cliente": ..., "monto": "..."}

Ejemplos:
  python productor.py --formato texto --mensaje "Hola desde Poke Fresh"
  python productor.py --formato fijo --id 101 --cliente "Kevin Muñoz" --monto 8990
  python productor.py --formato xml  --id 102 --cliente "Ana Rojas" --monto 12400.50
  python productor.py --formato json --id 103 --cliente "Luis Pérez" --monto 6990
"""

import argparse
import json
import logging
import sys
import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation

import stomp

COLA = "/queue/pedidos"

# stomp.py anota cada intento de conexión fallido como aviso en inglés.
# Los errores se informan aquí, en español, así que se silencian sus avisos.
logging.getLogger("stomp.py").setLevel(logging.CRITICAL)
FORMATOS = ("texto", "fijo", "xml", "json")

# Largo de cada campo en el formato fijo. Suman 36.
LARGO_ID = 6
LARGO_CLIENTE = 20
LARGO_MONTO = 10


class ErrorPedido(ValueError):
    """Un dato del pedido no se puede enviar."""


# ---------------------------------------------------------------------------
# Validación
# ---------------------------------------------------------------------------


def validar_monto(texto):
    """
    Convierte el monto a Decimal y lo deja con 2 decimales.

    Se usa Decimal y no float porque float no representa bien los decimales:
    0.1 + 0.2 da 0.30000000000000004. En dinero eso no es aceptable.

    Se rechazan montos con más de 2 decimales en vez de redondearlos. Así se
    detecta un error común en Chile: escribir "8.990" pensando en ocho mil
    novecientos noventa, cuando para Decimal es 8,99.
    """
    # Sin notación científica: "1e3" es un Decimal válido, pero no un monto que alguien escriba.
    if "e" in str(texto).lower():
        raise ErrorPedido(f'El monto "{texto}" no debe usar notación científica: escribe 1000, no 1e3.')
    try:
        monto = Decimal(str(texto).strip())
    except InvalidOperation:
        raise ErrorPedido(f'El monto "{texto}" no es un número. Usa punto para los decimales, sin separador de miles: 8990 o 8990.50.')

    if not monto.is_finite():
        raise ErrorPedido("El monto debe ser un número finito.")
    if monto < 0:
        raise ErrorPedido("El monto no puede ser negativo.")
    if monto.as_tuple().exponent < -2:
        raise ErrorPedido(f'El monto "{texto}" tiene más de 2 decimales. Si quisiste escribir miles, va sin punto: 8990, no 8.990.')

    monto = monto.quantize(Decimal("0.01"))

    # En el formato fijo el monto ocupa 10 caracteres, incluido el punto.
    if len(f"{monto:.2f}") > LARGO_MONTO:
        raise ErrorPedido(f"El monto no cabe en {LARGO_MONTO} caracteres: el máximo es 9999999.99.")

    return monto


def validar_pedido(id_pedido, cliente):
    if id_pedido is None or cliente is None:
        raise ErrorPedido("Los formatos fijo, xml y json necesitan --id, --cliente y --monto.")

    id_pedido = str(id_pedido).strip()
    cliente = " ".join(str(cliente).split())  # quita espacios repetidos

    if not id_pedido.isdigit():
        raise ErrorPedido("El id debe tener solo dígitos.")
    if len(id_pedido) > LARGO_ID:
        raise ErrorPedido(f"El id no puede tener más de {LARGO_ID} dígitos.")
    if not cliente:
        raise ErrorPedido("El cliente no puede estar vacío.")
    if len(cliente) > LARGO_CLIENTE:
        raise ErrorPedido(f"El cliente no puede tener más de {LARGO_CLIENTE} caracteres (tiene {len(cliente)}).")

    return id_pedido, cliente


# ---------------------------------------------------------------------------
# Formatos
# ---------------------------------------------------------------------------


def armar_fijo(id_pedido, cliente, monto):
    """
    id con ceros a la izquierda, cliente relleno con espacios a la derecha y
    monto con espacios a la izquierda:

      000101Kevin Muñoz            8990.00
      |-6--||--------20--------||---10---|
    """
    linea = f"{id_pedido:0>{LARGO_ID}}{cliente:<{LARGO_CLIENTE}}{monto:>{LARGO_MONTO}.2f}"
    assert len(linea) == LARGO_ID + LARGO_CLIENTE + LARGO_MONTO
    return linea


def armar_xml(id_pedido, cliente, monto):
    # ElementTree escapa los caracteres especiales: un cliente "Ana & Luis"
    # queda como "Ana &amp; Luis" y el XML sigue siendo válido.
    raiz = ET.Element("pedido")
    ET.SubElement(raiz, "id").text = id_pedido
    ET.SubElement(raiz, "cliente").text = cliente
    ET.SubElement(raiz, "monto").text = f"{monto:.2f}"
    return ET.tostring(raiz, encoding="unicode")


def armar_json(id_pedido, cliente, monto):
    # El monto va como texto y no como número: un número JSON se lee como
    # float al otro lado y se perdería la precisión de Decimal.
    return json.dumps({"id": id_pedido, "cliente": cliente, "monto": f"{monto:.2f}"}, ensure_ascii=False)


def armar_mensaje(formato, mensaje=None, id_pedido=None, cliente=None, monto=None):
    """Devuelve el cuerpo listo para enviar."""
    if formato not in FORMATOS:
        raise ErrorPedido(f"Formato desconocido: {formato}.")

    if formato == "texto":
        if not mensaje or not mensaje.strip():
            raise ErrorPedido("El formato texto necesita --mensaje.")
        return mensaje

    id_pedido, cliente = validar_pedido(id_pedido, cliente)
    if monto is None:
        raise ErrorPedido("Los formatos fijo, xml y json necesitan --monto.")
    monto = validar_monto(monto)

    armadores = {"fijo": armar_fijo, "xml": armar_xml, "json": armar_json}
    return armadores[formato](id_pedido, cliente, monto)


# ---------------------------------------------------------------------------
# Envío
# ---------------------------------------------------------------------------

TIPOS_CONTENIDO = {
    "texto": "text/plain",
    "fijo": "text/plain",
    "xml": "application/xml",
    "json": "application/json",
}


def enviar(cuerpo, formato, host, puerto, usuario, clave):
    conexion = stomp.Connection12([(host, puerto)], reconnect_attempts_max=1)
    conexion.connect(usuario, clave, wait=True)
    try:
        conexion.send(
            destination=COLA,
            body=cuerpo,
            content_type=TIPOS_CONTENIDO[formato],
            headers={
                # Le dice al consumidor cómo interpretar el cuerpo.
                "formato": formato,
                # Persistente: si ActiveMQ se reinicia, el mensaje no se pierde.
                "persistent": "true",
            },
        )
    finally:
        conexion.disconnect()


def leer_argumentos(argumentos=None):
    parser = argparse.ArgumentParser(description="Envía un pedido a la cola /queue/pedidos de ActiveMQ.")
    parser.add_argument("--formato", choices=FORMATOS, required=True, help="formato del mensaje")
    parser.add_argument("--mensaje", help="texto a enviar (formato texto)")
    parser.add_argument("--id", dest="id_pedido", help=f"id del pedido, hasta {LARGO_ID} dígitos")
    parser.add_argument("--cliente", help=f"nombre del cliente, hasta {LARGO_CLIENTE} caracteres")
    parser.add_argument("--monto", help="monto con punto decimal y sin separador de miles, por ejemplo 8990.50")
    parser.add_argument("--host", default="localhost", help="host de ActiveMQ (por defecto localhost)")
    parser.add_argument("--puerto", type=int, default=61613, help="puerto STOMP (por defecto 61613)")
    parser.add_argument("--usuario", default="admin", help="usuario de ActiveMQ (por defecto admin)")
    parser.add_argument("--clave", default="admin", help="clave de ActiveMQ (por defecto admin)")
    return parser.parse_args(argumentos)


def main(argumentos=None):
    args = leer_argumentos(argumentos)

    try:
        cuerpo = armar_mensaje(args.formato, args.mensaje, args.id_pedido, args.cliente, args.monto)
    except ErrorPedido as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    try:
        enviar(cuerpo, args.formato, args.host, args.puerto, args.usuario, args.clave)
    except stomp.exception.ConnectFailedException:
        print(f"Error: no se pudo conectar a ActiveMQ en {args.host}:{args.puerto}. Revisa que esté corriendo y que el usuario y la clave sean correctos.", file=sys.stderr)
        return 1

    print(f"Enviado a {COLA} en formato {args.formato}:")
    print(cuerpo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
