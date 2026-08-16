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
   | `ANTHROPIC_API_KEY` | your Claude key (keep secret) — enables the deep-dive + analyst layer |
   | `TWELVE_DATA_API_KEY` | optional fallback data source (Yahoo sidecar is primary) |
   | `RESEND_API_KEY` | [Resend](https://resend.com) key — required to *email* buy-zone alerts |
   | `ALERT_EMAIL` | where alert emails go, e.g. `you@example.com` |
   | `ALERT_FROM` | sender header — defaults to `Market Specialist <onboarding@resend.dev>` |
   | `MARKET_TZ` | market clock for the scanner / analyst / watchlist-signal jobs — defaults to `America/New_York` |
   | `SCANNER_UNIVERSE_SIZE` | how many names the scanner ranks — defaults to `550` (the full S&P 500), or `50` if you set `SCANNER_FULL_UNIVERSE=0` |
   | `SCANNER_FULL_UNIVERSE` | **on by default.** Set `=0` to fall back to the curated ~100-name large-cap list |
   | `APP_BASE_URL` | public URL, e.g. `https://sc.knr-manalang.net` (invite links + Secure cookies) |
   | `CORS_ORIGIN` | same hostname, e.g. `https://sc.knr-manalang.net` |
   | `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASS` | **first boot only** — creates the admin and migrates your existing watchlist/holdings/alerts onto that account |
   | `DAILY_LLM_BUDGET_USD` | optional Claude spend cap per UTC day (default `5`) |
   | `HA_BASE_URL` + `HA_TOKEN` | your Home Assistant URL and a long-lived access token — enables a push notification the day a watched ticker first turns into "Good time to buy" |
   | `HA_NOTIFY_SERVICE` | which `notify.<service>` to call, e.g. `mobile_app_your_phone` (default `notify`) |

   > **Before upgrading to multi-user:** copy the SQLite file out of the
   > `stock-checker-data` volume (rollback insurance). After deploy, sign in as
   > the bootstrap admin and confirm your watchlist/holdings look the same.

   > **Alert email:** each user sets their own address under **Your account** on
   > Home. Without `RESEND_API_KEY` alerts still flip to *triggered* in the UI —
   > they just don't send mail. With Resend's shared `onboarding@resend.dev`
   > sender, delivery only works to your own Resend account address; verify a
   > domain and change `ALERT_FROM` to send anywhere else.

   > **Inviting friends:** add their email in **Cloudflare Access**, then use
   > **Invite** in the app nav (admin) to copy an app invite link. Access is the
   > network gate; the app login isolates each person's data. Admin cannot view
   > another user's holdings.

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

## Schedules

The container clock is UTC, but the three market-clock jobs are pinned to `MARKET_TZ`
(default `America/New_York`), so they don't drift with daylight saving:

| Job | When | Clock | What it refreshes |
|---|---|---|---|
| Macro gate | every 20 min | interval | Market conditions card |
| Scanner | 21:15 nightly | **ET** | Top-ranked stocks |
| Analyst | 03:00 Sundays | **ET** | Claude fundamental scores (needs `ANTHROPIC_API_KEY`) |
| Alerts | every 10 min | interval | Buy-zone alert checks |
| Watchlist signals | 16:10 weekdays | **ET** | Watching-to-buy verdicts + the HA buy-signal push |

Macro and scanner also run once at boot when their tables are empty. Any layer can be
recomputed on demand from the Home dashboard's Refresh buttons.

## Updates

1. Pull latest from Git (Portainer stack → **Pull and redeploy** / **Update the stack**), or
2. SSH/add-on terminal: `docker compose pull && docker compose up -d --build`.

The named volume keeps your watchlist/alerts/cache across updates.

## Security notes

- Never commit `ANTHROPIC_API_KEY` or `BOOTSTRAP_ADMIN_PASS` to Git — use Portainer env vars or a host-only `.env`.
- The live instance at `https://sc.knr-manalang.net` sits behind **Cloudflare Access** plus **app login**. App sessions isolate personal data (watchlist, holdings, alerts, videos, risk). Holdings amounts are encrypted at rest with a per-user key unlocked at sign-in.
- Admin is ops-only (invites, refresh, usage) — there is no admin view of another user's portfolio.
- Before any multi-user upgrade: **back up** `/app/data/stock-checker.db` from the named volume.

## Troubleshooting

| Issue | Fix |
|--------|-----|
| Build fails / out of memory (Raspberry Pi) | The image now installs pandas/numpy/yfinance; on a low-RAM Pi build on another machine and push to GHCR, then set compose to `image:` instead of `build: .`. Requires a 64-bit (arm64/x86) host — 32-bit armv7 lacks the needed wheels. |
| `llm: false` in health | Set `ANTHROPIC_API_KEY` in the stack env and redeploy (optional — the app works without it). |
| Pro cards empty / scanner slow to fill | The scanner builds in the background on first boot; watch logs for `runScanner ok`, then refresh. It already ranks the full S&P 500 by default — if it's *too* slow, set `SCANNER_FULL_UNIVERSE=0` to drop to the curated ~100-name list. |
| Scanner takes many minutes and you set `TWELVE_DATA_API_KEY` | Twelve Data's free tier is paced at 8 s **per symbol, serially** — 550 names is hours. It's a fallback for small symbol sets; the Python sidecar is the path that makes the full universe viable. Confirm the sidecar works (row below) rather than leaning on Twelve Data. |
| UI looks stale/broken right after a redeploy | The app is a PWA with a service worker (`/sw.js`). Hard-reload (Cmd/Ctrl-Shift-R) to drop the cached assets. |
| No market data | Confirm the sidecar works: `docker exec stock-checker /app/server/.venv/bin/python3 /app/server/scripts/yf_fetch.py chart AAPL 5d`. If it errors, set `TWELVE_DATA_API_KEY` as a fallback. |
| Lost watchlist/alerts after redeploy | Ensure the `stock-checker-data` volume wasn't removed (`docker compose down` without `-v` keeps it; `-v` deletes it). |
| Blank page | Check logs; confirm `STATIC_DIR` is set (default in compose). |
