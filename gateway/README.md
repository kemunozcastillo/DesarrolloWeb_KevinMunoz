# API Gateway

Única entrada pública del sistema (puerto 8080). Sirve el frontend y la API `/api/v1`.

- `src/rutas.js`: la matriz de rutas (qué ruta pública va a qué servicio y quién puede usarla). Lo que no está ahí responde 404.
- `src/sesion.js`: login, logout y sesión con cookie HttpOnly; pregunta al Auth Service por cada petición (introspección).
- `src/reenvio.js`: reenvía al servicio privado con su credencial interna (de Vault) y la identidad verificada; descarta las cabeceras de identidad que mande el navegador.
- `src/limites.js`: límite de peticiones por IP.

Pruebas: `npm test`. Se levanta con el `docker-compose.yml` de la raíz.
