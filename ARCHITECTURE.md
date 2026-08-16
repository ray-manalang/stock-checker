# Architecture — Market Specialist

Technical reference for the `stock-checker` repo. **Baseline: `main` @ `a311020`
(2026-07-27)**, re-audited against source on **2026-07-31** (see
[CHANGELOG.md](CHANGELOG.md)). Written from source; every route, cron, table, weight and
env var below was re-derived from the code rather than carried forward.

Verified on the working tree at that commit: **73/73 server tests pass** (`node --test`).
**Not** verified against the running Home Assistant container, a real Holdings CSV import,
or a production build (`npm run build` needs the Mac's native `rollup` binary).

---

## Contents

- [Shape of the system](#shape-of-the-system)
- [Request/response conventions](#requestresponse-conventions)
- [HTTP API](#http-api)
- [Scheduled jobs](#scheduled-jobs)
- [Database](#database)
- [Market data](#market-data)
- [L1 — Macro gate](#l1--macro-gate)
- [L2 — Quant scanner](#l2--quant-scanner)
- [L3 — Claude analyst](#l3--claude-analyst)
- [Risk tolerance](#risk-tolerance)
- [Single-ticker check pipeline](#single-ticker-check-pipeline)
- [Claude integration](#claude-integration)
- [Alerts](#alerts)
- [Frontend](#frontend)
- [Design system](#design-system)
- [Environment variables](#environment-variables)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)

---

## Shape of the system

One Node process serves everything. The organising idea is **precompute on a schedule,
store a snapshot, read it instantly** — the page never waits on a computation.

```
                    ┌──────────────── node-cron (scheduler.js) ────────────────┐
                    │  macro */20m  scanner 21:15 ET  analyst Sun 03:00 ET  alerts */10m │
                    └───────────────────────┬─────────────────────────────────┘
                                            │ writes
                                      ┌─────▼──────┐
  Yahoo (yfinance sidecar)  ─────────▶│   SQLite   │◀──── Claude (Opus / Sonnet batch)
  Twelve Data / Yahoo spark / Stooq   │  snapshots │
  FRED CSV / Wikipedia / YouTube RSS  └─────┬──────┘
                                            │ reads (instant)
                              ┌─────────────▼─────────────┐
                              │  Express (index.js)       │
                              │  /api/* + static web/dist │
                              └─────────────┬─────────────┘
                                            │
                                    React SPA (Basic | Pro)
```

Every layer degrades rather than fails: a dead data source falls through to the next one,
a missing Claude key falls back to a deterministic verdict, a failed job leaves the last
good snapshot in place and the UI labels it stale.

**Layers**

| Layer | Module | Answers |
|---|---|---|
| Check | `analyze.js` | "Is now a good time to buy *this* ticker?" |
| L1 Macro | `macro/` | "Should I be buying *anything* right now?" |
| L2 Scanner | `scanner/` | "Which names look best on price/volume data?" |
| L3 Analyst | `analyst/` | "Do the fundamentals agree with the quant ranking?" |

---

## Request/response conventions

- **Snapshot endpoints** (`/api/macro`, `/api/scanner`) return an envelope:
  `{ data, asOf, stale, …extras }`. When nothing has been computed yet they return
  **HTTP 200** with `{ data: null, asOf: null, stale: true }` — clients must handle the
  null, not a 404.
- Staleness thresholds: macro **45 min**, scanner **36 h**.
- **List endpoints** return `{ data: [...] }`. Mutations return the full new list.
- `/api/check/:sym` returns the analysis object directly (no envelope) — it computes live.
- Symbols are normalised **dots → hyphens** internally (`BRK-B`, not `BRK.B`). Twelve Data
  and Stooq convert back on the way out.
- **Invite-only session auth** (`ms_session` cookie). Personal tables are scoped by
  `user_id`; admin is ops-only (invites / refresh / usage) and cannot read other
  users' holdings. Holdings amounts are encrypted at rest (per-user DEK).
  Cloudflare Access may sit in front as a network gate.

---

## HTTP API

`server/src/index.js`. CORS origin from `CORS_ORIGIN` (default: reflect any origin).

| Method | Path | Params | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{ ok, llm }` |
| GET | `/api/usage` | — | `{ llm, calls, cost, inputTokens, outputTokens, since }` — month-to-date (UTC) |
| GET | `/api/checks` | — | `{ data: RecentCheck[] }`, most recent 12 (one row per ticker) |
| GET | `/api/check/:sym` | `?deep=0` skips the LLM · `?fresh=1` forces a live Opus call | Full check object (see below). Threads the saved risk profile's `buyZoneScale` through — though it only takes effect on the deterministic buy zone, i.e. when no Claude analysis is available |
| POST | `/api/analyze` | body `{ ticker }` | Back-compat alias — **but** it passes no options, so it ignores `deep`/`fresh` **and the saved risk tolerance** (`buyZoneScale` falls back to 1). With Claude configured both verbs return Claude's `buy_zone` and agree; without it, the POST's buy zone can differ from the GET's for a non-`balanced` profile |
| GET | `/api/macro` | — | `{ asOf, stale, data: { composite, zone, sizingPct, scannerActive, scannerMode, oneLiner, signals } }` |
| GET | `/api/scanner` | — | `{ asOf, stale, macroMode, scannerActive, blended, summary, data: Row[] }` |
| GET | `/api/watchlist` | — | `{ data: [{ ticker, addedAt }] }` |
| POST | `/api/watchlist` | body `{ ticker }` | `{ ok, data }` · 400 if missing |
| DELETE | `/api/watchlist/:sym` | — | `{ ok, data }` |
| GET | `/api/watchlist/quotes` | — | `{ data: [{ ticker, name, price, changePct }] }` (6 h price cache) |
| GET | `/api/tape` | — | `{ data: TapeItem[] }` — indexes, then watchlist, then top-20 scanner |
| GET | `/api/quotes` | `?symbols=AAPL,MSFT` | `{ data: { SYM: { price, changePct } } }` — 60 s in-process cache |
| GET | `/api/news/videos` | `?force=1` bypasses cache | `{ data: Video[] }` — merged across sources, newest first; 5-min cache (keyed on the source set). Adds `cached: true` on a cache hit. **The failure branch is effectively dead**: `fetchAllVideos` swallows every per-source error and resolves to `[]`, so nothing throws — a total outage returns `200 { data: [] }`, and neither the documented 502 nor the `stale: true` flag (both in the same `catch`) can ship |
| GET | `/api/news/sources` | — | `{ data: [{ channelId, label }] }` — configured video sources (defaults to CNBC Television) |
| POST | `/api/news/sources` | body `{ url \| channelId, label? }` | `{ ok, data }` — resolves a channel URL / `@handle` / `UC…` id; 400 if unresolvable, 409 if duplicate |
| DELETE | `/api/news/sources/:channelId` | — | `{ ok, data }` |
| GET | `/api/alerts` | — | `{ data: Alert[] }` |
| POST | `/api/alerts` | body `{ ticker, targetLow?, targetHigh? }` | `{ ok, alert, data }` · 400 if no ticker or no usable target |
| PUT | `/api/alerts/:id` | body `{ targetLow?, targetHigh? }` | `{ ok, data }` — edit + re-arm · 400 if no usable target |
| DELETE | `/api/alerts/:id` | — | `{ ok, data }` |
| POST | `/api/alerts/check` | — | `{ ok, checked, triggered }` — runs synchronously |
| GET | `/api/settings` | — | `{ riskTolerance, riskProfiles }` — see [Risk tolerance](#risk-tolerance) |
| PUT | `/api/settings` | body `{ riskTolerance? }` | `{ ok, riskTolerance }` — changes the blender's quant weight **and** the suggested buy-zone width on subsequent reads |
| GET | `/api/watchlist/signals` | — | `{ data: WatchSignal[] }` — per-ticker last verdict + notify state, enriched with `name` (resolved via `company_names` cache → S&P table → one-time sidecar fetch, in that order) and cached `price`/`changePct` (the client overlays the live poller on top) |
| POST | `/api/watchlist/signals/check` | — | `{ ok, checked, notified }` — runs the daily scan now |
| GET | `/api/holdings` | — | `{ data: Portfolio, macro }` — rolled-up positions (gain/loss, concentration %, GICS sector, notes) + `bySector` allocation |
| POST | `/api/holdings/preview` | body `{ csv }` | `{ data: { headers, sample, rowCount, suggestedMapping } }` |
| POST | `/api/holdings/import` | body `{ csv, mapping, asOf? }` | `{ ok, imported, positions, skipped, skippedSymbols, asOf }` |
| POST | `/api/holdings/:ticker/tax` | body `{ taxAdvantaged }` | `{ ok }` — per-position flag (survives re-import) |
| GET | `/api/ha/summary` | — | `{ zone, composite, sizingPct, newLongs, oneLiner, asOf }` — for a passive HA tile. Before the first macro run the payload omits `oneLiner` entirely and the rest are `null` |
| GET | `/api/backtest` | `?window=90` | `{ data: { windowDays, logged, graded, ready, overall, buckets, since } }` |
| POST | `/api/refresh/:layer` | `macro` \| `scanner` \| `analyst` | `{ ok, layer, started }` — fires in the background, returns immediately · 404 on unknown layer |
| GET | `/*` (non-`/api/`) | — | `index.html` — only when `STATIC_DIR` is set |

**`/api/check/:sym` response**

```
{ quote, dividendYield, series: { timestamp[], close[] }, indicators, glance, verdict,
  confidence, why, buyZone, analysis, llm, cached, quarterEnd, llmError, asOf }
```

`dividendYield` is a fraction (or `null`) sourced from the sidecar's `fundamentals` call.

**`/api/scanner` row shape**

- Unblended: `{ ticker, composite, rank, factors, name, price, changePct, sector, sectorRank }`
- Blended (after an analyst run): adds `quantRank, blendedScore, rankDelta, rankFlag,
  fundamental, analyst`, and `rank` becomes the blended rank. `analyst` is
  `{ dimensions, notes, fundamentalScore, model }` or `null`. `sector`/`sectorRank` carry
  through both paths.
- `summary` (blended only): `{ candidates, upgrades, downgrades, avgBlended, top5 }`

**`/api/tape` composition** — pinned `^GSPC` ("S&P 500") and `^IXIC` ("Nasdaq") tagged
`source:"index"`, then watchlist (`"watch"`), then the top 20 scanner rows not already
present (`"scan"`). Scanner names are omitted entirely when the macro zone is `DEFENSIVE`.

**`/api/news/videos`** reads each configured source's YouTube RSS feed (12 s timeout,
hand-rolled regex XML parse), merges them newest-first and tags each clip with its source
label. Sources live in `settings.videoSources` (default: CNBC Television,
`UCrp_UI8XtuYfpiqluWLD7Lw`) and are managed via `/api/news/sources`; adding one accepts a
channel URL, `@handle`, or `UC…` id (a handle/custom URL is resolved by scraping the
channel page for its `channelId`).

---

## Scheduled jobs

`server/src/scheduler.js`, node-cron. The **three** market-clock jobs — scanner, analyst,
and watchlist signals — are pinned to `MARKET_TZ` (default `America/New_York`) so they
don't drift with DST or fire mid-afternoon ET on a UTC container. The two interval jobs
(macro, alerts) are timezone-independent.

| Job | Cron | Cadence | Writes |
|---|---|---|---|
| `computeMacro` | `*/20 * * * *` | every 20 min | `macro_snapshot`, `price_cache` |
| `runScanner` | `15 21 * * *` **ET** | nightly 21:15 ET | `scanner_results`, `scanner_run`, `price_cache` |
| `scoreAnalyst` | `0 3 * * 0` **ET** | Sundays 03:00 ET | `analyst_scores`, `llm_usage` |
| `checkAlerts` | `*/10 * * * *` | every 10 min | `alerts` (status) |
| `checkWatchlistSignals` | `10 16 * * 1-5` **ET** | weekdays 16:10 ET | `watchlist_verdict_state`; pushes via HA on fresh BUY transitions |

- A module-level `Set` guards against concurrent runs of the same job name; a second
  trigger while one is in flight is a no-op. Logs `[job] <name> ok` / `[job] <name> failed: …`.
- **On boot**: macro runs immediately if `macro_snapshot` is empty; the scanner runs
  immediately if `scanner_run` is empty. The analyst job never runs on boot.
- `scoreAnalyst` short-circuits with `[job] scoreAnalyst skipped — no ANTHROPIC_API_KEY`
  when the key is unset; otherwise it scores the tickers of the latest scanner run.
- `POST /api/refresh/:layer` goes through the **guarded** wrappers, so it respects the
  concurrency guard.
- **Two manual endpoints bypass the guard.** `POST /api/alerts/check` calls `checkAlerts()`
  and `POST /api/watchlist/signals/check` calls `checkWatchlistSignals()` *directly*, not
  via `runAlertsJob()` / `runWatchlistSignalsJob()`. Either can therefore overlap its own
  cron or itself. The watchlist one runs a full `analyzeTicker` over the whole watchlist,
  so an overlap means duplicate deep-dives and duplicate HA pushes.

---

## Database

`server/src/db.js` — better-sqlite3, WAL, lazy singleton, `CREATE TABLE IF NOT EXISTS` on
first use. No migration system and no indexes beyond the declared primary keys.

**Path**: `DB_PATH`, else `server/stock-checker.db`. In Docker: `/app/data/stock-checker.db`
on the `stock-checker-data` named volume.

| Table | Key columns | Written by | Read by |
|---|---|---|---|
| `macro_snapshot` | `id`, `composite`, `zone`, `signals_json`, `meta_json`, `computed_at` | macro job | `/api/macro`, scanner job, boot check |
| `scanner_results` | PK `(ticker, computed_at)`, `composite`, `factors_json`, `rank`, `macro_mode`, `sector`, `sector_rank` | scanner job (one transaction) | `/api/scanner` |
| `scanner_run` | `id`, `macro_mode`, `count`, `computed_at` | scanner job | `/api/scanner`, `/api/tape`, boot check |
| `analyst_scores` | PK `(ticker, quarter_end)`, `dimensions_json`, `fundamental_score`, `model`, `computed_at` | analyst batch, deep-dive save | scanner blend, check pipeline |
| `price_cache` | PK `ticker`, `series_json`, `fetched_at` | macro, scanner, watchlist quotes | anything needing cached OHLCV |
| `watchlist` | PK `ticker`, `added_at` | watchlist routes | `/api/watchlist`, `/api/tape` |
| `alerts` | `id`, `ticker`, `target_low`, `target_high`, `status`, `created_at`, `triggered_at` | alert routes, alert job | `/api/alerts` (ordered by `created_at`) |
| `recent_checks` | PK `ticker`, `name`, `verdict_label`, `verdict_tone`, `price`, `llm`, `checked_at` | every `/api/check` | `/api/checks` |
| `llm_usage` | `id`, `kind`, `model`, `input_tokens`, `output_tokens`, `cost`, `created_at` | every Claude call | `/api/usage` (filters on `created_at`) |
| `verdict_log` | `id`, `ticker`, `verdict`, `label`, `confidence`, `price`, `source`, `created_at` | every `/api/check` (append-only) | `/api/backtest` |
| `watchlist_verdict_state` | PK `ticker`, `last_verdict`, `last_label`, `last_checked_at`, `notified_at` | `checkWatchlistSignals` | `/api/watchlist/signals` |
| `holdings` | `id`, `ticker`, `shares`, `cost_basis`, `source`, `imported_at` | CSV import (replace-all) | `/api/holdings` |
| `holdings_flags` | PK `ticker`, `tax_advantaged` | tax toggle (survives re-import) | `/api/holdings` |
| `settings` | PK `key`, `value` (JSON), `updated_at` | `/api/settings`, holdings import, `/api/news/sources` | risk tolerance, CSV mapping, holdings as-of, `videoSources` |
| `company_names` | PK `ticker`, `name`, `updated_at` (+ `sector` via migration) | `/api/holdings` and `/api/watchlist/signals` (fill unknown name + GICS sector once via the sidecar `names` cmd) | holdings display, watchlist signals |

**Three** additive column migrations run as guarded `ALTER TABLE` statements on boot, so
existing DBs pick them up without a migration system: `scanner_results.sector`,
`scanner_results.sector_rank`, and `company_names.sector`. Note that `company_names.sector`
is *not* in that table's `CREATE TABLE` — a fresh DB gets it from the migration too.

`llm_usage.kind` is one of `deep_dive`, `analyst`, `analyst_batch`. `usageThisMonth()` sums
from the first of the current UTC month.

Cache TTLs are set by callers, not by the store: **24 h** for macro, scanner, and
`/api/holdings` price reads; **6 h** for `/api/watchlist/quotes` and `/api/tape`.

---

## Market data

`server/src/stocks.js` + `server/scripts/yf_fetch.py`.

The sidecar is a Python process invoked with `execFile(YF_PYTHON, [yf_fetch.py, …])`
(60 s timeout, 96 MiB buffer, JSON on stdout). It exists because Yahoo 429s plain Node and
`requests`; `yfinance` + `curl_cffi` impersonate a browser TLS fingerprint.

**Sidecar subcommands**

| Command | Returns |
|---|---|
| `chart <SYM> <range>` | `{ quote: { ticker, name, price, changePct, high52, low52, currency }, series: { timestamp, open, high, low, close, volume } }` |
| `multi <range> <SYM…>` | `{ SYM: { closes, volumes, timestamp } }` — one batched download, failures skipped |
| `quote <SYM…>` | `{ SYM: { price, prevClose } \| null }` |
| `names <SYM…>` | `{ SYM: { name, sector } }` — one-time company-name + yfinance-sector lookup, cached into `company_names` |
| `fundamentals <SYM>` | `{ quarterEnd, shortRatio, sector, dividendYield, financials }` — 4 quarters of revenue, net income, operating cash flow, FCF, gross/operating margin, debt/equity, ROE, CFO÷NI, AR-growth-vs-revenue-growth spread. `shortRatio` and `dividendYield` come off `.info` and are often `null` |

Ranges map through `{1y, 5y, 5d}`, defaulting to `1y`. `auto_adjust=True` throughout.
`fcf = op_cashflow + capex` (capex is negative).

**Fallback chains**

`fetchChart(ticker, range)` — single ticker, full OHLCV:

1. Fixtures (if `STOCK_FIXTURES=1`)
2. **yfinance sidecar** — accepted only if a price came back
3. Twelve Data (only with `TWELVE_DATA_API_KEY`)
4. Yahoo chart HTTP — 3 attempts across `query1`/`query2`, session cookie + crumb primed
   from `fc.yahoo.com` and `finance.yahoo.com`, 30 min session TTL, backoff `500ms × attempt`
5. Stooq CSV
6. Fixtures (if `STOCK_FIXTURES_FALLBACK=1`), else rethrow

`fetchSeriesMulti(symbols, range)` — used by macro, scanner, `/api/watchlist/quotes`,
`/api/tape`, and `/api/holdings`:

1. Fixtures (if `STOCK_FIXTURES=1`) — **this tier exists**, unlike in `fetchChart`'s
   ordering, it short-circuits first
2. Sidecar `multi` — falls through on an empty/null map **or** on a sidecar failure (60 s
   `execFile` timeout, Python crash, bad JSON); skipped outright when `YF_DISABLE=1` or the
   sidecar was already marked unavailable this process
3. Then **either** Twelve Data multi **or** Yahoo spark — *not both*. With
   `TWELVE_DATA_API_KEY` set the function `return`s Twelve Data unconditionally, and
   `fetchTwelveDataMulti` swallows per-symbol errors, so a Twelve Data outage yields `{}`
   rather than falling through to spark. Spark is only reachable with **no** key set.

**No Stooq tier.**

`liveQuotes(symbols)` — 60 s in-process cache; fixtures short-circuit when
`STOCK_FIXTURES=1`, otherwise sidecar `quote` only, no HTTP fallback.

`fetchFundamentals(ticker)` — sidecar only, returns `null` on failure. **Memoized per
symbol**: 6 h for a hit, 30 min for a miss, so repeated `/api/check` calls on the same
ticker don't each spawn a Python process.

**Pacing and gotchas**

- Twelve Data multi-fetch is **serial with an 8 s sleep per symbol** (free tier: 8/min), so
  50 symbols ≈ 7 minutes and the default 550-name universe is impractical on that tier.
  The sidecar's single batched download is what makes the full universe viable — Twelve
  Data is a fallback for small symbol sets, not a peer.
- The Yahoo spark path returns **closes only, no volume**, so the scanner's `volume_surge`
  factor silently drops out on that path.
- The sidecar is disabled for the life of the process on `ENOENT` / `No module named` /
  `ModuleNotFoundError` — if `yfinance` is installed later, the process must be restarted.
- FRED is read as plain CSV graph URLs (`BAMLH0A0HYM2`, `VIXCLS`) — no API key.

---

## L1 — Macro gate

`macro/signals.js` + `macro/compute.js`. Each signal scores **0–100** (higher = more
risk-on). Missing data yields a neutral **50**.

| Signal | Weight | Source | Method |
|---|---|---|---|
| VIX Level | **0.25** | `^VIX` (sidecar) or FRED `VIXCLS` | Percentile rank in trailing 252 days; +5 if VIX < 15, −10 if VIX > 30 |
| VIX Term Structure | **0.20** | `^VIX` / `^VIX3M` | Ratio mapped over 1.15 → 0.85; contango is risk-on |
| Market Breadth | **0.20** | 20 megacaps | % above their 200-DMA, mapped over 30% → 80% |
| Credit Spreads | **0.15** | FRED HY OAS | z-score vs trailing 252, inverted, mapped over ±2σ |
| Put/Call Sentiment | **0.10** | `^VIX` 20-day rate of change | Inverted ROC mapped over +50% → −30% (**asymmetric** — see below) |
| Factor Crowding | **0.10** | MTUM, QUAL, VLUE, USMV, SIZE | Stdev of 60-day returns, mapped over 3 → 15 |

Composite = weighted mean **normalised by the summed weights of the signals actually
present**, 1 decimal. In practice the divisor is always 1.0 because a failed signal still
contributes a neutral 50 at full weight (see [Known limitations](#known-limitations)) —
but the code divides, it does not assume.

**Put/Call is not centred on 50.** `clip(((-rocPct + 50) / 80) × 100)` means a flat VIX
(ROC = 0) scores **62.5**, not 50; the band runs ROC +50% → 0 and ROC −30% → 100. Every
other signal is symmetric around 50. At weight 0.10 this is a standing **≈ +1.25**
risk-on tilt on the composite.

**Zones**

| Composite | Zone | Sizing | New longs | Scanner |
|---|---|---|---|---|
| ≥ 70 | `FULL DEPLOY` | 100% | yes | on (`OFFENSIVE`) |
| 40 – 69.9 | `REDUCED` | 60% | yes | on (`REDUCED`) |
| < 40 | `DEFENSIVE` | 25% | no | **off** |

Each fetch is wrapped so a failure degrades to 50 rather than killing the run.
"Put/Call Sentiment" is a **VIX-derived proxy**, not real options data — the CBOE feed was
judged too fragile. It shares its input series with the VIX Level signal.

---

## L2 — Quant scanner

`scanner/engine.js` + `scanner/factors.js` + `scanner/universe.js`
(+ `scanner/sp500-table.js`, `scanner/names.js`, `scanner/sectors.js`).

**Universe** (`scanner/universe.js`) — the full S&P 500 by default, scraped from Wikipedia
(requires ≥400 names, cached 24 h in `server/.cache/sp500.json`). `SCANNER_FULL_UNIVERSE=0`
forces a hardcoded ~100-name large-cap list; the scrape also falls back to it on failure.
The result is sliced to `SCANNER_UNIVERSE_SIZE` (default **550** full / **50** curated). `SPY`
is fetched for relative strength and then removed. Names with fewer than 200 cached closes
are dropped.

**Names + sectors** — the same Wikipedia constituents table carries each name's company
name and GICS sector; `sp500-table.js` (a pure, unit-tested parser) pulls all three fields
from every row, cached alongside the tickers. `resolveName`/`resolveSector` check that
scraped data first, then fall back to the static `names.js`/`sectors.js` maps (which cover
only the curated list). This gives full-S&P-500 coverage for Top-ranked names and holdings;
holdings resolves names from here *before* the per-symbol sidecar `names` lookup.

**Factors** (0–100, higher = better)

| Factor | Computation | Ranking |
|---|---|---|
| `momentum` | EMA10/EMA50 gap, doubled on a recent crossover, plus half the 63-day return | Percentile |
| `rel_strength` | 20-day return minus SPY's 20-day return | Percentile |
| `high_52wk_prox` | Last close ÷ 252-day high | Percentile |
| `volume_surge` | 5-day avg volume ÷ 20-day avg volume, mapped linearly over 0.7 → 2.0 | **Direct**, not ranked |
| `short_interest` | Inverted `shortRatio` from the sidecar — opt-in via `SCANNER_SHORT_INTEREST=1` | Percentile |

> **`SCANNER_SHORT_INTEREST=1` is expensive.** It runs one `fetchFundamentals` subprocess
> per ticker **serially, with a 120 ms sleep between each**, before any factor math. On
> the default 550-name universe that is 550 sequential Python spawns plus ~66 s of
> deliberate sleep. Budget for it or shrink `SCANNER_UNIVERSE_SIZE` alongside it.

**Composite** = equal-weight mean of the factors actually present (missing factors are
skipped, not penalised), sorted descending, ranked 1..N. Each row is also tagged with its
`sector` and a **within-sector rank** (`sectorRank`); both are persisted on
`scanner_results` and rendered on the Top-ranked rows as *"#3 in Technology"*.

**Macro gating**

- `DEFENSIVE` → the run persists an empty result set (`count: 0`) and returns
- `REDUCED` → the ranking is sliced to the **top 20**
- `FULL DEPLOY` → up to 100 rows persisted (readers take 50; the UI shows 20)

---

## L3 — Claude analyst

`analyst/analyzer.js` + `analyst/blender.js`.

**Scoring** — `claude-sonnet-4-6` via the **Message Batches API**, `custom_id` = ticker,
polled every 15 s until the batch ends. The system prompt is sent as a cache-controlled
block. Structured output, all fields required:

```
earnings_quality, growth_trajectory, balance_sheet_health, margin_trends,
red_flags            (integers, clamped 1–10)
composite_fundamental_score  (integer 1–10)
analyst_notes                (string)
```

All five dimensions are clamped 1–10 with **no sign flip anywhere on the server** — the
prompt asks for `red_flags` on the same 1–10 scale as the rest. The "higher is better"
reading of `red_flags` exists only as a **UI label** (`ProView.tsx` renders it as
*"Red flags (inv.)"*); it is a display convention, not a property of the scoring contract.

**Cache key** is `(ticker, quarter_end)`, where `quarter_end` comes from yfinance's most
recent income-statement column (falling back to the current calendar quarter end). Tickers
already scored for that quarter are skipped, so a re-run is nearly free. Batch pricing gets
the 50% discount in the cost ledger.

**Blender** — normalises quant composite and fundamental score across the current
candidate set (missing fundamentals fill with the batch median), then:

```
blendedScore = qw × quantNorm + (1 − qw) × fundamentalNorm
rankDelta    = quantRank − blendedRank        (positive = moved up)
rankFlag     = "upgrade"   when rankDelta ≥ +3
               "downgrade" when rankDelta ≤ −3
```

**`qw` is not a constant** — it is the saved risk profile's `quantWeight`, read on every
`/api/scanner` request: `0.45` conservative, `0.60` balanced (default), `0.75` aggressive.
The familiar "60/40 blend" is only the `balanced` case. See
[Risk tolerance](#risk-tolerance).

The blend is applied at read time in `/api/scanner`, so it appears without re-running the
scanner. `blender.js` also exports a `blendSummary()` helper that nothing calls —
`/api/scanner` builds its own (differently shaped) summary inline.

---

## Risk tolerance

`server/src/risk.js` (Phase 4.1). A single three-way setting — `conservative` /
`balanced` / `aggressive`, persisted server-side in `settings.riskTolerance` because it
drives server math — that shifts **two** knobs at request time:

| Profile | `quantWeight` (blender) | `buyZoneScale` (buy zone) |
|---|---|---|
| `conservative` | 0.45 — leans on fundamentals | 1.4 — waits for a deeper pullback |
| `balanced` *(default)* | 0.60 | 1.0 |
| `aggressive` | 0.75 — leans on momentum | 0.6 — buys closer to spot |

Read by `GET /api/scanner` (blend weights — **always** in effect) and `GET /api/check/:sym`
(buy-zone width — in effect **only on the deterministic fallback zone**; Claude's own
`buy_zone` wins when present). Exposed via `GET`/`PUT /api/settings` and rendered by
`web/src/components/RiskControl.tsx` inside the Top-ranked card. Changing it re-runs the
currently displayed ticker.

So with `ANTHROPIC_API_KEY` set, the practical effect of this control is the **ranking
blend**; the buy-zone half only bites in the keyless / `?deep=0` path.

**`POST /api/analyze` does not read it** — see the [HTTP API](#http-api) note.

---

## Single-ticker check pipeline

`analyze.js` — `analyzeTicker(ticker, { deep = true, fresh = false, buyZoneScale = 1 })`:

1. `fetchChart(ticker)` — 1 year of daily OHLCV
2. `fetchCloses("SPY")` for relative strength (degrades to `null`)
3. `computeIndicators()` — RSI(14, Wilder), EMA10/EMA50, SMA50/SMA200, 30-day annualised
   volatility, drawdown from the 1-year high, % of 52-week range, 3-month and 1-year
   returns, relative strength
4. `fetchFundamentals(ticker)` → determines the quarter for the cache key (fail-soft,
   and memoized for 6 h so a revisit doesn't re-spawn the sidecar)
5. **Cache-first Claude lookup** on `(ticker, quarter)`; if fundamentals failed, falls back
   to the latest cached analysis for that ticker so off-calendar fiscal quarters don't
   re-bill
6. If nothing cached and `deep` is on → live Opus deep-dive, then saved
7. **The deterministic engine always runs.** `buildGlance()` and `scoreVerdict()` are
   computed on every request; when Claude returned an analysis, its verdict *replaces* the
   deterministic one and `det` is discarded. The three at-a-glance cells the UI renders are
   therefore always the deterministic mapping, never Claude's.

**Beginner language** (`language.js`) maps numbers to words with a tone:

| Field | Words |
|---|---|
| Timing (RSI) | Running hot ≥70 · Warming up ≥60 · Steady · Cooling off ≤40 · Beaten down ≤30 |
| Quality (score) | Healthy ≥7 · Decent ≥4 · Shaky · Not rated |
| Price (% of range) | Looks pricey ≥66 · Around fair · Looks cheap ≤33 |
| Trend | Pointing up / Sideways / Pointing down (vote across SMA50, SMA200, EMA cross) |
| Volatility | Bumpy ≥40 · Moderate ≥20 · Calm |
| Drawdown | At its high (<3%) · "N% below high" |

**Deterministic verdict** (`verdict.js`) — additive score:

```
trend up +2 / down −2 · price cheap +2, fair +0.5, pricey −1.5
timing beaten-down or cooling +1, running hot −1.5, warming up −0.5
quality healthy +1.5 / shaky −1.5

score ≥  2.5  → "Good time to buy"   (BUY)
score ≤ −1.5  → "Avoid for now"      (SELL)
pricey or hot, and not shaky → "Wait for a dip"  (HOLD)
otherwise     → "No rush — wait"     (HOLD)
```

Confidence 1–4 from `|score|`.

**The buy zone has two sources.** When a Claude analysis is present its `buy_zone` is used
verbatim and `buyZoneScale` is discarded — which is the default path, since the deep-dive is
cached per `(ticker, quarter_end)` and revisits hit it for free. The formula below is the
**deterministic fallback**, used when Claude is unconfigured, `?deep=0`, or the call failed:

```
low  = price × (1 − 0.12 × buyZoneScale),  floored at low52
high = price × (1 − 0.05 × buyZoneScale),  capped at high52
(swapped if low > high, then rounded to 2dp)
```

With the default `balanced` profile (`buyZoneScale = 1`) that is the familiar
`0.88 × price` → `0.95 × price`. Conservative (1.4) widens it to `0.832` → `0.930`;
aggressive (0.6) narrows it to `0.928` → `0.970`.

---

## Claude integration

`server/src/llm.js`.

| Use | Model | Config |
|---|---|---|
| Deep-dive | `claude-opus-4-8` (`ANTHROPIC_DEEPDIVE_MODEL`) | `max_tokens: 4000`, adaptive thinking, JSON-schema structured output |
| Analyst | `claude-sonnet-4-6` (`ANTHROPIC_ANALYST_MODEL`) | `max_tokens: 1000`, Message Batches, prompt caching |

**Deep-dive schema**: `signal` (BUY/HOLD/SELL), `confidence`, `verdict_plain`,
`buy_zone {low, high}`, `trend`, `bull[]`, `bear[]`, `invalidation`,
`dimensions { growth, profitability, balance_sheet, valuation, moat }`,
`fundamental_score`. Numbers are clamped after parsing. The prompt passes only computed
indicators and the raw fundamentals JSON, with an explicit "use ONLY the data provided"
instruction.

**Cost ledger** — per million tokens: Opus `$5 in / $25 out`, Sonnet `$3 in / $15 out`;
cache writes ×1.25, cache reads ×0.1, batch calls ×0.5. Every call is written to
`llm_usage` and surfaced in the UI footer as *"Claude usage this month."* Logging failures
are swallowed so accounting never breaks a request.

**Without a key**: `llm.js` throws a distinct `LlmUnavailable` error, which `analyze.js`
catches silently — the response comes back with `llm: false` and the deterministic verdict.
Any *other* Claude error is surfaced as `llmError` while still returning a usable answer.

---

## Alerts

`server/src/alerts.js`. Alerts store a `targetLow` and/or `targetHigh`. A hit is
`low ≤ price ≤ high` when both are set, or `price ≤ threshold` when only one is.

The cron (every 10 min) reads active alerts, de-dupes by ticker, fetches a 5-day chart per
ticker (a fetch failure just retries next run), flips hits to `triggered`, and calls
Resend. **Without `RESEND_API_KEY` or `ALERT_EMAIL` the email is skipped but the alert
still flips** — the status change is the in-app signal. `ALERT_FROM` defaults to
`Stock Checker <onboarding@resend.dev>`; docker-compose overrides it to
`Market Specialist <onboarding@resend.dev>`.

> With Resend's shared `onboarding@resend.dev` sender, delivery only works to your own
> Resend account email. Verify a domain to send anywhere else.

---

## Frontend

`web/` — Vite 6, React 19, TypeScript, recharts. **No router**; a single `useState`
switches between three nav tabs — **Home**, **Research**, **Holdings** — plus a Hide $
toggle.

**Mounting is not uniform.** Home and Research are both mounted and toggled with
`display:none`, so they keep polling in the background. **Holdings is conditionally
mounted** (`{view === "holdings" && <HoldingsPage …/>}`) — leaving it unmounts the page,
drops its live-price subscriptions, and discards loaded portfolio state; returning
re-fetches from scratch.

**Research view** (`App.tsx`) — the ticker check tool and everything watchlist-derived

- Search form → `GET /api/check/:sym`; recently-checked chips; watchlist chips with inline
  add/remove
- **Answer card**: ticker (deep-links to Yahoo), live price, change as a toggle button
  (% ⇄ $), verdict label + confidence bars, three glance cells with ⓘ, a 52-week price
  position bar, watchlist and alert buttons, and a freshness line — *"Price live · analysis
  by Claude (cached this quarter) · as of 9:41 AM"* with **Refresh** and **Fresh deep-dive**
  (`?fresh=1`)
- *"Why this call?"* `<details>` ships **open**; *"Show the details"* (chart + 4 metrics +
  fundamental dimensions) ships **closed**
- The details expander also shows **dividend yield** (with its own inline ⓘ)
- Below the answer card, the watchlist-driven cards in this order: **Watching to buy**
  (`WatchingToBuy.tsx` — ticker + company name + live price + daily change + verdict,
  collapsible), **Your alerts** (`AlertsPanel.tsx`, collapsible), **Track record**
  (`BacktestCard.tsx`, collapsible), and finally the Claude usage footer (only when Claude
  is configured) at the very bottom

**Home dashboard** (`ProView.tsx`, rendered under a holdings teaser)

- **Market conditions** — collapsible (persisted), zone pill, 3 headline cells, the 6
  signals with per-signal ⓘ that includes the live detail string, "updated Nm ago",
  Refresh button
- **Top-ranked stocks** — collapsible (persisted), Refresh + **Analyst** buttons, the
  **Risk tolerance** segmented control (`RiskControl.tsx` — Conservative / Balanced /
  Aggressive; see [Risk tolerance](#risk-tolerance)), blend summary (candidates / upgrades
  / downgrades / avg blended), a "quant vs analyst disagreements (rank shift ≥ 3)" block,
  then up to 20 scrollable rows. Each row shows its within-sector rank (*"#3 in
  Technology"*). Rows with analyst data expand to show dimension chips, the fundamental
  score, the rank move, and Claude's notes.
- **Market videos** (`CnbcVideos.tsx`) — a scrollable 4×3 grid of thumbnails with an in-page
  `youtube-nocookie` embed, 5-min auto-refresh, manual Refresh, and a Sources manager
  (add by channel URL / `@handle` / `UC…` id, remove chips) backed by `/api/news/sources`
- Refresh polling windows: macro ~5 min (60 × 5 s), scanner and analyst ~20 min (80 × 15 s),
  sized for Twelve Data pacing and the async batch API

**Ticker tape** (`TickerTape.tsx`) — fixed footer, indexes pinned first then everything
alphabetical, duplicated track for a seamless marquee, `%`/`$` toggle, reloads every 60 s.

**Shared live prices** (`livePrices.ts`) — one module-level refcounted registry and a single
60 s poller feeding `GET /api/quotes`. The answer card, the scanner rows, the tape, and the
Holdings page all subscribe, so the same symbol shows the same price everywhere. On error it
keeps the last known price. `/api/holdings` still serves cached last-close prices for an
instant load; the Holdings page then overlays the live poller on the client (`liveAdjust`),
recomputing market value, gain/loss, totals, concentration, and the sector allocation.

**Timers running concurrently**: live prices 60 s · tape reload 60 s · macro+scanner poll
30 s · Market videos 5 min.

**Views** (`App.tsx`): the former Basic/Pro toggle is gone. Nav switches between `main` (the
Home dashboard — holdings teaser + macro, scanner, and Market videos), `research` (the ticker
check tool — search, recents, watchlist, answer card — followed by the watchlist-driven cards
Watching to buy, Your alerts, and Track record), and `holdings` (`HoldingsPage.tsx`). The
watchlist cards live on Research because they're all watchlist-derived; Home stays the
at-a-glance market/portfolio picture. A `?check=SYM` query param opens Research on that ticker
(used by HA notifications).

**Client-side persistence** is a small set of localStorage keys: `changeMode` (`pct`/`abs`),
`blurAmounts` (Hide $), and per-card collapse flags (`macroCollapsed`, `scannerCollapsed`,
`sectorAllocCollapsed`, `alertsCollapsed`, `holdingsTeaserCollapsed`, `watchingCollapsed`,
`trackRecordCollapsed`). That list is complete — no other localStorage key is written
anywhere in `web/src`.

**Only three of the seven collapse flags actually use `lib/useCollapsed.ts`**
(`holdingsTeaserCollapsed`, `watchingCollapsed`, `trackRecordCollapsed`). The other four —
`macroCollapsed` and `scannerCollapsed` in `ProView.tsx`, `alertsCollapsed` in
`AlertsPanel.tsx`, `sectorAllocCollapsed` in `HoldingsPage.tsx` — hand-roll the identical
`useState(() => localStorage.getItem(k) === "1")` pattern. Worth consolidating; until then,
don't assume changing the hook changes all seven.

Risk tolerance is **server-side** (`settings` table) since it drives server math;
watchlist, alerts, holdings, and recent checks also live server-side.

**Glossary** (`lib/glossary.ts`) holds **18** ⓘ explanations. Two *other sources* of tip
copy live outside it: `DIM_INFO` in `ProView.tsx` (7 entries, one ⓘ per analyst dimension
chip) and the dividend-yield tip inline in `App.tsx`. Glossary-first is the convention; add
new copy there unless it's dimension-specific.

**Also in `web/` but easy to miss**

- **PWA**: `index.html` ships a web manifest, `apple-touch-icon`, Apple standalone meta
  tags, and registers `/sw.js`. A stale service worker can serve old assets after a
  redeploy — hard-reload if the UI looks wrong post-deploy.
- **`ClearableInput`** (`components/`) is the shared ×-to-clear wrapper behind the search
  box, watchlist add, alert price, alert editor, and the holdings filter.
- **Holdings UI** (`HoldingsPage.tsx`) is substantially larger than its one-line mention
  above: CSV file-upload *and* paste, a preview → column-mapping → import flow, a
  click-to-filter sector allocation meter list, a four-way segment (All / Gainers / Losers
  / Tax-loss) plus text search and sector + institution selects, per-position
  tax-advantaged checkboxes, and concentration / tax-loss note rows.

---

## Design system

Ported from the Minset watch app. Tokens in `web/src/index.css`:

```
--bg #000000   --surface #0e0e0f   --surface-2 #1c1c1e   --surface-3 #2c2c2e
--text #fff    --text-2 62%        --text-3 40%
--hairline 12% --hairline-soft 7%  --pill #fff / --pill-text #000
--up #34c759   --down #ff453a      --warn #ffd60a   --accent #5ea2ff   --star #e8b04b
--font  -apple-system, SF Pro Display/Text, Helvetica Neue, system-ui
--maxw 900px   --radius 18px       --ease cubic-bezier(0.16, 1, 0.3, 1)
```

Dark-only (`color-scheme: dark`, no light branch, no toggle). 17px base, `tabular-nums` on
figures, hairline dividers, white pill buttons, text glyphs (`★ ☆ 🔔 ↻ ▲ ▼ ▾ ▸ ⓘ`) instead
of an icon library. Card anatomy: `insight-card` → `insight-head` / `insight-divider` /
`insight-cells` / `insight-foot`.

**No web fonts, deliberately** — `index.html` carries a comment saying so, and
`web/src/index.css` is the only stylesheet in the tree. The pre-Minset leftovers (Google
Fonts links, the orphaned `App.css`) were removed on 2026-07-25.

---

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `STATIC_DIR` | unset | Serve `web/dist` + SPA fallback when set; API-only otherwise |
| `CORS_ORIGIN` | reflect any | CORS allowed origin |
| `DB_PATH` | `server/stock-checker.db` | SQLite file location |
| `ANTHROPIC_API_KEY` | unset | Enables deep-dive + analyst; both degrade silently without it |
| `ANTHROPIC_DEEPDIVE_MODEL` | `claude-opus-4-8` | Deep-dive model ID |
| `ANTHROPIC_ANALYST_MODEL` | `claude-sonnet-4-6` | Analyst/batch model ID |
| `YF_PYTHON` | `python3` | Interpreter for the yfinance sidecar |
| `YF_DISABLE` | unset | `=1` disables the sidecar entirely |
| `TWELVE_DATA_API_KEY` | unset | Enables the Twelve Data tier (chart + multi, with volume) |
| `STOCK_FIXTURES` | unset | `=1` serves synthetic data end-to-end (charts, macro, scanner, quotes/multi, holdings) |
| `STOCK_FIXTURES_FALLBACK` | unset | `=1` falls back to fixtures only after every live source fails |
| `SCANNER_FULL_UNIVERSE` | on | Full S&P 500 (Wikipedia, 24 h cache) by default; `=0` forces the curated large-cap list |
| `SCANNER_UNIVERSE_SIZE` | `550` / `50` | Universe cap (550 full, 50 curated) |
| `SCANNER_SHORT_INTEREST` | unset | `=1` adds the short-interest factor (one sidecar subprocess per ticker) |
| `MARKET_TZ` | `America/New_York` | Timezone for the scanner, analyst, and watchlist-signal crons |
| `RESEND_API_KEY` | unset | Enables alert email |
| `ALERT_EMAIL` | unset | Alert recipient (required alongside the key) |
| `ALERT_FROM` | `Stock Checker <onboarding@resend.dev>` | From header; compose overrides to `Market Specialist <…>` |
| `HA_BASE_URL` | unset | Home Assistant base URL — enables watchlist buy-signal push |
| `HA_TOKEN` | unset | HA long-lived access token (required alongside the URL) |
| `HA_NOTIFY_SERVICE` | `notify` | The `notify.<service>` to call (e.g. `mobile_app_your_phone`) |
| `APP_BASE_URL` | unset | This app's URL, for deep-linking notifications into a ticker's check view |

`server/.env` is loaded via `dotenv/config` at the top of `index.js`. See
`server/.env.example` for the annotated template.

---

## Deployment

Multi-stage Dockerfile:

1. `node:22-alpine` builds `web/dist`
2. `node:22-slim` (**Debian, not Alpine** — `curl_cffi` ships glibc wheels only) installs
   Python + a venv from `server/scripts/requirements.txt`, installs production Node deps,
   copies the built UI, and runs `node server/src/index.js`

Compose maps host **8088** → container **3001**, sets `STATIC_DIR=/app/web/dist` and
`DB_PATH=/app/data/stock-checker.db`, and mounts the `stock-checker-data` named volume so
the watchlist, alerts, and cached analyst scores survive redeploys. Requires a 64-bit host.

Full Portainer/Home Assistant walkthrough: **[DEPLOY-HAOS.md](DEPLOY-HAOS.md)**.

---

## Known limitations

Documented deliberately — these are real behaviours of the current code, not bugs to be
inferred from the docs. **Every bullet below was re-verified against source on
2026-07-31**; none had been silently fixed.

**Correctness**

- **Missing macro signals score 50 at full weight.** A failed fetch produces a real
  neutral score rather than being dropped, biasing the composite toward `REDUCED`.
- **`latestFundamentalScores` / `getAnalystDetail` use `GROUP BY … HAVING MAX(computed_at)`**,
  which is always truthy — SQLite picks an arbitrary row per group. Correct in the common
  one-row-per-ticker case, wrong in principle.
- **Composites are not comparable across data-source paths.** The Yahoo spark fallback has
  no volume, so `volume_surge` drops and the mean is taken over three factors instead of four.
- **`AnswerCard` is not keyed by ticker**, so the alert price input keeps the previous
  symbol's buy-zone low until the row is reopened.
- **Currency handling is inconsistent**, in four different ways — the Research check view
  threads `quote.currency` through, scanner rows hardcode `"USD"`, the tape prints no
  currency symbol at all, `WatchingToBuy.tsx` defines its own local `money()` that hardcodes
  `"$"`, and every `HoldingsPage` call omits the argument so it defaults to `"USD"`.
- **`POST /api/analyze` silently ignores the risk profile** (and `deep`/`fresh`). With
  Claude configured this is invisible — both verbs return Claude's `buy_zone` — but in the
  keyless / `?deep=0` path the same ticker returns a different buy zone per verb.
- **`buyZoneScale` is dead weight on the default path.** It is threaded from the risk
  profile all the way into `suggestBuyZone`, then discarded whenever a Claude analysis
  exists. Half the risk-tolerance control is inert whenever `ANTHROPIC_API_KEY` is set.
- **`POST /api/alerts/check` and `POST /api/watchlist/signals/check` bypass the job
  concurrency guard** and can overlap their own crons — see [Scheduled jobs](#scheduled-jobs).
- **The Put/Call signal is not centred on 50** — a flat VIX scores 62.5, biasing the macro
  composite ≈ +1.25 risk-on at all times. See [L1](#l1--macro-gate).
- **`isTradableSymbol` (holdings.js) only excludes a fixed list of known cash-sweep
  symbols** (`CASH_LIKE`). A brokerage-specific sweep vehicle not on that list (e.g. a
  ticker like `FCASH` or `MSBNK`) passes the tradability check, imports as a real
  position, and its price lookup then fails quietly (`price: null`) rather than being
  skipped like a recognized cash symbol — it clutters Holdings instead of disappearing
  cleanly. Extend `CASH_LIKE` as new sweep names turn up.

**Operational**

- **The batch poll loop has no timeout.** A wedged analyst batch blocks all future analyst
  runs for the life of the process (the job guard never clears).
- **The Anthropic client and the sidecar-disabled flag are memoised for the process
  lifetime** — changing the key or installing `yfinance` requires a restart.
- **`/api/refresh/:layer` is admin-only** (session + `role=admin`) and can still kick a paid
  analyst batch — treat invite links carefully and keep `DAILY_LLM_BUDGET_USD` set.
- **`computeBreadth` output is discarded** — the scanner computes market breadth and throws
  it away; the macro signal re-fetches its own 20-name sample.
- **`express.json()` has no explicit body-size limit override**, so `/api/holdings/import`
  relies on Express's default 100 kb cap. The verified sample export (~160 rows, 34 kb) is
  well under it, but a much larger multi-account CSV could hit the ceiling.

**Cosmetic / dead code**

- `price_cache.indicators_json` is declared and never used.
- `api.ts` exports `getWatchlistQuotes()` that nothing calls (`getAlerts()` is no longer
  dead — Phase 1.3's `AlertsPanel` uses it).
- `blender.js` exports `blendSummary()` and `llm.js` exports `scoreFundamentals()` — both
  dead; `/api/scanner` builds its own summary inline and only the batch scorer is wired up.
- **Four of the seven collapse flags don't use the shared `useCollapsed` hook** — they
  duplicate its logic inline. See [Frontend](#frontend).
- `TickerTape.tsx`'s docstring still says *"Stays in view on both Basic and Pro"*,
  referencing the removed Basic/Pro toggle.
- `fetchSeriesMulti`'s fixture branch emits `timestamps` (plural) where every other
  producer emits `timestamp`. Harmless today — all consumers read `.closes` / `.volumes`.
- `server/.env.example` omits `STATIC_DIR` and `CORS_ORIGIN`, and its commented `ALERT_FROM`
  shows the compose override (`Market Specialist <…>`) rather than the code default
  (`Stock Checker <…>`).
- `HoldingsResponse.demo: boolean` (`web/src/api.ts`) is vestigial: Phase 3.4's demo-mode
  toggle was built and then cut before shipping (see CHANGELOG's 2026-07-25 entry), and the
  server's `/api/holdings` never actually sends this field. Either finish 3.4 or drop the
  field.
- No UI path passes `deep=0` to `/api/check`, though the API supports it.
- `language.js` exports `macroWord()`, which no server module calls.

**Documentation contract**

When a cron cadence, factor weight, zone cutoff, risk-profile constant, model ID, route, or
env var changes, update this file **in the same commit**. Limitations that get fixed move to
CHANGELOG.md under **Fixed** and come out of the list above.

*Fixed on 2026-07-25 and removed from this list: the dead short-interest factor, UTC cron
drift, the per-request fundamentals subprocess, the unused Google Fonts, the orphaned
`App.css`, and the missing alert-management UI (Phase 1.3 added `AlertsPanel` + `PUT
/api/alerts/:id`). See [CHANGELOG.md](CHANGELOG.md).*
