/**
 * Utilidades compartidas por las vistas: plantillas seguras, formatos,
 * imágenes y avisos.
 *
 * Todos los scripts del sitio cuelgan de un único objeto global, `PF`, en vez
 * de usar módulos ES: los navegadores bloquean los módulos cuando la página
 * se abre desde el disco (file://), y este sitio tiene que funcionar así.
 */

window.PF = window.PF || {};

PF.ui = (function () {
  // -------------------------------------------------------------------------
  // Plantillas HTML seguras
  // -------------------------------------------------------------------------

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function escapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, (caracter) => ESCAPES[caracter]);
  }

  class HtmlSeguro {
    constructor(texto) {
      this.texto = texto;
    }
    toString() {
      return this.texto;
    }
  }

  /** Marca un fragmento como HTML ya construido, para anidarlo sin re-escapar. */
  const crudo = (texto) => new HtmlSeguro(texto);

  /**
   * Plantilla etiquetada que escapa todo lo interpolado.
   *
   * Desde la página de administración se pueden editar nombres y
   * descripciones. Si alguien guardara `<img onerror=...>` como nombre de un
   * producto, sin esto el código se ejecutaría al mostrar el menú.
   */
  function html(partes, ...valores) {
    let resultado = partes[0];

    valores.forEach((valor, i) => {
      if (valor instanceof HtmlSeguro) resultado += valor.texto;
      else if (Array.isArray(valor)) resultado += valor.map((v) => (v instanceof HtmlSeguro ? v.texto : escapar(v))).join("");
      else if (valor === false || valor === null || valor === undefined) resultado += "";
      else resultado += escapar(valor);

      resultado += partes[i + 1];
    });

    return new HtmlSeguro(resultado);
  }

  function pintar(elemento, fragmento) {
    elemento.innerHTML = String(fragmento);
  }

  // -------------------------------------------------------------------------
  // Formatos
  // -------------------------------------------------------------------------

  const PESOS = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });

  const precio = (monto) => PESOS.format(monto);

  /** "Salmón fresco" -> "salmon-fresco". Se usa para las rutas de imagen. */
  function slug(texto) {
    return String(texto)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // -------------------------------------------------------------------------
  // Categorías: valor interno <-> palabra de la URL <-> título visible
  // -------------------------------------------------------------------------

  const CATEGORIAS = [
    { enum: "BASE", slug: "bases", titulo: "Bases" },
    { enum: "PROTEINA", slug: "proteinas", titulo: "Proteína" },
    { enum: "SALSA", slug: "salsas", titulo: "Salsas" },
    { enum: "TOPPING", slug: "toppings", titulo: "Toppings" },
    { enum: "BEBIDA", slug: "bebidas", titulo: "Bebidas" },
    { enum: "PROMOCION", slug: "promociones", titulo: "Promociones" },
  ];

  const categoriaPorSlug = (valor) => CATEGORIAS.find((c) => c.slug === valor) ?? null;
  const categoriaPorEnum = (valor) => CATEGORIAS.find((c) => c.enum === valor) ?? null;
  const esIngrediente = (categoria) => ["BASE", "PROTEINA", "SALSA", "TOPPING"].includes(categoria);

  // -------------------------------------------------------------------------
  // Imágenes
  // -------------------------------------------------------------------------

  /**
   * Las fotos se buscan por el nombre del item: "Salmón fresco" ->
   * img/menu/salmon-fresco.jpg. Si el archivo no existe, se muestra un fondo
   * neutro en vez del ícono de imagen rota.
   */
  function imagen(nombre, { clase = "foto" } = {}) {
    return html`<span class="${clase}"><img src="img/menu/${slug(nombre)}.jpg" alt="" loading="lazy" data-foto /></span>`;
  }

  document.addEventListener(
    "error",
    (evento) => {
      const img = evento.target;
      if (img instanceof HTMLImageElement && img.hasAttribute("data-foto")) {
        img.parentElement?.classList.add("foto--vacia");
        img.remove();
      }
    },
    true, // el evento error no burbujea: se captura en la fase de captura
  );

  // -------------------------------------------------------------------------
  // Avisos flotantes
  // -------------------------------------------------------------------------

  function avisar(mensaje, { tipo = "info", duracion = 3500 } = {}) {
    const contenedor = document.querySelector("[data-avisos]");
    if (!contenedor) return;

    // Como máximo tres avisos a la vez: el más antiguo sale primero.
    while (contenedor.children.length >= 3) contenedor.firstElementChild.remove();

    const aviso = document.createElement("div");
    aviso.className = `aviso-flotante aviso-flotante--${tipo}`;
    aviso.setAttribute("role", tipo === "error" ? "alert" : "status");
    aviso.textContent = mensaje;
    contenedor.append(aviso);

    setTimeout(() => {
      aviso.classList.add("aviso-flotante--saliendo");
      aviso.addEventListener("animationend", () => aviso.remove(), { once: true });
      setTimeout(() => aviso.remove(), 400); // respaldo si la animación está desactivada
    }, duracion);
  }

  // -------------------------------------------------------------------------
  // Varios
  // -------------------------------------------------------------------------

  function titulo(texto) {
    document.title = texto ? `${texto} | Poke Fresh` : "Poke Fresh";
  }

  /** Copia texto al portapapeles, con respaldo para navegadores sin la API. */
  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = texto;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }


  // -------------------------------------------------------------------------
  // Fechas
  // -------------------------------------------------------------------------

  const FECHA_HORA = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });
  const FECHA_CORTA = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });

  const fechaHora = (iso) => FECHA_HORA.format(new Date(iso));
  const fechaCorta = (iso) => FECHA_CORTA.format(new Date(iso));

  // -------------------------------------------------------------------------
  // Estados de pedido
  // -------------------------------------------------------------------------

  const TONO_ESTADO = {
    PENDIENTE_PAGO: "espera",
    PAGADO: "activo",
    EN_PREPARACION: "activo",
    LISTO_DESPACHO: "activo",
    EN_DESPACHO: "activo",
    LISTO_RETIRO: "activo",
    ENTREGADO: "listo",
    ANULADO: "anulado",
  };

  const etiquetaEstado = (estado) =>
    html`<span class="estado-pedido estado-pedido--${TONO_ESTADO[estado] ?? "espera"}">${PF.pedidos.ESTADOS[estado] ?? estado}</span>`;

  // -------------------------------------------------------------------------
  // Panel interno
  // -------------------------------------------------------------------------

  /**
   * Secciones del panel del restaurante y qué perfiles entran a cada una.
   * Las mismas listas protegen las rutas en main.js, así que el menú nunca
   * muestra una sección a la que el perfil no puede entrar.
   */
  const SECCIONES_PANEL = [
    // El orden sigue el recorrido de un pedido, y la primera sección de cada
    // perfil es donde cae al ingresar.
    { ruta: "/admin/pedidos", titulo: "Pedidos", perfiles: ["ADMIN"] },
    { ruta: "/admin/cocina", titulo: "Cocina", perfiles: ["ADMIN", "COCINA"] },
    { ruta: "/admin/despacho", titulo: "Despacho", perfiles: ["ADMIN", "DESPACHO"] },
    { ruta: "/admin/reportes", titulo: "Reportes", perfiles: ["ADMIN", "DUENO"] },
    { ruta: "/admin/caja", titulo: "Caja", perfiles: ["ADMIN", "DUENO"] },
    { ruta: "/admin", titulo: "Productos", perfiles: ["ADMIN", "DUENO"] },
    { ruta: "/admin/clientes", titulo: "Clientes", perfiles: ["ADMIN"] },
    { ruta: "/admin/usuarios", titulo: "Usuarios", perfiles: ["ADMIN"] },
  ];

  const accesoDe = (ruta) => SECCIONES_PANEL.find((s) => s.ruta === ruta).perfiles;
  const inicioPanel = (perfil) => SECCIONES_PANEL.find((s) => s.perfiles.includes(perfil))?.ruta ?? "/";

  function panel({ sesion, activa, contenido }) {
    const secciones = SECCIONES_PANEL.filter((s) => s.perfiles.includes(sesion.perfil));

    return html`
      <div class="pagina panel">
        <div class="panel__cabeza">
          <p class="panel__quien">${sesion.nombre}, <span>${PF.cuentas.PERFILES[sesion.perfil]}</span></p>
          <nav class="panel__nav" aria-label="Secciones del panel">
            ${secciones.map((s) => {
              // Cocina muestra cuántos pedidos esperan ser aceptados.
              const pendientes = s.ruta === "/admin/cocina" ? PF.pedidos.porAceptar().length : 0;
              return html`<a href="#${s.ruta}" ${crudo(s.ruta === activa ? 'aria-current="page"' : "")}>${s.titulo}${pendientes ? html` <span class="panel__cuenta">${pendientes}</span>` : ""}</a>`;
            })}
          </nav>
        </div>
        ${contenido}
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Diálogo para pedir un motivo
  // -------------------------------------------------------------------------

  /**
   * Abre un diálogo con un campo de texto obligatorio y devuelve lo escrito,
   * o null si se cancela. Se usa para anular pedidos y rechazar depósitos,
   * donde el caso exige dejar el motivo registrado.
   */
  function pedirMotivo({ titulo: textoTitulo, detalle = "", confirmar = "Confirmar", minimo = 5 }) {
    return new Promise((resolver) => {
      const dialogo = document.createElement("dialog");
      dialogo.className = "dialogo";
      dialogo.innerHTML = String(html`
        <form method="dialog" class="dialogo__cuerpo">
          <h2>${textoTitulo}</h2>
          ${detalle ? html`<p>${detalle}</p>` : ""}
          <div class="campo">
            <label for="dialogo-motivo">Motivo</label>
            <textarea id="dialogo-motivo" rows="3" maxlength="200" required></textarea>
            <p class="campo__error" data-error-motivo></p>
          </div>
          <div class="estado__acciones estado__acciones--derecha">
            <button class="boton" type="button" data-cancelar>Volver</button>
            <button class="boton boton--peligro" type="submit">${confirmar}</button>
          </div>
        </form>
      `);
      document.body.append(dialogo);

      const campo = dialogo.querySelector("textarea");
      const cerrar = (valor) => {
        dialogo.close();
        dialogo.remove();
        resolver(valor);
      };

      dialogo.querySelector("[data-cancelar]").addEventListener("click", () => cerrar(null));
      dialogo.addEventListener("cancel", (evento) => {
        evento.preventDefault();
        cerrar(null);
      });
      dialogo.querySelector("form").addEventListener("submit", (evento) => {
        evento.preventDefault();
        const texto = campo.value.trim();
        if (texto.length < minimo) {
          dialogo.querySelector("[data-error-motivo]").textContent = `Escribe al menos ${minimo} caracteres.`;
          campo.focus();
          return;
        }
        cerrar(texto);
      });

      dialogo.showModal();
      campo.focus();
    });
  }

  /** Descarga un texto como archivo (funciona también abriendo desde el disco). */
  function descargar(nombre, contenido, tipo = "text/csv;charset=utf-8") {
    const url = URL.createObjectURL(new Blob(["\ufeff", contenido], { type: tipo }));
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombre;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    escapar,
    crudo,
    html,
    pintar,
    precio,
    slug,
    CATEGORIAS,
    categoriaPorSlug,
    categoriaPorEnum,
    esIngrediente,
    imagen,
    avisar,
    titulo,
    copiar,
    fechaHora,
    fechaCorta,
    etiquetaEstado,
    SECCIONES_PANEL,
    accesoDe,
    inicioPanel,
    panel,
    pedirMotivo,
    descargar,
  };
})();
