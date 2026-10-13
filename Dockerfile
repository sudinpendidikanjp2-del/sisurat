# syntax=docker/dockerfile:1
# Multi-stage build: `api` (API + worker) and `web` (static files behind nginx).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY prisma prisma
COPY apps/api/prisma.config.ts apps/api/
COPY apps/api/src/config/defaults.ts apps/api/src/config/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run db:generate && npm run build

FROM node:22-bookworm-slim AS api
# Local OCR fallback (optional but small): Tesseract with Indonesian data + poppler for PDF rasterising.
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ind poppler-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/apps/api/package.json /app/apps/api/prisma.config.ts ./apps/api/
COPY --from=build /app/apps/api/src/config/defaults.ts ./apps/api/src/config/defaults.ts
COPY --from=build /app/apps/api/src/generated ./apps/api/src/generated
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
