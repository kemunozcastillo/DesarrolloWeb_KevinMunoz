"""
Pruebas del productor y el consumidor.

Las de formato no necesitan broker. Las de punta a punta levantan un broker
STOMP de prueba (tests/broker_falso.py) y corren los programas como procesos
aparte, igual que se usarían de verdad.

    pytest
"""

import json
import os
import signal
import subprocess
import sys
import time
from decimal import Decimal
from pathlib import Path

import pytest
import stomp

import consumidor
import productor
from tests.broker_falso import DLQ, BrokerFalso

RAIZ = Path(__file__).resolve().parent.parent
COLA = "/queue/pedidos"


# ---------------------------------------------------------------------------
# Productor: validación del monto
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "texto, esperado",
    [("8990", "8990.00"), ("8990.5", "8990.50"), ("0", "0.00"), (" 12400.50 ", "12400.50"), ("9999999.99", "9999999.99")],
)
def test_monto_valido_queda_con_dos_decimales(texto, esperado):
    monto = productor.validar_monto(texto)
    assert isinstance(monto, Decimal)
    assert str(monto) == esperado


@pytest.mark.parametrize(
    "texto, pista",
    [
        ("8.990", "más de 2 decimales"),  # error típico: punto como separador de miles
        ("abc", "no es un número"),
        ("8,990", "no es un número"),
        ("-100", "negativo"),
        ("1e3", "notación científica"),
        ("NaN", "finito"),
        ("Infinity", "finito"),
        ("10000000.00", "no cabe"),
    ],
)
def test_monto_invalido_se_rechaza(texto, pista):
    with pytest.raises(productor.ErrorPedido, match=pista):
        productor.validar_monto(texto)


def test_decimal_no_pierde_precision_como_float():
    assert 0.1 + 0.2 != 0.3
    assert productor.validar_monto("0.1") + productor.validar_monto("0.2") == productor.validar_monto("0.3")


# ---------------------------------------------------------------------------
# Productor: formatos
# ---------------------------------------------------------------------------


def test_fijo_tiene_36_caracteres_con_cada_campo_en_su_lugar():
    linea = productor.armar_mensaje("fijo", id_pedido="101", cliente="Kevin Muñoz", monto="8990")

    assert len(linea) == 36
    assert linea[:6] == "000101"
    assert linea[6:26] == "Kevin Muñoz".ljust(20)
    assert linea[26:] == "   8990.00"


def test_xml_tiene_raiz_pedido_y_un_elemento_por_campo():
    import xml.etree.ElementTree as ET

    raiz = ET.fromstring(productor.armar_mensaje("xml", id_pedido="7", cliente="Ana & Luis <SpA>", monto="12.5"))
    assert raiz.tag == "pedido"
    assert [h.tag for h in raiz] == ["id", "cliente", "monto"]
    assert raiz.find("cliente").text == "Ana & Luis <SpA>"  # escapado al enviar, intacto al leer
    assert raiz.find("monto").text == "12.50"


def test_json_lleva_el_monto_como_texto():
    datos = json.loads(productor.armar_mensaje("json", id_pedido="103", cliente="Luis Pérez", monto="6990"))
    assert datos == {"id": "103", "cliente": "Luis Pérez", "monto": "6990.00"}


def test_texto_se_envia_tal_cual():
    assert productor.armar_mensaje("texto", mensaje="Hola, ¿qué tal?") == "Hola, ¿qué tal?"


@pytest.mark.parametrize(
    "argumentos, pista",
    [
        ({"formato": "texto"}, "necesita --mensaje"),
        ({"formato": "fijo", "cliente": "Kevin", "monto": "1"}, "necesitan --id"),
        ({"formato": "json", "id_pedido": "1", "cliente": "Kevin"}, "necesitan --monto"),
        ({"formato": "xml", "id_pedido": "1234567", "cliente": "Kevin", "monto": "1"}, "más de 6 dígitos"),
        ({"formato": "xml", "id_pedido": "12a", "cliente": "Kevin", "monto": "1"}, "solo dígitos"),
        ({"formato": "fijo", "id_pedido": "1", "cliente": "Un nombre demasiado largo", "monto": "1"}, "más de 20 caracteres"),
        ({"formato": "fijo", "id_pedido": "1", "cliente": "   ", "monto": "1"}, "vacío"),
    ],
)
def test_datos_incompletos_o_invalidos_se_rechazan(argumentos, pista):
    with pytest.raises(productor.ErrorPedido, match=pista):
        productor.armar_mensaje(**argumentos)


# ---------------------------------------------------------------------------
# Consumidor: interpretación
# ---------------------------------------------------------------------------


def fijo(id_pedido, cliente, monto):
    """Arma una línea de 36 caracteres sin validar, para probar mensajes malos."""
    return f"{id_pedido:<6}{cliente:<20}{monto:>10}"


@pytest.mark.parametrize("formato", ["fijo", "xml", "json"])
def test_lo_que_arma_el_productor_lo_entiende_el_consumidor(formato):
    cuerpo = productor.armar_mensaje(formato, id_pedido="101", cliente="Kevin Muñoz", monto="8990.5")
    _, datos = consumidor.interpretar(cuerpo, formato)
    assert datos == {"id": "000101", "cliente": "Kevin Muñoz", "monto": Decimal("8990.50")}


def test_json_con_monto_numerico_no_pasa_por_float():
    _, datos = consumidor.interpretar('{"id": "1", "cliente": "A", "monto": 0.10}', "json")
    assert datos["monto"] == Decimal("0.10")


@pytest.mark.parametrize(
    "formato, cuerpo, pista",
    [
        ("texto", "   ", "vacío"),
        ("fijo", "000106Corto", "36 caracteres"),
        ("fijo", fijo("ABC123", "Kevin", "10.00") + "x", "36 caracteres"),
        ("fijo", fijo("ABC123", "Kevin", "10.00"), "deben ser el id"),
        ("fijo", fijo("000001", "Kevin", "1000.0"), "2 decimales"),
        ("fijo", fijo("000001", "", "10.00"), "falta el cliente"),
        ("fijo", fijo("000001", "Kevin", "-10.00"), "no es válido"),
        ("xml", "<pedido><id>1</id><cliente>A</cliente></pedido>", "falta: monto"),
        ("xml", "<orden><id>1</id></orden>", "raíz"),
        ("xml", "<pedido><id>1</id>", "mal formado"),
        ("xml", "<pedido><id>1</id><id>2</id><cliente>A</cliente><monto>1</monto></pedido>", "repetido"),
        ("xml", '<!DOCTYPE p [<!ENTITY x "y">]><pedido></pedido>', "DOCTYPE"),
        ("json", '{"id": "1", "cliente": "A"', "mal formado"),
        ("json", '["no", "es", "objeto"]', "objeto"),
        ("json", '{"id": "1", "cliente": "A"}', "falta: monto"),
        ("json", '{"id": "1", "cliente": "A", "monto": "8.990"}', "más de 2 decimales"),
        ("json", '{"id": "1", "cliente": "A", "monto": "gratis"}', "no es un número"),
        ("csv", "1;A;10", "desconocido"),
    ],
)
def test_mensajes_malos_se_rechazan(formato, cuerpo, pista):
    with pytest.raises(consumidor.MensajeInvalido, match=pista):
        consumidor.interpretar(cuerpo, formato)


@pytest.mark.parametrize(
    "cuerpo, formato",
    [("<pedido/>", "xml"), ('{"a": 1}', "json"), ("000101Kevin Muñoz            8990.00", "fijo"), ("Hola", "texto")],
)
def test_sin_cabecera_se_deduce_el_formato(cuerpo, formato):
    assert consumidor.detectar_formato(cuerpo) == formato


def test_montos_se_muestran_en_formato_chileno():
    assert consumidor.pesos(Decimal("1234567.50")) == "$1.234.567,50"
    assert consumidor.pesos(Decimal("990.00")) == "$990,00"


# ---------------------------------------------------------------------------
# Punta a punta, con el broker de prueba
# ---------------------------------------------------------------------------


@pytest.fixture
def broker():
    servidor = BrokerFalso().iniciar()
    yield servidor
    servidor.detener()


def correr(script, *argumentos, broker, timeout=20):
    return subprocess.run(
        [sys.executable, script, *argumentos, "--host", "127.0.0.1", "--puerto", str(broker.puerto)],
        cwd=RAIZ, capture_output=True, text=True, timeout=timeout,
    )


def lanzar_consumidor(broker, *extra):
    proceso = subprocess.Popen(
        [sys.executable, "-u", "consumidor.py", "--host", "127.0.0.1", "--puerto", str(broker.puerto), *extra],
        cwd=RAIZ, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    esperar(lambda: any(c.suscripciones for c in broker.clientes))
    return proceso


def esperar(condicion, segundos=8):
    limite = time.time() + segundos
    while time.time() < limite:
        if condicion():
            return
        time.sleep(0.05)
    raise AssertionError("no se cumplió a tiempo")


def cortar_con_ctrl_c(proceso):
    proceso.send_signal(signal.SIGINT)
    salida, _ = proceso.communicate(timeout=10)
    return proceso.returncode, salida


@pytest.mark.skipif(os.name == "nt", reason="Ctrl+C a un proceso hijo se simula distinto en Windows")
def test_los_cuatro_formatos_llegan_y_se_confirman(broker):
    proceso = lanzar_consumidor(broker)

    assert correr("productor.py", "--formato", "texto", "--mensaje", "Hola desde Poke Fresh", broker=broker).returncode == 0
    assert correr("productor.py", "--formato", "fijo", "--id", "101", "--cliente", "Kevin Muñoz", "--monto", "8990", broker=broker).returncode == 0
    assert correr("productor.py", "--formato", "xml", "--id", "102", "--cliente", "Ana & Luis", "--monto", "12400.50", broker=broker).returncode == 0
    assert correr("productor.py", "--formato", "json", "--id", "103", "--cliente", "Luis Pérez", "--monto", "6990", broker=broker).returncode == 0

    esperar(lambda: len(broker.confirmados) == 4)
    codigo, salida = cortar_con_ctrl_c(proceso)

    assert codigo == 0
    assert salida.count("[ACK]") == 4
    assert "pedido 000101, cliente Kevin Muñoz, monto $8.990,00" in salida
    assert "cliente Ana & Luis, monto $12.400,50" in salida
    assert "Procesados: 4, rechazados: 0" in salida
    assert broker.en_cola(COLA) == [] and broker.en_cola(DLQ) == []


@pytest.mark.skipif(os.name == "nt", reason="Ctrl+C a un proceso hijo se simula distinto en Windows")
def test_mensajes_malos_reciben_nack_y_van_a_la_dlq(broker):
    proceso = lanzar_consumidor(broker)

    conexion = stomp.Connection12([("127.0.0.1", broker.puerto)])
    conexion.connect("admin", "admin", wait=True)
    conexion.send(COLA, "000106Corto", headers={"formato": "fijo"})
    conexion.send(COLA, "<pedido><id>107</id></pedido>", headers={"formato": "xml"})
    conexion.send(COLA, '{"id": "108"', headers={"formato": "json"})
    conexion.send(COLA, '{"id": "109", "cliente": "Bien", "monto": "990.00"}')  # sin cabecera, pero válido
    conexion.disconnect()

    esperar(lambda: len(broker.confirmados) + len(broker.rechazados) == 4)
    _, salida = cortar_con_ctrl_c(proceso)

    assert salida.count("[NACK]") == 3
    assert salida.count("[ACK]") == 1
    assert len(broker.en_cola(DLQ)) == 3
    assert broker.en_cola(COLA) == []


@pytest.mark.skipif(os.name == "nt", reason="Ctrl+C a un proceso hijo se simula distinto en Windows")
def test_mensajes_enviados_antes_de_conectar_no_se_pierden(broker):
    correr("productor.py", "--formato", "json", "--id", "1", "--cliente", "Temprano", "--monto", "100", broker=broker)
    assert len(broker.en_cola(COLA)) == 1

    proceso = lanzar_consumidor(broker)
    esperar(lambda: len(broker.confirmados) == 1)
    _, salida = cortar_con_ctrl_c(proceso)
    assert "cliente Temprano" in salida


@pytest.mark.skipif(os.name == "nt", reason="Ctrl+C a un proceso hijo se simula distinto en Windows")
def test_si_el_broker_se_cae_el_consumidor_se_reconecta():
    primero = BrokerFalso().iniciar()
    puerto = primero.puerto
    proceso = lanzar_consumidor(primero)

    primero.detener()
    time.sleep(1)
    segundo = BrokerFalso(puerto=puerto).iniciar()
    try:
        esperar(lambda: any(c.suscripciones for c in segundo.clientes), segundos=15)
        correr("productor.py", "--formato", "texto", "--mensaje", "Después de la caída", broker=segundo)
        esperar(lambda: len(segundo.confirmados) == 1)
        _, salida = cortar_con_ctrl_c(proceso)
    finally:
        segundo.detener()

    assert "[Desconectado]" in salida
    assert "[Reconectado]" in salida
    assert "Después de la caída" in salida


def test_credenciales_malas(broker):
    resultado = correr("consumidor.py", "--clave", "incorrecta", broker=broker)
    assert resultado.returncode == 1
    assert "rechazó la conexión" in resultado.stderr

    resultado = correr("productor.py", "--formato", "texto", "--mensaje", "x", "--clave", "incorrecta", broker=broker)
    assert resultado.returncode == 1


def test_sin_broker_se_informa_y_termina():
    falso = BrokerFalso()  # se reserva un puerto y se cierra sin iniciar: nadie escucha ahí
    falso.detener()

    resultado = correr("productor.py", "--formato", "texto", "--mensaje", "x", broker=falso)
    assert resultado.returncode == 1
    assert "no se pudo conectar" in resultado.stderr
    assert "could not connect" not in resultado.stderr  # sin los avisos en inglés de stomp.py

    resultado = correr("consumidor.py", broker=falso)
    assert resultado.returncode == 1
    assert "¿Está corriendo?" in resultado.stderr


def test_productor_con_dato_malo_no_se_conecta(broker):
    resultado = correr("productor.py", "--formato", "fijo", "--id", "1", "--cliente", "Kevin", "--monto", "8.990", broker=broker)
    assert resultado.returncode == 2
    assert "8.990" in resultado.stderr
    assert broker.clientes == []
