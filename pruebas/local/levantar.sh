#!/usr/bin/env bash
# Levanta el sistema completo SIN Docker, con Vault, Mongo y ActiveMQ
# simulados en memoria. Sirve para correr las pruebas de punta a punta en un
# equipo sin Docker. Para la demostración real, usar `docker compose up`.
#
#   bash pruebas/local/levantar.sh     (detener: bash pruebas/local/detener.sh)
set -euo pipefail
cd "$(dirname "$0")"
RAIZ="$(cd ../.. && pwd)"
mkdir -p logs tokens claves
rm -f tokens/*.token claves/*.json

node vault_falso.mjs > logs/vault.log 2>&1 & echo $! > logs/pids
python3 broker_falso.py > logs/activemq.log 2>&1 & echo $! >> logs/pids
sleep 1

# El mismo script de inicialización que usa docker compose.
VAULT_ADDR=http://127.0.0.1:8200 DIR_CLAVES="$PWD/claves" DIR_TOKENS="$PWD/tokens" SIN_MONGO=true \
  node "$RAIZ/vault/iniciar.js" > logs/vault-init.log 2>&1

export VAULT_ADDR=http://127.0.0.1:8200 MODO_DEMO=true ACTIVEMQ_HOST=127.0.0.1
export URL_NOTIFICACION_PAGOS=http://127.0.0.1:8080/api/v1/pagos/notificacion URL_PUBLICA=http://127.0.0.1:8080 PASARELA_URL_PUBLICA=http://127.0.0.1:9000

for par in inventario:8001 clientes:8002 pedidos:8003 pagos:8004 pasarela:9000; do
  s=${par%%:*}; p=${par##*:}
  VAULT_TOKEN_ARCHIVO="$PWD/tokens/$s.token" python3 servicio_memoria.py "$s" "$p" > "logs/$s.log" 2>&1 & echo $! >> logs/pids
done
ACTIVEMQ_HOST=127.0.0.1 python3 -c "import sys; sys.path.insert(0,'$RAIZ/servicios'); from notificador.main import main; main()" > logs/notificador.log 2>&1 & echo $! >> logs/pids

PORT=4100 VAULT_TOKEN_ARCHIVO="$PWD/tokens/auth.token" NODE_ENV=development node auth_memoria.mjs > logs/auth.log 2>&1 & echo $! >> logs/pids
PORT=4000 VAULT_TOKEN_ARCHIVO="$PWD/tokens/graphql.token" node "$RAIZ/graphql-gateway/src/server.js" > logs/graphql.log 2>&1 & echo $! >> logs/pids
sleep 3
PORT=8080 LIMITE_POR_MINUTO=${LIMITE_POR_MINUTO:-300} VAULT_TOKEN_ARCHIVO="$PWD/tokens/gateway.token" COOKIE_SECURE=false DIR_FRONTEND="$RAIZ/frontend" \
  node "$RAIZ/gateway/src/server.js" > logs/gateway.log 2>&1 & echo $! >> logs/pids
sleep 2
curl -s http://127.0.0.1:8080/api/salud; echo
