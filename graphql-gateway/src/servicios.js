/**
 * Llamadas del GraphQL Gateway a los microservicios.
 *
 * El GraphQL Gateway no tiene base de datos ni reglas de negocio: compone lo
 * que responden los servicios. Cada llamada lleva la credencial interna del
 * servicio de destino y la identidad del usuario, para que cada servicio
 * aplique SUS reglas (pedidos decide si el pedido es tuyo; clientes decide si
 * puedes ver una ficha). Nunca lee las bases de otros servicios.
 *
 * Una falla de un servicio se convierte en ErrorServicio: el resolver que la
 * reciba devuelve null en ese campo y el error queda en `errors` (respuesta
 * parcial), sin tumbar la consulta completa.
 */

export class ErrorServicio extends Error {
  constructor(servicio, estado, codigo, mensaje) {
    super(mensaje);
    this.servicio = servicio;
    this.estado = estado;
    this.codigo = codigo;
  }
}

export function crearClienteServicios(config, vault) {
  return async function llamar(servicio, ruta, { identidad, params, idPeticion } = {}) {
    const credencial = await vault.leerValor(`${config.rutaInternos}/${servicio}`, "credencial");
    const consulta = params ? `?${new URLSearchParams(params)}` : "";
    const cabeceras = { "X-Credencial-Interna": credencial, Accept: "application/json" };
    if (idPeticion) cabeceras["X-Request-Id"] = idPeticion;
    if (identidad) {
      Object.assign(cabeceras, {
        "X-Usuario-Id": identidad.id,
        "X-Usuario-Rol": identidad.rol,
        "X-Usuario-Sujeto": identidad.sujeto,
        "X-Usuario-Nombre": encodeURIComponent(identidad.nombre ?? ""),
      });
    }

    let respuesta;
    try {
      respuesta = await fetch(`${config.urls[servicio]}${ruta}${consulta}`, { headers: cabeceras, signal: AbortSignal.timeout(config.tiempoMaximoMs) });
    } catch (error) {
      const porTiempo = error.name === "TimeoutError";
      throw new ErrorServicio(servicio, porTiempo ? 504 : 502, porTiempo ? "SERVICIO_LENTO" : "SERVICIO_NO_DISPONIBLE", `El servicio de ${servicio} ${porTiempo ? "no respondió a tiempo" : "no está disponible"}.`);
    }

    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      const codigo = respuesta.status >= 500 ? "SERVICIO_NO_DISPONIBLE" : (datos?.codigo ?? "ERROR");
      throw new ErrorServicio(servicio, respuesta.status, codigo, datos?.mensaje ?? `El servicio de ${servicio} respondió ${respuesta.status}.`);
    }
    return datos;
  };
}
