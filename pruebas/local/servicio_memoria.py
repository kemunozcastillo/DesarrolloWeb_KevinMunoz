"""
Corre un microservicio con Mongo en memoria (mongomock), para probar el
sistema completo sin Docker. Uso: python servicio_memoria.py pedidos 8003
Los servicios de clientes, pedidos y pagos cargan los datos de ejemplo.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "servicios"))

servicio, puerto = sys.argv[1], int(sys.argv[2])
os.environ["SERVICIO"] = servicio

import importlib  # noqa: E402

import uvicorn  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

modulo = importlib.import_module(f"{servicio}.main")
app = modulo.app

if servicio != "pasarela":
    mongo = AsyncMongoMockClient()
    if servicio in ("clientes", "pedidos", "pagos"):
        from scripts.semilla import sembrar

        print(asyncio.run(sembrar(mongo)))
    app.state.db = mongo[f"pf_{servicio}"]

uvicorn.run(app, host="127.0.0.1", port=puerto, log_level="warning")
