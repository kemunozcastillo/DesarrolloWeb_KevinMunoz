"""
Catálogo inicial, tamaños, reglas de armado y cálculo de precios.

El precio de un pedido se calcula SIEMPRE aquí, con el catálogo guardado en
la base. El frontend muestra una cotización para que el cliente vea el
precio mientras arma su bowl, pero lo que envía al confirmar es solo la
selección (qué ingredientes, qué tamaño, cuántos): ningún precio que venga
del navegador se usa para cobrar.

`precio` significa distinto según la categoría:
  - BASE: no se usa; todas las bases cuestan lo mismo
  - PROTEINA, SALSA, TOPPING: recargo por ingrediente premium, 0 si es estándar
  - BEBIDA y PROMOCION: precio de venta
"""

from comun.errores import ErrorApi

CATEGORIAS = ("BASE", "PROTEINA", "SALSA", "TOPPING", "BEBIDA", "PROMOCION")
INGREDIENTES = ("BASE", "PROTEINA", "SALSA", "TOPPING")

CATALOGO_INICIAL = [
    ("base_gohan", "BASE", "Arroz gohan", "Arroz blanco japonés con vinagre de arroz", 0, 120),
    ("base_integral", "BASE", "Arroz integral", "Grano entero, textura más firme", 0, 80),
    ("base_quinoa", "BASE", "Quinoa", "Alta en proteína, sin gluten", 0, 60),
    ("base_verdes", "BASE", "Mix de hojas verdes", "Lechuga, rúcula y espinaca", 0, 60),
    ("base_soba", "BASE", "Fideos soba", "Trigo sarraceno, servidos fríos", 0, 40),
    ("pro_salmon", "PROTEINA", "Salmón fresco", "Cortado en cubos, marinado suave", 0, 80),
    ("pro_atun", "PROTEINA", "Atún", "Grado sashimi, corte del día", 1500, 30),
    ("pro_pollo", "PROTEINA", "Pollo teriyaki", "Grillado y glaseado", 0, 70),
    ("pro_camaron", "PROTEINA", "Camarón", "Cocido, con toque de limón", 1000, 40),
    ("pro_tofu", "PROTEINA", "Tofu marinado", "Opción vegana, shoyu y jengibre", 0, 40),
    ("pro_kanikama", "PROTEINA", "Kanikama", "Clásico, suave y dulce", 0, 50),
    ("sal_ponzu", "SALSA", "Ponzu", "Cítrica y ligera, la más clásica", 0, None),
    ("sal_shoyu", "SALSA", "Shoyu", "Soya con sésamo, sabor profundo", 0, None),
    ("sal_spicy", "SALSA", "Spicy mayo", "Cremosa con picante medio", 0, None),
    ("sal_goma", "SALSA", "Goma", "Base de sésamo tostado, suave", 0, None),
    ("sal_teriyaki", "SALSA", "Teriyaki", "Dulce y espesa", 0, None),
    ("sal_maracuya", "SALSA", "Maracuyá", "Ácida y fresca, para bowls de pollo", 0, None),
    ("top_palta", "TOPPING", "Palta", "En láminas, media unidad", 900, 60),
    ("top_mango", "TOPPING", "Mango", "En cubos, dulce y firme", 0, 60),
    ("top_sesamo", "TOPPING", "Sésamo tostado", "Blanco y negro", 0, None),
    ("top_edamame", "TOPPING", "Edamame", "Porotos de soya con sal marina", 0, 80),
    ("top_wakame", "TOPPING", "Alga wakame", "Ensalada marinada", 0, 50),
    ("top_crispy", "TOPPING", "Cebolla crispy", "Frita, crocante", 0, None),
    ("beb_limonada", "BEBIDA", "Limonada de menta", "500 ml, recién hecha", 2500, 40),
    ("beb_te", "BEBIDA", "Té verde frío", "Sin azúcar añadida", 2200, 40),
    ("beb_agua", "BEBIDA", "Agua mineral", "Con o sin gas, 500 ml", 1500, 60),
    ("beb_lata", "BEBIDA", "Bebida en lata", "350 ml, varias opciones", 1800, 0),
    ("promo_combo", "PROMOCION", "Combo mediodía", "Bowl regular más bebida, de lunes a viernes hasta las 16:00", 8990, None),
    ("promo_duo", "PROMOCION", "Dúo para compartir", "Dos bowls regulares con 15% de descuento", 11900, None),
]


def documentos_iniciales(ahora: str) -> list[dict]:
    """stock None = no se controla (salsas, sésamo: se reponen a granel)."""
    return [
        {"_id": i, "categoria": c, "nombre": n, "descripcion": d, "precio": p, "disponible": True, "stock": s, "actualizadoEn": ahora}
        for i, c, n, d, p, s in CATALOGO_INICIAL
    ]


TAMANOS = [
    {"id": "regular", "nombre": "Regular", "descripcion": "Porción individual", "precio": 6990, "salsasIncluidas": 2, "toppingsIncluidos": 3},
    {"id": "grande", "nombre": "Grande", "descripcion": "Más porción, más salsas y toppings incluidos", "precio": 9490, "salsasIncluidas": 3, "toppingsIncluidos": 4},
]

REGLAS = {
    "basesIncluidas": 1,
    "maxBases": 3,
    "recargoBaseExtra": 500,
    "proteinasIncluidas": 1,
    "maxProteinas": 3,
    "recargoProteinaExtra": 2500,
    "maxSalsas": 4,
    "recargoSalsaExtra": 500,
    "maxToppings": 6,
    "recargoToppingExtra": 700,
}

PROMOS = {
    "promo_combo": {"bowls": 1, "bebida": True, "tamanoId": "regular", "detalle": "Arma tu bowl regular y elige tu bebida."},
    "promo_duo": {"bowls": 2, "bebida": False, "tamanoId": "regular", "detalle": "Arma los dos bowls regulares a tu gusto."},
}

MAX_CANTIDAD = 20
MAX_LINEAS = 30


def _error(mensaje: str, codigo: str = "SELECCION_INVALIDA") -> ErrorApi:
    return ErrorApi(400, codigo, mensaje)


def vendible(item: dict) -> bool:
    """Disponible y con stock (o sin control de stock)."""
    return bool(item.get("disponible")) and (item.get("stock") is None or item["stock"] > 0)


class Cotizador:
    """Cotiza con un catálogo ya cargado ({id: item}); no toca la base."""

    def __init__(self, catalogo: dict[str, dict]):
        self.catalogo = catalogo

    def _resolver(self, ids: list, categoria: str, etiqueta: str) -> list[dict]:
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise _error(f"La selección de {etiqueta} no es válida.")
        if len(set(ids)) != len(ids):
            raise _error(f"Hay {etiqueta} repetidos en la selección.")
        items = []
        for id_ in ids:
            item = self.catalogo.get(id_)
            if not item:
                raise _error("Uno de los ingredientes ya no está en el menú.", "NO_ENCONTRADO")
            if item["categoria"] != categoria:
                raise _error(f'"{item["nombre"]}" no corresponde a {etiqueta}.')
            if not vendible(item):
                raise _error(f'"{item["nombre"]}" no está disponible hoy.', "NO_DISPONIBLE")
            items.append(item)
        return items

    def bowl(self, entrada: dict, tamano_forzado: str | None = None) -> dict:
        if not isinstance(entrada, dict):
            raise _error("El bowl no es válido.")
        tamano_id = tamano_forzado or entrada.get("tamanoId")
        tamano = next((t for t in TAMANOS if t["id"] == tamano_id), None)
        if not tamano:
            raise _error("El tamaño elegido no existe.", "NO_ENCONTRADO")

        bases_ids = entrada.get("baseIds") or []
        proteinas_ids = entrada.get("proteinaIds") or []
        salsas_ids = entrada.get("salsaIds") or []
        toppings_ids = entrada.get("toppingIds") or []
        r = REGLAS
        if not 1 <= len(bases_ids) <= r["maxBases"]:
            raise _error(f"El bowl lleva entre 1 y {r['maxBases']} bases.")
        if not 1 <= len(proteinas_ids) <= r["maxProteinas"]:
            raise _error(f"El bowl lleva entre 1 y {r['maxProteinas']} proteínas.")
        if len(salsas_ids) > r["maxSalsas"]:
            raise _error(f"Máximo {r['maxSalsas']} salsas por bowl.")
        if len(toppings_ids) > r["maxToppings"]:
            raise _error(f"Máximo {r['maxToppings']} toppings por bowl.")

        bases = self._resolver(bases_ids, "BASE", "bases")
        proteinas = self._resolver(proteinas_ids, "PROTEINA", "proteínas")
        salsas = self._resolver(salsas_ids, "SALSA", "salsas")
        toppings = self._resolver(toppings_ids, "TOPPING", "toppings")

        desglose = [{"concepto": f"Bowl {tamano['nombre']}", "monto": tamano["precio"]}]
        extras = [
            (len(bases) - r["basesIncluidas"], "Base extra", r["recargoBaseExtra"]),
            (len(proteinas) - r["proteinasIncluidas"], "Proteína extra", r["recargoProteinaExtra"]),
            (len(salsas) - tamano["salsasIncluidas"], "Salsa extra", r["recargoSalsaExtra"]),
            (len(toppings) - tamano["toppingsIncluidos"], "Topping extra", r["recargoToppingExtra"]),
        ]
        for cantidad, concepto, unitario in extras:
            if cantidad > 0:
                desglose.append({"concepto": f"{concepto} x{cantidad}", "monto": cantidad * unitario})
        for item in proteinas + salsas + toppings:
            if item["precio"] > 0:
                desglose.append({"concepto": f"{item['nombre']} (premium)", "monto": item["precio"]})

        todos = bases + proteinas + salsas + toppings
        return {
            "tamano": tamano,
            "precio": sum(l["monto"] for l in desglose),
            "desglose": desglose,
            "descripcion": f"Bowl {tamano['nombre']}: {', '.join(i['nombre'] for i in todos)}",
            "consumo": [i["_id"] for i in todos],
        }

    def promo(self, promo_id: str, bowls: list, bebida_id: str | None) -> dict:
        item = self.catalogo.get(promo_id)
        config = PROMOS.get(promo_id)
        if not item or item["categoria"] != "PROMOCION":
            raise _error("Esa promoción ya no existe.", "NO_ENCONTRADO")
        if not config:
            raise _error(f'"{item["nombre"]}" no se arma: se agrega directo desde el menú.')
        if not vendible(item):
            raise _error(f'"{item["nombre"]}" no está disponible hoy.', "NO_DISPONIBLE")
        if not isinstance(bowls, list) or len(bowls) != config["bowls"]:
            raise _error(f"Esta promoción lleva {config['bowls']} bowl(s).")

        precio = item["precio"]
        consumo = []
        descripciones = []
        for i, entrada in enumerate(bowls):
            b = self.bowl(entrada, config["tamanoId"])
            # La primera línea del desglose es el precio base del bowl, que la promoción ya cubre.
            precio += sum(l["monto"] for l in b["desglose"][1:])
            consumo += b["consumo"]
            descripcion = b["descripcion"]
            if config["bowls"] > 1:
                descripcion = descripcion.replace("Bowl ", f"Bowl {i + 1}, ", 1)
            descripciones.append(descripcion)

        texto = " / ".join(descripciones)
        if config["bebida"]:
            bebida = self.catalogo.get(bebida_id or "")
            if not bebida:
                raise _error("Elige la bebida de tu promoción.")
            if bebida["categoria"] != "BEBIDA":
                raise _error(f'"{bebida["nombre"]}" no es una bebida.')
            if not vendible(bebida):
                raise _error(f'"{bebida["nombre"]}" no está disponible hoy.', "NO_DISPONIBLE")
            consumo.append(bebida["_id"])
            texto += f" + {bebida['nombre']}"

        return {"precio": precio, "descripcion": f"{item['nombre']}: {texto}", "consumo": consumo}

    def item_simple(self, item_id: str) -> dict:
        item = self.catalogo.get(item_id or "")
        if not item:
            raise _error("Ese producto ya no está en el menú.", "NO_ENCONTRADO")
        if item["categoria"] in INGREDIENTES:
            raise _error(f'"{item["nombre"]}" es un ingrediente: va dentro de un bowl.')
        if item_id in PROMOS:
            raise _error(f'"{item["nombre"]}" se arma antes de agregarla al carrito.')
        if not vendible(item):
            raise _error(f'"{item["nombre"]}" no está disponible hoy.', "NO_DISPONIBLE")
        return {"precio": item["precio"], "descripcion": item["nombre"], "consumo": [item["_id"]]}

    def lineas(self, lineas: list) -> dict:
        """Cotiza las líneas de un carrito. Devuelve líneas con precio y el consumo total de stock."""
        if not isinstance(lineas, list) or not lineas:
            raise _error("El carrito está vacío.", "CARRITO_VACIO")
        if len(lineas) > MAX_LINEAS:
            raise _error(f"Un pedido puede tener hasta {MAX_LINEAS} líneas.")

        resultado = []
        consumo: dict[str, int] = {}
        for linea in lineas:
            if not isinstance(linea, dict):
                raise _error("Una línea del carrito no es válida.")
            cantidad = linea.get("cantidad")
            if not isinstance(cantidad, int) or isinstance(cantidad, bool) or not 1 <= cantidad <= MAX_CANTIDAD:
                raise _error(f"La cantidad debe estar entre 1 y {MAX_CANTIDAD}.")

            tipo = linea.get("tipo")
            if tipo == "BOWL":
                c = self.bowl(linea.get("entrada"))
            elif tipo == "PROMO":
                c = self.promo(linea.get("promoId"), linea.get("bowls"), linea.get("bebidaId"))
            elif tipo == "ITEM":
                c = self.item_simple(linea.get("itemId"))
            else:
                raise _error("Tipo de línea desconocido.")

            for id_ in c["consumo"]:
                consumo[id_] = consumo.get(id_, 0) + cantidad
            resultado.append(
                {
                    "tipo": tipo,
                    "descripcion": c["descripcion"],
                    "cantidad": cantidad,
                    "precioUnitario": c["precio"],
                    "subtotal": c["precio"] * cantidad,
                    "itemIds": sorted(set(c["consumo"])),
                }
            )

        # El stock se revisa con lo que pide el carrito completo: 3 bowls de atún necesitan 3 porciones.
        for id_, cantidad in consumo.items():
            item = self.catalogo[id_]
            if item.get("stock") is not None and item["stock"] < cantidad:
                raise ErrorApi(409, "SIN_STOCK", f'Quedan {item["stock"]} porciones de "{item["nombre"]}" y tu pedido necesita {cantidad}.')

        return {
            "lineas": resultado,
            "total": sum(l["subtotal"] for l in resultado),
            "consumo": [{"itemId": k, "cantidad": v} for k, v in sorted(consumo.items())],
        }
