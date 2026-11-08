# Vault en modo servidor con almacenamiento en archivo (los secretos
# sobreviven a un reinicio). El listener va sin TLS porque solo es accesible
# dentro de la red privada de Docker; en producción se activa TLS.
storage "file" {
  path = "/vault/file"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1
}

disable_mlock = true
ui            = false
api_addr      = "http://vault:8200"
