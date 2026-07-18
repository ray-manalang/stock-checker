# Build React UI
FROM node:22-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json ./web/
COPY server/package.json ./server/
COPY web ./web
RUN npm ci && npm run build -w stock-checker-web

# Production: API + static UI + Yahoo sidecar (Python).
# Debian (glibc) base, not Alpine — curl_cffi (which yfinance uses to
# impersonate a browser TLS fingerprint past Yahoo's bot-detection) ships
# glibc wheels; on musl it would have to compile from source.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV STATIC_DIR=/app/web/dist
ENV YF_PYTHON=/app/server/.venv/bin/python3

# Python + yfinance sidecar in an isolated venv.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY server/scripts ./server/scripts
RUN python3 -m venv /app/server/.venv \
    && /app/server/.venv/bin/pip install --no-cache-dir -r server/scripts/requirements.txt

# Node API
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY server/src ./server/src
RUN npm ci --omit=dev -w stock-checker-server

COPY --from=web-build /app/web/dist ./web/dist

EXPOSE 3001
CMD ["node", "server/src/index.js"]
