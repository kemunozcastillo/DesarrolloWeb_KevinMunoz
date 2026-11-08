/**
 * Límite de peticiones por IP en una ventana de un minuto. Frena el abuso
 * (fuerza bruta de contraseñas, registros masivos, scraping) antes de que
 * llegue a los servicios. En memoria: suficiente para un solo gateway.
 */
export function limitarPorMinuto(maximo, { reloj = Date.now, clave = (req) => req.ip } = {}) {
  const ventanas = new Map();

  return (req, res, next) => {
    const ahora = reloj();
    const id = clave(req);
    let v = ventanas.get(id);
    if (!v || ahora >= v.reinicio) {
      v = { cuenta: 0, reinicio: ahora + 60_000 };
      ventanas.set(id, v);
    }
    v.cuenta += 1;
    if (ventanas.size > 10_000) for (const [k, x] of ventanas) if (ahora >= x.reinicio) ventanas.delete(k);

    if (v.cuenta > maximo) {
      res.set("Retry-After", String(Math.ceil((v.reinicio - ahora) / 1000)));
      return res.status(429).json({ codigo: "DEMASIADAS_PETICIONES", mensaje: "Hiciste demasiadas peticiones seguidas. Espera un momento.", idPeticion: res.get("X-Request-Id") });
    }
    next();
  };
}
