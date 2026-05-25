# Build React UI
FROM node:22-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json ./web/
COPY server/package.json ./server/
COPY web ./web
RUN npm ci && npm run build -w stock-checker-web

# Production: API + static UI
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV STATIC_DIR=/app/web/dist

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY server/src ./server/src
RUN npm ci --omit=dev -w stock-checker-server

COPY --from=web-build /app/web/dist ./web/dist

EXPOSE 3001
CMD ["node", "server/src/index.js"]
