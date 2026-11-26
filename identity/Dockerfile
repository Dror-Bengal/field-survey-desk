FROM node:22-bookworm-slim
WORKDIR /identity
COPY package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY firebase.json ./
CMD ["node_modules/.bin/firebase","emulators:start","--only","auth","--project","demo-field-survey","--import=/state/saved","--export-on-exit=/state/saved"]
