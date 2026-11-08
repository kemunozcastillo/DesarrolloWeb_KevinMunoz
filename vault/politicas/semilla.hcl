# Carga de datos de ejemplo: solo su usuario de Mongo.
# Solo lectura y solo estas rutas: cualquier otra lectura responde 403.

path "secret/data/poke-fresh/mongo/semilla" {
  capabilities = ["read"]
}
