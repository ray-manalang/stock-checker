# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **beginner-first equity app**: a web UI + Node API that answers "is this a good time to buy?" in plain English on one screen, with advanced macro/scanner tools behind a Pro toggle. Design ported from the Minset watch app; analytics ported from the `stock-analyzer` Python repo. Data is free (Yahoo Finance + FRED); the LLM is Claude.

## Commands

```bash
npm install
cp server/.env.example server/.env   # set ANTHROPIC_API_KEY (optional — app runs without it)
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
(`server/src/db.js`, better-sqlite3); read endpoints serve the latest instantly
with an `{ data, asOf, stale }` envelope. Every layer degrades gracefully.

- **Data sources** (`stocks.js`): Yahoo via a Python sidecar
  (`scripts/yf_fetch.py`, yfinance/curl_cffi — impersonates a browser TLS
  fingerprint, since Yahoo 429s plain Node/requests) is primary and batches the
  whole universe in one fast call. Falls back to Twelve Data (keyed) → Yahoo
  spark → Stooq → fixtures. Point `YF_PYTHON` at a python with yfinance
  installed (`pip install -r server/scripts/requirements.txt`).
- **Simple Check** (`GET /api/check/:sym`) → `analyze.js`: live price + OHLCV
  series → technicals
  (`indicators.js`) → beginner-language glance + deterministic verdict
  (`language.js`, `verdict.js`) → optional Claude deep-dive (`llm.js`, Opus 4.8,
  structured output). Deep-dive is cached by quarter (`analyst/analyzer.js`);
  `?fresh=1` forces a live call, `?deep=0` skips the LLM.
- **L1 Macro gate** (`GET /api/macro`) → `macro/compute.js` + `macro/signals.js`:
  6 weighted signals → composite → FULL DEPLOY / REDUCED / DEFENSIVE zone.
- **L2 Scanner** (`GET /api/scanner`) → `scanner/engine.js` + `scanner/factors.js`:
  S&P 500 universe, 5 percentile-ranked factors, composite. Gated by the macro
  zone (DEFENSIVE = off, REDUCED = composite ≥ 75).
- **L3 Analyst** (`analyst/`): Sonnet Message-Batch fundamental scoring cached by
  `(ticker, quarter_end)`; `blender.js` blends quant (60%) + fundamental (40%),
  re-ranks, flags rank shifts ≥ 3 as upgrades/downgrades (joined into `/api/scanner`).
- **Watchlist + alerts**: `watchlist`/`alerts` tables; `alerts.js` checks buy-zone
  crossings on a cron and emails via Resend (optional — otherwise marks triggered).

`POST /api/refresh/:layer` (macro|scanner|analyst) kicks a background recompute.

**Dual-mode server**: `index.js` serves the built React app when `STATIC_DIR` is
set (production/Docker), else API-only with Vite proxying in dev.

**Web** (`web/`): `App.tsx` (Simple Check view) + `ProView.tsx` (macro + scanner).
Components in `web/src/components/` (InfoTip, PriceChart, SegmentedControl);
design tokens in `web/src/index.css`; plain-language copy in `web/src/lib/glossary.ts`.

## Key conventions

- yfinance ticker format uses hyphens not dots (`BRK-B` not `BRK.B`).
- Model IDs: deep-dive `claude-opus-4-8`, analyst `claude-sonnet-4-6` (override via
  `ANTHROPIC_DEEPDIVE_MODEL` / `ANTHROPIC_ANALYST_MODEL`). Structured output via
  `output_config.format`; adaptive thinking on the deep-dive.
- Design system: dark-only, system font, `tabular-nums` on figures. Tokens ported
  from Minset (`--bg:#000`, `--surface:#0e0e0f`, `--radius:18px`, iOS up/down colors).
- `STOCK_FIXTURES=1` serves deterministic demo data (never used unless opted in).

## Legacy Apps Script (optional)

Numbered `01 -` … `05 -` files at the repo root deploy via clasp — the original
Google Sheet prototype, kept for reference. Not part of the Node app.
