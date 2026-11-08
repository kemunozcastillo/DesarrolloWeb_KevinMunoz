FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Escribe en volúmenes montados como root; es un contenedor de un solo uso.
CMD ["node", "iniciar.js"]
