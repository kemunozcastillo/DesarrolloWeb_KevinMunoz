# El gateway lee el secreto de introspección (para identificarse ante el
# Auth Service) y la credencial interna (para entregársela al backend).
# No puede leer el pepper de las contraseñas.
path "secret/data/poke-fresh/introspeccion" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/backend" {
  capabilities = ["read"]
}
