FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY app/package*.json ./
RUN npm ci --no-fund --no-audit
COPY app/ .
RUN npm run build

FROM node:22-bookworm-slim AS backend
WORKDIR /api
COPY api/package*.json ./
RUN npm ci --no-fund --no-audit
COPY api/ .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend /api/node_modules ./node_modules
COPY --from=backend /api/dist ./dist
COPY --from=backend /api/package.json .
COPY --from=frontend /app/dist ./public
USER node
CMD ["node","dist/server.js"]
