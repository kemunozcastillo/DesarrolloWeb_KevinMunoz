# El backend solo lee la credencial interna. No ve el secreto de
# introspección ni el pepper de las contraseñas.
path "secret/data/poke-fresh/backend" {
  capabilities = ["read"]
}
