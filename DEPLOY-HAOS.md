# Deploy on Home Assistant OS (Portainer)

One container serves the React UI and Express API on port **3001** inside the container (mapped to **8088** on the host by default). The image also bundles a small **Python sidecar** (yfinance) that fetches Yahoo Finance market data, and persists its SQLite store on a named volume.

## Prerequisites

- Home Assistant OS with the **Portainer** add-on (or Portainer CE) running
- *(Optional)* An **Anthropic API key** ([platform.claude.com](https://platform.claude.com)) — enables the Claude deep-dive + analyst layer. The app runs fine without it (falls back to the deterministic verdict engine).
- This repo on GitHub: `https://github.com/ray-manalang/stock-checker`

## Option A — Deploy from Git (recommended)

1. In Portainer, go to **Stacks** → **+ Add stack**.
2. Name the stack `stock-checker`.
3. Build method: **Repository**.
4. Repository URL: `https://github.com/ray-manalang/stock-checker`
5. Repository reference: `refs/heads/main`
6. Compose path: `docker-compose.yml`
7. Enable **Build** (or "Pull and build") — the stack uses `build: .`.
8. Under **Environment variables**, add (all optional):

   | Name | Value |
   |------|--------|
   | `ANTHROPIC_API_KEY` | your Claude key (keep secret) — enables the LLM layer |
   | `TWELVE_DATA_API_KEY` | optional fallback data source (Yahoo sidecar is primary) |

9. Deploy the stack. **The first build takes several minutes** — the image installs Python + pandas/numpy/yfinance in addition to Node (see notes below).
10. Open the app: `http://<ha-ip>:8088` (e.g. `http://192.168.1.50:8088`).

## Option B — Deploy from Compose upload

1. On your Mac, clone the repo and create a `.env` file next to `docker-compose.yml` (do not commit it):

   ```bash
   git clone https://github.com/ray-manalang/stock-checker.git
   cd stock-checker
   echo "ANTHROPIC_API_KEY=your_key_here" > .env      # optional
   ```

2. In Portainer → **Stacks** → **+ Add stack** → **Web editor**, paste `docker-compose.yml`.
3. Add the same environment variables as in Option A.
4. Web-editor-only stacks can't build from a local context — use the **Git** method (Option A), or build locally and push an image to a registry (see Troubleshooting).

## Data & market feed

- **Market data** comes from Yahoo Finance via the bundled Python sidecar (yfinance/curl_cffi — it impersonates a browser TLS fingerprint, which plain Node cannot). No API key needed. `YF_PYTHON` is preset in the image, so it works out of the box.
- **Persistence**: the SQLite store (watchlist, price alerts, cached analyst scores, Claude usage) lives on the `stock-checker-data` named volume mounted at `/app/data`. It survives redeploys. To reset it, remove the volume (`docker volume rm stock-checker_stock-checker-data`).

## Change the host port

Edit the `docker-compose.yml` ports mapping, then redeploy:

```yaml
ports:
  - "8123:3001"   # example: host 8123 → container 3001
```

## Health check

```bash
curl http://<ha-ip>:8088/api/health
```

Expected: `{"ok":true,"llm":true}` when `ANTHROPIC_API_KEY` is set (`llm:false` without it — the app still works).

## Logs

Portainer → **Containers** → `stock-checker` → **Logs**. On boot you'll see `[job] computeMacro ok` and `[job] runScanner ok` as the Pro-layer snapshots build.

## Updates

1. Pull latest from Git (Portainer stack → **Pull and redeploy** / **Update the stack**), or
2. SSH/add-on terminal: `docker compose pull && docker compose up -d --build`.

The named volume keeps your watchlist/alerts/cache across updates.

## Security notes

- Never commit `ANTHROPIC_API_KEY` to Git — use Portainer env vars or a host-only `.env`.
- The app is intended for **LAN use**. For external exposure, put it behind Home Assistant/nginx with authentication.

## Troubleshooting

| Issue | Fix |
|--------|-----|
| Build fails / out of memory (Raspberry Pi) | The image now installs pandas/numpy/yfinance; on a low-RAM Pi build on another machine and push to GHCR, then set compose to `image:` instead of `build: .`. Requires a 64-bit (arm64/x86) host — 32-bit armv7 lacks the needed wheels. |
| `llm: false` in health | Set `ANTHROPIC_API_KEY` in the stack env and redeploy (optional — the app works without it). |
| Pro cards empty / scanner slow to fill | The scanner builds in the background on first boot; watch logs for `runScanner ok`, then refresh. Set `SCANNER_FULL_UNIVERSE=1` for the full S&P 500. |
| No market data | Confirm the sidecar works: `docker exec stock-checker /app/server/.venv/bin/python3 /app/server/scripts/yf_fetch.py chart AAPL 5d`. If it errors, set `TWELVE_DATA_API_KEY` as a fallback. |
| Lost watchlist/alerts after redeploy | Ensure the `stock-checker-data` volume wasn't removed (`docker compose down` without `-v` keeps it; `-v` deletes it). |
| Blank page | Check logs; confirm `STATIC_DIR` is set (default in compose). |
