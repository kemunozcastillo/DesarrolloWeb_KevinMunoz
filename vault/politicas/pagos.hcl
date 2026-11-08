# Pagos: su credencial, la de pedidos (para confirmar pagos), la clave del comercio en la pasarela y su usuario de Mongo.
# Solo lectura y solo estas rutas: cualquier otra lectura responde 403.

path "secret/data/poke-fresh/internos/pagos" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/pedidos" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/pasarela/comercio" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/mongo/pagos" {
  capabilities = ["read"]
}
