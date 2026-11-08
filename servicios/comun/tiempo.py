from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from comun.config import ajustes


def ahora_iso() -> str:
    """Instante actual en UTC, en ISO 8601 con milisegundos y Z (como toISOString de JavaScript)."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def dia_local(iso: str) -> str:
    """Fecha "AAAA-MM-DD" en la hora de Chile: una venta de las 22:30 del lunes cuenta como lunes."""
    instante = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return instante.astimezone(ZoneInfo(ajustes().zona_horaria)).date().isoformat()


def fecha_valida(texto: str | None) -> bool:
    try:
        date.fromisoformat(texto or "")
        return True
    except ValueError:
        return False
