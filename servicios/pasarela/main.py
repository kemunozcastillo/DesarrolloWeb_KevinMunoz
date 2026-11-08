"""
Pasarela de pago simulada ("Servipag de prueba").

No es parte de Poke Fresh: hace el papel del proveedor externo, que no tiene
un entorno de pruebas abierto. Respeta el contrato de una pasarela real
para que el servicio de pagos se integre igual que con una de verdad:

  POST /api/transacciones   el comercio crea una transacción (X-Api-Key)
                            -> { token, urlPago }
  GET  /pagar/{token}       página donde el cliente paga o rechaza
  POST /pagar/{token}       resultado: avisa al comercio con una notificación
                            firmada (HMAC-SHA256) y devuelve al cliente al sitio
  POST /api/devoluciones    el comercio devuelve un pago aprobado

La clave del comercio y el secreto de firma los lee de Vault, igual que el
servicio de pagos. Guarda las transacciones en memoria: es un simulador.
"""

import hashlib
import hmac
import html
import json
import logging
import os
import secrets

import httpx
from fastapi import APIRouter, FastAPI, Form, Header, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from comun import vault
from comun.errores import ErrorApi, registrar_manejadores
from comun.tiempo import ahora_iso

RUTA_COMERCIO = "poke-fresh/pasarela/comercio"
registro = logging.getLogger("pasarela")

transacciones: dict[str, dict] = {}
# Las pruebas reemplazan la red para entregar la notificación en memoria.
transporte_notificacion: httpx.AsyncBaseTransport | None = None

rutas = APIRouter()


async def _comercio(api_key: str | None) -> dict:
    comercio = await vault.leer_secreto(RUTA_COMERCIO)
    if not api_key or not hmac.compare_digest(api_key, comercio["api_key"]):
        raise ErrorApi(401, "API_KEY_INVALIDA", "Clave de comercio inválida.")
    return comercio


@rutas.post("/api/transacciones", status_code=201)
async def crear_transaccion(datos: dict, request: Request, api_key: str | None = Header(default=None, alias="X-Api-Key")):
    await _comercio(api_key)
    monto = datos.get("monto")
    if not isinstance(monto, int) or monto <= 0:
        raise ErrorApi(400, "MONTO_INVALIDO", "Monto inválido.")
    token = secrets.token_urlsafe(24)
    transacciones[token] = {
        "token": token,
        "orden": datos["orden"],
        "monto": monto,
        "glosa": datos.get("glosa", ""),
        "urlRetorno": datos["urlRetorno"],
        "urlNotificacion": datos["urlNotificacion"],
        "estado": "PENDIENTE",
        "creada": ahora_iso(),
    }
    # La página de pago la abre el navegador del cliente: va con la dirección pública de la pasarela.
    base = os.environ.get("PASARELA_URL_PUBLICA") or str(request.base_url).rstrip("/")
    return {"token": token, "urlPago": f"{base}/pagar/{token}"}


def _pesos(n: int) -> str:
    return "$" + f"{n:,}".replace(",", ".")


@rutas.get("/pagar/{token}", response_class=HTMLResponse)
async def pagina(token: str):
    t = transacciones.get(token)
    if not t:
        return HTMLResponse("<h1>Transacción inexistente o vencida</h1>", status_code=404)
    ya = t["estado"] != "PENDIENTE"
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Servipag (simulación)</title>
<style>body{{font-family:system-ui,sans-serif;background:#f3f4f6;margin:0;display:grid;place-items:center;min-height:100vh}}
main{{background:#fff;padding:32px;border-radius:12px;max-width:420px;width:calc(100% - 32px);box-shadow:0 4px 20px #0001}}
.marca{{color:#0b5;font-weight:700;font-size:1.3rem}}.aviso{{background:#fff7d6;padding:8px 12px;border-radius:8px;font-size:.9rem}}
button{{font:inherit;padding:12px 18px;border-radius:8px;border:0;cursor:pointer;margin-right:8px}}
.pagar{{background:#0b5;color:#fff}}.rechazar{{background:#eee}}</style></head><body><main>
<p class="marca">Servipag</p><p class="aviso">Pasarela de prueba: no se cobra dinero real.</p>
<p>{html.escape(t["glosa"])}</p><h1>{_pesos(t["monto"])}</h1>
{"<p>Esta transacción ya fue procesada.</p>" if ya else f'''<form method="post" action="/pagar/{token}">
<button class="pagar" name="decision" value="APROBADO">Pagar {_pesos(t["monto"])}</button>
<button class="rechazar" name="decision" value="RECHAZADO">Rechazar</button></form>'''}
</main></body></html>"""


def _firmar(cuerpo: bytes, secreto: str) -> str:
    return hmac.new(secreto.encode(), cuerpo, hashlib.sha256).hexdigest()


async def notificar(t: dict, secreto: str) -> bool:
    """Envía la notificación firmada. Reintenta hasta 3 veces, como hacen las pasarelas reales."""
    cuerpo = json.dumps(
        {"token": t["token"], "orden": t["orden"], "monto": t["monto"], "estado": t["estado"], "referencia": t.get("referencia"), "fecha": ahora_iso()},
        separators=(",", ":"),
    ).encode()
    for intento in range(3):
        try:
            async with httpx.AsyncClient(timeout=5, transport=transporte_notificacion) as cliente:
                r = await cliente.post(t["urlNotificacion"], content=cuerpo, headers={"Content-Type": "application/json", "X-Firma": _firmar(cuerpo, secreto)})
            if r.status_code == 200:
                return True
            registro.warning("notificación %s respondió %s (intento %s)", t["orden"], r.status_code, intento + 1)
        except httpx.HTTPError as error:
            registro.warning("notificación %s falló: %s (intento %s)", t["orden"], error.__class__.__name__, intento + 1)
    return False


@rutas.post("/pagar/{token}")
async def decidir(token: str, decision: str = Form(...)):
    t = transacciones.get(token)
    if not t:
        return HTMLResponse("<h1>Transacción inexistente</h1>", status_code=404)
    if t["estado"] == "PENDIENTE" and decision in ("APROBADO", "RECHAZADO"):
        t["estado"] = decision
        if decision == "APROBADO":
            t["referencia"] = f"SVP-{secrets.randbelow(10**8):08d}"
        comercio = await vault.leer_secreto(RUTA_COMERCIO)
        t["notificada"] = await notificar(t, comercio["secreto_firma"])
    return RedirectResponse(t["urlRetorno"] + ("" if t["estado"] == "APROBADO" else "?pago=rechazado"), status_code=303)


@rutas.post("/api/devoluciones")
async def devolucion(datos: dict, api_key: str | None = Header(default=None, alias="X-Api-Key")):
    await _comercio(api_key)
    t = transacciones.get(datos.get("token") or "")
    # Si el simulador se reinició, no recuerda la transacción: se acepta igual para no bloquear la anulación.
    if t:
        t["estado"] = "DEVUELTO"
    return {"ok": True}


@rutas.get("/salud")
async def salud():
    return {"servicio": "pasarela", "ok": await vault.salud() == "ok"}


def crear_aplicacion() -> FastAPI:
    app = FastAPI(title="Servipag de prueba", version="1.0.0")
    registrar_manejadores(app)
    app.include_router(rutas)
    return app


app = crear_aplicacion()
