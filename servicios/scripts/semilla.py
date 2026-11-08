"""
Datos de ejemplo: las fichas de los clientes de prueba y un mes de ventas,
para que caja, cocina, despacho y reportes tengan algo que mostrar desde el
primer arranque. Todos los datos son ficticios.

Las cuentas (correo y contraseña) de estos clientes las crea el Auth Service
en modo demo, con los mismos ids (cli_demo_1, ...).

Se corre una vez, después de que los servicios crearon sus índices:
    python -m scripts.semilla
No hace nada si ya hay pedidos.

Escribe directo en las bases de clientes, pedidos y pagos porque es un script
de carga inicial (como una migración), con su propio usuario de Mongo. En
operación normal ningún servicio toca la base de otro.
"""

import asyncio
import os
import random
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus, urlsplit
from zoneinfo import ZoneInfo

from motor.motor_asyncio import AsyncIOMotorClient

from clientes.ficha import digito_verificador, tiene_despacho
from comun import vault
from inventario.reglas import Cotizador, documentos_iniciales

ZONA = ZoneInfo("America/Santiago")
REGION = "Región Metropolitana de Santiago"

CLIENTES = [
    ("16459723", "Javiera Morales Díaz", "Av. Providencia 2133, depto 504", "Providencia", "1994-05-12", "F", "cliente@correo.cl", "+56 9 8123 4567"),
    ("18234567", "Benjamín Castro Vera", "Irarrázaval 3450", "Ñuñoa", "1998-11-02", "M", "benjamin.castro@correo.cl", "+56 9 7654 3210"),
    ("15987321", "Fernanda Silva Rojas", "San Diego 1020", "Santiago", "1989-02-27", "F", "fernanda.silva@correo.cl", "+56 9 6543 2109"),
    ("19876543", "Diego Araya Pinto", "Av. Recoleta 850", "Recoleta", "2001-07-19", "M", "diego.araya@correo.cl", "+56 9 5432 1098"),
    ("17345678", "Catalina Núñez León", "Av. Apoquindo 4500", "Las Condes", "1992-09-08", "F", "catalina.nunez@correo.cl", "+56 9 4321 0987"),
    ("14567890", "Ignacio Herrera Mora", "Av. Pajaritos 3200", "Maipú", "1985-12-15", "M", "ignacio.herrera@correo.cl", "+56 9 3210 9876"),
]

COCINA = "Francisca Lagos (Cocina)"
DESPACHO = "Matías Pérez (Encargado de despacho)"
ADMIN = "Camila Rojas (Administrador)"
CHOFERES = ["Luis Contreras", "Andrea Muñoz"]


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def fichas() -> list[dict]:
    hace_40 = iso(datetime.now(timezone.utc) - timedelta(days=40))
    return [
        {
            "_id": f"cli_demo_{i + 1}",
            "run": f"{cuerpo}-{digito_verificador(cuerpo)}",
            "nombre": nombre,
            "direccion": direccion,
            "region": REGION,
            "provincia": "Santiago",
            "comuna": comuna,
            "fechaNacimiento": nacimiento,
            "sexo": sexo,
            "email": email,
            "telefono": telefono,
            "activo": True,
            "origen": "ADMIN" if i % 3 == 2 else "WEB",
            "creadoEn": hace_40,
        }
        for i, (cuerpo, nombre, direccion, comuna, nacimiento, sexo, email, telefono) in enumerate(CLIENTES)
    ]


def linea_aleatoria(azar: random.Random, cot: Cotizador) -> dict:
    def ids(categoria):
        return [i["_id"] for i in cot.catalogo.values() if i["categoria"] == categoria and i["disponible"] and (i["stock"] is None or i["stock"] > 0)]

    tipo = azar.random()
    if tipo < 0.62:
        toppings = list(dict.fromkeys([azar.choice(ids("TOPPING")), azar.choice(ids("TOPPING"))]))
        entrada = {"tamanoId": "regular" if azar.random() < 0.7 else "grande", "baseIds": [azar.choice(ids("BASE"))], "proteinaIds": [azar.choice(ids("PROTEINA"))], "salsaIds": [azar.choice(ids("SALSA"))], "toppingIds": toppings}
        linea = {"tipo": "BOWL", "cantidad": 1, "entrada": entrada}
    elif tipo < 0.85:
        linea = {"tipo": "ITEM", "cantidad": 1 + int(azar.random() * 2), "itemId": azar.choice(ids("BEBIDA"))}
    else:
        bowl = {"baseIds": [azar.choice(ids("BASE"))], "proteinaIds": [azar.choice(ids("PROTEINA"))], "salsaIds": [azar.choice(ids("SALSA"))], "toppingIds": []}
        linea = {"tipo": "PROMO", "cantidad": 1, "promoId": "promo_combo", "bowls": [bowl], "bebidaId": azar.choice(ids("BEBIDA"))}
    return cot.lineas([linea])["lineas"][0]


def generar(clientes: list[dict]) -> tuple[list[dict], list[dict]]:
    azar = random.Random(24)
    cot = Cotizador({d["_id"]: d for d in documentos_iniciales("")})
    ahora = datetime.now(ZONA)

    fechas = []
    for dias in range(30, -1, -1):
        cantidad = 7 if dias == 0 else 1 + int(azar.random() * 4)
        for n in range(cantidad):
            dia = ahora - timedelta(days=dias)
            hora_max = max(12, ahora.hour) if dias == 0 else 21
            f = dia.replace(hour=12 + int(azar.random() * (hora_max - 11)), minute=int(azar.random() * 60), second=0, microsecond=0)
            if f > ahora:
                f = ahora - timedelta(minutes=(8 - n) * 9)
            # "De hoy" = los últimos pedidos, que quedan en curso para cocina y despacho
            # (aunque se corra pasada la medianoche).
            fechas.append((f, dias == 0))
    fechas.sort()

    estados_hoy = ["ENTREGADO", "ENTREGADO", "EN_DESPACHO", "LISTO", "EN_PREPARACION", "PAGADO", "PAGADO"]
    pedidos, pagos = [], []
    venta = boleta = 0

    for n, (fecha, es_hoy) in enumerate(fechas, start=1):
        cliente = azar.choice(clientes)
        delivery = tiene_despacho(cliente["comuna"]) and azar.random() < 0.65
        lineas = [linea_aleatoria(azar, cot) for _ in range(1 + int(azar.random() * 2))]
        total = sum(l["subtotal"] for l in lineas)
        en = lambda m: iso(fecha + timedelta(minutes=m))  # noqa: E731

        final = estados_hoy[(sum(1 for p in pedidos if p["_hoy"]))] if es_hoy else "ENTREGADO"
        if not es_hoy and azar.random() < 0.06:
            final = "ANULADO_PAGADO" if azar.random() < 0.5 else "ANULADO_PENDIENTE"

        p = {
            "_id": f"PF-{n:05d}",
            "_hoy": es_hoy,
            "clienteId": cliente["_id"],
            "cliente": {k: cliente[k] for k in ("nombre", "run", "email", "telefono")},
            "modoEntrega": "DELIVERY" if delivery else "RETIRO",
            "direccion": f"{cliente['direccion']}, {cliente['comuna']}" if delivery else None,
            "nota": "",
            "lineas": lineas,
            "total": total,
            "despacho": 0,
            "pago": {"medio": "SERVIPAG", "estado": "PENDIENTE"},
            "venta": None,
            "boleta": None,
            "estado": "PENDIENTE_PAGO",
            "creadoEn": iso(fecha),
            "historial": [{"estado": "PENDIENTE_PAGO", "fecha": iso(fecha), "actor": "Cliente", "nota": ""}],
        }

        def pasar(estado, m, actor, nota=""):
            p["estado"] = estado
            p["historial"].append({"estado": estado, "fecha": en(m), "actor": actor, "nota": nota})

        if final == "ANULADO_PENDIENTE":
            p["anulacion"] = {"motivo": "Me equivoqué de dirección", "fecha": en(10), "por": "Cliente", "devolucion": False}
            pasar("ANULADO", 10, "Cliente", "Me equivoqué de dirección")
        else:
            venta += 1
            boleta += 1
            referencia = f"SVP-{azar.randrange(10**8):08d}"
            pago_id = f"PAG-DEMO{n:05d}"
            neto = round(total / 1.19)
            p["venta"] = {"numero": venta, "caja": "CAJA-WEB-01", "cajero": "Cajero virtual", "fecha": en(1), "total": total, "anulada": False}
            p["boleta"] = {"numero": boleta, "fecha": en(1), "neto": neto, "iva": total - neto, "total": total, "enviadaA": cliente["email"]}
            p["pago"] = {"medio": "SERVIPAG", "estado": "CONFIRMADO", "referencia": referencia, "pagoId": pago_id, "confirmadoEn": en(1)}
            pasar("PAGADO", 1, "Cajero virtual", f"Venta N° {venta}, boleta N° {boleta}")
            pago = {
                "_id": pago_id, "pedidoId": p["_id"], "clienteId": cliente["_id"], "monto": total, "medio": "SERVIPAG",
                "estado": "APROBADO", "referencia": referencia, "token": secrets.token_urlsafe(18), "urlPago": None,
                "idempotencia": f"semilla:{p['_id']}", "creadoEn": iso(fecha), "actualizadoEn": en(1), "pedidoNotificado": True,
                "eventos": [{"tipo": "CREADO", "fecha": iso(fecha)}, {"tipo": "APROBADO", "fecha": en(1)}],
            }

            if final == "ANULADO_PAGADO":
                motivo = "El cliente ya no podrá recibir el pedido"
                p["venta"]["anulada"] = True
                p["pago"]["estado"] = "DEVUELTO"
                p["anulacion"] = {"motivo": motivo, "fecha": en(8), "por": ADMIN, "devolucion": True}
                pasar("ANULADO", 8, ADMIN, motivo)
                pago["estado"] = "DEVUELTO"
                pago["eventos"].append({"tipo": "DEVUELTO", "fecha": en(8), "motivo": motivo})
            elif final != "PAGADO":
                pasar("EN_PREPARACION", 3, COCINA)
                if final != "EN_PREPARACION":
                    p["listoEn"] = en(15)
                    pasar("LISTO_DESPACHO" if delivery else "LISTO_RETIRO", 15, COCINA)
                    if final != "LISTO":
                        if delivery:
                            p["chofer"] = azar.choice(CHOFERES)
                            pasar("EN_DESPACHO", 18, DESPACHO, f"Chofer: {p['chofer']}")
                        if final == "ENTREGADO":
                            pasar("ENTREGADO", 38, DESPACHO)
            pagos.append(pago)

        pedidos.append(p)

    for p in pedidos:
        del p["_hoy"]
    return pedidos, pagos


async def conectar() -> AsyncIOMotorClient:
    uri = os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017")
    ruta = os.environ.get("MONGO_RUTA_VAULT")
    if ruta:
        datos = await vault.leer_secreto(ruta)
        partes = urlsplit(uri)
        # El usuario de la semilla vive en pf_clientes y tiene readWrite en clientes, pedidos y pagos.
        # Se conserva lo que traiga la URI base (tls=true&tlsCAFile=...).
        consulta = "&".join(filter(None, ["authSource=pf_clientes", partes.query]))
        uri = f"mongodb://{quote_plus(datos['usuario'])}:{quote_plus(datos['clave'])}@{partes.netloc}/?{consulta}"
    return AsyncIOMotorClient(uri, serverSelectionTimeoutMS=10000)


async def sembrar(mongo) -> str:
    if await mongo["pf_pedidos"]["pedidos"].count_documents({}) > 0:
        return "Ya hay pedidos: no se cargan datos de ejemplo."

    clientes = fichas()
    for c in clientes:
        await mongo["pf_clientes"]["clientes"].update_one({"_id": c["_id"]}, {"$setOnInsert": c}, upsert=True)

    pedidos, pagos = generar(clientes)
    await mongo["pf_pedidos"]["pedidos"].insert_many(pedidos)
    await mongo["pf_pagos"]["pagos"].insert_many(pagos)
    ventas = sum(1 for p in pedidos if p["venta"])
    for nombre, valor in (("pedido", len(pedidos)), ("venta", ventas), ("boleta", ventas)):
        await mongo["pf_pedidos"]["contadores"].update_one({"_id": nombre}, {"$set": {"valor": valor}}, upsert=True)
    return f"Datos de ejemplo: {len(clientes)} clientes, {len(pedidos)} pedidos, {len(pagos)} pagos."


async def main():
    mongo = await conectar()
    print(await sembrar(mongo))
    mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
