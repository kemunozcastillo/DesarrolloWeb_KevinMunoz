"""
Configuración de cada microservicio, leída de variables de entorno.

Aquí no hay contraseñas. Lo único sensible que llega por entorno es la
ubicación del token de Vault; las credenciales de Mongo, las credenciales
internas y la clave de la pasarela se leen de Vault al usarlas.
"""

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _entero(nombre: str, porDefecto: int) -> int:
    try:
        return int(os.environ.get(nombre, porDefecto))
    except ValueError:
        return porDefecto


def _token_vault() -> str:
    """El token puede venir directo o en un archivo (así lo entrega docker compose)."""
    archivo = os.environ.get("VAULT_TOKEN_ARCHIVO")
    if archivo and Path(archivo).exists():
        return Path(archivo).read_text().strip()
    return os.environ.get("VAULT_TOKEN", "")


@dataclass(frozen=True)
class Ajustes:
    servicio: str
    vault_addr: str
    vault_token: str
    vault_montaje: str
    vault_cache_segundos: int
    # Si Vault deja de responder, se sigue usando el último valor leído por
    # este tiempo. Pasado ese plazo, el servicio rechaza las peticiones.
    vault_gracia_segundos: int
    mongo_uri: str
    mongo_db: str
    mongo_ruta_vault: str
    modo_demo: bool
    urls: dict = field(default_factory=dict)
    activemq_host: str = ""
    activemq_puerto: int = 61613
    # CA de prueba para hablar con ActiveMQ por STOMP+TLS. Vacío: sin TLS (pruebas y entorno local).
    activemq_ca: str = ""
    zona_horaria: str = "America/Santiago"
    url_publica: str = "http://localhost:8080"
    url_notificacion_pagos: str = ""


@lru_cache
def ajustes() -> Ajustes:
    servicio = os.environ.get("SERVICIO", "desconocido")
    return Ajustes(
        servicio=servicio,
        vault_addr=os.environ.get("VAULT_ADDR", "http://127.0.0.1:8200").rstrip("/"),
        vault_token=_token_vault(),
        vault_montaje=os.environ.get("VAULT_MONTAJE", "secret"),
        vault_cache_segundos=_entero("VAULT_CACHE_SEGUNDOS", 30),
        vault_gracia_segundos=_entero("VAULT_GRACIA_SEGUNDOS", 300),
        mongo_uri=os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017"),
        mongo_db=os.environ.get("MONGO_DB", f"pf_{servicio}"),
        # Ruta en Vault con el usuario y la clave de Mongo de este servicio.
        # Vacía: se conecta sin credenciales (desarrollo local).
        mongo_ruta_vault=os.environ.get("MONGO_RUTA_VAULT", ""),
        # En modo demo, los códigos de verificación y las claves temporales
        # vuelven en la respuesta para mostrarlos como "correo simulado".
        modo_demo=os.environ.get("MODO_DEMO", "true").lower() == "true",
        urls={
            nombre: os.environ.get(f"URL_{nombre.upper()}", f"http://127.0.0.1:{puerto}")
            for nombre, puerto in {
                "inventario": 8001,
                "clientes": 8002,
                "pedidos": 8003,
                "pagos": 8004,
                "pasarela": 9000,
                "auth": 4100,
            }.items()
        },
        activemq_host=os.environ.get("ACTIVEMQ_HOST", ""),
        activemq_puerto=_entero("ACTIVEMQ_PUERTO", 61613),
        activemq_ca=os.environ.get("ACTIVEMQ_CA", ""),
        # Dirección del sitio que ve el navegador (para volver desde la pasarela).
        url_publica=os.environ.get("URL_PUBLICA", "http://localhost:8080").rstrip("/"),
        # Dirección con que la pasarela llega al gateway para notificar el pago.
        url_notificacion_pagos=os.environ.get("URL_NOTIFICACION_PAGOS", ""),
    )
