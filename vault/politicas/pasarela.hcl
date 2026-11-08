# Pasarela simulada: la clave y el secreto de firma que comparte con el servicio de pagos.
# Solo lectura y solo estas rutas: cualquier otra lectura responde 403.

path "secret/data/poke-fresh/pasarela/comercio" {
  capabilities = ["read"]
}
