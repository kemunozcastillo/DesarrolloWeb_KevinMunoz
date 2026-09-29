# El gateway lee el token de los clientes (para validarlo) y la credencial
# interna (para entregársela al backend). Solo lectura: no puede cambiarlos.
path "secret/data/poke-fresh/gateway" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/backend" {
  capabilities = ["read"]
}
