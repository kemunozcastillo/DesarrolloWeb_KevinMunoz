/**
 * Muestra los códigos que pide la entrega, uno por uno:
 *
 *   npm run demo -- <token del cliente>
 *
 * Con Vault y el backend arriba se esperan 401, 401, 200, 403 y 403. Para
 * ver el 502, apaga Vault (o el backend) y vuelve a correrlo: la petición
 * con el token correcto pasa a responder 502.
 */

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const GATEWAY = process.env.URL_GATEWAY ?? `http://localhost:${process.env.PORT ?? 3000}`;
const BACKEND = (process.env.URL_BACKEND ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const TOKEN = process.argv[2] ?? process.env.TOKEN_CLIENTE;

if (!TOKEN) {
  console.error("Indica el token del cliente: npm run demo -- <token>");
  process.exit(1);
}

const casos = [
  ["Sin token", `${GATEWAY}/api/v1/productos`, {}, 401],
  ["Token incorrecto", `${GATEWAY}/api/v1/productos`, { Authorization: "Bearer esto-no-es-el-token" }, 401],
  ["Token correcto", `${GATEWAY}/api/v1/productos?categoria=SALSA`, { Authorization: `Bearer ${TOKEN}` }, 200],
  ["Directo al backend, sin credencial", `${BACKEND}/items`, {}, 403],
  ["Directo al backend, credencial inventada", `${BACKEND}/items`, { "X-Credencial-Interna": "adivinando" }, 403],
];

for (const [nombre, url, cabeceras, esperado] of casos) {
  try {
    const respuesta = await fetch(url, { headers: cabeceras });
    const cuerpo = await respuesta.json().catch(() => ({}));
    const resumen = cuerpo.mensaje ?? cuerpo.detail ?? (Array.isArray(cuerpo) ? `${cuerpo.length} productos` : "");
    const marca = respuesta.status === esperado ? "OK" : "!!";
    console.log(`[${marca}] ${respuesta.status} ${nombre.padEnd(42)} ${typeof resumen === "string" ? resumen : ""}`);
  } catch {
    console.log(`[--] --- ${nombre.padEnd(42)} sin conexión con ${new URL(url).host}`);
  }
}
