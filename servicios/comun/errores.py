"""
Errores con el mismo formato en todos los servicios:

    {"codigo": "NO_ENCONTRADO", "mensaje": "No encontramos ese pedido."}

El frontend muestra `mensaje` tal cual y decide qué hacer según `codigo`.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorApi(Exception):
    def __init__(self, estado: int, codigo: str, mensaje: str, extra: dict | None = None):
        super().__init__(mensaje)
        self.estado = estado
        self.codigo = codigo
        self.mensaje = mensaje
        self.extra = extra or {}


def invalido(mensaje: str, codigo: str = "DATOS_INVALIDOS") -> ErrorApi:
    return ErrorApi(400, codigo, mensaje)


def no_encontrado(mensaje: str) -> ErrorApi:
    return ErrorApi(404, "NO_ENCONTRADO", mensaje)


def conflicto(mensaje: str, codigo: str = "CONFLICTO") -> ErrorApi:
    return ErrorApi(409, codigo, mensaje)


def prohibido(mensaje: str = "Tu perfil no puede hacer esta operación.") -> ErrorApi:
    return ErrorApi(403, "PROHIBIDO", mensaje)


def _json(estado: int, codigo: str, mensaje: str, extra: dict | None = None) -> JSONResponse:
    return JSONResponse(status_code=estado, content={"codigo": codigo, "mensaje": mensaje, **(extra or {})})


def registrar_manejadores(app: FastAPI) -> None:
    @app.exception_handler(ErrorApi)
    async def _error_api(_req: Request, error: ErrorApi):
        return _json(error.estado, error.codigo, error.mensaje, error.extra)

    @app.exception_handler(RequestValidationError)
    async def _validacion(_req: Request, error: RequestValidationError):
        campos = [".".join(str(p) for p in e["loc"] if p != "body") for e in error.errors()]
        mensaje = f"Revisa estos datos: {', '.join(c for c in campos if c) or 'cuerpo de la petición'}."
        return _json(422, "DATOS_INVALIDOS", mensaje, {"campos": campos})

    @app.exception_handler(StarletteHTTPException)
    async def _http(_req: Request, error: StarletteHTTPException):
        if isinstance(error.detail, dict):
            return JSONResponse(status_code=error.status_code, content=error.detail)
        codigo = {404: "NO_ENCONTRADO", 405: "METODO_NO_PERMITIDO"}.get(error.status_code, f"HTTP_{error.status_code}")
        return _json(error.status_code, codigo, str(error.detail))
