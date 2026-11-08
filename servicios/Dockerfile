# Una sola imagen para los servicios Python. Cada contenedor elige cuál
# corre con la variable SERVICIO (inventario, clientes, pedidos, pagos, pasarela).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY comun ./comun
COPY inventario ./inventario
COPY clientes ./clientes
COPY pedidos ./pedidos
COPY pagos ./pagos
COPY pasarela ./pasarela
COPY notificador ./notificador
COPY scripts ./scripts

# Sin privilegios de root dentro del contenedor.
RUN useradd --create-home --uid 10001 servicio
USER servicio

ENV PORT=8000
CMD ["sh", "-c", "uvicorn ${SERVICIO}.main:app --host 0.0.0.0 --port ${PORT} --no-server-header"]
