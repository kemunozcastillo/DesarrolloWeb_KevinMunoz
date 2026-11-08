"""
Llamadas entre servicios internos.

Cada llamada lleva la credencial interna del servicio de destino (leída de
Vault con el token del servicio que llama; su política solo le permite leer
las credenciales de los servicios que necesita) y, si existe, la identidad
del usuario que originó la petición, para que el destino aplique sus propias
reglas de autorización.

Si el destino no responde a tiempo, se responde 504; si responde con error
5xx o no se puede conectar, 502. Los errores 4xx del destino se propagan tal
cual, porque son decisiones de negocio del dueño de los datos.
"""

import base64

import httpx

from comun import vault
from comun.config import ajustes
from comun.errores import ErrorApi
from comun.seguridad import CABECERA_CREDENCIAL, Identidad, ruta_credencial, servicio_actual

TIEMPO_MAXIMO = 4.0

# Las pruebas conectan los servicios en memoria: {"inventario": transporte ASGI, ...}
transportes: dict[str, httpx.AsyncBaseTransport] = {}

NOMBRES = {
    "inventario": "inventario",
    "clientes": "clientes",
    "pedidos": "pedidos",
    "pagos": "pagos",
    "auth": "el servicio de cuentas",
}


async def _cabeceras(destino: str) -> dict:
    if destino == "auth":
        # El Auth Service autentica a sus clientes con HTTP Basic: cada
        # cliente (gateway, clientes) tiene su propio secreto.
        origen = servicio_actual.get()
        secreto = await vault.leer_valor(f"poke-fresh/internos/auth-{origen}", "secreto")
        valor = base64.b64encode(f"{origen}:{secreto}".encode()).decode()
        return {"Authorization": f"Basic {valor}"}
    return {CABECERA_CREDENCIAL: await vault.leer_valor(ruta_credencial(destino), "credencial")}


async def llamar(
    destino: str,
    metodo: str,
    ruta: str,
    *,
    json: dict | None = None,
    params: dict | None = None,
    identidad: Identidad | None = None,
    request_id: str | None = None,
    esperar: tuple[int, ...] = (200, 201, 204),
) -> dict | list | None:
    cabeceras = await _cabeceras(destino)
    if identidad:
        cabeceras.update(identidad.cabeceras())
    if request_id:
        cabeceras["X-Request-Id"] = request_id

    base = ajustes().urls[destino]
    try:
        async with httpx.AsyncClient(base_url=base, timeout=TIEMPO_MAXIMO, transport=transportes.get(destino)) as cliente:
            respuesta = await cliente.request(metodo, ruta, json=json, params=params, headers=cabeceras)
    except httpx.TimeoutException:
        raise ErrorApi(504, "SERVICIO_LENTO", f"El servicio de {NOMBRES.get(destino, destino)} no respondió a tiempo.")
    except httpx.HTTPError:
        raise ErrorApi(502, "SERVICIO_NO_DISPONIBLE", f"El servicio de {NOMBRES.get(destino, destino)} no está disponible.")

    if respuesta.status_code in esperar:
        return respuesta.json() if respuesta.content else None

    try:
        cuerpo = respuesta.json()
    except ValueError:
        cuerpo = {}

    if 400 <= respuesta.status_code < 500:
        raise ErrorApi(respuesta.status_code, cuerpo.get("codigo", "ERROR"), cuerpo.get("mensaje", "La operación no se pudo completar."))
    raise ErrorApi(502, "SERVICIO_NO_DISPONIBLE", f"El servicio de {NOMBRES.get(destino, destino)} falló.")
