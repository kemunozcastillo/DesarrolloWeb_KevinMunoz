/**
 * Router del sitio basado en el hash de la URL.
 *
 * Las rutas tienen la forma `index.html#/menu?categoria=salsas`. Se usa el
 * hash y no la History API porque el sitio se abre con doble clic desde el
 * disco (file://), y ahí los navegadores no permiten `pushState` hacia otras
 * rutas. Cambiar el hash, en cambio, funciona en cualquier contexto y el
 * navegador lo registra en el historial, así que atrás y adelante funcionan.
 *
 * Cada ruta es un patrón con parámetros opcionales (`/orden/:id`). La vista
 * recibe los parámetros y la query string, así que todo el estado que viva
 * en la URL sobrevive a una recarga y se puede compartir como enlace.
 *
 * Una ruta puede exigir sesión: `acceso: "CLIENTE"` para clientes, o una
 * lista de perfiles internos (`["ADMIN", "DUENO"]`). Sin sesión, el router
 * lleva a la pantalla de ingreso y vuelve a la ruta pedida después; con una
 * sesión de otro perfil, muestra "sin permiso".
 */

PF.router = (function () {
  const rutas = [];
  let vistaNoEncontrada = null;
  let vistaSinPermiso = null;
  let raiz = null;
  let limpiezaActual = null;
  let hashIgnorado = null;

  /** Convierte "/orden/:id" en una expresión regular y la lista de claves. */
  function compilar(patron) {
    const claves = [];
    const fuente = patron
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\/:([a-zA-Z_]+)/g, (_coincidencia, clave) => {
        claves.push(clave);
        return "/([^/]+)";
      });

    return { regex: new RegExp(`^${fuente}/?$`), claves };
  }

  function definir(patron, vista, { acceso = null } = {}) {
    rutas.push({ patron, vista, acceso, ...compilar(patron) });
  }

  function definirNoEncontrada(vista) {
    vistaNoEncontrada = vista;
  }

  function definirSinPermiso(vista) {
    vistaSinPermiso = vista;
  }

  /** ¿La sesión puede entrar a una ruta con este acceso? */
  function permitido(acceso, sesion) {
    if (!acceso) return true;
    if (!sesion) return false;
    // El perfil de un cliente es "CLIENTE", así que una lista puede mezclar
    // clientes y personal: ["CLIENTE", "ADMIN"].
    const lista = Array.isArray(acceso) ? acceso : [acceso];
    return lista.includes(sesion.perfil);
  }

  /** "#/menu?categoria=salsas" -> { ruta: "/menu", query: URLSearchParams } */
  function leerHash() {
    const hash = location.hash.replace(/^#/, "");
    const [ruta, busqueda = ""] = hash.split("?");
    return { ruta: ruta || "/", query: new URLSearchParams(busqueda) };
  }

  function armarHash(ruta, query) {
    const busqueda = query.toString();
    return `#${ruta}${busqueda ? `?${busqueda}` : ""}`;
  }

  function coincidir(ruta) {
    for (const definicion of rutas) {
      const resultado = definicion.regex.exec(ruta);
      if (!resultado) continue;

      const params = {};
      definicion.claves.forEach((clave, i) => {
        params[clave] = decodeURIComponent(resultado[i + 1]);
      });

      return { definicion, params };
    }

    return null;
  }

  function marcarNavegacion(ruta) {
    document.querySelectorAll("[data-nav]").forEach((enlace) => {
      const destino = enlace.dataset.nav;
      const activo = ruta === destino || ruta.startsWith(`${destino}/`);

      if (activo) enlace.setAttribute("aria-current", "page");
      else enlace.removeAttribute("aria-current");
    });
  }

  function resolver({ moverFoco = true } = {}) {
    const { ruta, query } = leerHash();
    const coincidencia = coincidir(ruta);

    // La vista anterior retira sus listeners antes de que entre la nueva.
    if (typeof limpiezaActual === "function") limpiezaActual();
    limpiezaActual = null;

    marcarNavegacion(ruta);

    PF.cuentas.renovarSesion();
    const sesion = PF.cuentas.sesionActual();
    const acceso = coincidencia?.definicion.acceso;

    // Sin sesión: a ingresar, recordando adónde iba.
    if (acceso && !sesion) {
      const volver = encodeURIComponent(location.hash.replace(/^#/, ""));
      navegar(`/ingresar?volver=${volver}`, { reemplazar: true });
      return;
    }

    let vista = coincidencia?.definicion.vista ?? vistaNoEncontrada;
    if (acceso && !permitido(acceso, sesion)) vista = vistaSinPermiso;

    try {
      limpiezaActual = vista({ raiz, params: coincidencia?.params ?? {}, query, sesion });
    } catch (error) {
      console.error(error);
      raiz.innerHTML = `<section class="estado estado--error"><h1>No pudimos mostrar esta página</h1><p>Recarga para intentarlo de nuevo.</p></section>`;
    }

    if (moverFoco) {
      window.scrollTo(0, 0);
      raiz.focus({ preventScroll: true }); // los lectores de pantalla anuncian la página nueva
    }
  }

  /** Navega a una ruta del sitio: navegar("/orden/PF-123"). */
  function navegar(destino, { reemplazar = false } = {}) {
    const hash = destino.startsWith("#") ? destino : `#${destino}`;

    if (hash === location.hash) {
      resolver();
      return;
    }

    if (reemplazar) location.replace(`${location.href.split("#")[0]}${hash}`);
    else location.hash = hash;
    // El cambio de hash dispara "hashchange", que llama a resolver().
  }

  /**
   * Cambia la query string sin volver a pintar la vista.
   *
   * La usan las vistas que guardan su estado en la URL (filtros del menú,
   * selección del armador): cada cambio se refleja en el enlace, y abrir ese
   * enlace reconstruye la misma pantalla. Se usa `location.replace` para que
   * cada clic no agregue una entrada al historial.
   */
  function actualizarQuery(cambios) {
    const { ruta, query } = leerHash();

    for (const [clave, valor] of Object.entries(cambios)) {
      const vacio =
        valor === null ||
        valor === undefined ||
        valor === "" ||
        valor === false ||
        (Array.isArray(valor) && valor.length === 0);

      if (vacio) query.delete(clave);
      else query.set(clave, Array.isArray(valor) ? valor.join(",") : String(valor));
    }

    const hash = armarHash(ruta, query);
    if (hash === location.hash) return;

    // Este cambio lo hizo la vista misma: el hashchange que dispara no debe
    // volver a pintarla, o se perdería el foco del campo que se está usando.
    hashIgnorado = hash;
    location.replace(`${location.href.split("#")[0]}${hash}`);
  }

  /** Lee un parámetro de lista separado por comas: "a,b,c" -> ["a","b","c"]. */
  function leerLista(query, clave) {
    return (query.get(clave) ?? "")
      .split(",")
      .map((valor) => valor.trim())
      .filter(Boolean);
  }

  function iniciar(elementoRaiz) {
    raiz = elementoRaiz;

    window.addEventListener("hashchange", () => {
      if (hashIgnorado && location.hash === hashIgnorado) {
        hashIgnorado = null;
        return;
      }
      hashIgnorado = null;
      resolver();
    });

    resolver({ moverFoco: false });
  }

  /** Vuelve a pintar la ruta actual (por ejemplo, al iniciar o cerrar sesión). */
  const recargar = () => resolver({ moverFoco: false });

  return { definir, definirNoEncontrada, definirSinPermiso, permitido, navegar, actualizarQuery, leerLista, iniciar, recargar };
})();
