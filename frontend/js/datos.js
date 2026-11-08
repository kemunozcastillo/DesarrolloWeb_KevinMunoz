/**
 * Catálogo, tamaños, reglas de armado y guardado local del carrito.
 *
 * El catálogo vive en el microservicio de inventario. Se carga al abrir el
 * sitio y se guarda en memoria para que el menú y el armador respondan al
 * instante; se vuelve a pedir cada minuto y después de cada cambio del
 * administrador.
 *
 * TAMANOS, REGLAS y PROMOS también vienen del backend. Son objetos que se
 * llenan en su lugar (no se reemplazan) para que los módulos que los tomaron
 * al cargar sigan viendo los valores.
 *
 * En localStorage queda solo el carrito: no tiene datos personales ni precios
 * que se usen para cobrar (el backend recalcula todo al confirmar).
 */

PF.datos = (function () {
  const TAMANOS = [];
  const REGLAS = {};
  const PROMOS = {};

  const PREFIJO = "pokefresh:";

  function leer(clave, porDefecto) {
    try {
      const texto = localStorage.getItem(PREFIJO + clave);
      return texto === null ? porDefecto : JSON.parse(texto);
    } catch {
      return porDefecto;
    }
  }

  function guardar(clave, valor) {
    try {
      localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    } catch {
      /* sin storage, el carrito dura lo que dure la pestaña */
    }
  }

  function borrar(clave) {
    try {
      localStorage.removeItem(PREFIJO + clave);
    } catch {
      /* nada que borrar */
    }
  }

  // Los errores de la API traen mensaje y código, igual que los antiguos ErrorDatos.
  const ErrorDatos = PF.api.ErrorApi;

  let catalogo = [];
  let cargadoEn = 0;

  async function cargar() {
    const [configuracion, items] = await Promise.all([PF.api.get("/catalogo/configuracion"), PF.api.get("/catalogo/items")]);
    TAMANOS.splice(0, TAMANOS.length, ...configuracion.tamanos);
    Object.keys(REGLAS).forEach((k) => delete REGLAS[k]);
    Object.assign(REGLAS, configuracion.reglas);
    Object.keys(PROMOS).forEach((k) => delete PROMOS[k]);
    Object.assign(PROMOS, configuracion.promos);
    catalogo = items;
    cargadoEn = Date.now();
  }

  async function refrescar() {
    catalogo = await PF.api.get("/catalogo/items");
    cargadoEn = Date.now();
  }

  const catalogoApi = {
    listar({ categoria } = {}) {
      return categoria ? catalogo.filter((item) => item.categoria === categoria) : [...catalogo];
    },

    obtener(id) {
      return catalogo.find((item) => item.id === id) ?? null;
    },

    async crear(datos) {
      const item = await PF.api.post("/catalogo/items", datos);
      await refrescar();
      return item;
    },

    async actualizar(id, cambios) {
      const item = await PF.api.put(`/catalogo/items/${encodeURIComponent(id)}`, cambios);
      await refrescar();
      return item;
    },

    async eliminar(id) {
      await PF.api.eliminar(`/catalogo/items/${encodeURIComponent(id)}`);
      await refrescar();
    },
  };

  return {
    TAMANOS,
    REGLAS,
    PROMOS,
    ErrorDatos,
    leer,
    guardar,
    borrar,
    cargar,
    refrescar,
    antiguedad: () => Date.now() - cargadoEn,
    catalogo: catalogoApi,
  };
})();
