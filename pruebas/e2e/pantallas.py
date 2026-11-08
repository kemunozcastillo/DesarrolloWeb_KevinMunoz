"""
Recorre las pantallas principales en un navegador real (Chromium) contra el
sistema levantado y guarda capturas en docs/evidencias/pantallas/. Sirve
como evidencia de que el frontend usa las APIs reales a través del gateway.

    python pruebas/e2e/pantallas.py [--sitio http://localhost:8080]

Requiere: pip install playwright && playwright install chromium
"""

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--sitio", default="http://localhost:8080")
args = parser.parse_args()

SALIDA = Path(__file__).resolve().parents[2] / "docs" / "evidencias" / "pantallas"
SALIDA.mkdir(parents=True, exist_ok=True)
SITIO = args.sitio
errores: list[str] = []
llamadas: list[str] = []
pasos: list[str] = []


def nuevo(navegador):
    contexto = navegador.new_context(viewport={"width": 1280, "height": 900}, locale="es-CL")
    pagina = contexto.new_page()
    pagina.on("console", lambda m: m.type == "error" and errores.append(f"{pagina.url}: {m.text}"))
    pagina.on("pageerror", lambda e: errores.append(f"{pagina.url}: {e}"))
    pagina.on("request", lambda r: "/api/" in r.url and llamadas.append(f"{r.method} {r.url.split('/api')[1].split('?')[0]}"))
    return pagina


def foto(pagina, nombre, completa=False):
    pagina.wait_for_timeout(400)
    # Las fotos del menú son loading="lazy": se espera a las que están a la vista (con Docker tardan más que en local).
    try:
        pagina.wait_for_function("() => [...document.images].every(i => i.complete || i.getBoundingClientRect().top > innerHeight)", timeout=8000)
    except Exception:
        pass
    pagina.screenshot(path=str(SALIDA / f"{nombre}.png"), full_page=completa)
    pasos.append(nombre)


def ingresar(pagina, email, clave):
    pagina.goto(f"{SITIO}/#/ingresar")
    pagina.fill('input[name="email"]', email)
    pagina.fill('input[name="clave"]', clave)
    pagina.click('form button[type="submit"]')
    pagina.wait_for_function("() => !location.hash.startsWith('#/ingresar')")


with sync_playwright() as p:
    nav = p.chromium.launch()

    # --- Tienda pública ---------------------------------------------------------------
    c = nuevo(nav)
    c.goto(SITIO)
    c.wait_for_selector("text=Arma tu bowl")
    foto(c, "01-inicio")
    c.goto(f"{SITIO}/#/menu")
    c.wait_for_selector(".tarjeta-producto, .producto, article")
    foto(c, "02-menu-desde-inventario")

    # --- Compra del cliente -------------------------------------------------------------
    ingresar(c, "cliente@correo.cl", "Cliente2026")
    linea = {"id": "lin_e2e", "tipo": "BOWL", "cantidad": 1, "entrada": {"tamanoId": "regular", "baseIds": ["base_quinoa"], "proteinaIds": ["pro_salmon"], "salsaIds": ["sal_goma"], "toppingIds": ["top_mango", "top_edamame"]}}
    c.evaluate("l => localStorage.setItem('pokefresh:carrito', JSON.stringify([l]))", linea)
    c.goto(f"{SITIO}/#/checkout")
    c.wait_for_selector("text=Confirmar pedido")
    foto(c, "03-checkout")
    c.click('form button[type="submit"]')
    c.wait_for_url(re.compile(r"#/pago/PF-"))
    pedido = c.url.rsplit("/", 1)[1]
    foto(c, "04-pago")
    c.click("[data-pagar]")
    c.wait_for_url(re.compile(r"/pagar/"))
    foto(c, "05-pasarela-servipag")
    c.click("button.pagar")
    c.wait_for_url(re.compile(r"#/orden/PF-"))
    c.wait_for_selector("text=Pagos")
    foto(c, "06-pedido-pagado-graphql", completa=True)
    texto_orden = c.inner_text("#contenido")

    # --- Cocina y despacho -------------------------------------------------------------------
    k = nuevo(nav)
    ingresar(k, "cocina@pokefresh.cl", "Cocina2026")
    k.goto(f"{SITIO}/#/admin/cocina")
    k.wait_for_selector(f"[data-pedido='{pedido}']")
    foto(k, "07-cocina")
    k.click(f"[data-pedido='{pedido}'] [data-accion='aceptar']")
    k.wait_for_selector(f"[data-pedido='{pedido}'] [data-accion='terminar']")
    k.click(f"[data-pedido='{pedido}'] [data-accion='terminar']")
    k.wait_for_timeout(800)

    d = nuevo(nav)
    ingresar(d, "despacho@pokefresh.cl", "Despacho2026")
    d.goto(f"{SITIO}/#/admin/despacho")
    d.wait_for_selector(f"[data-pedido='{pedido}']")
    foto(d, "08-despacho")
    tarjeta = d.locator(f"[data-pedido='{pedido}']")
    if tarjeta.locator("[data-chofer]").count():
        tarjeta.locator("[data-chofer]").select_option("Andrea Muñoz")
        tarjeta.locator("[data-accion='despachar']").click()
        d.wait_for_selector(f"[data-pedido='{pedido}'] [data-accion='entregar']")
    d.locator(f"[data-pedido='{pedido}'] [data-accion='entregar']").click()
    d.wait_for_timeout(800)

    c.goto(f"{SITIO}/#/orden/{pedido}")
    c.wait_for_selector("text=Entregado")
    foto(c, "09-seguimiento-entregado", completa=True)
    c.goto(f"{SITIO}/#/mis-pedidos")
    c.wait_for_selector(f"text={pedido}")
    foto(c, "10-mis-pedidos")

    # --- Administración ----------------------------------------------------------------------
    a = nuevo(nav)
    ingresar(a, "admin@pokefresh.cl", "Admin2026")
    a.goto(f"{SITIO}/#/admin/reportes")
    a.wait_for_selector("text=Conciliación con pagos")
    foto(a, "11-reportes-graphql", completa=True)
    a.goto(f"{SITIO}/#/admin")
    a.wait_for_selector("text=Stock")
    foto(a, "12-productos-stock")
    a.goto(f"{SITIO}/#/admin/clientes")
    a.wait_for_selector("text=Javiera")
    foto(a, "13-clientes")
    a.goto(f"{SITIO}/#/orden/{pedido}")
    a.wait_for_selector("text=Contacto del cliente")
    foto(a, "14-pedido-vista-admin", completa=True)

    # --- Registro con verificación de correo ----------------------------------------------------
    r = nuevo(nav)
    r.goto(f"{SITIO}/#/registro")
    r.fill('input[name="run"]', "12.345.678-5")
    r.fill('input[name="nombre"]', "Ana Prueba Soto")
    r.fill('input[name="direccion"]', "Av. Italia 1500")
    r.select_option('select[name="region"]', "Región Metropolitana de Santiago")
    r.select_option('select[name="provincia"]', "Santiago")
    r.select_option('select[name="comuna"]', "Ñuñoa")
    r.fill('input[name="fechaNacimiento"]', "1995-03-10")
    r.check('input[name="sexo"][value="F"]') if r.locator('input[name="sexo"][value="F"]').count() else r.select_option('select[name="sexo"]', "F")
    r.fill('input[name="email"]', "ana.prueba@correo.cl")
    r.fill('input[name="telefono"]', "+56 9 1111 2222")
    r.fill('input[name="clave"]', "Prueba2026")
    r.fill('input[name="clave2"]', "Prueba2026")
    r.click('form button[type="submit"]')
    r.wait_for_url(re.compile(r"#/verificar"))
    r.wait_for_selector(".correo-simulado__codigo")
    foto(r, "15-verificacion-correo")
    codigo = r.inner_text(".correo-simulado__codigo")
    r.fill('input[name="codigo"]', codigo)
    r.click('form button[type="submit"]')
    r.wait_for_url(re.compile(r"#/ingresar"))
    ingresar(r, "ana.prueba@correo.cl", "Prueba2026")
    foto(r, "16-cliente-nuevo-con-sesion")

    nav.close()

resumen = {"pedido": pedido, "pantallas": pasos, "erroresConsola": errores, "llamadasApi": sorted(set(llamadas)), "ordenMuestraPagos": "Aprobado" in texto_orden}
(SALIDA / "recorrido.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k: v for k, v in resumen.items() if k != "llamadasApi"}, ensure_ascii=False, indent=2))
print(f"{len(set(llamadas))} rutas distintas de la API usadas por el frontend")
