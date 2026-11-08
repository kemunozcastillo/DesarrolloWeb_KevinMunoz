"""Validación de la ficha del cliente: las mismas reglas que muestra el formulario del sitio."""

import re
from datetime import date

from comun.errores import invalido

REGION = "Región Metropolitana de Santiago"
PROVINCIAS = {
    "Santiago": [
        "Cerrillos", "Cerro Navia", "Conchalí", "El Bosque", "Estación Central", "Huechuraba",
        "Independencia", "La Cisterna", "La Florida", "La Granja", "La Pintana", "La Reina",
        "Las Condes", "Lo Barnechea", "Lo Espejo", "Lo Prado", "Macul", "Maipú", "Ñuñoa",
        "Pedro Aguirre Cerda", "Peñalolén", "Providencia", "Pudahuel", "Quilicura",
        "Quinta Normal", "Recoleta", "Renca", "San Joaquín", "San Miguel", "San Ramón",
        "Santiago", "Vitacura",
    ],
    "Cordillera": ["Pirque", "Puente Alto", "San José de Maipo"],
    "Chacabuco": ["Colina", "Lampa", "Tiltil"],
    "Maipo": ["Buin", "Calera de Tango", "Paine", "San Bernardo"],
    "Melipilla": ["Alhué", "Curacaví", "María Pinto", "Melipilla", "San Pedro"],
    "Talagante": ["El Monte", "Isla de Maipo", "Padre Hurtado", "Peñaflor", "Talagante"],
}

# Comunas a menos de 3 km del local (Providencia). Sin un servicio de mapas
# no se mide la distancia exacta a cada dirección: se aproxima por comuna.
COMUNAS_CON_DESPACHO = ["Providencia", "Ñuñoa", "Santiago", "Recoleta", "Las Condes"]

SEXOS = {"F", "M", "O", "N"}
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
TELEFONO = re.compile(r"^\+?56\s?9\s?\d{4}\s?\d{4}$|^9\s?\d{4}\s?\d{4}$")


def normalizar_run(valor) -> str | None:
    limpio = re.sub(r"[.\s]", "", str(valor or "")).upper()
    m = re.fullmatch(r"(\d{7,8})-?([\dK])", limpio)
    return f"{m.group(1)}-{m.group(2)}" if m else None


def digito_verificador(cuerpo: str) -> str:
    suma, factor = 0, 2
    for d in reversed(cuerpo):
        suma += int(d) * factor
        factor = 2 if factor == 7 else factor + 1
    resto = 11 - suma % 11
    return "0" if resto == 11 else "K" if resto == 10 else str(resto)


def run_valido(valor) -> bool:
    run = normalizar_run(valor)
    if not run:
        return False
    cuerpo, dv = run.split("-")
    return digito_verificador(cuerpo) == dv


def tiene_despacho(comuna: str) -> bool:
    return comuna in COMUNAS_CON_DESPACHO


def edad(fecha: date) -> int:
    hoy = date.today()
    return hoy.year - fecha.year - ((hoy.month, hoy.day) < (fecha.month, fecha.day))


def validar_ficha(datos: dict) -> dict:
    ficha = {
        "run": normalizar_run(datos.get("run")),
        "nombre": " ".join(str(datos.get("nombre") or "").split()),
        "direccion": str(datos.get("direccion") or "").strip(),
        "region": datos.get("region"),
        "provincia": datos.get("provincia"),
        "comuna": datos.get("comuna"),
        "fechaNacimiento": datos.get("fechaNacimiento"),
        "sexo": datos.get("sexo"),
        "email": str(datos.get("email") or "").strip().lower(),
        "telefono": str(datos.get("telefono") or "").strip(),
    }

    if not ficha["run"] or not run_valido(ficha["run"]):
        raise invalido("El RUN no es válido. Revisa el dígito verificador.")
    if len(ficha["nombre"].split(" ")) < 2 or len(ficha["nombre"]) > 120:
        raise invalido("Escribe nombre y apellido.")
    if not 5 <= len(ficha["direccion"]) <= 150:
        raise invalido("Escribe la dirección con calle y número.")
    if ficha["region"] != REGION or ficha["comuna"] not in PROVINCIAS.get(ficha["provincia"], []):
        raise invalido("Elige región, provincia y comuna.")
    try:
        nacimiento = date.fromisoformat(str(ficha["fechaNacimiento"]))
    except ValueError:
        raise invalido("Indica la fecha de nacimiento.")
    if not 14 <= edad(nacimiento) <= 110:
        raise invalido("Revisa la fecha de nacimiento.")
    if ficha["sexo"] not in SEXOS:
        raise invalido("Elige una opción en sexo.")
    if not EMAIL.match(ficha["email"]) or len(ficha["email"]) > 120:
        raise invalido("El correo no tiene un formato válido.")
    if not TELEFONO.match(ficha["telefono"]):
        raise invalido("El teléfono debe ser un celular chileno, por ejemplo +56 9 1234 5678.")
    return ficha
