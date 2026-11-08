# Pedidos: su credencial, las de los servicios que llama (inventario, clientes, pagos) y su usuario de Mongo.
# Solo lectura y solo estas rutas: cualquier otra lectura responde 403.

path "secret/data/poke-fresh/internos/pedidos" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/inventario" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/clientes" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/pagos" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/mongo/pedidos" {
  capabilities = ["read"]
}
