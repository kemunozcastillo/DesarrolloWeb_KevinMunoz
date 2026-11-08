"""
Quién puede llamar a un servicio y en nombre de quién.

1. Credencial interna. Cada servicio tiene la suya en Vault
   (secret/poke-fresh/internos/<servicio>). Solo la conocen el gateway y los
   servicios que tienen que llamarlo. Una petición sin ella, o con otra, se
   rechaza con 403: así se bloquea a quien intente entrar directo a la red
   privada saltándose el gateway.

2. Identidad del usuario. El gateway valida la sesión con el Auth Service y
   reenvía quién es el usuario en cabeceras X-Usuario-*. El servicio confía
   en esas cabeceras solo porque la petición trae la credencial interna; el
   gateway borra las que mande el navegador.
"""

import secrets
from contextvars import ContextVar
from dataclasses import dataclass
from urllib.parse import unquote

from fastapi import Depends, Header, Request

from comun import vault
from comun.errores import ErrorApi

# Nombre del servicio que atiende la petición en curso. Lo fija el middleware
# de cada app; sirve para saber qué credencial verificar y con qué nombre
# presentarse al llamar a otro servicio (en las pruebas corren varios en un
# mismo proceso).
servicio_actual: ContextVar[str] = ContextVar("servicio_actual", default="desconocido")

CABECERA_CREDENCIAL = "X-Credencial-Interna"
ROLES_PERSONAL = ("admin", "dueno", "cocina", "despacho")


def ruta_credencial(servicio: str) -> str:
    return f"poke-fresh/internos/{servicio}"


async def verificar_credencial_interna(
    credencial: str | None = Header(default=None, alias=CABECERA_CREDENCIAL),
) -> None:
    if not credencial:
        raise ErrorApi(403, "ACCESO_DIRECTO", "Acceso directo no permitido: este servicio solo atiende peticiones internas.")

    esperada = await vault.leer_valor(ruta_credencial(servicio_actual.get()), "credencial")

    # compare_digest tarda lo mismo aunque coincidan más o menos caracteres.
    if not secrets.compare_digest(credencial.encode(), esperada.encode()):
        raise ErrorApi(403, "CREDENCIAL_INVALIDA", "Credencial interna inválida.")


@dataclass(frozen=True)
class Identidad:
    id: str
    rol: str
    sujeto: str  # para un cliente, su id de cliente; para el personal, su id de usuario
    nombre: str

    @property
    def es_cliente(self) -> bool:
        return self.rol == "cliente"

    @property
    def es_personal(self) -> bool:
        return self.rol in ROLES_PERSONAL

    def cabeceras(self) -> dict:
        """Para reenviar la identidad a otro servicio interno."""
        from urllib.parse import quote

        return {
            "X-Usuario-Id": self.id,
            "X-Usuario-Rol": self.rol,
            "X-Usuario-Sujeto": self.sujeto,
            "X-Usuario-Nombre": quote(self.nombre),
        }


def identidad_opcional(request: Request) -> Identidad | None:
    h = request.headers
    if not h.get("x-usuario-id") or not h.get("x-usuario-rol"):
        return None
    return Identidad(
        id=h["x-usuario-id"],
        rol=h["x-usuario-rol"],
        sujeto=h.get("x-usuario-sujeto") or h["x-usuario-id"],
        nombre=unquote(h.get("x-usuario-nombre") or ""),
    )


def requerir(*roles: str):
    """Dependencia: exige sesión y, si se indican roles, uno de ellos."""

    def dependencia(identidad: Identidad | None = Depends(identidad_opcional)) -> Identidad:
        if identidad is None:
            raise ErrorApi(401, "SIN_SESION", "Inicia sesión para continuar.")
        if roles and identidad.rol not in roles:
            raise ErrorApi(403, "PROHIBIDO", "Tu perfil no puede hacer esta operación.")
        return identidad

    return dependencia


PERFILES = {"admin": "Administrador", "dueno": "Dueño", "cocina": "Cocina", "despacho": "Encargado de despacho"}


def nombre_actor(identidad: Identidad) -> str:
    if identidad.es_cliente:
        return "Cliente"
    return f"{identidad.nombre} ({PERFILES.get(identidad.rol, identidad.rol)})"
