# El Auth Service lee el pepper de las contraseñas y el secreto con que se
# identifica el gateway. No ve la credencial interna del backend: aunque
# alguien tomara el control del Auth Service, no podría hablarle al backend.
path "secret/data/poke-fresh/auth" {
  capabilities = ["read"]
}

path "secret/data/poke-fresh/introspeccion" {
  capabilities = ["read"]
}
