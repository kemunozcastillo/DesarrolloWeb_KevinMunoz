# Auth Service

Cuentas (correo, rol, hash de la contraseña), login, sesiones con expiración, introspección y verificación de correo. Guarda las cuentas en MongoDB (`pf_auth`).

- Contraseñas con scrypt, sal por cuenta y pepper en Vault. Nunca se guardan ni se devuelven.
- Token de sesión opaco de 256 bits; se guarda su hash. Vence a los 30 minutos sin uso o a las 8 horas.
- Bloqueo tras 5 intentos fallidos durante 5 minutos.
- Solo lo llaman el gateway y el servicio de clientes, cada uno con su secreto en Vault y solo a sus rutas.

Pruebas: `npm test`.
