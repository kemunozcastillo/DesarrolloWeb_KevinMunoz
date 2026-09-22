/**
 * Región, provincias y comunas para el registro de clientes, y las comunas
 * con despacho.
 *
 * El local atiende solo en la Región Metropolitana. El despacho gratuito
 * llega a 3 km a la redonda del local; sin un servicio de mapas no se puede
 * medir la distancia exacta a cada dirección, así que se aproxima con las
 * comunas que quedan dentro de ese radio.
 */

PF.geografia = (function () {
  const REGIONES = [
    {
      nombre: "Región Metropolitana de Santiago",
      provincias: [
        {
          nombre: "Santiago",
          comunas: [
            "Cerrillos", "Cerro Navia", "Conchalí", "El Bosque", "Estación Central", "Huechuraba",
            "Independencia", "La Cisterna", "La Florida", "La Granja", "La Pintana", "La Reina",
            "Las Condes", "Lo Barnechea", "Lo Espejo", "Lo Prado", "Macul", "Maipú", "Ñuñoa",
            "Pedro Aguirre Cerda", "Peñalolén", "Providencia", "Pudahuel", "Quilicura",
            "Quinta Normal", "Recoleta", "Renca", "San Joaquín", "San Miguel", "San Ramón",
            "Santiago", "Vitacura",
          ],
        },
        { nombre: "Cordillera", comunas: ["Pirque", "Puente Alto", "San José de Maipo"] },
        { nombre: "Chacabuco", comunas: ["Colina", "Lampa", "Tiltil"] },
        { nombre: "Maipo", comunas: ["Buin", "Calera de Tango", "Paine", "San Bernardo"] },
        { nombre: "Melipilla", comunas: ["Alhué", "Curacaví", "María Pinto", "Melipilla", "San Pedro"] },
        { nombre: "Talagante", comunas: ["El Monte", "Isla de Maipo", "Padre Hurtado", "Peñaflor", "Talagante"] },
      ],
    },
  ];

  // Comunas a menos de 3 km del local (Providencia).
  const COMUNAS_CON_DESPACHO = ["Providencia", "Ñuñoa", "Santiago", "Recoleta", "Las Condes"];

  const regiones = () => REGIONES.map((r) => r.nombre);
  const provincias = (region) => REGIONES.find((r) => r.nombre === region)?.provincias.map((p) => p.nombre) ?? [];
  const comunas = (region, provincia) =>
    REGIONES.find((r) => r.nombre === region)?.provincias.find((p) => p.nombre === provincia)?.comunas ?? [];

  const esValida = (region, provincia, comuna) => comunas(region, provincia).includes(comuna);
  const tieneDespacho = (comuna) => COMUNAS_CON_DESPACHO.includes(comuna);

  return { regiones, provincias, comunas, esValida, tieneDespacho, COMUNAS_CON_DESPACHO };
})();
