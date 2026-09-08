import DataLoader from "dataloader";
import { db } from "../data/store.js";

/**
 * Se crea un juego de loaders por cada request (nunca uno global): así la caché
 * dura lo que dura la consulta y dos clientes no comparten datos.
 *
 * Con la BD real, `itemsPorIds` pasa a ser un solo `WHERE id IN (...)` en vez
 * de una consulta por ingrediente.
 */
export const crearLoaders = () => ({
  item: new DataLoader(async (ids) => db.itemsPorIds(ids)),
});
