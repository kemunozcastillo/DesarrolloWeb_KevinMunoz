"""
Microservicio de pedidos: el ciclo de vida de cada pedido, la venta y la
boleta, la cola de cocina y la de despacho, y el reporte de ventas.

Flujo (el mismo que el frontend):
  PENDIENTE_PAGO -> PAGADO -> EN_PREPARACION -> LISTO_DESPACHO -> EN_DESPACHO -> ENTREGADO
                                              \\-> LISTO_RETIRO --------------/
  ANULADO solo desde PENDIENTE_PAGO o PAGADO (antes de que cocina acepte).

Reglas de autorización que aplica este servicio (además del gateway):
  - un cliente solo ve y anula SUS pedidos; uno ajeno responde 404, sin datos;
  - cocina acepta y termina; despacho despacha y entrega; admin hace todo;
  - cocina y despacho reciben solo nombre y teléfono del cliente (no RUN ni correo).

El precio lo calcula inventario; el pago lo confirma el servicio de pagos
por una ruta interna. Nada que mande el navegador fija precios ni pagos.
"""

import re
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, Query, Request

from comun import internos as servicios
from comun.aplicacion import crear_app, request_id
from comun.db import obtener_db, siguiente
from comun.errores import ErrorApi, conflicto, invalido, no_encontrado, prohibido
from comun.seguridad import Identidad, nombre_actor, requerir
from comun.tiempo import ahora_iso, dia_local, fecha_valida
from pedidos import eventos

ESTADOS = {
    "PENDIENTE_PAGO": "Pendiente de pago",
    "PAGADO": "Esperando cocina",
    "EN_PREPARACION": "En preparación",
    "LISTO_DESPACHO": "Listo para despacho",
    "EN_DESPACHO": "En camino",
    "LISTO_RETIRO": "Listo para retiro",
    "ENTREGADO": "Entregado",
    "ANULADO": "Anulado",
}
ANULABLES = ("PENDIENTE_PAGO", "PAGADO")
COLA_COCINA = ("PAGADO", "EN_PREPARACION")
COLA_DESPACHO = ("LISTO_DESPACHO", "EN_DESPACHO", "LISTO_RETIRO")
CHOFERES = ["Luis Contreras", "Andrea Muñoz"]
CAJA_WEB = "CAJA-WEB-01"
CAJERO_VIRTUAL = "Cajero virtual"

publico = APIRouter(tags=["Pedidos"])
internos = APIRouter(prefix="/internos", tags=["Interno"])

TODOS = ("cliente", "admin", "dueno", "cocina", "despacho")


# ---------------------------------------------------------------------------
# Representación según quién pregunta
# ---------------------------------------------------------------------------


def vista(pedido: dict, quien: Identidad) -> dict:
    p = {k: v for k, v in pedido.items() if k not in ("_id", "idempotencia", "consumo")}
    p["id"] = pedido["_id"]
    if quien.rol in ("cocina", "despacho"):
        # Para preparar y entregar basta el nombre y el teléfono.
        p["cliente"] = {"nombre": pedido["cliente"]["nombre"], "telefono": pedido["cliente"]["telefono"]}
    if quien.es_cliente:
        # El cliente no necesita el detalle interno del historial (quién del personal hizo cada paso).
        p["historial"] = [{"estado": h["estado"], "fecha": h["fecha"]} for h in pedido["historial"]]
    return p


def puede_ver(pedido: dict, quien: Identidad) -> bool:
    if quien.es_cliente:
        return pedido["clienteId"] == quien.sujeto
    if quien.rol == "cocina":
        return pedido.get("venta") is not None
    if quien.rol == "despacho":
        return pedido["estado"] in COLA_DESPACHO + ("ENTREGADO",)
    return quien.rol in ("admin", "dueno")


async def buscar(db, pedido_id: str, quien: Identidad) -> dict:
    pedido = await db["pedidos"].find_one({"_id": pedido_id})
    # Un pedido ajeno se responde igual que uno inexistente: no se confirma que existe.
    if not pedido or not puede_ver(pedido, quien):
        raise no_encontrado("No encontramos ese pedido.")
    return pedido


def paso(estado: str, actor: str, nota: str = "") -> dict:
    return {"estado": estado, "fecha": ahora_iso(), "actor": actor, "nota": nota}


# ---------------------------------------------------------------------------
# Crear y consultar
# ---------------------------------------------------------------------------


@publico.post("/pedidos", status_code=201)
async def crear_pedido(
    datos: dict,
    request: Request,
    db=Depends(obtener_db),
    yo: Identidad = Depends(requerir("cliente")),
    idempotencia: str | None = Header(default=None, alias="Idempotency-Key"),
):
    # Un doble clic en "Ir a pagar" no debe crear dos pedidos.
    if idempotencia:
        previo = await db["pedidos"].find_one({"idempotencia": f"{yo.sujeto}:{idempotencia}"})
        if previo:
            return vista(previo, yo)

    modo = datos.get("modoEntrega")
    if modo not in ("RETIRO", "DELIVERY"):
        raise invalido("Elige cómo recibir tu pedido.")
    nota = str(datos.get("nota") or "").strip()[:200]

    rid = request_id(request)
    cliente = await servicios.llamar("clientes", "GET", f"/internos/clientes/{yo.sujeto}", request_id=rid)
    if not cliente["activo"]:
        raise ErrorApi(403, "INACTIVA", "Tu cuenta no está habilitada para comprar.")
    if modo == "DELIVERY" and not cliente["tieneDespacho"]:
        raise ErrorApi(400, "FUERA_DE_RADIO", f"{cliente['comuna']} está fuera del radio de despacho de 3 km. Puedes retirar en el local.")

    # El precio lo calcula inventario con su catálogo; del carrito solo se usa la selección.
    cotizacion = await servicios.llamar("inventario", "POST", "/internos/cotizar", json={"lineas": datos.get("lineas")}, request_id=rid)

    pedido_id = f"PF-{await siguiente(db, 'pedido'):05d}"
    await servicios.llamar("inventario", "POST", "/internos/reservas", json={"pedidoId": pedido_id, "consumo": cotizacion["consumo"]}, request_id=rid)

    pedido = {
        "_id": pedido_id,
        "clienteId": yo.sujeto,
        "cliente": {"nombre": cliente["nombre"], "run": cliente["run"], "email": cliente["email"], "telefono": cliente["telefono"]},
        "modoEntrega": modo,
        "direccion": f"{cliente['direccion']}, {cliente['comuna']}" if modo == "DELIVERY" else None,
        "nota": nota,
        # Las líneas se congelan con su descripción y precio de este momento.
        "lineas": cotizacion["lineas"],
        "total": cotizacion["total"],
        "despacho": 0,
        "pago": {"medio": "SERVIPAG", "estado": "PENDIENTE"},
        "venta": None,
        "boleta": None,
        "estado": "PENDIENTE_PAGO",
        "creadoEn": ahora_iso(),
        "historial": [paso("PENDIENTE_PAGO", "Cliente")],
        "consumo": cotizacion["consumo"],
    }
    if idempotencia:
        pedido["idempotencia"] = f"{yo.sujeto}:{idempotencia}"

    try:
        await db["pedidos"].insert_one(pedido)
    except Exception:
        await servicios.llamar("inventario", "POST", f"/internos/reservas/{pedido_id}/liberar", request_id=rid)
        raise
    return vista(pedido, yo)


@publico.get("/pedidos")
async def listar(
    estado: str | None = None,
    cola: str | None = Query(default=None, pattern="^(cocina|despacho)$"),
    q: str | None = None,
    limite: int = Query(default=100, ge=1, le=500),
    db=Depends(obtener_db),
    yo: Identidad = Depends(requerir(*TODOS)),
):
    filtro: dict = {}
    orden = [("creadoEn", -1)]

    if yo.es_cliente:
        filtro["clienteId"] = yo.sujeto
    elif yo.rol == "cocina":
        cola = "cocina"
    elif yo.rol == "despacho":
        cola = "despacho"

    if cola == "cocina":
        filtro["estado"] = {"$in": list(COLA_COCINA)}
        orden = [("venta.fecha", 1)]  # en el orden en que se pagaron
    elif cola == "despacho":
        filtro["estado"] = {"$in": list(COLA_DESPACHO)}
        orden = [("listoEn", 1)]
    elif estado:
        if estado not in ESTADOS:
            raise invalido("Ese estado no existe.")
        filtro["estado"] = estado

    if q and not yo.es_cliente:
        patron = re.compile(re.escape(q.strip()), re.IGNORECASE)
        filtro["$or"] = [{"_id": patron}, {"cliente.nombre": patron}]

    docs = [d async for d in db["pedidos"].find(filtro).sort(orden).limit(limite)]
    return [vista(d, yo) for d in docs]


@publico.get("/pedidos/boleta/{numero}")
async def por_boleta(numero: int, db=Depends(obtener_db), yo: Identidad = Depends(requerir("cliente", "admin", "dueno"))):
    pedido = await db["pedidos"].find_one({"boleta.numero": numero})
    if not pedido or not puede_ver(pedido, yo):
        raise no_encontrado("No encontramos esa boleta.")
    return vista(pedido, yo)


@publico.get("/pedidos/{pedido_id}")
async def obtener(pedido_id: str, db=Depends(obtener_db), yo: Identidad = Depends(requerir(*TODOS))):
    return vista(await buscar(db, pedido_id, yo), yo)


# ---------------------------------------------------------------------------
# Cambios de estado
# ---------------------------------------------------------------------------


async def cambiar_estado(db, pedido_id: str, yo: Identidad, *, desde: tuple, hacia, roles: tuple, nota: str = "", extra: dict | None = None) -> dict:
    if yo.rol not in ("admin",) + roles:
        raise prohibido("Tu perfil no puede hacer este paso.")
    pedido = await buscar(db, pedido_id, yo)
    destino = hacia(pedido) if callable(hacia) else hacia

    # La condición sobre el estado va en el mismo update: si dos puestos
    # aceptan el mismo pedido a la vez, solo uno lo consigue.
    r = await db["pedidos"].update_one(
        {"_id": pedido_id, "estado": {"$in": list(desde)}},
        {"$set": {"estado": destino, **(extra or {})}, "$push": {"historial": paso(destino, nombre_actor(yo), nota)}},
    )
    if r.modified_count == 0:
        actual = await db["pedidos"].find_one({"_id": pedido_id})
        raise conflicto(f'El pedido está "{ESTADOS[actual["estado"]]}": este paso ya no corresponde.', "ESTADO")
    return vista(await db["pedidos"].find_one({"_id": pedido_id}), yo)


@publico.post("/pedidos/{pedido_id}/aceptar")
async def aceptar(pedido_id: str, db=Depends(obtener_db), yo: Identidad = Depends(requerir(*TODOS))):
    return await cambiar_estado(db, pedido_id, yo, desde=("PAGADO",), hacia="EN_PREPARACION", roles=("cocina",))


@publico.post("/pedidos/{pedido_id}/terminar")
async def terminar(pedido_id: str, db=Depends(obtener_db), yo: Identidad = Depends(requerir(*TODOS))):
    return await cambiar_estado(
        db, pedido_id, yo,
        desde=("EN_PREPARACION",),
        hacia=lambda p: "LISTO_DESPACHO" if p["modoEntrega"] == "DELIVERY" else "LISTO_RETIRO",
        roles=("cocina",),
        extra={"listoEn": ahora_iso()},
    )


@publico.post("/pedidos/{pedido_id}/despachar")
async def despachar(pedido_id: str, datos: dict, db=Depends(obtener_db), yo: Identidad = Depends(requerir(*TODOS))):
    chofer = datos.get("chofer")
    if chofer not in CHOFERES:
        raise invalido("Elige el chofer que lleva el pedido.")
    return await cambiar_estado(db, pedido_id, yo, desde=("LISTO_DESPACHO",), hacia="EN_DESPACHO", roles=("despacho",), nota=f"Chofer: {chofer}", extra={"chofer": chofer})


@publico.post("/pedidos/{pedido_id}/entregar")
async def entregar(pedido_id: str, db=Depends(obtener_db), yo: Identidad = Depends(requerir(*TODOS))):
    return await cambiar_estado(db, pedido_id, yo, desde=("EN_DESPACHO", "LISTO_RETIRO"), hacia="ENTREGADO", roles=("despacho",))


@publico.post("/pedidos/{pedido_id}/impresa", status_code=204)
async def marcar_impresa(pedido_id: str, db=Depends(obtener_db), yo: Identidad = Depends(requerir("admin", "cocina", "despacho"))):
    await buscar(db, pedido_id, yo)
    await db["pedidos"].update_one({"_id": pedido_id}, {"$set": {"ordenImpresa": ahora_iso()}})


@publico.post("/pedidos/{pedido_id}/anular")
async def anular(pedido_id: str, datos: dict, request: Request, db=Depends(obtener_db), yo: Identidad = Depends(requerir("cliente", "admin"))):
    motivo = str(datos.get("motivo") or "").strip()
    if not 5 <= len(motivo) <= 200:
        raise invalido("Indica el motivo de la anulación (entre 5 y 200 caracteres).")

    pedido = await buscar(db, pedido_id, yo)
    if pedido["estado"] not in ANULABLES:
        raise conflicto("Cocina ya aceptó el pedido: no se puede anular.", "ESTADO")

    pagado = pedido["estado"] == "PAGADO"
    rid = request_id(request)
    if pagado:
        # Primero la devolución: si pagos no responde, el pedido no queda anulado con el dinero retenido.
        await servicios.llamar("pagos", "POST", "/internos/devoluciones", json={"pedidoId": pedido_id, "motivo": motivo}, request_id=rid)

    cambios = {
        "estado": "ANULADO",
        "anulacion": {"motivo": motivo, "fecha": ahora_iso(), "por": nombre_actor(yo), "devolucion": pagado},
    }
    if pagado:
        cambios.update({"venta.anulada": True, "pago.estado": "DEVUELTO"})

    r = await db["pedidos"].update_one(
        {"_id": pedido_id, "estado": pedido["estado"]},
        {"$set": cambios, "$push": {"historial": paso("ANULADO", nombre_actor(yo), motivo)}},
    )
    if r.modified_count == 0:
        raise conflicto("El pedido cambió mientras lo anulabas. Revisa su estado.", "ESTADO")

    # Recuperación de stock: lo reservado vuelve al inventario.
    await servicios.llamar("inventario", "POST", f"/internos/reservas/{pedido_id}/liberar", request_id=rid)
    return vista(await db["pedidos"].find_one({"_id": pedido_id}), yo)


# ---------------------------------------------------------------------------
# Interno: confirmación de pago (solo la llama el servicio de pagos)
# ---------------------------------------------------------------------------


@internos.post("/pedidos/{pedido_id}/pago-confirmado")
async def pago_confirmado(pedido_id: str, datos: dict, db=Depends(obtener_db)):
    """
    El servicio de pagos avisa que la pasarela confirmó el pago. El cajero
    virtual registra la venta y emite la boleta. Idempotente: si llega dos
    veces el mismo pago, la segunda no hace nada.
    """
    pedido = await db["pedidos"].find_one({"_id": pedido_id})
    if not pedido:
        raise no_encontrado("No existe ese pedido.")

    if pedido.get("pago", {}).get("pagoId") == datos.get("pagoId") and pedido.get("venta"):
        return {"pedidoId": pedido_id, "estado": pedido["estado"], "repetido": True}
    if pedido["estado"] != "PENDIENTE_PAGO":
        raise conflicto("El pedido ya no espera pago.", "ESTADO")
    if datos.get("monto") != pedido["total"]:
        # El monto pagado debe ser exactamente el total calculado por el backend.
        raise conflicto("El monto pagado no coincide con el total del pedido.", "MONTO_DISTINTO")

    ahora = ahora_iso()
    total = pedido["total"]
    neto = round(total / 1.19)
    venta = {"numero": await siguiente(db, "venta"), "caja": CAJA_WEB, "cajero": CAJERO_VIRTUAL, "fecha": ahora, "total": total, "anulada": False}
    boleta = {"numero": await siguiente(db, "boleta"), "fecha": ahora, "neto": neto, "iva": total - neto, "total": total, "enviadaA": pedido["cliente"]["email"]}
    pago = {"medio": "SERVIPAG", "estado": "CONFIRMADO", "referencia": datos.get("referencia"), "pagoId": datos.get("pagoId"), "confirmadoEn": ahora}

    r = await db["pedidos"].update_one(
        {"_id": pedido_id, "estado": "PENDIENTE_PAGO"},
        {
            "$set": {"estado": "PAGADO", "venta": venta, "boleta": boleta, "pago": pago},
            "$push": {"historial": paso("PAGADO", CAJERO_VIRTUAL, f"Venta N° {venta['numero']}, boleta N° {boleta['numero']}")},
        },
    )
    if r.modified_count == 0:
        raise conflicto("El pedido ya no espera pago.", "ESTADO")

    await eventos.publicar("/queue/correos", {"tipo": "BOLETA", "para": boleta["enviadaA"], "pedido": pedido_id, "boleta": boleta["numero"], "total": str(total)})
    await eventos.publicar("/queue/cocina", {"tipo": "PEDIDO_PAGADO", "pedido": pedido_id, "modoEntrega": pedido["modoEntrega"]})
    return {"pedidoId": pedido_id, "estado": "PAGADO", "repetido": False}


# ---------------------------------------------------------------------------
# Reporte de ventas
# ---------------------------------------------------------------------------


@publico.get("/reportes/ventas")
async def reporte(desde: str, hasta: str, db=Depends(obtener_db), yo: Identidad = Depends(requerir("admin", "dueno"))):
    if not fecha_valida(desde) or not fecha_valida(hasta):
        raise invalido("Indica las fechas como AAAA-MM-DD.")
    if desde > hasta:
        desde, hasta = hasta, desde
    if (date.fromisoformat(hasta) - date.fromisoformat(desde)).days > 366:
        raise invalido("El período puede tener hasta un año.")

    # Margen de un día por la diferencia horaria; el filtro fino se hace con la fecha local.
    inicio = (date.fromisoformat(desde) - timedelta(days=1)).isoformat()
    fin = (date.fromisoformat(hasta) + timedelta(days=2)).isoformat()
    candidatos = [d async for d in db["pedidos"].find({"venta.fecha": {"$gte": inicio, "$lt": fin}})]
    ventas = sorted((p for p in candidatos if desde <= dia_local(p["venta"]["fecha"]) <= hasta), key=lambda p: p["venta"]["fecha"])
    validas = [p for p in ventas if not p["venta"]["anulada"]]
    anuladas = [p for p in ventas if p["venta"]["anulada"]]
    monto = sum(p["total"] for p in validas)

    por_dia = {}
    d = date.fromisoformat(desde)
    while d <= date.fromisoformat(hasta):
        por_dia[d.isoformat()] = {"cantidad": 0, "monto": 0}
        d += timedelta(days=1)
    for p in validas:
        dia = por_dia[dia_local(p["venta"]["fecha"])]
        dia["cantidad"] += 1
        dia["monto"] += p["total"]

    por_entrega = []
    for modo, nombre in (("DELIVERY", "Despacho a domicilio"), ("RETIRO", "Retiro en local")):
        del_modo = [p for p in validas if p["modoEntrega"] == modo]
        por_entrega.append({"modo": modo, "nombre": nombre, "cantidad": len(del_modo), "monto": sum(p["total"] for p in del_modo)})

    productos: dict[str, dict] = {}
    for p in validas:
        for l in p["lineas"]:
            nombre = l["descripcion"].split(":")[0]
            actual = productos.setdefault(nombre, {"nombre": nombre, "cantidad": 0, "monto": 0, "itemIds": set()})
            actual["cantidad"] += l["cantidad"]
            actual["monto"] += l["subtotal"]
            if l.get("tipo") == "ITEM":
                actual["itemIds"].update(l.get("itemIds", []))
    mas_vendidos = sorted(productos.values(), key=lambda x: -x["cantidad"])[:6]
    for m in mas_vendidos:
        m["itemIds"] = sorted(m["itemIds"])

    return {
        "desde": desde,
        "hasta": hasta,
        "ventas": [vista(p, yo) for p in ventas],
        "cantidad": len(validas),
        "monto": monto,
        "promedio": round(monto / len(validas)) if validas else 0,
        "anuladas": len(anuladas),
        "montoAnulado": sum(p["total"] for p in anuladas),
        "porDia": [{"dia": k, **v} for k, v in por_dia.items()],
        "porEntrega": por_entrega,
        "masVendidos": mas_vendidos,
    }


@publico.get("/pedidos-config")
async def configuracion(_yo: Identidad = Depends(requerir(*TODOS))):
    return {"estados": ESTADOS, "choferes": CHOFERES, "caja": CAJA_WEB, "cajero": CAJERO_VIRTUAL}


async def preparar(app) -> None:
    db = app.state.db
    await db["pedidos"].create_index([("clienteId", 1), ("creadoEn", -1)])
    await db["pedidos"].create_index("estado")
    await db["pedidos"].create_index("venta.fecha")
    await db["pedidos"].create_index("boleta.numero", sparse=True)
    await db["pedidos"].create_index("idempotencia", unique=True, sparse=True)


def crear_aplicacion():
    return crear_app("pedidos", "Poke Fresh: pedidos", [publico, internos], al_iniciar=preparar)


app = crear_aplicacion()
