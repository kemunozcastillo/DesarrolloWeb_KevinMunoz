"""
Lectura de secretos en HashiCorp Vault (motor KV versión 2).

Cada servicio tiene su propio token, con una política que solo le deja leer
las rutas que necesita (ver vault/politicas/). Los valores se guardan en
memoria por unos segundos para no consultar Vault en cada petición.

Si Vault deja de responder:
  - mientras el último valor leído tenga menos de VAULT_GRACIA_SEGUNDOS, se
    sigue usando (una caída breve de Vault no tumba la tienda);
  - pasado ese plazo, o si nunca se leyó, se lanza ErrorVault y el servicio
    responde 503: sin poder verificar credenciales no deja pasar a nadie.
"""

import time

import httpx

from comun.config import ajustes
from comun.errores import ErrorApi


class ErrorVault(ErrorApi):
    def __init__(self, detalle: str):
        super().__init__(503, "SECRETOS_NO_DISPONIBLES", "El servicio no pudo leer sus secretos. Intenta en unos minutos.")
        self.detalle = detalle


_cache: dict[str, tuple[dict, float]] = {}

# Las pruebas reemplazan Vault por un diccionario {ruta: {clave: valor}}.
_valores_fijos: dict[str, dict] | None = None
_transporte: httpx.AsyncBaseTransport | None = None


def usar_valores_fijos(valores: dict[str, dict] | None) -> None:
    global _valores_fijos
    _valores_fijos = valores
    _cache.clear()


async def leer_secreto(ruta: str) -> dict:
    if _valores_fijos is not None:
        if ruta not in _valores_fijos:
            raise ErrorVault(f"sin permiso o inexistente: {ruta}")
        return _valores_fijos[ruta]

    a = ajustes()
    ahora = time.monotonic()
    guardado = _cache.get(ruta)
    if guardado and ahora - guardado[1] < a.vault_cache_segundos:
        return guardado[0]

    url = f"{a.vault_addr}/v1/{a.vault_montaje}/data/{ruta}"
    try:
        async with httpx.AsyncClient(timeout=3.0, transport=_transporte) as cliente:
            respuesta = await cliente.get(url, headers={"X-Vault-Token": a.vault_token})
    except httpx.HTTPError as error:
        if guardado and ahora - guardado[1] < a.vault_gracia_segundos:
            return guardado[0]
        raise ErrorVault(f"Vault no responde: {error.__class__.__name__}")

    if respuesta.status_code != 200:
        # 403: el token no tiene permiso para esa ruta. 404: la ruta no existe.
        raise ErrorVault(f"Vault respondió {respuesta.status_code} para {ruta}")

    datos = (respuesta.json().get("data") or {}).get("data") or {}
    _cache[ruta] = (datos, ahora)
    return datos


async def leer_valor(ruta: str, clave: str) -> str:
    datos = await leer_secreto(ruta)
    valor = datos.get(clave)
    if not valor:
        raise ErrorVault(f"falta la clave {clave} en {ruta}")
    return str(valor)


async def salud() -> str:
    if _valores_fijos is not None:
        return "ok"
    a = ajustes()
    try:
        async with httpx.AsyncClient(timeout=2.0, transport=_transporte) as cliente:
            r = await cliente.get(f"{a.vault_addr}/v1/sys/health")
        return "ok" if r.status_code == 200 else f"estado {r.status_code}"
    except httpx.HTTPError:
        return "sin conexión"
