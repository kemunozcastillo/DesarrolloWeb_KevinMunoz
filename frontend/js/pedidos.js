/**
 * Proceso de venta, a través de la API. Las reglas viven en el backend:
 *
 *   1. El cliente confirma su carrito: el servicio de pedidos pide a
 *      inventario el precio de cada línea (aquí solo se envía la selección)
 *      y reserva el stock. El pedido queda pendiente de pago.
 *   2. Paga en Servipag (pasarela de prueba). La pasarela avisa al servicio
 *      de pagos con una notificación firmada.
 *   3. Con el pago confirmado, el cajero virtual registra la venta y emite la
 *      boleta (servicio de pedidos), y se avisa a cocina y al correo del
 *      cliente por ActiveMQ.
 *   4. Cocina acepta y marca listo; despacho asigna chofer y entrega.
 *
 * Un pedido puede anularse mientras cocina no lo acepte. Si estaba pagado,
 * pagos devuelve el dinero e inventario recupera el stock.
 */

PF.pedidos = (function () {
  const api = PF.api;

  const ESTADOS = {
    PENDIENTE_PAGO: "Pendiente de pago",
    PAGADO: "Esperando cocina",
    EN_PREPARACION: "En preparación",
    LISTO_DESPACHO: "Listo para despacho",
    EN_DESPACHO: "En camino",
    LISTO_RETIRO: "Listo para retiro",
    ENTREGADO: "Entregado",
    ANULADO: "Anulado",
  };

  const MEDIOS_PAGO = { SERVIPAG: "Pago en línea (Servipag)" };
  const CAJERO_VIRTUAL = "Cajero virtual";
  const CAJA_WEB = "CAJA-WEB-01";
  const CHOFERES = ["Luis Contreras", "Andrea Muñoz"];
  const ANULABLES = ["PENDIENTE_PAGO", "PAGADO"];

  // Datos del emisor de la boleta (ficticios).
  const EMPRESA = {
    razonSocial: "Poke Fresh SpA",
    giro: "Venta de comida preparada",
    rut: "76.543.210-3",
    direccion: "Av. Providencia 1234, Providencia",
  };

  /** Solo la selección de cada línea: los precios del carrito no viajan. */
  function lineasParaEnviar(carrito) {
    return carrito.lineas.map((l) => {
      if (l.tipo === "BOWL") return { tipo: "BOWL", cantidad: l.cantidad, entrada: l.entrada };
      if (l.tipo === "PROMO") return { tipo: "PROMO", cantidad: l.cantidad, promoId: l.promoId, bowls: l.bowls, bebidaId: l.bebidaId };
      return { tipo: "ITEM", cantidad: l.cantidad, itemId: l.itemId };
    });
  }

  async function crear({ modoEntrega, nota = "", idempotencia }) {
    const carrito = PF.tienda.obtenerCarrito();
    if (carrito.lineas.length === 0) throw new api.ErrorApi("El carrito está vacío.", "CARRITO_VACIO", 400);
    const pedido = await api.post("/pedidos", { modoEntrega, nota, lineas: lineasParaEnviar(carrito) }, { cabeceras: { "Idempotency-Key": idempotencia } });
    PF.tienda.vaciarCarrito();
    return pedido;
  }

  /**
   * Inicia el pago y devuelve la dirección de la pasarela. La clave de
   * idempotencia se recuerda por pedido: si el cliente vuelve a apretar
   * "Pagar", el servicio de pagos reutiliza el mismo intento.
   */
  async function iniciarPago(pedidoId) {
    const clave = `pokefresh:pago:${pedidoId}`;
    let idempotencia = sessionStorage.getItem(clave);
    if (!idempotencia) {
      idempotencia = api.claveIdempotencia();
      sessionStorage.setItem(clave, idempotencia);
    }
    const pago = await api.post("/pagos", { pedidoId }, { cabeceras: { "Idempotency-Key": idempotencia } });
    return pago;
  }

  /** Tras un rechazo, el siguiente intento usa una clave nueva. */
  const olvidarIntentoDePago = (pedidoId) => sessionStorage.removeItem(`pokefresh:pago:${pedidoId}`);

  const ruta = (id, accion = "") => `/pedidos/${encodeURIComponent(id)}${accion ? `/${accion}` : ""}`;

  const anular = (id, motivo) => api.post(ruta(id, "anular"), { motivo });
  const aceptar = (id) => api.post(ruta(id, "aceptar"));
  const terminar = (id) => api.post(ruta(id, "terminar"));
  const despachar = (id, chofer) => api.post(ruta(id, "despachar"), { chofer });
  const entregar = (id) => api.post(ruta(id, "entregar"));
  const marcarImpresa = (id) => api.post(ruta(id, "impresa"));
  const esAnulable = (pedido) => ANULABLES.includes(pedido.estado);

  async function obtener(id) {
    try {
      return await api.get(ruta(id));
    } catch (fallo) {
      if (fallo.estado === 404) return null;
      throw fallo;
    }
  }

  async function porBoleta(numero) {
    try {
      return await api.get(`/pedidos/boleta/${encodeURIComponent(numero)}`);
    } catch (fallo) {
      if (fallo.estado === 404) return null;
      throw fallo;
    }
  }

  const delCliente = () => api.get("/pedidos");
  const todos = ({ estado, q } = {}) => api.get("/pedidos", { estado, q });
  const colaCocina = () => api.get("/pedidos", { cola: "cocina" });
  const colaDespacho = () => api.get("/pedidos", { cola: "despacho" });
  const porAceptar = async () => (await colaCocina()).filter((p) => p.estado === "PAGADO");
  const reporte = (desde, hasta) => api.get("/reportes/ventas", { desde, hasta });

  // -------------------------------------------------------------------------
  // Agregaciones GraphQL
  // -------------------------------------------------------------------------

  /** Pedido + pagos (servicio de pagos) + productos (inventario) + contacto (clientes, solo admin). */
  async function resumen(id, { conContacto = false } = {}) {
    const consulta = `query Resumen($id: ID!) {
      resumenPedido(id: $id) {
        pedido {
          id clienteId estado estadoTexto modoEntrega direccion nota chofer total creadoEn
          lineas { descripcion cantidad precioUnitario subtotal productos { id nombre categoria disponibleHoy } }
          boleta { numero fecha total }
          anulacion { motivo fecha por devolucion }
          historial { estado fecha actor nota }
        }
        pagos { id estado monto medio referencia creadoEn actualizadoEn }
        ${conContacto ? "cliente { nombre telefono email comuna }" : ""}
      }
    }`;
    const { datos, errores } = await api.graphql(consulta, { id });
    return { resumen: datos?.resumenPedido ?? null, errores };
  }

  /** Ventas por categoría (pedidos + inventario) y conciliación con los pagos aprobados (pagos). */
  async function analisisVentas(desde, hasta) {
    const consulta = `query Analisis($desde: String!, $hasta: String!) {
      reporteVentas(desde: $desde, hasta: $hasta) {
        porCategoria { categoria unidades }
        conciliacion { ventas pagosAprobados montoVentas montoPagos pedidosConDiferencia }
      }
    }`;
    const { datos, errores } = await api.graphql(consulta, { desde, hasta });
    return { analisis: datos?.reporteVentas ?? null, errores };
  }

  /** Fecha local "AAAA-MM-DD" de una marca ISO. */
  const diaLocal = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  return {
    ESTADOS,
    MEDIOS_PAGO,
    CAJERO_VIRTUAL,
    EMPRESA,
    CHOFERES,
    CAJA_WEB,
    crear,
    iniciarPago,
    olvidarIntentoDePago,
    anular,
    esAnulable,
    colaCocina,
    porAceptar,
    aceptar,
    terminar,
    colaDespacho,
    despachar,
    entregar,
    marcarImpresa,
    obtener,
    delCliente,
    todos,
    porBoleta,
    reporte,
    resumen,
    analisisVentas,
    diaLocal,
  };
})();
