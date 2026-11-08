"""
Pruebas de punta a punta contra el sistema levantado (docker compose o el
entorno local de pruebas/local). Cada caso hace peticiones reales al API
Gateway, como lo haría el navegador, y deja evidencia en
docs/evidencias/e2e-resultados.md (tabla) y e2e-resultados.json (detalle con
el X-Request-Id de cada petición, para buscarla en los logs).

    python pruebas/e2e/casos.py                       (gateway en http://localhost:8080)
    python pruebas/e2e/casos.py --directo             también prueba entrar directo a los
                                                      servicios (solo entorno local: en
                                                      docker no tienen puertos publicados)

Requiere: pip install httpx
"""

import argparse
import json
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

import httpx

parser = argparse.ArgumentParser()
parser.add_argument("--gateway", default="http://localhost:8080")
parser.add_argument("--pasarela", default="http://localhost:9000")
parser.add_argument("--directo", action="store_true")
parser.add_argument("--salida", default=str(Path(__file__).resolve().parents[2] / "docs" / "evidencias"))
args = parser.parse_args()

API = f"{args.gateway}/api/v1"
resultados: list[dict] = []


class Navegador:
    """Un navegador: guarda la cookie HttpOnly que pone el gateway y la manda sola."""

    def __init__(self, nombre: str):
        self.nombre = nombre
        self.http = httpx.Client(base_url=API, timeout=15, headers={"Origin": args.gateway})

    def pedir(self, metodo, ruta, **kw):
        kw.setdefault("headers", {})["X-Request-Id"] = f"e2e-{uuid.uuid4().hex[:12]}"
        return self.http.request(metodo, ruta, **kw)

    def ingresar(self, email, clave):
        r = self.pedir("POST", "/auth/login", json={"email": email, "clave": clave})
        assert r.status_code == 200, r.text
        return r

    def graphql(self, query, variables=None):
        return self.pedir("POST", "/graphql", json={"query": query, "variables": variables or {}})


def caso(numero, nombre, entrada, identidad, esperado, componente):
    def decorador(funcion):
        inicio = time.perf_counter()
        try:
            obtenido, detalle = funcion()
            ok = True
        except AssertionError as error:
            obtenido, detalle, ok = f"FALLÓ: {error}", {}, False
        except Exception as error:  # noqa: BLE001
            obtenido, detalle, ok = f"ERROR: {error.__class__.__name__}: {error}", {}, False
        resultados.append(
            {
                "caso": numero, "nombre": nombre, "entrada": entrada, "identidad": identidad, "esperado": esperado,
                "obtenido": obtenido, "componente": componente, "ok": ok, "ms": round((time.perf_counter() - inicio) * 1000), "detalle": detalle,
            }
        )
        print(f"{'OK ' if ok else 'XX '} {numero:>4}  {nombre}: {obtenido}")
        return funcion

    return decorador


def rid(r):
    return r.headers.get("x-request-id")


anonimo = Navegador("anónimo")
cliente = Navegador("cliente")
otro = Navegador("otro cliente")
admin = Navegador("admin")
dueno = Navegador("dueño")
cocina = Navegador("cocina")
despacho = Navegador("despacho")

cliente.ingresar("cliente@correo.cl", "Cliente2026")
otro.ingresar("benjamin.castro@correo.cl", "Clave2026")
admin.ingresar("admin@pokefresh.cl", "Admin2026")
dueno.ingresar("dueno@pokefresh.cl", "Dueno2026")
cocina.ingresar("cocina@pokefresh.cl", "Cocina2026")
despacho.ingresar("despacho@pokefresh.cl", "Despacho2026")

BOWL = {"tamanoId": "regular", "baseIds": ["base_gohan"], "proteinaIds": ["pro_salmon"], "salsaIds": ["sal_ponzu"], "toppingIds": ["top_palta"]}
estado: dict = {}

# ---------------------------------------------------------------------------
# Módulo 7: casos de validación de seguridad
# ---------------------------------------------------------------------------


@caso("7.1", "Acceso anónimo al catálogo", "GET /catalogo/items", "anónimo", "200, sin stock ni datos internos", "Gateway (ruta pública) + inventario")
def _():
    r = anonimo.pedir("GET", "/catalogo/items")
    assert r.status_code == 200
    items = r.json()
    assert items and all("stock" not in i for i in items)
    return f"200, {len(items)} productos, ninguno trae stock", {"requestId": rid(r)}


@caso("7.2", "Operación protegida sin sesión", "GET /pedidos", "anónimo", "401 SIN_SESION", "Gateway")
def _():
    r = anonimo.pedir("GET", "/pedidos")
    assert r.status_code == 401 and r.json()["codigo"] == "SIN_SESION"
    return "401 SIN_SESION", {"requestId": rid(r)}


@caso("7.3", "Administración desde un rol sin permiso", "DELETE /catalogo/items/top_mango; GET /clientes; GET /reportes/ventas", "cocina, dueño, cliente", "403 en las tres", "Gateway (matriz de rutas) + inventario")
def _():
    a = cocina.pedir("DELETE", "/catalogo/items/top_mango")
    b = dueno.pedir("DELETE", "/catalogo/items/top_mango")
    c = cliente.pedir("GET", "/clientes")
    d = cocina.pedir("GET", "/reportes/ventas", params={"desde": "2026-11-01", "hasta": "2026-11-07"})
    assert [x.status_code for x in (a, b, c, d)] == [403, 403, 403, 403]
    return "cocina DELETE 403, dueño DELETE 403, cliente /clientes 403, cocina reportes 403", {"requestIds": [rid(x) for x in (a, b, c, d)]}


@caso("7.4", "Cabeceras de identidad falsificadas", "GET /clientes con X-Usuario-Rol: admin", "cliente", "403 (el gateway descarta la cabecera)", "Gateway")
def _():
    r = cliente.pedir("GET", "/clientes", headers={"X-Usuario-Rol": "admin", "X-Credencial-Interna": "inventada"})
    assert r.status_code == 403
    return "403: la identidad la pone el gateway, no el navegador", {"requestId": rid(r)}


@caso("10.1", "Compra completa: pedido con precio calculado en el servidor", "POST /pedidos con precioUnitario: 1 en la línea", "cliente", "201, total = precio del catálogo", "Pedidos + inventario + clientes")
def _():
    linea = {"tipo": "BOWL", "cantidad": 1, "entrada": BOWL, "precioUnitario": 1, "subtotal": 1}
    r = cliente.pedir("POST", "/pedidos", json={"modoEntrega": "DELIVERY", "nota": "Sin sésamo", "lineas": [linea]}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    p = r.json()
    # Regular 6.990 + palta premium 900
    assert p["total"] == 7890, p["total"]
    estado["pedido"] = p["id"]
    return f"201 {p['id']}, total {p['total']} (el 1 enviado se ignoró)", {"requestId": rid(r), "pedido": p["id"]}


@caso("7.5", "Consulta de un pedido ajeno (REST y GraphQL)", "GET /pedidos/{id}; resumenPedido(id)", "otro cliente", "404 sin datos; GraphQL null", "Pedidos (propiedad del recurso) + GraphQL Gateway")
def _():
    pid = estado["pedido"]
    r = otro.pedir("GET", f"/pedidos/{pid}")
    g = otro.graphql("query($id: ID!){ resumenPedido(id: $id) { pedido { id total } } }", {"id": pid})
    assert r.status_code == 404 and "Javiera" not in r.text
    assert g.json()["data"]["resumenPedido"] is None
    propio = cliente.pedir("GET", f"/pedidos/{pid}")
    assert propio.status_code == 200
    return "REST 404 sin datos; GraphQL resumenPedido = null; la dueña sí lo ve (200)", {"requestIds": [rid(r), rid(g), rid(propio)]}


@caso("7.6", "Pago con datos alterados desde el frontend", "POST /pagos {monto: 1}; POST /pagos/notificacion sin firma y con firma falsa", "cliente", "monto = total del pedido; notificaciones 401", "Pagos (firma HMAC, monto del pedido)")
def _():
    pid = estado["pedido"]
    clave = str(uuid.uuid4())
    r = cliente.pedir("POST", "/pagos", json={"pedidoId": pid, "monto": 1}, headers={"Idempotency-Key": clave})
    assert r.status_code == 201, r.text
    pago = r.json()
    assert pago["monto"] == 7890
    estado["pago"] = pago
    estado["clavePago"] = clave
    token = pago["urlPago"].rsplit("/", 1)[1]
    cuerpo = json.dumps({"token": token, "orden": pago["id"], "monto": 7890, "estado": "APROBADO", "referencia": "FALSA"})
    sin = anonimo.pedir("POST", "/pagos/notificacion", content=cuerpo, headers={"Content-Type": "application/json"})
    falsa = anonimo.pedir("POST", "/pagos/notificacion", content=cuerpo, headers={"Content-Type": "application/json", "X-Firma": "0" * 64})
    assert sin.status_code == 401 and falsa.status_code == 401
    sigue = cliente.pedir("GET", f"/pedidos/{pid}").json()["estado"]
    assert sigue == "PENDIENTE_PAGO"
    return f"monto cobrado {pago['monto']} (no 1); notificación sin firma 401, firma falsa 401; pedido sigue {sigue}", {"requestIds": [rid(r), rid(sin), rid(falsa)]}


@caso("10.2", "Pago duplicado (doble clic)", "POST /pagos dos veces con la misma Idempotency-Key", "cliente", "el mismo pago", "Pagos (idempotencia)")
def _():
    r = cliente.pedir("POST", "/pagos", json={"pedidoId": estado["pedido"]}, headers={"Idempotency-Key": estado["clavePago"]})
    assert r.json()["id"] == estado["pago"]["id"]
    return f"mismo pago {r.json()['id']}", {"requestId": rid(r)}


@caso("10.3", "Pago aprobado en la pasarela y notificación firmada", "POST pasarela /pagar/{token} APROBADO (dos veces)", "cliente (navegador en Servipag)", "pedido PAGADO con boleta; el segundo envío no hace nada", "Pasarela -> gateway -> pagos -> pedidos -> ActiveMQ")
def _():
    url = estado["pago"]["urlPago"].replace("http://localhost:9000", args.pasarela).replace("http://127.0.0.1:9000", args.pasarela)
    with httpx.Client(timeout=15) as nav:
        r = nav.post(url, data={"decision": "APROBADO"}, follow_redirects=False)
        r2 = nav.post(url, data={"decision": "APROBADO"}, follow_redirects=False)
    assert r.status_code == 303 and r2.status_code == 303
    p = cliente.pedir("GET", f"/pedidos/{estado['pedido']}").json()
    assert p["estado"] == "PAGADO" and p["boleta"]["numero"] > 0
    historial = [h["estado"] for h in p["historial"]]
    assert historial.count("PAGADO") == 1
    estado["boleta"] = p["boleta"]["numero"]
    return f"PAGADO, venta N° {p['venta']['numero']}, boleta N° {p['boleta']['numero']}, ref. {p['pago']['referencia']}; un solo paso PAGADO", {"pedido": p["id"]}


@caso("10.4", "Flujo de cocina y despacho con permisos", "aceptar/terminar (cocina), despachar/entregar (despacho), y cruzados", "cocina, despacho", "estados en orden; cruzados 403", "Gateway + pedidos")
def _():
    pid = estado["pedido"]
    cruzado1 = despacho.pedir("POST", f"/pedidos/{pid}/aceptar")
    cola = cocina.pedir("GET", "/pedidos").json()
    visto = next(p for p in cola if p["id"] == pid)
    assert set(visto["cliente"]) == {"nombre", "telefono"}, visto["cliente"]
    pasos = [
        cocina.pedir("POST", f"/pedidos/{pid}/aceptar"),
        cocina.pedir("POST", f"/pedidos/{pid}/aceptar"),  # repetido: 409
        cocina.pedir("POST", f"/pedidos/{pid}/terminar"),
    ]
    cruzado2 = cocina.pedir("POST", f"/pedidos/{pid}/despachar", json={"chofer": "Luis Contreras"})
    pasos += [despacho.pedir("POST", f"/pedidos/{pid}/despachar", json={"chofer": "Luis Contreras"}), despacho.pedir("POST", f"/pedidos/{pid}/entregar")]
    codigos = [x.status_code for x in pasos]
    assert cruzado1.status_code == 403 and cruzado2.status_code == 403
    assert codigos == [200, 409, 200, 200, 200], codigos
    final = cliente.pedir("GET", f"/pedidos/{pid}").json()
    assert final["estado"] == "ENTREGADO"
    return f"despacho→aceptar 403, cocina→despachar 403; pasos {codigos}; cocina ve solo nombre y teléfono; final ENTREGADO", {"pedido": pid}


@caso("8.1", "Agregación GraphQL desde la pantalla del pedido", "resumenPedido(id) con pedido, pagos y productos", "cliente", "datos de pedidos + pagos + inventario en una respuesta", "GraphQL Gateway")
def _():
    q = """query($id: ID!){ resumenPedido(id: $id) { pedido { id estadoTexto total lineas { descripcion productos { nombre categoria } } }
              pagos { estado monto referencia } cliente { email } } }"""
    r = cliente.graphql(q, {"id": estado["pedido"]})
    cuerpo = r.json()
    res = cuerpo["data"]["resumenPedido"]
    assert res["pedido"]["estadoTexto"] == "Entregado"
    assert res["pagos"][0]["estado"] == "APROBADO"
    assert {p["categoria"] for p in res["pedido"]["lineas"][0]["productos"]} == {"BASE", "PROTEINA", "SALSA", "TOPPING"}
    assert res["cliente"] is None and cuerpo["errors"][0]["extensions"]["code"] == "PROHIBIDO"
    return "pedido + pago APROBADO + 4 categorías de productos; campo cliente negado al cliente (PROHIBIDO)", {"requestId": rid(r)}


@caso("8.2", "Límites GraphQL", "consulta de costo alto; misPedidos(primeros: 500)", "cliente", "rechazadas antes de ejecutar", "GraphQL Gateway")
def _():
    costosa = cliente.graphql("{ misPedidos(primeros: 50) { nodos { id lineas { descripcion productos { id nombre categoria disponibleHoy } } } } }").json()
    grande = cliente.graphql("{ misPedidos(primeros: 500) { nodos { id } } }").json()
    assert "cuesta" in costosa["errors"][0]["message"]
    assert grande["errors"][0]["extensions"]["code"] == "BAD_USER_INPUT"
    return f"costo: «{costosa['errors'][0]['message']}»; página >50: BAD_USER_INPUT", {}


@caso("8.3", "Reporte con agregación (admin/dueño)", "reporteVentas(desde, hasta)", "dueño; cocina", "dueño: categorías y conciliación; cocina: PROHIBIDO", "GraphQL Gateway + pedidos + pagos + inventario")
def _():
    hoy = datetime.now().date().isoformat()
    q = f'{{ reporteVentas(desde: "{hoy[:8]}01", hasta: "{hoy}") {{ cantidad porCategoria {{ categoria unidades }} conciliacion {{ ventas pagosAprobados pedidosConDiferencia }} }} }}'
    d = dueno.graphql(q).json()
    c = cocina.graphql(q).json()
    rep = d["data"]["reporteVentas"]
    assert rep["porCategoria"] and rep["conciliacion"]["ventas"] == rep["cantidad"]
    assert c["data"]["reporteVentas"] is None and c["errors"][0]["extensions"]["code"] == "PROHIBIDO"
    return f"dueño: {rep['cantidad']} ventas, {len(rep['porCategoria'])} categorías, {rep['conciliacion']['pagosAprobados']} pagos aprobados; cocina: PROHIBIDO", {}


@caso("10.5", "Reserva y recuperación de stock", "stock=1; pedido de 2 (409); pedido de 1; anular", "admin, cliente", "409 SIN_STOCK; stock 0; anular devuelve a 1", "Inventario (reservas) + pedidos")
def _():
    admin.pedir("PUT", "/catalogo/items/pro_tofu", json={"stock": 1})
    bowl = {**BOWL, "proteinaIds": ["pro_tofu"], "toppingIds": []}
    dos = cliente.pedir("POST", "/pedidos", json={"modoEntrega": "RETIRO", "lineas": [{"tipo": "BOWL", "cantidad": 2, "entrada": bowl}]})
    uno = cliente.pedir("POST", "/pedidos", json={"modoEntrega": "RETIRO", "lineas": [{"tipo": "BOWL", "cantidad": 1, "entrada": bowl}]})
    assert dos.status_code == 409 and dos.json()["codigo"] == "SIN_STOCK", dos.text
    assert uno.status_code == 201, uno.text
    tras = admin.pedir("GET", "/catalogo/items/pro_tofu").json()["stock"]
    publico = anonimo.pedir("GET", "/catalogo/items/pro_tofu").json()["disponible"]
    an = cliente.pedir("POST", f"/pedidos/{uno.json()['id']}/anular", json={"motivo": "Prueba de stock"})
    despues = admin.pedir("GET", "/catalogo/items/pro_tofu").json()["stock"]
    assert (tras, publico, an.status_code, despues) == (0, False, 200, 1)
    admin.pedir("PUT", "/catalogo/items/pro_tofu", json={"stock": 40})
    return "pedido de 2: 409 SIN_STOCK; pedido de 1: stock 0 y el catálogo lo muestra agotado; anulación: stock vuelve a 1", {}


@caso("10.6", "Anular un pedido pagado devuelve el pago", "pedido pagado; POST /pedidos/{id}/anular", "cliente", "ANULADO, venta anulada, pago DEVUELTO", "Pedidos + pagos + pasarela + inventario")
def _():
    p = cliente.pedir("POST", "/pedidos", json={"modoEntrega": "RETIRO", "lineas": [{"tipo": "ITEM", "cantidad": 1, "itemId": "beb_te"}]}).json()
    pago = cliente.pedir("POST", "/pagos", json={"pedidoId": p["id"]}, headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    with httpx.Client(timeout=15) as nav:
        nav.post(pago["urlPago"].replace("http://localhost:9000", args.pasarela).replace("http://127.0.0.1:9000", args.pasarela), data={"decision": "APROBADO"})
    r = cliente.pedir("POST", f"/pedidos/{p['id']}/anular", json={"motivo": "Me equivoqué de dirección"})
    a = r.json()
    pagos = cliente.pedir("GET", "/pagos", params={"pedidoId": p["id"]}).json()
    assert a["estado"] == "ANULADO" and a["venta"]["anulada"] and pagos[-1]["estado"] == "DEVUELTO"
    return f"{p['id']}: ANULADO, venta anulada, pago {pagos[-1]['estado']}", {"requestId": rid(r)}


@caso("6.1", "Ruta interna no publicada", "POST /internos/pedidos/{id}/pago-confirmado", "admin", "404", "Gateway (matriz de rutas)")
def _():
    r = admin.pedir("POST", f"/internos/pedidos/{estado['pedido']}/pago-confirmado", json={"pagoId": "x", "monto": 1})
    assert r.status_code == 404
    return "404 RUTA_INEXISTENTE", {"requestId": rid(r)}


@caso("7.7", "CSRF: petición desde otro sitio", "POST /pedidos con Origin ajeno y la cookie", "cliente", "403 ORIGEN_NO_PERMITIDO", "Gateway")
def _():
    r = cliente.pedir("POST", "/pedidos", json={}, headers={"Origin": "https://sitio-malicioso.example"})
    assert r.status_code == 403 and r.json()["codigo"] == "ORIGEN_NO_PERMITIDO"
    return "403 ORIGEN_NO_PERMITIDO", {"requestId": rid(r)}


@caso("7.8", "Cookie de sesión protegida", "POST /auth/login", "cliente", "HttpOnly, SameSite, Path=/api; token fuera del cuerpo", "Gateway")
def _():
    n = Navegador("nuevo")
    r = n.ingresar("cliente@correo.cl", "Cliente2026")
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Path=/api" in cookie
    token = re.search(r"pf_sesion=([^;]+)", cookie).group(1)
    assert token not in r.text
    salir = n.pedir("POST", "/auth/logout")
    despues = n.http.get("/pedidos", headers={"Cookie": f"pf_sesion={token}"})
    assert salir.status_code == 204 and despues.status_code == 401
    return "HttpOnly; SameSite=Lax; Path=/api; el token no viaja en el cuerpo; tras logout el mismo token responde 401", {}


if args.directo:

    @caso("7.9", "Acceso directo a los servicios privados", "GET a pedidos, inventario y GraphQL sin pasar por el gateway, con X-Usuario-Rol: admin", "atacante en la red", "403 en todos", "Cada servicio (credencial interna de Vault)")
    def _():
        h = {"X-Usuario-Id": "x", "X-Usuario-Rol": "admin", "X-Usuario-Sujeto": "x"}
        codigos = [
            httpx.get("http://127.0.0.1:8003/pedidos", headers=h).status_code,
            httpx.get("http://127.0.0.1:8001/items", headers=h).status_code,
            httpx.post("http://127.0.0.1:4000/graphql", headers=h, json={"query": "{__typename}"}).status_code,
            httpx.post("http://127.0.0.1:4100/login", json={"usuario": "admin@pokefresh.cl", "clave": "Admin2026"}).status_code,
        ]
        assert codigos == [403, 403, 403, 401], codigos
        return f"pedidos {codigos[0]}, inventario {codigos[1]}, GraphQL {codigos[2]}, Auth Service {codigos[3]}", {}

    @caso("7.10", "Un servicio no puede leer secretos ajenos en Vault", "token de inventario lee la credencial de pagos y el pepper", "inventario", "403 de Vault", "Vault (políticas por servicio)")
    def _():
        token = (Path(__file__).resolve().parents[1] / "local" / "tokens" / "inventario.token").read_text().strip()
        h = {"X-Vault-Token": token}
        propio = httpx.get("http://127.0.0.1:8200/v1/secret/data/poke-fresh/internos/inventario", headers=h).status_code
        ajeno = httpx.get("http://127.0.0.1:8200/v1/secret/data/poke-fresh/internos/pagos", headers=h).status_code
        pepper = httpx.get("http://127.0.0.1:8200/v1/secret/data/poke-fresh/auth", headers=h).status_code
        assert (propio, ajeno, pepper) == (200, 403, 403)
        return f"propia 200; credencial de pagos {ajeno}; pepper {pepper}", {}

    @caso("10.7", "Indisponibilidad de Vault", "Vault sellado; GET /catalogo/items y login", "anónimo", "503 SECRETOS_NO_DISPONIBLES (no deja pasar)", "Gateway / Vault")
    def _():
        httpx.post("http://127.0.0.1:8200/v1/_sellar", json={"sellado": True})
        try:
            time.sleep(31)  # el gateway guarda lo leído de Vault 30 s
            r = anonimo.pedir("GET", "/catalogo/items")
            l = Navegador("x").pedir("POST", "/auth/login", json={"email": "admin@pokefresh.cl", "clave": "Admin2026"})
        finally:
            httpx.post("http://127.0.0.1:8200/v1/_sellar", json={"sellado": False})
        assert r.status_code == 503 and l.status_code in (502, 503)
        return f"catálogo {r.status_code} {r.json()['codigo']}; login {l.status_code}", {"requestIds": [rid(r), rid(l)]}


@caso("7.11", "Límite de intentos de login", "25 logins seguidos con clave incorrecta", "anónimo", "bloqueo (429) antes del intento 25", "Auth Service (5 intentos) + gateway (20/min por IP)")
def _():
    n = Navegador("fuerza bruta")
    codigos = [n.pedir("POST", "/auth/login", json={"email": "dueno@pokefresh.cl", "clave": f"Mala{i}"}).status_code for i in range(25)]
    primero = codigos.index(429) + 1
    assert 429 in codigos and primero <= 6
    return f"401 en los primeros {primero - 1}; 429 desde el intento {primero}", {"codigos": codigos}


# ---------------------------------------------------------------------------

total = len(resultados)
buenos = sum(r["ok"] for r in resultados)
salida = Path(args.salida)
salida.mkdir(parents=True, exist_ok=True)
(salida / "e2e-resultados.json").write_text(json.dumps({"fecha": datetime.now().isoformat(timespec="seconds"), "gateway": args.gateway, "resultados": resultados}, ensure_ascii=False, indent=2))

filas = ["| Caso | Prueba | Entrada | Identidad | Esperado | Obtenido | Componente que lo verifica | Resultado |", "|---|---|---|---|---|---|---|---|"]
for r in resultados:
    filas.append(f"| {r['caso']} | {r['nombre']} | {r['entrada']} | {r['identidad']} | {r['esperado']} | {r['obtenido']} | {r['componente']} | {'✅' if r['ok'] else '❌'} |")
(salida / "e2e-resultados.md").write_text(
    f"# Pruebas de punta a punta\n\nEjecutadas el {datetime.now():%d-%m-%Y %H:%M} contra `{args.gateway}`. {buenos} de {total} correctas.\n"
    f"El detalle de cada petición (con su X-Request-Id para buscarla en los logs) está en `e2e-resultados.json`.\n\n" + "\n".join(filas) + "\n"
)
print(f"\n{buenos}/{total} casos correctos. Evidencia en {salida}")
sys.exit(0 if buenos == total else 1)
