/**
 * Configuración del gateway, leída desde variables de entorno.
 *
 * Nada de esto va escrito en el código: las URLs de los servicios cambian
 * entre el computador de desarrollo y el servidor, y los orígenes permitidos
 * dependen de dónde esté publicado el frontend.
 */

const lista = (valor) =>
  String(valor ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const entero = (valor, porDefecto) => {
  const numero = Number.parseInt(valor, 10);
  return Number.isFinite(numero) && numero > 0 ? numero : porDefecto;
};

export function leerConfig(entorno = process.env) {
  return {
    puerto: entero(entorno.PORT, 3000),

    // Servicios detrás del gateway.
    urlApiRest: entorno.URL_API_REST ?? "http://127.0.0.1:8000",
    urlApiGraphql: entorno.URL_API_GRAPHQL ?? "http://127.0.0.1:4000",

    // Orígenes del navegador que pueden llamar a la API: el frontend en
    // GitHub Pages y los servidores locales de desarrollo.
    origenesPermitidos: lista(entorno.ORIGENES_PERMITIDOS ?? "http://localhost:5500,http://127.0.0.1:5500"),

    // Tiempo máximo que se espera a un servicio antes de responder 504.
    tiempoMaximoMs: entero(entorno.TIEMPO_MAXIMO_MS, 10_000),

    // Límites por IP y por minuto.
    limiteGeneral: entero(entorno.LIMITE_GENERAL, 300),
    limiteEscritura: entero(entorno.LIMITE_ESCRITURA, 60),

    // En pruebas no se ensucia la consola con el log de acceso.
    registrarAccesos: entorno.NODE_ENV !== "test",
  };
}
