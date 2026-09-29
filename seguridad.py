"""
Protección del backend: solo acepta peticiones que llegan por el gateway.

El gateway agrega la cabecera X-Credencial-Interna a cada petición que ya
validó. El backend compara ese valor con el guardado en Vault:

  - sin la cabecera, o con un valor distinto: 403 (alguien intentó entrar
    directo, saltándose el gateway);
  - Vault no responde y no hay una credencial guardada: 500, porque sin
    poder comparar no se deja pasar a nadie.
"""

import secrets
import time

import httpx
from fastapi import Header, HTTPException, status

from app.config import get_settings

CABECERA_INTERNA = "X-Credencial-Interna"

# Credencial leída de Vault y hasta cuándo sirve.
_cache: dict = {"valor": None, "vence": 0.0}

# Permite a las pruebas reemplazar la red por un Vault simulado.
_transporte: httpx.AsyncBaseTransport | None = None


async def obtener_clave_interna() -> str:
    """Lee la credencial interna desde Vault (motor KV v2), con caché corta."""
    if _cache["valor"] and time.monotonic() < _cache["vence"]:
        return _cache["valor"]

    settings = get_settings()
    url = f"{settings.vault_addr.rstrip('/')}/v1/{settings.vault_montaje}/data/{settings.vault_ruta_backend}"

    try:
        async with httpx.AsyncClient(timeout=3.0, transport=_transporte) as cliente:
            respuesta = await cliente.get(url, headers={"X-Vault-Token": settings.vault_token})
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo verificar la credencial: el gestor de secretos no está disponible.",
        )

    valor = None
    if respuesta.status_code == 200:
        valor = (respuesta.json().get("data") or {}).get("data", {}).get("credencial_interna")

    if not valor:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo verificar la credencial: el backend no puede leer su secreto en Vault.",
        )

    _cache.update(valor=valor, vence=time.monotonic() + settings.vault_cache_segundos)
    return valor


def limpiar_cache() -> None:
    _cache.update(valor=None, vence=0.0)


async def verificar_credencial_interna(
    credencial: str | None = Header(default=None, alias=CABECERA_INTERNA),
) -> None:
    """Dependencia que protege las rutas de productos."""
    # Sin la cabecera se rechaza de inmediato, sin molestar a Vault.
    if not credencial:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso directo no permitido: esta API solo acepta peticiones que llegan por el gateway.",
        )

    esperada = await obtener_clave_interna()

    # compare_digest tarda lo mismo aunque coincidan más o menos caracteres,
    # así no se puede adivinar la credencial midiendo tiempos de respuesta.
    if not secrets.compare_digest(credencial.encode(), esperada.encode()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Credencial interna inválida: esta API solo acepta peticiones que llegan por el gateway.",
        )
