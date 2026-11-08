# Vault en modo servidor con almacenamiento en archivo (los secretos
# sobreviven a un reinicio). El listener usa TLS con el certificado que crea
# el contenedor tls-init y entrega en el volumen /run/tls.
storage "file" {
  path = "/vault/file"
}

listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_cert_file = "/run/tls/vault.crt"
  tls_key_file  = "/run/tls/vault.key"
  tls_min_version = "tls12"
}

disable_mlock = true
ui            = false
api_addr      = "https://vault:8200"
