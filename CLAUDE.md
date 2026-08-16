# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Market Specialist** — a beginner-first equity app: a web UI + Node API that answers "is
this a good time to buy?" in plain English on one screen, with macro/scanner/analyst tools
on a Home dashboard. Design ported from the Minset watch app; analytics ported from the
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
`*/10m`, watchlist signals `weekdays 16:10 ET` — the **three** market-clock jobs (scanner,
analyst, watchlist signals) are pinned to `MARKET_TZ` (default `America/New_York`) since the
container runs UTC. Macro and scanner also run on boot when their tables are empty.

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
  full S&P 500 (Wikipedia-scraped) sliced to `SCANNER_UNIVERSE_SIZE` — **default 550**, or
  50 when `SCANNER_FULL_UNIVERSE=0` forces the curated large-cap list. 4–5
  percentile-ranked factors, equal-weight composite, plus a within-sector rank.
  Macro-gated: **DEFENSIVE = off, REDUCED = top 20** (this replaced an older
  "composite ≥ 75" rule).
- **L3 Analyst** (`analyst/`): Sonnet Message-Batch fundamental scoring cached by
  `(ticker, quarter_end)`; `blender.js` blends quant + fundamental, re-ranks, flags rank
  shifts ≥ 3 as upgrades/downgrades (joined into `/api/scanner` at read time).
- **Risk tolerance** (`risk.js`) is *not* cosmetic — it feeds two pieces of server math at
  request time: the blender's quant weight (`0.45` / `0.60` / `0.75`) and the buy-zone
  width scale (`1.4` / `1.0` / `0.6`). **Don't write "the 60/40 blend" or
  "`0.88 × price`" as if they were constants** — those are the `balanced` defaults only.
  Persisted in `settings.riskTolerance`. Caveat: `buyZoneScale` only reaches the output when
  there's no Claude analysis (Claude's `buy_zone` wins), so with a key set only the blend
  half of the control is live.
- **Watchlist + alerts**: `watchlist`/`alerts` tables; `alerts.js` checks buy-zone crossings
  on a cron and emails via Resend (optional — otherwise it just marks them triggered).
- **Tape + quotes**: `/api/tape` (indexes + watchlist + top-20 scanner) and `/api/quotes`
  (60s in-process cache) feed the footer marquee and the shared live-price store.
- **Market videos**: `/api/news/videos` merges each configured source's YouTube RSS
  (5-min cache, keyed on the source set); sources live in `settings.videoSources` (default
  CNBC Television) and are managed via `/api/news/sources` (GET/POST/DELETE — POST resolves
  a channel URL / `@handle` / `UC…` id).

`POST /api/refresh/:layer` (macro|scanner|analyst) kicks a background recompute.

**Dual-mode server**: `index.js` serves the built React app when `STATIC_DIR` is set
(production/Docker), else API-only with Vite proxying in dev. Invite-only session auth;
personal data is per-user. Cloudflare Access may sit in front on the public hostname.

**Web** (`web/`): nav in `App.tsx` — Home, Research, and Holdings stay mounted
(`display:none` so they keep polling / portfolio state); **Profile** and **Guide** are
conditionally mounted.
**Home** (`main`): holdings teaser + `ProView.tsx` (Market conditions/macro + Top-ranked/scanner + Market
videos). **Research** owns everything ticker/watchlist: the check tool (search, recents,
watchlist), the answer card, then the watchlist-driven cards — `WatchingToBuy.tsx`,
`AlertsPanel.tsx` ("Your alerts"), and `BacktestCard.tsx` ("Track record") at the bottom.
**Holdings** is `HoldingsPage.tsx`. Friend-facing docs: `USER-GUIDE.md` + in-app Guide.
Tip jar is Ko-fi via `KOFI_URL` (outbound link only). Daily Claude cap
(`DAILY_LLM_BUDGET_USD`) is on `GET /api/usage` as `budget` (Profile / Guide / Research).
A `?check=SYM` query param opens Research on that ticker
(HA deep-links). `TickerTape.tsx` is a fixed footer in every view. `livePrices.ts` is a single
refcounted 60s poller every price on screen subscribes to — add new price displays there
rather than polling separately. Components in `web/src/components/` (`InfoTip`,
`PriceChart`, `ClearableInput`, `RiskControl`, `SupportButton`); design tokens in `web/src/index.css` — the
only stylesheet in the tree; plain-language copy in `web/src/lib/glossary.ts` (19 entries —
the two exceptions are `DIM_INFO` in `ProView.tsx` and the dividend-yield tip inline in
`App.tsx`). The app is a PWA: `index.html` registers `/sw.js`, so a stale service worker can
serve old assets after a redeploy.

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
- Client persistence is a handful of localStorage keys: `changeMode`, `blurAmounts`
  (Hide $), and per-card collapse flags (`macroCollapsed`, `scannerCollapsed`,
  `sectorAllocCollapsed`, `alertsCollapsed`, `holdingsTeaserCollapsed`, `watchingCollapsed`,
  `trackRecordCollapsed`). Only three go through `lib/useCollapsed.ts` — `ProView`,
  `AlertsPanel`, and `HoldingsPage` hand-roll the same logic inline, so editing the hook
  does **not** change all seven. Everything else — including risk tolerance (the `settings`
  table) — is server-side SQLite.
- `POST /api/alerts/check` and `POST /api/watchlist/signals/check` call their workers
  directly, skipping the scheduler's concurrency guard. Route new manual triggers through
  the guarded `run*Job()` wrappers instead.
- `npm run build` needs the Mac's native `rollup` binary — it can't run from a Linux
  sandbox against these `node_modules`. Build and verify on the Mac.
- Snapshot endpoints return HTTP 200 with `data: null` before the first run — handle the
  null, don't expect a 404.
- `STOCK_FIXTURES=1` serves deterministic demo data (never used unless opted in).
- Before assuming behaviour that "looks broken", check *Known limitations* in
  `ARCHITECTURE.md` — several oddities are documented and intentional-for-now.

## Legacy Apps Script (optional)

Numbered `01 -` … `05 -` files at the repo root deploy via clasp — the original Google
Sheet prototype, kept for reference. Not part of the Node app.
