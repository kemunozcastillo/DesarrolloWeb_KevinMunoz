/**
 * Proceso de venta completo, según el caso:
 *
 *   1. El cliente registrado confirma su carrito y se crea el pedido,
 *      pendiente de pago.
 *   2. Paga en la plataforma externa (Servipag, simulada).
 *   3. Con el pago confirmado, el cajero virtual (el propio sistema) registra
 *      la venta en la caja web y emite la boleta digital, que se envía al
 *      correo del cliente (simulado). Nadie tiene que intervenir.
 *   4. El pedido pagado llega solo a cocina, en orden de llegada y con aviso.
 *      Cocina lo acepta, lo prepara y lo marca listo.
 *   5. Si es despacho, el encargado le asigna chofer y registra la entrega;
 *      si es retiro, queda listo para que el cliente lo retire.
 *
 * Un pedido puede anularse, indicando el motivo, mientras cocina no lo haya
 * aceptado. Si ya estaba pagado, la venta queda anulada y el pago se devuelve.
 */

PF.pedidos = (function () {
  const { ErrorDatos, leer, guardar } = PF.datos;
  const error = (mensaje, codigo = "BAD_USER_INPUT") => new ErrorDatos(mensaje, codigo);

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

  // Datos del emisor de la boleta. Reemplazar por los reales.
  const EMPRESA = {
    razonSocial: "Poke Fresh SpA",
    giro: "Venta de comida preparada",
    rut: "76.543.210-3",
    direccion: "Av. Providencia 1234, Providencia",
  };

  const leerPedidos = () => leer("pedidos", []);
  const guardarPedidos = (lista) => guardar("pedidos", lista);

  function siguiente(clave) {
    const contadores = leer("contadores", {});
    contadores[clave] = (contadores[clave] ?? 0) + 1;
    guardar("contadores", contadores);
    return contadores[clave];
  }

  function registrar(pedido, estado, actor, nota = "") {
    pedido.estado = estado;
    pedido.historial.push({ estado, fecha: new Date().toISOString(), actor, nota });
  }

  function buscar(lista, id) {
    const pedido = lista.find((p) => p.id === id);
    if (!pedido) throw error("No encontramos ese pedido.", "NOT_FOUND");
    return pedido;
  }

  const nombreActor = (sesion) =>
    sesion.tipo === "CLIENTE" ? "Cliente" : `${sesion.nombre} (${PF.cuentas.PERFILES[sesion.perfil]})`;

  // -------------------------------------------------------------------------
  // 1. Crear pedido
  // -------------------------------------------------------------------------

  function crear({ sesion, modoEntrega, nota = "" }) {
    if (sesion?.tipo !== "CLIENTE") throw error("Solo los clientes registrados pueden comprar.", "SIN_SESION");

    const cliente = PF.cuentas.obtenerCliente(sesion.id);
    if (!cliente || !cliente.activo) throw error("Tu cuenta no está habilitada para comprar.", "INACTIVA");
    if (!cliente.emailVerificado) throw error("Verifica tu correo antes de comprar.", "SIN_VERIFICAR");
    if (!["RETIRO", "DELIVERY"].includes(modoEntrega)) throw error("Elige cómo recibir tu pedido.");
    if (modoEntrega === "DELIVERY" && !PF.geografia.tieneDespacho(cliente.comuna)) {
      throw error(`${cliente.comuna} está fuera del radio de despacho de 3 km. Puedes retirar en el local.`, "FUERA_DE_RADIO");
    }

    const carrito = PF.tienda.obtenerCarrito();
    if (carrito.lineas.length === 0) throw error("El carrito está vacío.", "CARRITO_VACIO");

    const ahora = new Date().toISOString();

    // Las líneas se congelan con su descripción y precio de este momento: si
    // el menú cambia después, el pedido y su boleta no se alteran.
    const pedido = {
      id: `PF-${String(siguiente("pedido")).padStart(5, "0")}`,
      clienteId: cliente.id,
      cliente: { nombre: cliente.nombre, run: cliente.run, email: cliente.email, telefono: cliente.telefono },
      modoEntrega,
      direccion: modoEntrega === "DELIVERY" ? `${cliente.direccion}, ${cliente.comuna}` : null,
      nota: String(nota).trim().slice(0, 200),
      lineas: carrito.lineas.map((l) => ({
        descripcion: l.tipo === "ITEM" ? l.nombre : l.tipo === "PROMO" ? `${l.nombre}: ${l.detalle}` : l.detalle,
        cantidad: l.cantidad,
        precioUnitario: l.unitario,
        subtotal: l.subtotal,
      })),
      total: carrito.total,
      despacho: 0, // gratuito dentro del radio
      pago: { medio: "SERVIPAG", estado: "PENDIENTE" },
      venta: null,
      boleta: null,
      creadoEn: ahora,
      historial: [],
    };

    registrar(pedido, "PENDIENTE_PAGO", "Cliente");

    const lista = leerPedidos();
    lista.push(pedido);
    guardarPedidos(lista);
    PF.tienda.vaciarCarrito();
    return pedido;
  }

  // -------------------------------------------------------------------------
  // 2 y 3. Pago, venta y boleta
  // -------------------------------------------------------------------------

  /**
   * Con el pago confirmado se registra la venta en la caja web, a cargo del
   * cajero virtual, y se emite la boleta. El envío por correo se simula.
   * Desde este momento el pedido aparece en cocina.
   */
  function confirmarPago(pedido, { referencia, cajero = CAJERO_VIRTUAL }) {
    const ahora = new Date().toISOString();

    pedido.pago = { ...pedido.pago, estado: "CONFIRMADO", referencia, confirmadoEn: ahora };
    pedido.venta = { numero: siguiente("venta"), caja: CAJA_WEB, cajero, fecha: ahora, total: pedido.total, anulada: false };

    // En Chile la boleta informa el IVA incluido en el total.
    const neto = Math.round(pedido.total / 1.19);
    pedido.boleta = {
      numero: siguiente("boleta"),
      fecha: ahora,
      neto,
      iva: pedido.total - neto,
      total: pedido.total,
      enviadaA: pedido.cliente.email,
    };

    registrar(pedido, "PAGADO", cajero, `Venta N° ${pedido.venta.numero}, boleta N° ${pedido.boleta.numero}`);
  }

  /** Simula la respuesta de la plataforma externa cuando el cliente paga. */
  function pagarEnLinea(id, sesion) {
    const lista = leerPedidos();
    const pedido = buscar(lista, id);

    if (pedido.clienteId !== sesion.id) throw error("Ese pedido no es tuyo.", "PROHIBIDO");
    if (pedido.estado !== "PENDIENTE_PAGO") throw error("Este pedido ya no espera pago.");

    confirmarPago(pedido, { referencia: `SVP-${Date.now().toString().slice(-8)}` });
    guardarPedidos(lista);
    return pedido;
  }

  // -------------------------------------------------------------------------
  // Anulación
  // -------------------------------------------------------------------------

  function anular(id, sesion, motivo) {
    const texto = String(motivo ?? "").trim();
    if (texto.length < 5) throw error("Indica el motivo de la anulación (al menos 5 caracteres).");

    const lista = leerPedidos();
    const pedido = buscar(lista, id);

    if (sesion.tipo === "CLIENTE" && pedido.clienteId !== sesion.id) throw error("Ese pedido no es tuyo.", "PROHIBIDO");
    if (sesion.tipo === "USUARIO" && sesion.perfil !== "ADMIN") throw error("Solo el administrador puede anular pedidos.", "PROHIBIDO");
    if (!ANULABLES.includes(pedido.estado)) throw error("Cocina ya aceptó el pedido: no se puede anular.");

    const pagado = pedido.estado === "PAGADO";
    if (pagado) {
      pedido.venta.anulada = true;
      pedido.pago.estado = "DEVUELTO";
    }

    pedido.anulacion = { motivo: texto, fecha: new Date().toISOString(), por: nombreActor(sesion), devolucion: pagado };
    registrar(pedido, "ANULADO", nombreActor(sesion), texto);
    guardarPedidos(lista);
    return pedido;
  }

  const esAnulable = (pedido) => ANULABLES.includes(pedido.estado);

  // -------------------------------------------------------------------------
  // 4. Cocina
  // -------------------------------------------------------------------------

  /** Solo estos perfiles pueden ejecutar cada paso; el administrador, todos. */
  function exigirPerfil(sesion, perfiles) {
    if (sesion?.tipo !== "USUARIO" || !["ADMIN", ...perfiles].includes(sesion.perfil)) {
      throw error("Tu perfil no puede hacer este paso.", "PROHIBIDO");
    }
  }

  function cambiarEstado(id, sesion, { desde, hacia, perfiles, nota = "", preparar }) {
    exigirPerfil(sesion, perfiles);

    const lista = leerPedidos();
    const pedido = buscar(lista, id);
    if (!desde.includes(pedido.estado)) {
      throw error(`El pedido está "${ESTADOS[pedido.estado]}": este paso ya no corresponde.`, "ESTADO");
    }

    const destino = typeof hacia === "function" ? hacia(pedido) : hacia;
    preparar?.(pedido);
    registrar(pedido, destino, nombreActor(sesion), nota);
    guardarPedidos(lista);
    return pedido;
  }

  /** Pedidos pagados que llegaron a cocina, en el orden en que se pagaron. */
  const porFechaDePago = (a, b) => a.venta.fecha.localeCompare(b.venta.fecha);
  const colaCocina = () => leerPedidos().filter((p) => ["PAGADO", "EN_PREPARACION"].includes(p.estado)).sort(porFechaDePago);
  const porAceptar = () => leerPedidos().filter((p) => p.estado === "PAGADO");

  const aceptar = (id, sesion) =>
    cambiarEstado(id, sesion, { desde: ["PAGADO"], hacia: "EN_PREPARACION", perfiles: ["COCINA"] });

  const terminar = (id, sesion) =>
    cambiarEstado(id, sesion, {
      desde: ["EN_PREPARACION"],
      hacia: (p) => (p.modoEntrega === "DELIVERY" ? "LISTO_DESPACHO" : "LISTO_RETIRO"),
      perfiles: ["COCINA"],
      preparar: (p) => (p.listoEn = new Date().toISOString()),
    });

  // -------------------------------------------------------------------------
  // 5. Despacho y entrega
  // -------------------------------------------------------------------------

  /** Pedidos listos para salir o para retirar, en el orden en que quedaron listos. */
  const colaDespacho = () =>
    leerPedidos()
      .filter((p) => ["LISTO_DESPACHO", "EN_DESPACHO", "LISTO_RETIRO"].includes(p.estado))
      .sort((a, b) => (a.listoEn ?? a.venta.fecha).localeCompare(b.listoEn ?? b.venta.fecha));

  function despachar(id, sesion, chofer) {
    if (!CHOFERES.includes(chofer)) throw error("Elige el chofer que lleva el pedido.");
    return cambiarEstado(id, sesion, {
      desde: ["LISTO_DESPACHO"],
      hacia: "EN_DESPACHO",
      perfiles: ["DESPACHO"],
      nota: `Chofer: ${chofer}`,
      preparar: (p) => (p.chofer = chofer),
    });
  }

  const entregar = (id, sesion) =>
    cambiarEstado(id, sesion, { desde: ["EN_DESPACHO", "LISTO_RETIRO"], hacia: "ENTREGADO", perfiles: ["DESPACHO"] });

  function marcarImpresa(id) {
    const lista = leerPedidos();
    const pedido = buscar(lista, id);
    pedido.ordenImpresa = new Date().toISOString();
    guardarPedidos(lista);
  }

  // -------------------------------------------------------------------------
  // Consultas y reporte
  // -------------------------------------------------------------------------

  const obtener = (id) => leerPedidos().find((p) => p.id === id) ?? null;
  const delCliente = (clienteId) => leerPedidos().filter((p) => p.clienteId === clienteId).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  const todos = () => leerPedidos().sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  const porBoleta = (numero) => leerPedidos().find((p) => p.boleta?.numero === Number(numero)) ?? null;

  /** Fecha local "AAAA-MM-DD" de una marca ISO. */
  const diaLocal = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  /**
   * Ventas del período, por fecha de venta. Las anuladas se informan aparte
   * y no suman al total.
   */
  function reporte(desde, hasta) {
    const ventas = leerPedidos().filter((p) => p.venta && diaLocal(p.venta.fecha) >= desde && diaLocal(p.venta.fecha) <= hasta);
    const validas = ventas.filter((p) => !p.venta.anulada);
    const anuladas = ventas.filter((p) => p.venta.anulada);

    const monto = validas.reduce((suma, p) => suma + p.total, 0);

    const porDia = new Map();
    for (let d = new Date(`${desde}T12:00:00`); diaLocal(d.toISOString()) <= hasta; d.setDate(d.getDate() + 1)) {
      porDia.set(diaLocal(d.toISOString()), { cantidad: 0, monto: 0 });
    }
    validas.forEach((p) => {
      const dia = porDia.get(diaLocal(p.venta.fecha));
      if (dia) {
        dia.cantidad += 1;
        dia.monto += p.total;
      }
    });

    const porEntrega = [
      ["DELIVERY", "Despacho a domicilio"],
      ["RETIRO", "Retiro en local"],
    ].map(([modo, nombre]) => ({
      modo,
      nombre,
      cantidad: validas.filter((p) => p.modoEntrega === modo).length,
      monto: validas.filter((p) => p.modoEntrega === modo).reduce((s, p) => s + p.total, 0),
    }));

    // Lo más vendido, agrupando por el primer tramo de la descripción.
    const productos = new Map();
    validas.forEach((p) =>
      p.lineas.forEach((l) => {
        const nombre = l.descripcion.split(":")[0];
        const actual = productos.get(nombre) ?? { nombre, cantidad: 0, monto: 0 };
        actual.cantidad += l.cantidad;
        actual.monto += l.subtotal;
        productos.set(nombre, actual);
      }),
    );

    return {
      ventas: ventas.sort((a, b) => a.venta.fecha.localeCompare(b.venta.fecha)),
      cantidad: validas.length,
      monto,
      promedio: validas.length ? Math.round(monto / validas.length) : 0,
      anuladas: anuladas.length,
      montoAnulado: anuladas.reduce((s, p) => s + p.total, 0),
      porDia: [...porDia.entries()].map(([dia, datos]) => ({ dia, ...datos })),
      porEntrega,
      masVendidos: [...productos.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 6),
    };
  }

  return {
    ESTADOS,
    MEDIOS_PAGO,
    CAJERO_VIRTUAL,
    EMPRESA,
    CHOFERES,
    CAJA_WEB,
    crear,
    pagarEnLinea,
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
    diaLocal,
    // Uso interno de los datos de ejemplo.
    _guardarTodos: guardarPedidos,
    _siguiente: siguiente,
  };
})();
