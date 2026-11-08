# Clientes: su credencial, su secreto ante el Auth Service y su usuario de Mongo.
# Solo lectura y solo estas rutas: cualquier otra lectura responde 403.

path "secret/data/poke-fresh/internos/clientes" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/auth-clientes" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/mongo/clientes" {
  capabilities = ["read"]
}
