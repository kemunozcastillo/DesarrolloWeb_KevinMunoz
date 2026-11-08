"""
Broker STOMP 1.2 mínimo para las pruebas, sin instalar ActiveMQ.

Imita lo que importa del comportamiento de ActiveMQ Classic:
  - exige usuario y clave (admin/admin);
  - guarda los mensajes en colas y los entrega a los suscriptores;
  - con ack client-individual, un mensaje entregado queda pendiente hasta
    que llega su ACK;
  - un ACK lo borra; un NACK lo manda a la cola de mensajes muertos
    (ActiveMQ.DLQ);
  - si el consumidor se desconecta sin confirmar, el mensaje vuelve a la cola.

No es un broker de verdad: es lo justo para probar el productor y el
consumidor de punta a punta.
"""

import itertools
import socket
import threading
from collections import deque

DLQ = "ActiveMQ.DLQ"

_ESCAPES = {"\\": "\\\\", "\n": "\\n", "\r": "\\r", ":": "\\c"}
_DESESCAPES = {"\\\\": "\\", "\\n": "\n", "\\r": "\r", "\\c": ":"}


def escapar(texto):
    return "".join(_ESCAPES.get(c, c) for c in texto)


def desescapar(texto):
    resultado, i = [], 0
    while i < len(texto):
        par = texto[i : i + 2]
        if par in _DESESCAPES:
            resultado.append(_DESESCAPES[par])
            i += 2
        else:
            resultado.append(texto[i])
            i += 1
    return "".join(resultado)


def armar_frame(comando, cabeceras=None, cuerpo=b""):
    if isinstance(cuerpo, str):
        cuerpo = cuerpo.encode("utf-8")
    lineas = [comando] + [f"{escapar(k)}:{escapar(str(v))}" for k, v in (cabeceras or {}).items()]
    return ("\n".join(lineas) + "\n\n").encode("utf-8") + cuerpo + b"\x00"


class _Cliente(threading.Thread):
    def __init__(self, broker, conexion):
        super().__init__(daemon=True)
        self.broker = broker
        self.conexion = conexion
        self.buffer = b""
        self.suscripciones = {}  # id -> (destino, modo de ack)
        self.pendientes = {}  # ack id -> (destino, mensaje)
        self.cerrado = False
        self.bloqueo_envio = threading.Lock()

    # --- lectura de frames ------------------------------------------------------

    def _leer_frame(self):
        while True:
            # Los heart-beats son saltos de línea sueltos entre frames.
            self.buffer = self.buffer.lstrip(b"\r\n")
            fin_cabeceras = self.buffer.find(b"\n\n")
            if fin_cabeceras >= 0:
                texto = self.buffer[:fin_cabeceras].decode("utf-8")
                comando, *lineas = texto.replace("\r\n", "\n").split("\n")
                cabeceras = {}
                for linea in lineas:
                    clave, _, valor = linea.partition(":")
                    cabeceras.setdefault(desescapar(clave), desescapar(valor))  # la primera repetida gana

                inicio = fin_cabeceras + 2
                if "content-length" in cabeceras:
                    fin = inicio + int(cabeceras["content-length"])
                    if len(self.buffer) > fin:
                        cuerpo = self.buffer[inicio:fin]
                        self.buffer = self.buffer[fin + 1 :]
                        return comando, cabeceras, cuerpo
                else:
                    nulo = self.buffer.find(b"\x00", inicio)
                    if nulo >= 0:
                        cuerpo = self.buffer[inicio:nulo]
                        self.buffer = self.buffer[nulo + 1 :]
                        return comando, cabeceras, cuerpo

            datos = self.conexion.recv(65536)
            if not datos:
                return None
            self.buffer += datos

    def enviar(self, comando, cabeceras=None, cuerpo=b""):
        with self.bloqueo_envio:
            try:
                self.conexion.sendall(armar_frame(comando, cabeceras, cuerpo))
            except OSError:
                self.cerrado = True

    # --- ciclo de vida -------------------------------------------------------------------

    def run(self):
        try:
            while not self.cerrado:
                frame = self._leer_frame()
                if frame is None:
                    break
                self._atender(*frame)
        except (OSError, UnicodeDecodeError, ValueError):
            pass
        finally:
            self._cerrar()

    def _cerrar(self):
        self.cerrado = True
        self.broker._desconectado(self)
        try:
            self.conexion.close()
        except OSError:
            pass

    def _atender(self, comando, cabeceras, cuerpo):
        receipt = cabeceras.get("receipt")
        broker = self.broker

        if comando in ("CONNECT", "STOMP"):
            if cabeceras.get("login") != broker.usuario or cabeceras.get("passcode") != broker.clave:
                self.enviar("ERROR", {"message": "Usuario o clave incorrectos"}, "Autenticación fallida")
                self.cerrado = True
                return
            # heart-beat 0,0: el broker no exige ni manda latidos.
            self.enviar("CONNECTED", {"version": "1.2", "heart-beat": "0,0", "server": "broker-falso"})
            return

        if comando == "SEND":
            extras = {k: v for k, v in cabeceras.items() if k not in ("destination", "receipt", "content-length")}
            broker._publicar(cabeceras["destination"], extras, cuerpo)
        elif comando == "SUBSCRIBE":
            self.suscripciones[cabeceras["id"]] = (cabeceras["destination"], cabeceras.get("ack", "auto"))
            broker._repartir(cabeceras["destination"])
        elif comando == "UNSUBSCRIBE":
            self.suscripciones.pop(cabeceras.get("id"), None)
        elif comando in ("ACK", "NACK"):
            pendiente = self.pendientes.pop(cabeceras.get("id"), None)
            if pendiente is None:
                self.enviar("ERROR", {"message": f"{comando} de un mensaje que no está pendiente"})
            elif comando == "ACK":
                broker.confirmados.append(pendiente[1])
            else:
                broker.colas.setdefault(DLQ, deque()).append(pendiente[1])
                broker.rechazados.append(pendiente[1])
            if pendiente is not None:
                broker._repartir(pendiente[0])
        elif comando == "DISCONNECT":
            if receipt:
                self.enviar("RECEIPT", {"receipt-id": receipt})
            self.cerrado = True
            return

        if receipt:
            self.enviar("RECEIPT", {"receipt-id": receipt})

    # --- entrega -----------------------------------------------------------------------------

    def suscripcion_para(self, destino):
        for id_sub, (dest, modo) in self.suscripciones.items():
            if dest == destino:
                return id_sub, modo
        return None

    def puede_recibir(self, destino):
        """Uno a la vez por consumidor en modo client-individual, como prefetch 1."""
        sub = self.suscripcion_para(destino)
        if not sub or self.cerrado:
            return False
        return sub[1] == "auto" or not any(d == destino for d, _ in self.pendientes.values())

    def entregar(self, destino, mensaje):
        id_sub, modo = self.suscripcion_para(destino)
        cabeceras = {"destination": destino, "message-id": mensaje["id"], "subscription": id_sub, **mensaje["cabeceras"]}
        if modo != "auto":
            ack_id = f"ack-{next(self.broker._contador)}"
            cabeceras["ack"] = ack_id
            self.pendientes[ack_id] = (destino, mensaje)
        cabeceras["content-length"] = len(mensaje["cuerpo"])
        self.enviar("MESSAGE", cabeceras, mensaje["cuerpo"])


class BrokerFalso:
    def __init__(self, host="127.0.0.1", puerto=0, usuario="admin", clave="admin"):
        self.usuario, self.clave = usuario, clave
        self.colas = {}
        self.confirmados = []
        self.rechazados = []
        self.clientes = []
        self._contador = itertools.count(1)
        self._bloqueo = threading.RLock()

        self.servidor = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.servidor.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.servidor.bind((host, puerto))
        self.servidor.listen()
        self.host, self.puerto = self.servidor.getsockname()
        self._hilo = threading.Thread(target=self._aceptar, daemon=True)

    def iniciar(self):
        self._hilo.start()
        return self

    def detener(self):
        # shutdown antes de close: en Linux, cerrar el socket no despierta al
        # hilo que espera en accept(), y el puerto seguiría aceptando.
        try:
            self.servidor.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self.servidor.close()
        except OSError:
            pass
        for cliente in list(self.clientes):
            try:
                cliente.conexion.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def _aceptar(self):
        while True:
            try:
                conexion, _ = self.servidor.accept()
            except OSError:
                return
            cliente = _Cliente(self, conexion)
            with self._bloqueo:
                self.clientes.append(cliente)
            cliente.start()

    def _publicar(self, destino, cabeceras, cuerpo):
        with self._bloqueo:
            mensaje = {"id": f"ID:broker-falso-{next(self._contador)}", "cabeceras": cabeceras, "cuerpo": cuerpo}
            self.colas.setdefault(destino, deque()).append(mensaje)
        self._repartir(destino)

    def _repartir(self, destino):
        with self._bloqueo:
            cola = self.colas.get(destino)
            while cola:
                consumidor = next((c for c in self.clientes if c.puede_recibir(destino)), None)
                if not consumidor:
                    return
                consumidor.entregar(destino, cola.popleft())

    def _desconectado(self, cliente):
        """Lo que quedó sin confirmar vuelve al inicio de su cola, como en ActiveMQ."""
        with self._bloqueo:
            if cliente in self.clientes:
                self.clientes.remove(cliente)
            for destino, mensaje in reversed(list(cliente.pendientes.values())):
                self.colas.setdefault(destino, deque()).appendleft(mensaje)
            devueltos = {d for d, _ in cliente.pendientes.values()}
            cliente.pendientes.clear()
        for destino in devueltos:
            self._repartir(destino)

    def en_cola(self, destino):
        with self._bloqueo:
            return [m["cuerpo"].decode("utf-8") for m in self.colas.get(destino, [])]


if __name__ == "__main__":
    import time

    broker = BrokerFalso(puerto=61613, usuario=None, clave=None).iniciar()
    print(f"Broker STOMP de prueba en {broker.host}:{broker.puerto} (sin usuario, como ActiveMQ por defecto). Ctrl+C para salir.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        broker.detener()
