import { GraphQLError } from "graphql";

/**
 * Regla de validación que rechaza consultas demasiado anidadas.
 *
 * En GraphQL el cliente decide la forma de la consulta, así que sin un límite
 * cualquiera puede pedir una anidación enorme y tumbar el servidor.
 */
export const limiteProfundidad = (maximo) => (context) => ({
  OperationDefinition(nodo) {
    const profundidad = medir(nodo.selectionSet, context, new Set());

    if (profundidad > maximo) {
      context.reportError(
        new GraphQLError(
          `La consulta tiene profundidad ${profundidad} y el máximo permitido es ${maximo}.`,
          { nodes: [nodo], extensions: { code: "CONSULTA_MUY_PROFUNDA" } },
        ),
      );
    }
  },
});

function medir(selectionSet, context, fragmentosVistos) {
  if (!selectionSet) return 0;

  let maxima = 0;

  for (const seleccion of selectionSet.selections) {
    if (seleccion.kind === "Field") {
      maxima = Math.max(maxima, 1 + medir(seleccion.selectionSet, context, fragmentosVistos));
    } else if (seleccion.kind === "InlineFragment") {
      maxima = Math.max(maxima, medir(seleccion.selectionSet, context, fragmentosVistos));
    } else if (seleccion.kind === "FragmentSpread") {
      const nombre = seleccion.name.value;
      if (fragmentosVistos.has(nombre)) continue;

      const fragmento = context.getFragment(nombre);
      if (!fragmento) continue;

      maxima = Math.max(
        maxima,
        medir(fragmento.selectionSet, context, new Set([...fragmentosVistos, nombre])),
      );
    }
  }

  return maxima;
}
