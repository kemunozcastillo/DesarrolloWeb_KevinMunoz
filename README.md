# Poke Fresh
Sitio web de Poke Fresh, una tienda de poke bowls. Corresponde al caso 24 del ramo de Desarrollo Web, basado en el caso 19 (Fukusuke Sushi): venta online con registro de clientes, pago externo, boleta digital y despacho. Está hecho solo con HTML, CSS y JavaScript, sin frameworks ni servidor.

## Cómo abrirlo
Basta con abrir `index.html` en el navegador. También está publicado en GitHub Pages: `https://tu-usuario.github.io/nombre-del-repo/`

Si se descarga, hay que mantener las carpetas `css`, `js` e `img` junto al `index.html`.

## Cuentas de prueba
El sitio viene con datos de ejemplo (clientes, usuarios y un mes de ventas). En la pantalla de ingreso aparecen estas cuentas y se pueden completar con un clic:

| Perfil | Correo | Contraseña |
|---|---|---|
| Cliente | cliente@correo.cl | Cliente2026 |
| Administrador | admin@pokefresh.cl | Admin2026 |
| Dueño | dueno@pokefresh.cl | Dueno2026 |
| Cocina | cocina@pokefresh.cl | Cocina2026 |
| Despacho | despacho@pokefresh.cl | Despacho2026 |

Para ver el flujo completo se pueden usar varias pestañas, porque cada una tiene su propia sesión: en una se entra como cocina y en otra como cliente. Cuando el cliente paga, el pedido aparece en cocina con un aviso.

## Qué se puede hacer
- Ver el menú, buscar productos y filtrar por categoría.
- Armar un bowl eligiendo tamaño, bases, proteínas, salsas y toppings, con el precio calculado al momento.
- Armar las promociones (combo con bebida o dúo de bowls).
- Registrarse, verificar el correo e iniciar sesión.
- Pagar, revisar los pedidos, ver la boleta y anular un pedido indicando el motivo.
- Cocina acepta los pedidos pagados y los marca listos; despacho asigna chofer y registra la entrega.
- El dueño ve lo recaudado y un reporte de ventas por período, que se puede descargar en CSV.
- El administrador maneja productos, clientes, usuarios y pedidos.

## Cómo está armado
Es una aplicación de una sola página. Hay un solo `index.html` y cada sección es una vista en `js/views/`. El router usa el hash de la URL (`#/menu`, `#/arma-tu-bowl`, `#/orden/PF-00012`), así funciona tanto abriendo el archivo directo como en GitHub Pages.

Varias pantallas guardan su estado en la URL. Por ejemplo, `#/menu?categoria=salsas` abre solo las salsas y `#/arma-tu-bowl?base=base_gohan&proteina=pro_salmon` abre el armador con esos ingredientes elegidos.

Los datos se guardan en el `localStorage` del navegador. Para volver a los datos iniciales, entrar como administrador y usar "Restaurar datos de ejemplo" en Productos.

```
index.html
css/styles.css
img/
js/
  main.js          rutas del sitio
  router.js        router por hash
  datos.js         catálogo y reglas de precio
  tienda.js        precio del bowl, promociones y carrito
  cuentas.js       clientes, usuarios y sesión
  pedidos.js       pedidos, pagos, boletas, cocina y despacho
  views/           una vista por pantalla
```

## Qué está simulado
Como no hay backend, algunas partes del caso se simulan:

- El pago con Servipag es una pantalla de prueba.
- El correo de verificación y el envío de la boleta se muestran en pantalla en vez de enviarse.
- El radio de despacho de 3 km se aproxima con las comunas cercanas al local.
- El aviso a cocina solo llega a otras pestañas del mismo navegador.

## Fotos
Las fotos van en `img/menu/` con el nombre del producto en minúsculas, sin tildes y con guiones. Por ejemplo, "Salmón fresco" se busca como `salmon-fresco.jpg`. Si una foto no está, se muestra un fondo verde.
