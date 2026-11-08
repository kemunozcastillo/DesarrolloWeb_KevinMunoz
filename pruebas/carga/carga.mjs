/**
 * Prueba de carga reproducible, sin dependencias (Node 20+).
 *
 *   node pruebas/carga/carga.mjs [--sitio http://localhost:8080] [--segundos 20] [--concurrencia 20]
 *
 * Escenarios (cada uno corre por separado):
 *   catalogo   GET /api/v1/catalogo/items, anónimo (la ruta más usada de la tienda)
 *   resumen    POST /api/v1/graphql resumenPedido, con sesión de cliente
 *              (agregación: pedidos + pagos + inventario)
 *   pedidos    GET /api/v1/pedidos?cola=cocina con sesión de cocina (pantalla que consulta cada 8 s)
 *
 * Mide latencia p50, p95 y p99, peticiones por segundo y errores. Antes de
 * correrla hay que subir el límite por IP del gateway (LIMITE_POR_MINUTO),
 * porque todas las peticiones salen de la misma IP.
 */

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith("--") ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const SITIO = args.sitio ?? "http://localhost:8080";
const SEGUNDOS = Number(args.segundos ?? 20);
const CONCURRENCIA = Number(args.concurrencia ?? 20);

async function login(email, clave) {
  const r = await fetch(`${SITIO}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: SITIO }, body: JSON.stringify({ email, clave }) });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return r.headers.get("set-cookie").split(";")[0];
}

const percentil = (ordenadas, p) => ordenadas[Math.min(ordenadas.length - 1, Math.floor((p / 100) * ordenadas.length))];

async function escenario(nombre, hacer) {
  const latencias = [];
  let errores = 0;
  const fin = Date.now() + SEGUNDOS * 1000;
  const inicio = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCIA }, async () => {
      while (Date.now() < fin) {
        const t = performance.now();
        try {
          const r = await hacer();
          await r.arrayBuffer();
          if (!r.ok) errores += 1;
        } catch {
          errores += 1;
        }
        latencias.push(performance.now() - t);
      }
    }),
  );
  const duracion = (performance.now() - inicio) / 1000;
  latencias.sort((a, b) => a - b);
  const r = (x) => Math.round(x * 10) / 10;
  return { escenario: nombre, peticiones: latencias.length, porSegundo: r(latencias.length / duracion), p50ms: r(percentil(latencias, 50)), p95ms: r(percentil(latencias, 95)), p99ms: r(percentil(latencias, 99)), errores, tasaError: `${r((errores / latencias.length) * 100)}%` };
}

const cliente = await login("cliente@correo.cl", "Cliente2026");
const cocina = await login("cocina@pokefresh.cl", "Cocina2026");
const pedidos = await (await fetch(`${SITIO}/api/v1/pedidos`, { headers: { Cookie: cliente } })).json();
const pedidoId = pedidos[0]?.id;
const consulta = JSON.stringify({ query: "query($id: ID!){ resumenPedido(id: $id) { pedido { id estado total lineas { descripcion productos { nombre categoria } } } pagos { estado monto } } }", variables: { id: pedidoId } });

console.log(`Carga: ${CONCURRENCIA} conexiones concurrentes, ${SEGUNDOS} s por escenario, contra ${SITIO}\n`);
const resultados = [];
resultados.push(await escenario("catalogo", () => fetch(`${SITIO}/api/v1/catalogo/items`)));
resultados.push(await escenario("resumen (GraphQL)", () => fetch(`${SITIO}/api/v1/graphql`, { method: "POST", headers: { Cookie: cliente, "Content-Type": "application/json", Origin: SITIO }, body: consulta })));
resultados.push(await escenario("cola de cocina", () => fetch(`${SITIO}/api/v1/pedidos?cola=cocina`, { headers: { Cookie: cocina } })));
console.table(resultados);
console.log(JSON.stringify({ fecha: new Date().toISOString(), sitio: SITIO, concurrencia: CONCURRENCIA, segundos: SEGUNDOS, resultados }));
