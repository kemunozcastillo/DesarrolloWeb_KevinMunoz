PF.vistas = PF.vistas || {};

PF.vistas.inicio = function ({ raiz }) {
  const { html, pintar, titulo, imagen } = PF.ui;

  const PASOS = [
    {
      titulo: "Elige tu base",
      texto: "Arroz, quinoa o mix de hojas verdes. La base define el carácter de tu bowl.",
      foto: "Quinoa",
      enlace: "#/menu?categoria=bases",
    },
    {
      titulo: "Agrega tu proteína",
      texto: "Salmón, atún, pollo o tofu. Fresco, porcionado y listo para combinar.",
      foto: "Salmón fresco",
      enlace: "#/menu?categoria=proteinas",
    },
    {
      titulo: "Remata con salsa y topping",
      texto: "Desde la clásica ponzu hasta palta, mango o sésamo tostado.",
      foto: "Salsas",
      enlace: "#/menu?categoria=salsas",
    },
  ];

  titulo("");

  pintar(
    raiz,
    html`
      <section class="hero">
        <div class="hero__texto">
          <h1>Arma tu Poke Bowl</h1>
          <p>Arma tu exquisito Poke Bowl a tu manera. Elige tu base, proteína, salsas y toppings.</p>
          <a class="boton boton--primario" href="#/arma-tu-bowl">Ordena aquí</a>
        </div>
        ${imagen("hero", { clase: "hero__foto foto" })}
      </section>

      <section class="pasos" aria-label="Cómo armar tu bowl">
        ${PASOS.map(
          (paso) => html`
            <a class="tarjeta tarjeta--paso" href="${paso.enlace}">
              <h2>${paso.titulo}</h2>
              <p>${paso.texto}</p>
              ${imagen(paso.foto)}
            </a>
          `,
        )}
      </section>
    `,
  );
};
