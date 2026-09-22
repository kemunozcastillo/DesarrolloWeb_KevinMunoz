/**
 * Salud agregada: consulta el endpoint de salud de cada servicio en paralelo
 * y responde con el estado de todos. 200 si todos responden, 503 si alguno
 * falla. Sirve para un monitor externo o para revisar rápido qué está caído.
 */
export function saludAgregada(rutas) {
  return async (_req, res) => {
    const resultados = await Promise.all(
      rutas.map(async (ruta) => {
        const inicio = performance.now();
        try {
          const respuesta = await fetch(`${ruta.destino}${ruta.salud}`, { signal: AbortSignal.timeout(2_000) });
          return {
            servicio: ruta.servicio,
            estado: respuesta.ok ? "ok" : `error ${respuesta.status}`,
            ms: Math.round(performance.now() - inicio),
          };
        } catch {
          return { servicio: ruta.servicio, estado: "sin respuesta", ms: null };
        }
      }),
    );

    const todoBien = resultados.every((r) => r.estado === "ok");
    res.status(todoBien ? 200 : 503).json({ gateway: "ok", servicios: resultados });
  };
}
