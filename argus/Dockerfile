FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# npm ci: instala exatamente o package-lock.json (build reproduzivel).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

# Nao roda como root. /documentos (volume) precisa ser gravavel pelo usuario node.
RUN mkdir -p /documentos && chown node:node /documentos
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "src/app.js"]
