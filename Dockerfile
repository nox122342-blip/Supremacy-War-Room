FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    API_PORT=3001 \
    DATABASE_PATH=/app/data/supremacy.sqlite

WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.mjs ./
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.mjs"]
