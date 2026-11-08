# Inventario: su credencial interna (para validar a quien lo llama) y su usuario de Mongo.
# Solo lectura y solo estas rutas: cualquier otra lectura responde 403.

path "secret/data/poke-fresh/internos/inventario" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/mongo/inventario" {
  capabilities = ["read"]
}
