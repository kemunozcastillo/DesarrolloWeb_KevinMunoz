import { GraphQLError } from "graphql";

/**
 * Límite de costo: cada campo cuesta 1 y los campos que traen listas
 * multiplican lo que tienen dentro (por su argumento `primeros`, o por un
 * tamaño estimado). Así una consulta con pocas líneas pero listas anidadas
 * grandes también se rechaza antes de ejecutarse.
 */
const LISTAS = { lineas: 10, productos: 5, pagos: 3, nodos: null, porCategoria: 6, pedidosConDiferencia: 1 };

export const limiteCosto = (maximo) => (context) => ({
  OperationDefinition(nodo) {
    const costo = medir(nodo.selectionSet, context, 1);
    if (costo > maximo) {
      context.reportError(new GraphQLError(`La consulta cuesta ${costo} y el máximo permitido es ${maximo}.`, { nodes: [nodo], extensions: { code: "CONSULTA_MUY_COSTOSA" } }));
    }
  },
});

function multiplicador(campo) {
  const nombre = campo.name.value;
  if (!(nombre in LISTAS)) return 1;
  if (LISTAS[nombre] !== null) return LISTAS[nombre];
  // nodos: depende de "primeros" en el campo padre; se asume el máximo.
  return 50;
}

function medir(selectionSet, context, factor) {
  if (!selectionSet) return 0;
  let total = 0;
  for (const s of selectionSet.selections) {
    if (s.kind === "Field") {
      const m = multiplicador(s);
      total += factor + medir(s.selectionSet, context, factor * m);
    } else if (s.kind === "InlineFragment") {
      total += medir(s.selectionSet, context, factor);
    } else if (s.kind === "FragmentSpread") {
      const f = context.getFragment(s.name.value);
      if (f) total += medir(f.selectionSet, context, factor);
    }
  }
  return total;
}
