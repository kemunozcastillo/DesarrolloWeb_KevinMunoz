# GraphQL Gateway: su credencial y las de los servicios que consulta. No tiene base de datos.
# Solo lectura y solo estas rutas: cualquier otra lectura responde 403.

path "secret/data/poke-fresh/internos/graphql" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/pedidos" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/inventario" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/pagos" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/clientes" {
  capabilities = ["read"]
}
