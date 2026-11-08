# API Gateway: credenciales internas de cada servicio que enruta y su secreto ante el Auth Service.
# Solo lectura y solo estas rutas: cualquier otra lectura responde 403.

path "secret/data/poke-fresh/internos/inventario" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/clientes" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/pedidos" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/pagos" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/graphql" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/auth-gateway" {
  capabilities = ["read"]
}
