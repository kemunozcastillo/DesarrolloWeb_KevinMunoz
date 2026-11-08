#!/bin/sh
# Crea una CA de prueba y un certificado de servidor por cada componente.
#
#   /ca    volumen solo de este contenedor: aquí queda la clave PRIVADA de la CA.
#   /tls   volumen que montan los demás en solo lectura: ca.pem, <servicio>.crt/.key.
#
# Es idempotente: lo que ya existe no se vuelve a crear (así un reinicio no
# invalida los certificados). Para renovarlos: docker compose down -v.
# Nada de esto se versiona; las claves nacen en el arranque.
set -eu

CA=/ca
TLS=/tls
# Un certificado por componente; cada uno vale para su nombre en la red de
# Docker, para localhost (healthchecks y navegador) y para 127.0.0.1.
COMPONENTES="gateway pasarela pagos auth graphql inventario clientes pedidos vault mongo activemq"

if [ ! -f "$CA/ca.key" ] || [ ! -f "$TLS/ca.pem" ]; then
  echo "Creando la CA de prueba"
  openssl ecparam -name prime256v1 -genkey -noout -out "$CA/ca.key"
  openssl req -x509 -new -key "$CA/ca.key" -sha256 -days 3650 \
    -subj "/O=Poke Fresh/CN=Poke Fresh CA de prueba"     -addext "basicConstraints=critical,CA:TRUE,pathlen:0"     -addext "keyUsage=critical,keyCertSign,cRLSign"     -addext "subjectKeyIdentifier=hash"     -out "$TLS/ca.pem"
  # Si cambia la CA, los certificados anteriores ya no sirven.
  rm -f "$TLS"/*.crt "$TLS"/*.key "$TLS"/*.pem.tmp
fi

for nombre in $COMPONENTES; do
  [ -f "$TLS/$nombre.crt" ] && continue
  echo "Certificado de $nombre"
  openssl ecparam -name prime256v1 -genkey -noout -out "$TLS/$nombre.key"
  openssl req -new -key "$TLS/$nombre.key" -subj "/O=Poke Fresh/CN=$nombre" -out "/tmp/$nombre.csr"
  cat > "/tmp/$nombre.ext" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
extendedKeyUsage=serverAuth,clientAuth
subjectAltName=DNS:$nombre,DNS:localhost,IP:127.0.0.1
EXT
  openssl x509 -req -in "/tmp/$nombre.csr" -CA "$TLS/ca.pem" -CAkey "$CA/ca.key" -CAcreateserial \
    -CAserial /tmp/ca.srl -sha256 -days 825 -extfile "/tmp/$nombre.ext" -out "$TLS/$nombre.crt" 2>/dev/null
done

# Mongo pide el certificado y la clave en un solo archivo.
cat "$TLS/mongo.crt" "$TLS/mongo.key" > "$TLS/mongo.pem"

# ActiveMQ (Java) lee un almacén PKCS12 protegido con una clave aleatoria que
# queda en un archivo del volumen, no en el compose ni en el repositorio.
if [ ! -f "$TLS/activemq.p12" ]; then
  openssl rand -hex 16 > "$TLS/activemq.clave"
  openssl pkcs12 -export -in "$TLS/activemq.crt" -inkey "$TLS/activemq.key" -name activemq \
    -passout "file:$TLS/activemq.clave" -out "$TLS/activemq.p12"
fi

# Cada contenedor corre con su propio usuario (node, servicio, vault, mongo...):
# todos deben poder leer. El volumen solo lo montan los componentes del sistema.
chmod 755 "$TLS"
chmod 644 "$TLS"/*
echo "Certificados listos:"
ls "$TLS"
