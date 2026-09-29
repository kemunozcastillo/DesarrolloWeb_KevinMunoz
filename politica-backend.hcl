# El backend solo lee la credencial interna. No puede ver el token de los
# clientes: si alguien obtuviera el acceso del backend a Vault, no podría
# hacerse pasar por un cliente ante el gateway.
path "secret/data/poke-fresh/backend" {
  capabilities = ["read"]
}
