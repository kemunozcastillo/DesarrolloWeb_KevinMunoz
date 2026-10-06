import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const ROLES = ["admin", "usuario"];

/**
 * Usuarios guardados en un archivo JSON. Cada uno tiene usuario, nombre, rol
 * y el hash de su contraseña; la contraseña en sí nunca se guarda.
 *
 * El archivo está en el .gitignore: se crea con el script de usuarios.
 *
 * Se vuelve a leer cada vez que cambia. Así, si se desactiva a alguien o se
 * le cambia el rol (con el script), la introspección lo nota en la petición
 * siguiente, sin reiniciar el servicio.
 */
export function crearRepositorioUsuarios(archivo) {
  let usuarios = null;
  let modificado = null;

  async function cargar() {
    let marca;
    try {
      marca = (await stat(archivo)).mtimeMs;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      usuarios ??= [];
      return usuarios;
    }

    if (!usuarios || marca !== modificado) {
      usuarios = JSON.parse(await readFile(archivo, "utf8"));
      modificado = marca;
    }
    return usuarios;
  }

  async function guardar() {
    await mkdir(dirname(archivo), { recursive: true });
    // Se escribe a un archivo temporal y se renombra: si el proceso se corta
    // a mitad de camino, el archivo original queda intacto.
    const temporal = `${archivo}.tmp`;
    await writeFile(temporal, JSON.stringify(usuarios, null, 2));
    await rename(temporal, archivo);
    modificado = (await stat(archivo)).mtimeMs;
  }

  const normalizar = (usuario) => String(usuario ?? "").trim().toLowerCase();

  return {
    async buscar(usuario) {
      return (await cargar()).find((u) => u.usuario === normalizar(usuario)) ?? null;
    },

    async obtener(id) {
      return (await cargar()).find((u) => u.id === id) ?? null;
    },

    async crear({ usuario, nombre, rol, hash }) {
      const lista = await cargar();
      const nombreUsuario = normalizar(usuario);

      if (!/^[a-z0-9._-]{3,30}$/.test(nombreUsuario)) throw new Error("El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo.");
      if (!ROLES.includes(rol)) throw new Error(`El rol debe ser uno de: ${ROLES.join(", ")}.`);

      const existente = lista.find((u) => u.usuario === nombreUsuario);
      const datos = { usuario: nombreUsuario, nombre: String(nombre ?? nombreUsuario).trim(), rol, hash, activo: true };

      if (existente) Object.assign(existente, datos);
      else lista.push({ id: randomUUID(), ...datos, creadoEn: new Date().toISOString() });

      await guardar();
      return { creado: !existente };
    },
  };
}
