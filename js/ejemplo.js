/**
 * Datos de ejemplo que se cargan la primera vez que se abre el sitio:
 * un usuario por perfil, algunos clientes y un mes de ventas, para que cada
 * pantalla (caja, despacho, reportes) tenga algo que mostrar desde el inicio.
 *
 * Las credenciales de prueba se muestran en la pantalla de ingreso.
 */

PF.ejemplo = (function () {
  const { guardar, borrar, leer } = PF.datos;

  const USUARIOS = [
    { nombre: "Camila Rojas", email: "admin@pokefresh.cl", clave: "Admin2026", perfil: "ADMIN" },
    { nombre: "Tomás Fuentes", email: "dueno@pokefresh.cl", clave: "Dueno2026", perfil: "DUENO" },
    { nombre: "Francisca Lagos", email: "cocina@pokefresh.cl", clave: "Cocina2026", perfil: "COCINA" },
    { nombre: "Matías Pérez", email: "despacho@pokefresh.cl", clave: "Despacho2026", perfil: "DESPACHO" },
  ];

  const CLIENTE_DEMO = { email: "cliente@correo.cl", clave: "Cliente2026" };

  const CLIENTES = [
    { cuerpo: "16459723", nombre: "Javiera Morales Díaz", direccion: "Av. Providencia 2133, depto 504", comuna: "Providencia", nacimiento: "1994-05-12", sexo: "F", email: CLIENTE_DEMO.email, telefono: "+56 9 8123 4567" },
    { cuerpo: "18234567", nombre: "Benjamín Castro Vera", direccion: "Irarrázaval 3450", comuna: "Ñuñoa", nacimiento: "1998-11-02", sexo: "M", email: "benjamin.castro@correo.cl", telefono: "+56 9 7654 3210" },
    { cuerpo: "15987321", nombre: "Fernanda Silva Rojas", direccion: "San Diego 1020", comuna: "Santiago", nacimiento: "1989-02-27", sexo: "F", email: "fernanda.silva@correo.cl", telefono: "+56 9 6543 2109" },
    { cuerpo: "19876543", nombre: "Diego Araya Pinto", direccion: "Av. Recoleta 850", comuna: "Recoleta", nacimiento: "2001-07-19", sexo: "M", email: "diego.araya@correo.cl", telefono: "+56 9 5432 1098" },
    { cuerpo: "17345678", nombre: "Catalina Núñez León", direccion: "Av. Apoquindo 4500", comuna: "Las Condes", nacimiento: "1992-09-08", sexo: "F", email: "catalina.nunez@correo.cl", telefono: "+56 9 4321 0987" },
    { cuerpo: "14567890", nombre: "Ignacio Herrera Mora", direccion: "Av. Pajaritos 3200", comuna: "Maipú", nacimiento: "1985-12-15", sexo: "M", email: "ignacio.herrera@correo.cl", telefono: "+56 9 3210 9876" },
  ];

  /** Calcula el dígito verificador para armar RUN válidos. */
  function digitoVerificador(cuerpo) {
    let suma = 0;
    let factor = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
      suma += Number(cuerpo[i]) * factor;
      factor = factor === 7 ? 2 : factor + 1;
    }
    const resto = 11 - (suma % 11);
    return resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  }

  /** Generador pseudoaleatorio con semilla: los datos salen iguales en cada carga. */
  function aleatorio(semilla) {
    let estado = semilla;
    return () => {
      estado = (estado * 1664525 + 1013904223) % 2 ** 32;
      return estado / 2 ** 32;
    };
  }

  const PROVINCIA_DE = (comuna) => PF.geografia.provincias("Región Metropolitana de Santiago").find((p) => PF.geografia.comunas("Región Metropolitana de Santiago", p).includes(comuna));

  async function crearCuentas() {
    const usuarios = [];
    for (const u of USUARIOS) {
      const sal = PF.cuentas.nuevaSal();
      usuarios.push({ id: `usr_${u.perfil.toLowerCase()}`, nombre: u.nombre, email: u.email, perfil: u.perfil, sal, hash: await PF.cuentas.hashClave(u.clave, sal), activo: true, creadoEn: new Date().toISOString() });
    }
    guardar("usuarios", usuarios);

    const clientes = [];
    for (const [i, c] of CLIENTES.entries()) {
      const sal = PF.cuentas.nuevaSal();
      const clave = i === 0 ? CLIENTE_DEMO.clave : "Clave2026";
      clientes.push({
        id: `cli_${i + 1}`,
        run: `${c.cuerpo}-${digitoVerificador(c.cuerpo)}`,
        nombre: c.nombre,
        direccion: c.direccion,
        region: "Región Metropolitana de Santiago",
        provincia: PROVINCIA_DE(c.comuna),
        comuna: c.comuna,
        fechaNacimiento: c.nacimiento,
        sexo: c.sexo,
        email: c.email,
        telefono: c.telefono,
        sal,
        hash: await PF.cuentas.hashClave(clave, sal),
        emailVerificado: true,
        activo: true,
        origen: i % 3 === 2 ? "ADMIN" : "WEB",
        creadoEn: new Date(Date.now() - 40 * 864e5).toISOString(),
      });
    }
    guardar("clientes", clientes);
    return clientes;
  }

  /** Un pedido armado con el catálogo real, para que precios y descripciones cuadren. */
  function lineaAleatoria(azar) {
    const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
    const ids = (categoria) => PF.datos.catalogo.listar({ categoria }).filter((i) => i.disponible).map((i) => i.id);
    const tipo = azar();

    if (tipo < 0.62) {
      const entrada = {
        tamanoId: azar() < 0.7 ? "regular" : "grande",
        baseIds: [elegir(ids("BASE"))],
        proteinaIds: [elegir(ids("PROTEINA"))],
        salsaIds: [elegir(ids("SALSA"))],
        toppingIds: [elegir(ids("TOPPING")), elegir(ids("TOPPING"))].filter((v, i, a) => a.indexOf(v) === i),
      };
      const bowl = PF.tienda.cotizarBowl(entrada);
      return { descripcion: PF.tienda.describirBowl(bowl), cantidad: 1, precioUnitario: bowl.precio };
    }

    if (tipo < 0.85) {
      const bebida = PF.datos.catalogo.obtener(elegir(ids("BEBIDA")));
      return { descripcion: bebida.nombre, cantidad: 1 + Math.floor(azar() * 2), precioUnitario: bebida.precio };
    }

    const bowl = { baseIds: [elegir(ids("BASE"))], proteinaIds: [elegir(ids("PROTEINA"))], salsaIds: [elegir(ids("SALSA"))], toppingIds: [] };
    const promo = PF.tienda.cotizarPromo("promo_combo", { bowls: [bowl], bebidaId: elegir(ids("BEBIDA")) });
    return { descripcion: `${promo.item.nombre}: ${PF.tienda.describirPromo(promo)}`, cantidad: 1, precioUnitario: promo.precio };
  }

  function crearPedidos(clientes) {
    const azar = aleatorio(24);
    const pedidos = [];
    const hoy = new Date();

    // Un mes de historia: entre 1 y 4 pedidos por día.
    const fechas = [];
    for (let dias = 30; dias >= 0; dias--) {
      const cantidad = dias === 0 ? 7 : 1 + Math.floor(azar() * 4);
      for (let n = 0; n < cantidad; n++) {
        const fecha = new Date(hoy);
        fecha.setDate(hoy.getDate() - dias);
        // Hoy, los pedidos quedan antes de la hora actual.
        const horaMaxima = dias === 0 ? Math.max(12, hoy.getHours()) : 21;
        fecha.setHours(12 + Math.floor(azar() * (horaMaxima - 11)), Math.floor(azar() * 60), 0, 0);
        if (fecha > hoy) fecha.setTime(hoy.getTime() - (8 - n) * 9 * 60000);
        fechas.push(fecha);
      }
    }
    fechas.sort((a, b) => a - b);

    // Estado de los pedidos de hoy, del más antiguo al más reciente, para que
    // cocina y despacho tengan trabajo apenas se abre el sitio.
    const estadosHoy = ["ENTREGADO", "ENTREGADO", "EN_DESPACHO", "LISTO", "EN_PREPARACION", "PAGADO", "PAGADO"];
    let indiceHoy = 0;

    for (const fecha of fechas) {
      const esHoy = PF.pedidos.diaLocal(fecha.toISOString()) === PF.pedidos.diaLocal(hoy.toISOString());
      const cliente = clientes[Math.floor(azar() * clientes.length)];
      const conDespacho = PF.geografia.tieneDespacho(cliente.comuna) && azar() < 0.65;

      const lineas = Array.from({ length: 1 + Math.floor(azar() * 2) }, () => lineaAleatoria(azar)).map((l) => ({ ...l, subtotal: l.precioUnitario * l.cantidad }));
      const total = lineas.reduce((s, l) => s + l.subtotal, 0);
      const medio = "SERVIPAG";
      const minutos = (m) => new Date(fecha.getTime() + m * 60000).toISOString();

      let estadoFinal = esHoy ? estadosHoy[indiceHoy++ % estadosHoy.length] : "ENTREGADO";
      if (!esHoy && azar() < 0.06) estadoFinal = azar() < 0.5 ? "ANULADO_PAGADO" : "ANULADO_PENDIENTE";

      const pedido = {
        id: `PF-${String(PF.pedidos._siguiente("pedido")).padStart(5, "0")}`,
        clienteId: cliente.id,
        cliente: { nombre: cliente.nombre, run: cliente.run, email: cliente.email, telefono: cliente.telefono },
        modoEntrega: conDespacho ? "DELIVERY" : "RETIRO",
        direccion: conDespacho ? `${cliente.direccion}, ${cliente.comuna}` : null,
        nota: "",
        lineas,
        total,
        despacho: 0,
        pago: { medio, estado: "PENDIENTE" },
        venta: null,
        boleta: null,
        creadoEn: fecha.toISOString(),
        historial: [{ estado: "PENDIENTE_PAGO", fecha: fecha.toISOString(), actor: "Cliente", nota: "" }],
        estado: "PENDIENTE_PAGO",
      };

      const pagar = () => {
        const cuando = minutos(1);
        const cajero = PF.pedidos.CAJERO_VIRTUAL;
        const neto = Math.round(total / 1.19);
        pedido.pago = { medio, estado: "CONFIRMADO", referencia: `SVP-${fecha.getTime().toString().slice(-8)}`, confirmadoEn: cuando };
        pedido.venta = { numero: PF.pedidos._siguiente("venta"), caja: PF.pedidos.CAJA_WEB, cajero, fecha: cuando, total, anulada: false };
        pedido.boleta = { numero: PF.pedidos._siguiente("boleta"), fecha: cuando, neto, iva: total - neto, total, enviadaA: cliente.email };
        pedido.estado = "PAGADO";
        pedido.historial.push({ estado: "PAGADO", fecha: cuando, actor: cajero, nota: `Venta N° ${pedido.venta.numero}, boleta N° ${pedido.boleta.numero}` });
      };

      const COCINA = "Francisca Lagos (Cocina)";
      const DESPACHO = "Matías Pérez (Encargado de despacho)";
      const pasar = (estado, m, actor, nota = "") => {
        pedido.estado = estado;
        pedido.historial.push({ estado, fecha: minutos(m), actor, nota });
      };

      if (estadoFinal === "ANULADO_PENDIENTE") {
        pedido.estado = "ANULADO";
        pedido.anulacion = { motivo: "Me equivoqué de dirección", fecha: minutos(10), por: "Cliente", devolucion: false };
        pedido.historial.push({ estado: "ANULADO", fecha: minutos(10), actor: "Cliente", nota: "Me equivoqué de dirección" });
      } else {
        pagar();

        if (estadoFinal === "ANULADO_PAGADO") {
          pedido.venta.anulada = true;
          pedido.pago.estado = "DEVUELTO";
          pedido.estado = "ANULADO";
          pedido.anulacion = { motivo: "El cliente ya no podrá recibir el pedido", fecha: minutos(8), por: "Camila Rojas (Administrador)", devolucion: true };
          pedido.historial.push({ estado: "ANULADO", fecha: minutos(8), actor: "Camila Rojas (Administrador)", nota: pedido.anulacion.motivo });
        } else if (estadoFinal !== "PAGADO") {
          pasar("EN_PREPARACION", 3, COCINA);
          if (estadoFinal !== "EN_PREPARACION") {
            pedido.listoEn = minutos(15);
            pasar(conDespacho ? "LISTO_DESPACHO" : "LISTO_RETIRO", 15, COCINA);

            if (estadoFinal !== "LISTO") {
              if (conDespacho) {
                const chofer = PF.pedidos.CHOFERES[Math.floor(azar() * 2)];
                pedido.chofer = chofer;
                pasar("EN_DESPACHO", 18, DESPACHO, `Chofer: ${chofer}`);
              }
              if (estadoFinal === "ENTREGADO") pasar("ENTREGADO", 38, DESPACHO);
              // Un retiro "en camino" no existe: queda listo esperando al cliente.
              if (estadoFinal === "EN_DESPACHO" && !conDespacho) pedido.estado = "LISTO_RETIRO";
            }
          }
        }
      }

      pedidos.push(pedido);
    }

    PF.pedidos._guardarTodos(pedidos);
  }

  /**
   * Sube cada vez que cambia la forma de los datos guardados. Si el navegador
   * tiene datos de una versión anterior, se reemplazan por los de ejemplo en
   * vez de mezclar estructuras distintas.
   */
  const VERSION = 3;

  /** Carga los datos de ejemplo si el sitio se abre por primera vez. */
  async function inicializar() {
    if (leer("usuarios", null) && leer("version", 0) === VERSION) return;
    if (leer("usuarios", null)) {
      ["usuarios", "clientes", "pedidos", "contadores", "carrito", "sesion", "intentos"].forEach(borrar); // "sesion": restos de versiones que la guardaban aquí
    }
    const clientes = await crearCuentas();
    crearPedidos(clientes);
    guardar("version", VERSION);
  }

  /** Borra todo y vuelve a cargar los datos de ejemplo. */
  async function restaurar() {
    ["usuarios", "clientes", "pedidos", "contadores", "carrito", "intentos", "catalogo", "version"].forEach(borrar);
    PF.cuentas.salir();
    PF.datos.catalogo.restaurar();
    await inicializar();
  }

  return { USUARIOS, CLIENTE_DEMO, inicializar, restaurar };
})();
