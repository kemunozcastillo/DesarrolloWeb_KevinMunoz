# Contenedor de un solo uso: crea la CA de prueba y un certificado por servicio.
FROM alpine:3.20
RUN apk add --no-cache openssl
COPY generar.sh /generar.sh
RUN chmod +x /generar.sh
CMD ["/generar.sh"]
