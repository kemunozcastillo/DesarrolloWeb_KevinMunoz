/**
 * Páginas informativas: ubicación, contacto y la página de ruta inexistente.
 */

PF.vistas = PF.vistas || {};

// Envuelto en una función para que LOCAL y MOTIVOS no queden como globales.
(function () {

// Reemplazar por los datos reales del local.
const LOCAL = {
  direccion: "Av. Providencia 1234, Providencia, Santiago",
  whatsapp: "56912345678",
  horarios: [
    ["Lunes a viernes", "12:00 a 22:00"],
    ["Sábado", "12:00 a 23:00"],
    ["Domingo", "12:00 a 18:00"],
  ],
};

PF.vistas.ubicacion = function ({ raiz }) {
  const { html, pintar, titulo } = PF.ui;
  titulo("Ubicación");

  const mapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(LOCAL.direccion)}`;

  pintar(
    raiz,
    html`
      <div class="pagina pagina--angosta">
        <h1>Ubicación</h1>
        <div class="ficha">
          <div>
            <h2>Dirección</h2>
            <p>${LOCAL.direccion}</p>
            <a class="boton" href="${mapa}" target="_blank" rel="noopener">Abrir en Google Maps</a>
          </div>
          <div>
            <h2>Horario</h2>
            <dl class="horario">
              ${LOCAL.horarios.map(([dia, horas]) => html`<div><dt>${dia}</dt><dd>${horas}</dd></div>`)}
            </dl>
          </div>
        </div>
      </div>
    `,
  );
};

const MOTIVOS = [
  { valor: "pedido", texto: "Consulta sobre un pedido" },
  { valor: "evento", texto: "Pedido para evento o empresa" },
  { valor: "reclamo", texto: "Reclamo o sugerencia" },
  { valor: "otro", texto: "Otro tema" },
];

/**
 * Contacto por WhatsApp: el formulario arma el mensaje y abre el chat.
 * El motivo se puede preseleccionar desde la URL: #/contacto?motivo=evento
 */
PF.vistas.contacto = function ({ raiz, query }) {
  const { avisar, crudo, html, pintar, titulo } = PF.ui;
  titulo("Contacto");

  const motivoInicial = MOTIVOS.some((m) => m.valor === query.get("motivo")) ? query.get("motivo") : "pedido";

  pintar(
    raiz,
    html`
      <div class="pagina pagina--angosta">
        <h1>Contacto</h1>
        <p class="introduccion">Escríbenos y te respondemos por WhatsApp.</p>
        <form class="formulario-admin" novalidate>
          <div class="campo">
            <label for="c-motivo">Motivo</label>
            <select id="c-motivo" name="motivo">
              ${MOTIVOS.map((m) => html`<option value="${m.valor}" ${crudo(m.valor === motivoInicial ? "selected" : "")}>${m.texto}</option>`)}
            </select>
          </div>
          <div class="campo">
            <label for="c-nombre">Nombre</label>
            <input id="c-nombre" name="nombre" required minlength="2" autocomplete="name" />
          </div>
          <div class="campo">
            <label for="c-mensaje">Mensaje</label>
            <textarea id="c-mensaje" name="mensaje" rows="5" required minlength="10" maxlength="600"></textarea>
            <p class="campo__ayuda" data-contador>0 de 600 caracteres</p>
          </div>
          <button class="boton boton--primario" type="submit">Enviar por WhatsApp</button>
        </form>
      </div>
    `,
  );

  const form = raiz.querySelector("form");
  const contador = raiz.querySelector("[data-contador]");

  form.mensaje.addEventListener("input", () => {
    contador.textContent = `${form.mensaje.value.length} de 600 caracteres`;
  });

  form.motivo.addEventListener("change", () => PF.router.actualizarQuery({ motivo: form.motivo.value }));

  form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    if (!form.reportValidity()) return;

    const motivo = MOTIVOS.find((m) => m.valor === form.motivo.value).texto;
    const texto = `Hola, soy ${form.nombre.value.trim()}. ${motivo}: ${form.mensaje.value.trim()}`;

    window.open(`https://wa.me/${LOCAL.whatsapp}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
    avisar("Abrimos WhatsApp con tu mensaje listo para enviar.", { tipo: "exito" });
  });
};

PF.vistas.noEncontrada = function ({ raiz }) {
  const { html, pintar, titulo } = PF.ui;
  titulo("Página no encontrada");

  pintar(
    raiz,
    html`
      <div class="pagina pagina--angosta">
        <section class="estado estado--vacio">
          <h1>Esta página no existe</h1>
          <p>La dirección ${location.hash} no corresponde a ninguna sección.</p>
          <div class="estado__acciones">
            <a class="boton boton--primario" href="#/menu">Ver el menú</a>
            <a class="boton" href="#/">Ir al inicio</a>
          </div>
        </section>
      </div>
    `,
  );
};
PF.vistas.sinPermiso = function ({ raiz, sesion }) {
  const { html, pintar, titulo } = PF.ui;
  titulo("Sin permiso");
  const destino = sesion?.tipo === "USUARIO" ? PF.ui.inicioPanel(sesion.perfil) : "/";

  pintar(
    raiz,
    html`
      <div class="pagina pagina--angosta">
        <section class="estado estado--vacio">
          <h1>No tienes acceso a esta sección</h1>
          <p>Tu perfil no incluye esta parte del sistema. Si crees que es un error, pídele al administrador que revise tu perfil.</p>
          <a class="boton boton--primario" href="#${destino}">Ir a mi inicio</a>
        </section>
      </div>
    `,
  );
};

/**
 * Ayuda en línea: preguntas frecuentes para clientes y una guía por perfil
 * para el personal. #/ayuda?tema=pagos abre directo esa sección.
 */
PF.vistas.ayuda = function ({ raiz, query, sesion }) {
  const { crudo, html, pintar, titulo, precio } = PF.ui;
  titulo("Ayuda");

  const R = PF.datos.REGLAS;
  const comunas = PF.geografia.COMUNAS_CON_DESPACHO.join(", ");

  const TEMAS = [
    {
      id: "comprar",
      titulo: "Cómo comprar",
      preguntas: [
        ["¿Cómo armo mi bowl?", `Entra a "Arma tu bowl", elige tamaño, base, proteína, salsas y toppings. El precio se actualiza con cada elección y el botón para agregar se activa cuando tienes al menos una base y una proteína.`],
        ["¿Cuánto cuesta agregar más ingredientes?", `Cada bowl incluye ${R.basesIncluidas} base y ${R.proteinasIncluidas} proteína. Cada base extra suma ${precio(R.recargoBaseExtra)}, cada proteína extra ${precio(R.recargoProteinaExtra)}, cada salsa extra ${precio(R.recargoSalsaExtra)} y cada topping extra ${precio(R.recargoToppingExtra)}. Los ingredientes premium muestran su recargo en la tarjeta.`],
        ["¿Cómo funcionan las promociones?", "En el menú, entra a Promociones y usa \u201cArmar promoción\u201d. El precio cubre lo estándar; lo que agregues encima se suma aparte y aparece en el desglose."],
        ["¿Necesito una cuenta?", "Puedes armar tu carrito sin cuenta, pero para pagar tienes que estar registrado y haber verificado tu correo."],
      ],
    },
    {
      id: "pagos",
      titulo: "Pagos y boletas",
      preguntas: [
        ["¿Cómo puedo pagar?", "En línea con Servipag. El pago se confirma al instante y tu pedido pasa directo a cocina."],
        ["¿Cuándo se prepara mi pedido?", "Apenas cocina lo acepta, que es justo después de confirmado el pago. Antes de pagar, el pedido queda pendiente."],
        ["¿Dónde está mi boleta?", "Se emite al confirmar el pago y se envía a tu correo. También la ves en \u201cMis pedidos\u201d, dentro de cada pedido."],
        ["¿Puedo anular un pedido?", "Sí, mientras cocina no lo haya aceptado. Entra al pedido, usa \u201cAnular pedido\u201d e indica el motivo. Si ya lo habías pagado, se devuelve el pago."],
      ],
    },
    {
      id: "despacho",
      titulo: "Despacho",
      preguntas: [
        ["¿Hasta dónde despachan?", `El despacho es gratis dentro de 3 km del local, que hoy cubre estas comunas: ${comunas}. Si vives fuera de ese radio, puedes retirar en el local.`],
        ["¿A qué dirección llega mi pedido?", "A la dirección registrada en tu cuenta. Para cambiarla, entra a \u201cMis datos\u201d antes de confirmar el pedido."],
        ["¿Cómo sé en qué va mi pedido?", "En \u201cMis pedidos\u201d verás cada etapa: esperando cocina, en preparación, listo, en camino o listo para retiro, y entregado."],
      ],
    },
    {
      id: "cuenta",
      titulo: "Tu cuenta",
      preguntas: [
        ["¿Qué datos piden para registrarme?", "RUN, nombre completo, fecha de nacimiento, sexo, correo, teléfono y dirección con región, provincia y comuna."],
        ["No me llegó el código de verificación", "En la página de verificación puedes pedir un código nuevo. El código vence en 24 horas."],
        ["Mi cuenta quedó bloqueada", "Tras 5 intentos fallidos el ingreso se bloquea 5 minutos. Espera y vuelve a intentar."],
        ["¿Por qué se cerró mi sesión?", `Por seguridad, la sesión se cierra después de ${PF.cuentas.MINUTOS_SESION} minutos sin actividad.`],
      ],
    },
    {
      id: "personal",
      titulo: "Guía para el personal",
      preguntas: [
        ["Cocina", "Los pedidos pagados llegan solos a Cocina, en orden de llegada, con un aviso y un sonido. Imprime la orden de despacho, acepta el pedido para empezar a prepararlo y márcalo listo al terminar."],
        ["Encargado de despacho", "En Despacho aparecen los pedidos que cocina marcó listos. Asigna un chofer a los despachos y registra la entrega; los retiros se marcan cuando el cliente los lleva."],
        ["Dueño", "En Caja ves lo recaudado hoy. En Reportes eliges el período y revisas el monto vendido, las ventas por día, por tipo de entrega y lo más vendido; puedes imprimirlo o descargarlo en CSV."],
        ["Administrador", "Mantiene productos, clientes y usuarios, y puede anular pedidos que cocina todavía no acepta. Los clientes registrados en el local reciben una contraseña temporal y deben verificar su correo."],
      ],
    },
  ];

  const abierto = query.get("tema");

  pintar(
    raiz,
    html`
      <div class="pagina pagina--angosta ayuda">
        <h1>Ayuda</h1>
        <nav class="rangos" aria-label="Temas de ayuda">
          ${TEMAS.map((t) => html`<a href="#/ayuda?tema=${t.id}" ${crudo(t.id === abierto ? 'aria-current="true"' : "")}>${t.titulo}</a>`)}
        </nav>
        ${TEMAS.map(
          (t) => html`
            <section class="ayuda__tema" id="tema-${t.id}">
              <h2>${t.titulo}</h2>
              ${t.preguntas.map(
                ([pregunta, respuesta], i) => html`
                  <details ${crudo(t.id === abierto && i === 0 ? "open" : "")}>
                    <summary>${pregunta}</summary>
                    <p>${respuesta}</p>
                  </details>
                `,
              )}
            </section>
          `,
        )}
        <p class="cuenta__alternativa">¿No encontraste tu respuesta? <a href="#/contacto">Escríbenos</a>.</p>
      </div>
    `,
  );

  if (TEMAS.some((t) => t.id === abierto)) raiz.querySelector(`#tema-${abierto}`).scrollIntoView({ block: "start" });
};

})();
