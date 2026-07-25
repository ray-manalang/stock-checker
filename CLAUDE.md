# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Market Specialist** — a beginner-first equity app: a web UI + Node API that answers "is
this a good time to buy?" in plain English on one screen, with macro/scanner/analyst tools
behind a Pro tab. Design ported from the Minset watch app; analytics ported from the
`stock-analyzer` Python repo. Data is free (Yahoo Finance + FRED); the LLM is Claude.

The **repo, npm workspaces, container, and SQLite file are named `stock-checker`**; the
**product is "Market Specialist"** (title, brand, alert emails). Don't "fix" either name.

Deeper reference: `ARCHITECTURE.md` (full API/module/schema reference and a maintained
*Known limitations* list), `README.md` (setup), `DEPLOY-HAOS.md` (Portainer), `CHANGELOG.md`.

## Commands

```bash
npm install
cp server/.env.example server/.env   # set YF_PYTHON; ANTHROPIC_API_KEY optional
npm run dev                          # API :3001 + UI :5173 (hot reload)

npm test                             # server unit tests (node --test)
npm run typecheck                    # web tsc --noEmit
npm run build                        # builds web/dist
npm start                            # serves API + static UI on PORT (default 3001)

# Offline/demo (no live data or key needed):
STOCK_FIXTURES=1 STATIC_DIR=../web/dist npm start
```

## Architecture — 3-layer pipeline behind a freshness store

Scheduled jobs (`server/src/scheduler.js`, node-cron) write snapshots to SQLite
(`server/src/db.js`, better-sqlite3); read endpoints serve the latest instantly with an
`{ data, asOf, stale }` envelope — **never compute on page load**. Every layer degrades
gracefully. Cadence: macro `*/20m`, scanner `21:15 ET`, analyst `Sun 03:00 ET`, alerts
`*/10m` — the two market-clock jobs are pinned to `MARKET_TZ` (default `America/New_York`)
since the container runs UTC. Macro and scanner also run on boot when their tables are empty.

- **Data sources** (`stocks.js`): Yahoo via a Python sidecar (`scripts/yf_fetch.py`,
  yfinance/curl_cffi — impersonates a browser TLS fingerprint, since Yahoo 429s plain Node)
  is primary and batches the whole universe in one fast call. Falls back to Twelve Data
  (keyed, 8s/symbol serial pacing) → Yahoo spark (no volume!) → Stooq → fixtures. Point
  `YF_PYTHON` at a python with yfinance installed
  (`pip install -r server/scripts/requirements.txt`).
- **Simple Check** (`GET /api/check/:sym`) → `analyze.js`: live price + OHLCV series →
  technicals (`indicators.js`) → beginner-language glance + deterministic verdict
  (`language.js`, `verdict.js`) → optional Claude deep-dive (`llm.js`, Opus 4.8, structured
  output). Deep-dive is cached by quarter; `?fresh=1` forces a live call, `?deep=0` skips
  the LLM.
- **L1 Macro gate** (`GET /api/macro`) → `macro/compute.js` + `macro/signals.js`:
  6 weighted signals → composite → zone. Cutoffs: **≥70 FULL DEPLOY, ≥40 REDUCED, else
  DEFENSIVE**. A signal that fails to fetch scores a neutral 50 *at full weight*.
- **L2 Scanner** (`GET /api/scanner`) → `scanner/engine.js` + `scanner/factors.js`:
  large-cap universe sliced to `SCANNER_UNIVERSE_SIZE` (default 50), 4–5 percentile-ranked
  factors, equal-weight composite. Macro-gated: **DEFENSIVE = off, REDUCED = top 20**
  (this replaced an older "composite ≥ 75" rule).
- **L3 Analyst** (`analyst/`): Sonnet Message-Batch fundamental scoring cached by
  `(ticker, quarter_end)`; `blender.js` blends quant (60%) + fundamental (40%), re-ranks,
  flags rank shifts ≥ 3 as upgrades/downgrades (joined into `/api/scanner` at read time).
- **Watchlist + alerts**: `watchlist`/`alerts` tables; `alerts.js` checks buy-zone crossings
  on a cron and emails via Resend (optional — otherwise it just marks them triggered).
- **Tape + quotes**: `/api/tape` (indexes + watchlist + top-20 scanner) and `/api/quotes`
  (60s in-process cache) feed the footer marquee and the shared live-price store.
- **CNBC**: `/api/news/videos` reads CNBC Television's YouTube RSS, 5-min server cache.

`POST /api/refresh/:layer` (macro|scanner|analyst) kicks a background recompute.

**Dual-mode server**: `index.js` serves the built React app when `STATIC_DIR` is set
(production/Docker), else API-only with Vite proxying in dev. No auth on any route — LAN only.

**Web** (`web/`): `App.tsx` (Basic view — search, answer card, watchlist, alerts) +
`ProView.tsx` (macro + scanner + CNBC). Pro renders *above* the Basic check tool rather than
replacing it. `TickerTape.tsx` is a fixed footer in both views. `livePrices.ts` is a single
refcounted 60s poller every price on screen subscribes to — add new price displays there
rather than polling separately. Components in `web/src/components/` (InfoTip, PriceChart,
SegmentedControl); design tokens in `web/src/index.css`; plain-language copy in
`web/src/lib/glossary.ts` (the single source for every ⓘ — analyst dimension copy is the one
exception, inline in `ProView.tsx`).

## Key conventions

- yfinance ticker format uses hyphens not dots (`BRK-B` not `BRK.B`); normalise on the way in.
- `fetchFundamentals` spawns a Python subprocess, so it's memoized per symbol (6h hit /
  30min miss). Don't add a second uncached path — extend the cache.
- Model IDs: deep-dive `claude-opus-4-8`, analyst `claude-sonnet-4-6` (override via
  `ANTHROPIC_DEEPDIVE_MODEL` / `ANTHROPIC_ANALYST_MODEL`). Structured output via
  `output_config.format`; adaptive thinking on the deep-dive. Every call is costed into
  `llm_usage` — keep `PRICING` in `llm.js` current when swapping models.
- Design system: dark-only, **system font stack** (`--font` in `index.css` — no web fonts,
  deliberately), `tabular-nums` on figures. Tokens ported from Minset (`--bg:#000`, `--surface:#0e0e0f`, `--radius:18px`,
  `--maxw:900px`, iOS up/down colors).
- Client persistence is three localStorage keys (`changeMode`, `macroCollapsed`,
  `scannerCollapsed`); everything else — including risk tolerance (the `settings` table) —
  is server-side SQLite.
- Snapshot endpoints return HTTP 200 with `data: null` before the first run — handle the
  null, don't expect a 404.
- `STOCK_FIXTURES=1` serves deterministic demo data (never used unless opted in).
- Before assuming behaviour that "looks broken", check *Known limitations* in
  `ARCHITECTURE.md` — several oddities are documented and intentional-for-now.

## Legacy Apps Script (optional)

Numbered `01 -` … `05 -` files at the repo root deploy via clasp — the original Google
Sheet prototype, kept for reference. Not part of the Node app.
