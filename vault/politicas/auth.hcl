# Auth Service: pepper de contraseñas, secretos para validar a sus clientes y su usuario de Mongo.
# Solo lectura y solo estas rutas: cualquier otra lectura responde 403.

path "secret/data/poke-fresh/auth" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/auth-gateway" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/internos/auth-clientes" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/mongo/auth" {
  capabilities = ["read"]
}
