/**
 * Recorre los casos de la entrega contra el gateway:
 *
 *   npm run demo -- <clave de vendedor> <clave de admin>
 *
 * Las claves son las que mostró "npm run usuarios-ejemplo" en el Auth Service.
 * Para ver un 502, apaga Vault o el Auth Service y vuelve a correrlo.
 */

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const GATEWAY = process.env.URL_GATEWAY ?? `http://localhost:${process.env.PORT ?? 3000}`;
const BACKEND = (process.env.URL_BACKEND ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const [claveVendedor, claveAdmin] = process.argv.slice(2);

if (!claveVendedor || !claveAdmin) {
  console.error("Uso: npm run demo -- <clave de vendedor> <clave de admin>");
  process.exit(1);
}

/** Navegador mínimo: guarda la cookie que recibe y la manda en las siguientes. */
function navegador() {
  let cookie = null;
  return {
    async pedir(metodo, ruta, cuerpo) {
      const respuesta = await fetch(`${GATEWAY}${ruta}`, {
        method: metodo,
        headers: { ...(cuerpo ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      const recibida = respuesta.headers.getSetCookie?.().find((c) => c.startsWith("pf_sesion="));
      if (recibida) cookie = recibida.split(";")[0].endsWith("=") ? null : recibida.split(";")[0];
      const datos = respuesta.status === 204 ? null : await respuesta.json().catch(() => null);
      return { estado: respuesta.status, datos, recibida };
    },
    cookie: () => cookie,
    usarCookie: (valor) => (cookie = valor),
  };
}

let fallas = 0;
function mostrar(nombre, esperado, { estado, datos }, extra = "") {
  const ok = estado === esperado;
  if (!ok) fallas += 1;
  const detalle = datos?.mensaje ?? datos?.detail ?? (Array.isArray(datos) ? `${datos.length} productos` : datos?.usuario ? `sesión de ${datos.usuario.usuario ?? datos.usuario} (${datos.usuario.rol ?? datos.rol})` : "");
  console.log(`[${ok ? "OK" : "!!"}] ${String(estado).padEnd(3)} ${nombre.padEnd(44)} ${extra || detalle}`);
}

try {
  const vendedor = navegador();
  const admin = navegador();

  mostrar("Productos sin iniciar sesión", 401, await vendedor.pedir("GET", "/api/v1/productos"));
  mostrar("Login con contraseña incorrecta", 401, await vendedor.pedir("POST", "/api/auth/login", { usuario: "vendedor", clave: "no-es-la-clave1" }));

  const login = await vendedor.pedir("POST", "/api/auth/login", { usuario: "vendedor", clave: claveVendedor });
  const atributos = login.recibida?.split(";").slice(1).map((a) => a.trim().split("=")[0]).join(", ");
  mostrar("Login de vendedor (rol usuario)", 200, login, `cookie con ${atributos}; el token no viene en el cuerpo: ${!("token" in (login.datos ?? {}))}`);

  mostrar("Vendedor lista productos", 200, await vendedor.pedir("GET", "/api/v1/productos?categoria=SALSA"));

  const nuevo = await vendedor.pedir("POST", "/api/v1/productos", { nombre: `Salsa demo ${Date.now()}`, descripcion: "Creada por la demo", categoria: "SALSA", precio: 0 });
  mostrar("Vendedor crea un producto", 201, nuevo);
  const id = nuevo.datos?.id;

  mostrar("Vendedor intenta borrarlo", 403, await vendedor.pedir("DELETE", `/api/v1/productos/${id}`));

  mostrar("Login de admin", 200, await admin.pedir("POST", "/api/auth/login", { usuario: "admin", clave: claveAdmin }));
  mostrar("Admin lo borra", 204, await admin.pedir("DELETE", `/api/v1/productos/${id}`), "producto eliminado");

  const cookieVieja = admin.cookie();
  mostrar("Admin cierra sesión", 204, await admin.pedir("POST", "/api/auth/logout"), "sesión revocada en el Auth Service");
  admin.usarCookie(cookieVieja);
  mostrar("Reusar la cookie después del logout", 401, await admin.pedir("GET", "/api/v1/productos"));

  const directo = await fetch(`${BACKEND}/items`);
  mostrar("Directo al backend, sin pasar por el gateway", 403, { estado: directo.status, datos: await directo.json().catch(() => null) });

  console.log(fallas ? `\n${fallas} caso(s) no respondieron lo esperado.` : "\nTodos los casos respondieron lo esperado.");
} catch (error) {
  console.error(`Sin conexión con el gateway en ${GATEWAY}. ¿Están corriendo Vault, el Auth Service, el backend y el gateway?`);
  process.exit(1);
}
