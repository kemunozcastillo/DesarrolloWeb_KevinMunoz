"""
Recorrido de compra en móvil (390x812, táctil) contra el sistema levantado por
HTTPS: inicio, menú, ingreso, checkout, pago, pasarela, pedido pagado y mis pedidos.
Guarda capturas en docs/evidencias/movil/ y comprueba que no haya scroll horizontal.
Se puede repetir sobre la misma base (no registra cuentas nuevas).

    python pruebas/e2e/movil.py [--sitio https://localhost:8080]

Requiere: pip install playwright && playwright install chromium
"""

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--sitio", default="https://localhost:8080")
args = parser.parse_args()

SALIDA = Path(__file__).resolve().parents[2] / "docs" / "evidencias" / "movil"
SALIDA.mkdir(parents=True, exist_ok=True)
SITIO = args.sitio
errores: list[str] = []
pasos: dict[str, dict] = {}


def foto(pagina, nombre, completa=False):
    pagina.wait_for_timeout(400)
    try:
        pagina.wait_for_function("() => [...document.images].every(i => i.complete || i.getBoundingClientRect().top > innerHeight)", timeout=8000)
    except Exception:
        pass
    pagina.screenshot(path=str(SALIDA / f"{nombre}.png"), full_page=completa)
    pasos[nombre] = {
        "url": pagina.url.split("#")[0] + ("#" + pagina.url.split("#")[1] if "#" in pagina.url else ""),
        "https": pagina.url.startswith("https://"),
        "desbordeHorizontal": pagina.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1"),
    }


with sync_playwright() as p:
    nav = p.chromium.launch()
    ctx = nav.new_context(viewport={"width": 390, "height": 812}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="es-CL", ignore_https_errors=True)
    m = ctx.new_page()
    m.on("console", lambda msg: msg.type == "error" and errores.append(f"{m.url}: {msg.text}"))
    m.on("pageerror", lambda e: errores.append(f"{m.url}: {e}"))

    m.goto(SITIO)
    m.wait_for_selector("text=Arma tu bowl")
    foto(m, "01-inicio")
    m.goto(f"{SITIO}/#/menu")
    m.wait_for_selector(".tarjeta-producto, .producto, article")
    foto(m, "02-menu")

    m.goto(f"{SITIO}/#/ingresar")
    m.fill('input[name="email"]', "cliente@correo.cl")
    m.fill('input[name="clave"]', "Cliente2026")
    foto(m, "03-ingreso")
    m.click('form button[type="submit"]')
    m.wait_for_function("() => !location.hash.startsWith('#/ingresar')")

    linea = {"id": "lin_movil", "tipo": "BOWL", "cantidad": 1, "entrada": {"tamanoId": "regular", "baseIds": ["base_quinoa"], "proteinaIds": ["pro_salmon"], "salsaIds": ["sal_goma"], "toppingIds": ["top_mango", "top_edamame"]}}
    m.evaluate("l => localStorage.setItem('pokefresh:carrito', JSON.stringify([l]))", linea)
    m.goto(f"{SITIO}/#/checkout")
    m.wait_for_selector("text=Confirmar pedido")
    foto(m, "04-checkout", completa=True)
    m.click('form button[type="submit"]')
    m.wait_for_url(re.compile(r"#/pago/PF-"))
    pedido = m.url.rsplit("/", 1)[1]
    foto(m, "05-pago")
    m.click("[data-pagar]")
    m.wait_for_url(re.compile(r"/pagar/"))
    foto(m, "06-pasarela-servipag")
    m.click("button.pagar")
    m.wait_for_url(re.compile(r"#/orden/PF-"))
    m.wait_for_selector("text=Pagos")
    foto(m, "07-pedido-pagado", completa=True)
    m.goto(f"{SITIO}/#/mis-pedidos")
    m.wait_for_selector(f"text={pedido}")
    foto(m, "08-mis-pedidos")
    nav.close()

resumen = {"pedido": pedido, "dispositivo": "390x812, táctil, escala 2 (Chromium con emulación móvil)", "erroresConsola": errores, "pantallas": pasos}
(SALIDA / "recorrido.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"pedido": pedido, "erroresConsola": errores, "todasHttps": all(v["https"] for v in pasos.values()), "algunaConDesborde": any(v["desbordeHorizontal"] for v in pasos.values()), "capturas": len(pasos)}, ensure_ascii=False, indent=2))
