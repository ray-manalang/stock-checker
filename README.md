# Market Specialist

A beginner-first equity app. Type a ticker, get a plain-English answer to *"is this a
good time to buy?"* on one screen — plus a Home dashboard with a macro risk gate, a quant
scanner over the largest US names, and Claude-scored fundamentals, and a Holdings tab.

Runs as a single container: Express API + built React UI + a Python sidecar for market
data, with a SQLite store for snapshots, watchlist, alerts, and cached scores.

> **Naming:** the product is **Market Specialist** (browser title, UI brand, alert
> emails). The repository, npm workspaces (`stock-checker-server` / `stock-checker-web`),
> Docker container, and SQLite file are all still named `stock-checker`. Both names refer
> to the same thing.

---

## Status — `main` @ `a311020`, re-audited 2026-07-31

This documentation set tracks `main`; it describes what the code deploys, not a verified
reading of the running Home Assistant container. See [CHANGELOG.md](CHANGELOG.md) for the
history and [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical reference (including
a maintained *Known limitations* list).

---

## What it does

Three nav tabs — **Home**, **Research**, **Holdings** — plus **Profile**, **Guide**, and a Hide $ toggle.

For a friend-facing walkthrough see [USER-GUIDE.md](USER-GUIDE.md) (also under **Guide** in the app).

**Research tab** — one search box and one answer card:

- Live price, day change (toggle % / $), and where today's price sits in its 52-week range
- A verdict in plain English (*"Good time to buy"*, *"Wait for a dip"*, *"No rush — wait"*,
  *"Avoid for now"*) with a 4-bar confidence meter
- An at-a-glance row: **Timing** (RSI), **Quality** (fundamental score), **Price** (rich/cheap)
- *"Why this call?"* — in its favor / watch out / a good plan
- *"Show the details"* — 1-year price chart with the suggested buy zone shaded, plus
  momentum, trend, volatility, and drawdown
- Watchlist chips, recently-checked chips, and a one-click price alert
- **Watching to buy** — each watched ticker's name, live price, day change, and latest
  verdict; notifies the day one first turns into "Good time to buy"
- **Your alerts** and a **Track record** (how past verdicts scored) round out the bottom
- Every ⓘ pulls its wording from a single glossary, so the jargon is explained inline

**Home tab** — a holdings teaser over three market cards:

- **Market conditions** — 6 weighted macro signals → composite 0–100 → a deployment zone
  (`FULL DEPLOY` / `REDUCED` / `DEFENSIVE`) with position sizing
- **Top-ranked stocks** — percentile-ranked quant scanner, gated by the macro zone,
  optionally blended with Claude's fundamental scores (shows quant-vs-analyst
  disagreements as upgrades/downgrades) and each name's rank within its sector
- **Risk tolerance** — a Conservative / Balanced / Aggressive control on that card that
  shifts how much the ranking leans on fundamentals vs momentum (and, when Claude isn't
  answering, how deep a pullback the suggested buy zone waits for)
- **Market videos** — a scrollable grid of market video, playable in-app, with custom
  YouTube sources you can add or remove

**Holdings tab** — import brokerage CSVs to roll up positions with gain/loss, concentration,
GICS-sector allocation, sector/institution filters, and live intraday prices.

**Everywhere** — a scrolling ticker tape (indexes + watchlist + top-ranked) pinned to the
bottom, and a shared 60-second live-price poller so every price on screen agrees.

Nothing is computed on page load. Scheduled jobs write snapshots; the page reads the
latest one instantly and labels it *"updated 12m ago."*

---

## Stack and cost

| Piece | What | Cost |
|---|---|---|
| **Web** (`web/`) | Vite 6 + React 19 + TypeScript + recharts | Free |
| **API** (`server/`) | Node 22 + Express 4 + better-sqlite3 + node-cron | Free |
| **Market data** | Yahoo Finance via a Python sidecar (`yfinance` / `curl_cffi`) | Free, no key |
| **Data fallbacks** | Twelve Data (keyed) → Yahoo spark → Stooq → fixtures | Free tiers |
| **Macro data** | FRED CSV (HY OAS, VIX) | Free, no key |
| **AI** | Claude — Opus for the deep-dive, Sonnet (Message Batches) for fundamentals | Paid, optional |
| **Alert email** | Resend | Free tier, optional |

**The app runs with no API keys at all.** Without `ANTHROPIC_API_KEY` the verdict falls
back to a deterministic scoring engine and the analyst layer is skipped; without
`RESEND_API_KEY` alerts still flip to *triggered* in the UI, they just don't email.

---

## Quick start

Requires **Node 22+** and a **Python 3** with `yfinance` installed.

```bash
npm install                              # workspaces: server + web

python3 -m venv server/.venv             # Yahoo sidecar
server/.venv/bin/pip install -r server/scripts/requirements.txt

cp server/.env.example server/.env       # then set YF_PYTHON, optionally ANTHROPIC_API_KEY
npm run dev                              # API :3001 + UI :5173 (hot reload, /api proxied)
```

Open <http://localhost:5173> and check a ticker (e.g. `AAPL`).

Other commands:

```bash
npm test          # 73 server unit tests (node --test) — indicators, verdict, factors,
                  # signals, blender, alerts, spark, holdings, risk, sp500-table
npm run typecheck # web: tsc --noEmit
npm run build     # builds web/dist
npm start         # serves API + static UI on PORT (default 3001)

# Offline demo — deterministic synthetic data, no network or key needed:
STOCK_FIXTURES=1 STATIC_DIR=../web/dist npm start
```

On first boot the macro job runs immediately if the store is empty, and the scanner
follows; the Pro cards fill in within a few minutes. Watch the logs for `[job] computeMacro ok`
and `[job] runScanner ok`.

---

## Configuration

All server config is environment variables (loaded from `server/.env` in dev, from the
Portainer stack in production). Full table with defaults and effects is in
[ARCHITECTURE.md § Environment](ARCHITECTURE.md#environment-variables). The ones that matter:

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `STATIC_DIR` | unset | When set, serves the built React app + SPA fallback; otherwise API-only |
| `DB_PATH` | `server/stock-checker.db` | SQLite file |
| `YF_PYTHON` | `python3` | Python interpreter that has `yfinance` — **the primary data path** |
| `ANTHROPIC_API_KEY` | unset | Enables the Claude deep-dive and the analyst layer |
| `TWELVE_DATA_API_KEY` | unset | Fallback data source when the sidecar is unavailable |
| `SCANNER_UNIVERSE_SIZE` | `550` | How many names the scanner ranks (`550` on the default full S&P 500; `50` when `SCANNER_FULL_UNIVERSE=0` forces the curated list) |
| `RESEND_API_KEY` + `ALERT_EMAIL` | unset | Sends buy-zone alert emails |
| `STOCK_FIXTURES` | unset | `=1` serves deterministic demo data end to end |

---

## Deployment

Production target is **Home Assistant OS via Portainer** — one container on host port
**8088** → container **3001**, with the SQLite store on the `stock-checker-data` named
volume. Step-by-step instructions, env-var table, health check, and troubleshooting live
in **[DEPLOY-HAOS.md](DEPLOY-HAOS.md)**.

Health check:

```bash
curl http://<host>:8088/api/health     # {"ok":true,"llm":true}
```

The image is Debian-based (not Alpine) on purpose: `curl_cffi`, which `yfinance` uses to
impersonate a browser TLS fingerprint past Yahoo's bot detection, only ships glibc wheels.
It needs a 64-bit host (arm64 or x86); 32-bit armv7 lacks the wheels.

---

## Repository layout

```
server/
  src/
    index.js            Express app — all routes, static serving
    scheduler.js        node-cron jobs (macro, scanner, analyst, alerts)
    db.js               SQLite schema + every query
    stocks.js           Market data: sidecar → Twelve Data → Yahoo → Stooq → fixtures
    analyze.js          Single-ticker pipeline for the Research check tool
    indicators.js       RSI, EMA/SMA, volatility, drawdown, relative strength
    language.js         Numbers → beginner words ("Running hot", "Looks cheap")
    verdict.js          Deterministic verdict when Claude is unavailable
    llm.js              Claude clients, schemas, pricing, usage accounting
    alerts.js           Buy-zone alert checks + Resend email
    risk.js             Risk profiles — blend weight + buy-zone width
    holdings.js         Brokerage CSV parsing, mapping, position roll-up
    backtest.js         Verdict hit-rate grading behind "Track record"
    watchlistSignals.js Daily watchlist scan + Home Assistant push
    notify.js           HA notification + /api/ha/summary payload
    fixtures.js         Offline demo data
    macro/              L1 — 6 signals + composite + zone
    scanner/            L2 — universe, factors, percentile ranking
    analyst/            L3 — Claude fundamental scoring + quant/fundamental blender
  scripts/
    yf_fetch.py         Python sidecar: chart | multi | quote | names | fundamentals
web/
  src/
    App.tsx             Nav (Home/Research/Holdings) + Research check tool & cards
    ProView.tsx         Home dashboard — macro card, top-ranked card, refresh/poll logic
    HoldingsPage.tsx    Holdings — CSV import, roll-up, sector allocation, filters
    WatchingToBuy.tsx   Watchlist buy-signal cards (name, live price, verdict)
    AlertsPanel.tsx     "Your alerts" — list/edit/delete price alerts
    BacktestCard.tsx    "Track record" — verdict hit-rate report
    TickerTape.tsx      Fixed scrolling footer
    CnbcVideos.tsx      Market videos card (multi-source YouTube grid)
    livePrices.ts       Shared 60s live-price store (refcounted, deduped)
    components/         InfoTip, PriceChart, ClearableInput, RiskControl
    lib/glossary.ts     Single source of ⓘ copy (18 entries; analyst dimensions
                        and dividend yield are the two exceptions)
    lib/useCollapsed.ts Per-card collapse state (localStorage-backed)
    index.css           Design tokens + all layout (ported from Minset)
01 - … 05 - *.js        Legacy Google Apps Script prototype (not part of the app)
```

---

## Design system

Ported from the Minset watch app: **dark-only**, pure black (`--bg: #000`), system font
stack (`-apple-system` / SF Pro), 18px radius, iOS system colors (`--up: #34c759`,
`--down: #ff453a`, `--warn: #ffd60a`, `--accent: #5ea2ff`), 900px max width,
`tabular-nums` on every figure, hairline dividers, white pill buttons, and text glyphs
instead of an icon library. The card anatomy (`insight-card` / `insight-cells` /
`insight-foot`, `InfoTip`) comes straight from Minset.

---

## Legacy Apps Script

The numbered `01 -` … `05 -` files at the repo root are the original Google Sheets
prototype, deployable via `clasp`. They are kept for reference and are not part of the
Node app.
