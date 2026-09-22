/**
 * Piezas de formulario compartidas. La ficha del cliente se usa en tres
 * lugares con los mismos campos y validaciones: el registro web, "Mi cuenta"
 * y el mantenedor de clientes del administrador.
 */

PF.formularios = (function () {
  const { crudo, html } = PF.ui;
  const geo = PF.geografia;
  const REGION = geo.regiones()[0];

  function campo({ nombre, etiqueta, tipo = "text", valor = "", autocompletar = "off", ayuda = "", atributos = "" }) {
    return html`
      <div class="campo">
        <label for="campo-${nombre}">${etiqueta}</label>
        <input id="campo-${nombre}" name="${nombre}" type="${tipo}" value="${valor}" autocomplete="${autocompletar}" ${crudo(atributos)} />
        ${ayuda ? html`<p class="campo__ayuda">${ayuda}</p>` : ""}
      </div>
    `;
  }

  function selector({ nombre, etiqueta, opciones, valor = "", vacio = "Elige una opción" }) {
    return html`
      <div class="campo">
        <label for="campo-${nombre}">${etiqueta}</label>
        <select id="campo-${nombre}" name="${nombre}">
          <option value="">${vacio}</option>
          ${opciones.map(([v, texto]) => html`<option value="${v}" ${crudo(v === valor ? "selected" : "")}>${texto}</option>`)}
        </select>
      </div>
    `;
  }

  const opcionesDe = (lista) => lista.map((v) => [v, v]);

  /** Campos de la ficha del cliente, con los datos que pide el caso. */
  function fichaCliente(cliente = {}, { conClave = false } = {}) {
    const region = cliente.region ?? REGION;
    const provincia = cliente.provincia ?? "";

    return html`
      <fieldset class="grupo-campos">
        <legend>Datos personales</legend>
        <div class="campo-doble">
          ${campo({ nombre: "run", etiqueta: "RUN", valor: cliente.run ? PF.cuentas.formatearRun(cliente.run) : "", ayuda: "Con dígito verificador, por ejemplo 12.345.678-5.", atributos: 'inputmode="text" maxlength="12"' })}
          ${campo({ nombre: "fechaNacimiento", etiqueta: "Fecha de nacimiento", tipo: "date", valor: cliente.fechaNacimiento ?? "", autocompletar: "bday" })}
        </div>
        ${campo({ nombre: "nombre", etiqueta: "Nombre completo", valor: cliente.nombre ?? "", autocompletar: "name", ayuda: "Nombre y apellidos." })}
        ${selector({ nombre: "sexo", etiqueta: "Sexo", valor: cliente.sexo ?? "", opciones: Object.entries(PF.cuentas.SEXOS) })}
      </fieldset>

      <fieldset class="grupo-campos">
        <legend>Contacto</legend>
        <div class="campo-doble">
          ${campo({ nombre: "email", etiqueta: "Correo electrónico", tipo: "email", valor: cliente.email ?? "", autocompletar: "email", ayuda: "Te enviaremos un código para verificarlo." })}
          ${campo({ nombre: "telefono", etiqueta: "Teléfono celular", tipo: "tel", valor: cliente.telefono ?? "", autocompletar: "tel", ayuda: "Por ejemplo +56 9 1234 5678." })}
        </div>
      </fieldset>

      <fieldset class="grupo-campos">
        <legend>Dirección</legend>
        ${campo({ nombre: "direccion", etiqueta: "Calle y número", valor: cliente.direccion ?? "", autocompletar: "street-address", ayuda: "Agrega depto o casa si corresponde." })}
        <div class="campo-triple">
          ${selector({ nombre: "region", etiqueta: "Región", valor: region, opciones: opcionesDe(geo.regiones()), vacio: "Elige la región" })}
          ${selector({ nombre: "provincia", etiqueta: "Provincia", valor: provincia, opciones: opcionesDe(geo.provincias(region)), vacio: "Elige la provincia" })}
          ${selector({ nombre: "comuna", etiqueta: "Comuna", valor: cliente.comuna ?? "", opciones: opcionesDe(geo.comunas(region, provincia)), vacio: "Elige la comuna" })}
        </div>
        <p class="campo__ayuda" data-cobertura></p>
      </fieldset>

      ${conClave
        ? html`
            <fieldset class="grupo-campos">
              <legend>Contraseña</legend>
              <div class="campo-doble">
                ${campo({ nombre: "clave", etiqueta: "Contraseña", tipo: "password", autocompletar: "new-password", ayuda: "Al menos 8 caracteres, con letras y números." })}
                ${campo({ nombre: "clave2", etiqueta: "Repite la contraseña", tipo: "password", autocompletar: "new-password" })}
              </div>
            </fieldset>
          `
        : ""}
    `;
  }

  /**
   * Conecta los selectores en cascada: al cambiar la región se recargan las
   * provincias, y al cambiar la provincia, las comunas. Además avisa si la
   * comuna elegida tiene despacho.
   */
  function conectarUbicacion(form) {
    const { region, provincia, comuna } = form.elements;
    const aviso = form.querySelector("[data-cobertura]");

    const llenar = (select, valores, vacio) => {
      select.innerHTML = String(html`<option value="">${vacio}</option>${valores.map((v) => html`<option value="${v}">${v}</option>`)}`);
    };

    const actualizarAviso = () => {
      if (!aviso) return;
      aviso.textContent = !comuna.value
        ? ""
        : geo.tieneDespacho(comuna.value)
          ? `${comuna.value} tiene despacho gratis.`
          : `${comuna.value} está fuera del radio de despacho de 3 km: tus pedidos serán para retiro en el local.`;
    };

    region.addEventListener("change", () => {
      llenar(provincia, geo.provincias(region.value), "Elige la provincia");
      llenar(comuna, [], "Elige la comuna");
      actualizarAviso();
    });

    provincia.addEventListener("change", () => {
      llenar(comuna, geo.comunas(region.value, provincia.value), "Elige la comuna");
      actualizarAviso();
    });

    comuna.addEventListener("change", actualizarAviso);
    actualizarAviso();
  }

  function leerFicha(form) {
    const e = form.elements;
    return {
      run: e.run.value,
      nombre: e.nombre.value,
      fechaNacimiento: e.fechaNacimiento.value,
      sexo: e.sexo.value,
      email: e.email.value,
      telefono: e.telefono.value,
      direccion: e.direccion.value,
      region: e.region.value,
      provincia: e.provincia.value,
      comuna: e.comuna.value,
    };
  }

  /** Muestra un error de envío en el formulario y lo lleva a la vista. */
  function mostrarError(elemento, mensaje) {
    elemento.textContent = mensaje;
    elemento.hidden = !mensaje;
    if (mensaje) elemento.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /** Formatea el RUN mientras se escribe, sin mover el cursor al final a mitad de edición. */
  function formatearRunAlSalir(input) {
    input.addEventListener("blur", () => {
      if (PF.cuentas.normalizarRun(input.value)) input.value = PF.cuentas.formatearRun(input.value);
    });
  }

  return { campo, selector, fichaCliente, conectarUbicacion, leerFicha, mostrarError, formatearRunAlSalir };
})();
