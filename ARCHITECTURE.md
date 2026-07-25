# Architecture — Market Specialist

Technical reference for the `stock-checker` repo. **Baseline: `main` @ `53afb48`
(2026-07-25), after the Phases 1–5 enhancement pass** (see [CHANGELOG.md](CHANGELOG.md)).
Written from source. Independently verified via a clean clone (68/68 server tests,
`tsc --noEmit`, `vite build`, and a `STOCK_FIXTURES=1` smoke test all pass) — but not
verified against the running Home Assistant container or a real Holdings CSV import.

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
- **No authentication on any endpoint.** LAN use only.

---

## HTTP API

`server/src/index.js`. CORS origin from `CORS_ORIGIN` (default: reflect any origin).

| Method | Path | Params | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{ ok, llm }` |
| GET | `/api/usage` | — | `{ llm, calls, cost, inputTokens, outputTokens, since }` — month-to-date (UTC) |
| GET | `/api/checks` | — | `{ data: RecentCheck[] }`, most recent 12 (one row per ticker) |
| GET | `/api/check/:sym` | `?deep=0` skips the LLM · `?fresh=1` forces a live Opus call | Full check object (see below) |
| POST | `/api/analyze` | body `{ ticker }` | Same as above — back-compat alias |
| GET | `/api/macro` | — | `{ asOf, stale, data: { composite, zone, sizingPct, scannerActive, scannerMode, oneLiner, signals } }` |
| GET | `/api/scanner` | — | `{ asOf, stale, macroMode, scannerActive, blended, summary, data: Row[] }` |
| GET | `/api/watchlist` | — | `{ data: [{ ticker, addedAt }] }` |
| POST | `/api/watchlist` | body `{ ticker }` | `{ ok, data }` · 400 if missing |
| DELETE | `/api/watchlist/:sym` | — | `{ ok, data }` |
| GET | `/api/watchlist/quotes` | — | `{ data: [{ ticker, name, price, changePct }] }` (6 h price cache) |
| GET | `/api/tape` | — | `{ data: TapeItem[] }` — indexes, then watchlist, then top-20 scanner |
| GET | `/api/quotes` | `?symbols=AAPL,MSFT` | `{ data: { SYM: { price, changePct } } }` — 60 s in-process cache |
| GET | `/api/news/videos` | `?force=1` bypasses cache | `{ data: CnbcVideo[] }` — 5-min cache · 502 if no cache and upstream fails |
| GET | `/api/alerts` | — | `{ data: Alert[] }` |
| POST | `/api/alerts` | body `{ ticker, targetLow?, targetHigh? }` | `{ ok, alert, data }` · 400 if no ticker or no usable target |
| PUT | `/api/alerts/:id` | body `{ targetLow?, targetHigh? }` | `{ ok, data }` — edit + re-arm · 400 if no usable target |
| DELETE | `/api/alerts/:id` | — | `{ ok, data }` |
| POST | `/api/alerts/check` | — | `{ ok, checked, triggered }` — runs synchronously |
| GET | `/api/settings` | — | `{ riskTolerance, riskProfiles }` |
| PUT | `/api/settings` | body `{ riskTolerance? }` | `{ ok, riskTolerance }` |
| GET | `/api/watchlist/signals` | — | `{ data: WatchSignal[] }` — per-ticker last verdict + notify state |
| POST | `/api/watchlist/signals/check` | — | `{ ok, checked, notified }` — runs the daily scan now |
| GET | `/api/holdings` | — | `{ data: Portfolio, macro }` — rolled-up positions (gain/loss, concentration %, GICS sector, notes) + `bySector` allocation |
| POST | `/api/holdings/preview` | body `{ csv }` | `{ data: { headers, sample, rowCount, suggestedMapping } }` |
| POST | `/api/holdings/import` | body `{ csv, mapping, asOf? }` | `{ ok, imported, positions, skipped, skippedSymbols, asOf }` |
| POST | `/api/holdings/:ticker/tax` | body `{ taxAdvantaged }` | `{ ok }` — per-position flag (survives re-import) |
| GET | `/api/ha/summary` | — | `{ zone, composite, sizingPct, newLongs, oneLiner, asOf }` — for a passive HA tile |
| GET | `/api/backtest` | `?window=90` | `{ data: { windowDays, logged, graded, ready, overall, buckets } }` |
| POST | `/api/refresh/:layer` | `macro` \| `scanner` \| `analyst` | `{ ok, layer, started }` — fires in the background, returns immediately · 404 on unknown layer |
| GET | `/*` (non-`/api/`) | — | `index.html` — only when `STATIC_DIR` is set |

**`/api/check/:sym` response**

```
{ quote, series: { timestamp[], close[] }, indicators, glance, verdict, confidence,
  why, buyZone, analysis, llm, cached, quarterEnd, llmError, asOf }
```

**`/api/scanner` row shape**

- Unblended: `{ ticker, composite, rank, factors, name, price, changePct }`
- Blended (after an analyst run): adds `quantRank, blendedScore, rankDelta, rankFlag,
  fundamental, analyst`, and `rank` becomes the blended rank. `analyst` is
  `{ dimensions, notes, fundamentalScore, model }` or `null`.
- `summary` (blended only): `{ candidates, upgrades, downgrades, avgBlended, top5 }`

**`/api/tape` composition** — pinned `^GSPC` ("S&P 500") and `^IXIC` ("Nasdaq") tagged
`source:"index"`, then watchlist (`"watch"`), then the top 20 scanner rows not already
present (`"scan"`). Scanner names are omitted entirely when the macro zone is `DEFENSIVE`.

**`/api/news/videos`** reads CNBC Television's YouTube RSS feed
(channel `UCrp_UI8XtuYfpiqluWLD7Lw`), 12 s timeout, hand-rolled regex XML parse, 12 items.

---

## Scheduled jobs

`server/src/scheduler.js`, node-cron. The two market-clock jobs are pinned to `MARKET_TZ`
(default `America/New_York`) so they don't drift with DST or fire mid-afternoon ET on a
UTC container. The interval jobs are timezone-independent.

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
- `POST /api/refresh/:layer` calls the same functions out of band.

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
| `scanner_run` | `id`, `macro_mode`, `count`, `computed_at` | scanner job | `/api/scanner`, boot check |
| `analyst_scores` | PK `(ticker, quarter_end)`, `dimensions_json`, `fundamental_score`, `model` | analyst batch, deep-dive save | scanner blend, check pipeline |
| `price_cache` | PK `ticker`, `series_json`, `fetched_at` | macro, scanner, watchlist quotes | anything needing cached OHLCV |
| `watchlist` | PK `ticker`, `added_at` | watchlist routes | `/api/watchlist`, `/api/tape` |
| `alerts` | `id`, `ticker`, `target_low`, `target_high`, `status`, `triggered_at` | alert routes, alert job | `/api/alerts` |
| `recent_checks` | PK `ticker`, `verdict_label`, `verdict_tone`, `price`, `llm`, `checked_at` | every `/api/check` | `/api/checks` |
| `llm_usage` | `id`, `kind`, `model`, `input_tokens`, `output_tokens`, `cost` | every Claude call | `/api/usage` |
| `verdict_log` | `id`, `ticker`, `verdict`, `confidence`, `price`, `source`, `created_at` | every `/api/check` (append-only) | `/api/backtest` |
| `watchlist_verdict_state` | PK `ticker`, `last_verdict`, `last_label`, `last_checked_at`, `notified_at` | `checkWatchlistSignals` | `/api/watchlist/signals` |
| `holdings` | `id`, `ticker`, `shares`, `cost_basis`, `source`, `imported_at` | CSV import (replace-all) | `/api/holdings` |
| `holdings_flags` | PK `ticker`, `tax_advantaged` | tax toggle (survives re-import) | `/api/holdings` |
| `settings` | PK `key`, `value` (JSON) | `/api/settings`, holdings import | risk tolerance, CSV mapping, holdings as-of |
| `company_names` | PK `ticker`, `name` | `/api/holdings` (fills unknown names once via the sidecar `names` cmd) | holdings display |

Two additive column migrations (`scanner_results.sector`, `.sector_rank`) run as guarded
`ALTER TABLE` statements on boot, so existing DBs pick them up without a migration system.

`llm_usage.kind` is one of `deep_dive`, `analyst`, `analyst_batch`. `usageThisMonth()` sums
from the first of the current UTC month.

Cache TTLs are set by callers, not by the store: **24 h** for macro and scanner price
reads, **6 h** for `/api/watchlist/quotes` and `/api/tape`.

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
| `fundamentals <SYM>` | `{ quarterEnd, shortRatio, financials }` — 4 quarters of revenue, net income, operating cash flow, FCF, gross/operating margin, debt/equity, ROE, CFO÷NI, AR-growth-vs-revenue-growth spread. `shortRatio` comes off `.info` and is often `null` |

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

`fetchSeriesMulti(symbols, range)` — used by macro and scanner: sidecar `multi` → Twelve
Data multi → Yahoo spark. **No Stooq or fixture tier.**

`liveQuotes(symbols)` — 60 s in-process cache, sidecar `quote` only, no HTTP fallback.

`fetchFundamentals(ticker)` — sidecar only, returns `null` on failure. **Memoized per
symbol**: 6 h for a hit, 30 min for a miss, so repeated `/api/check` calls on the same
ticker don't each spawn a Python process.

**Pacing and gotchas**

- Twelve Data multi-fetch is **serial with an 8 s sleep per symbol** (free tier: 8/min), so
  50 symbols ≈ 7 minutes. This is why `SCANNER_UNIVERSE_SIZE` defaults to 50.
- The Yahoo spark path returns **closes only, no volume**, so the scanner's `volume_surge`
  factor silently drops out on that path.
- The sidecar is disabled for the life of the process on `ENOENT` / `No module named` — if
  `yfinance` is installed later, the process must be restarted.
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
| Put/Call Sentiment | **0.10** | `^VIX` 20-day rate of change | Inverted ROC mapped to 0–100 |
| Factor Crowding | **0.10** | MTUM, QUAL, VLUE, USMV, SIZE | Stdev of 60-day returns, mapped over 3 → 15 |

Composite = weighted mean, 1 decimal.

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
| `short_interest` | Inverted `shortRatio` from the sidecar — opt-in via `SCANNER_SHORT_INTEREST=1`, one subprocess per ticker | Percentile |

**Composite** = equal-weight mean of the factors actually present (missing factors are
skipped, not penalised), sorted descending, ranked 1..N.

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
red_flags            (integers, clamped 1–10; red_flags is inverted — higher is better)
composite_fundamental_score  (integer 1–10)
analyst_notes                (string)
```

**Cache key** is `(ticker, quarter_end)`, where `quarter_end` comes from yfinance's most
recent income-statement column (falling back to the current calendar quarter end). Tickers
already scored for that quarter are skipped, so a re-run is nearly free. Batch pricing gets
the 50% discount in the cost ledger.

**Blender** — normalises quant composite and fundamental score across the current
candidate set (missing fundamentals fill with the batch median), then:

```
blendedScore = 0.6 × quantNorm + 0.4 × fundamentalNorm
rankDelta    = quantRank − blendedRank        (positive = moved up)
rankFlag     = "upgrade"   when rankDelta ≥ +3
               "downgrade" when rankDelta ≤ −3
```

The blend is applied at read time in `/api/scanner`, so it appears without re-running the
scanner.

---

## Single-ticker check pipeline

`analyze.js` — `analyzeTicker(ticker, { deep = true, fresh = false })`:

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
7. Claude's verdict wins when present; otherwise the deterministic engine runs

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

Confidence 1–4 from `|score|`. The suggested buy zone is `max(price × 0.88, low52)` to
`min(price × 0.95, high52)`.

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
switches between two tabs rendered by a `SegmentedControl`: **Basic** and **Pro**.

Pro does not replace Basic — it renders the macro/scanner/CNBC cards *above* the same check
tool, which stays mounted and usable.

**Basic view** (`App.tsx`)

- Search form → `GET /api/check/:sym`; recently-checked chips; watchlist chips with inline
  add/remove
- **Answer card**: ticker (deep-links to Yahoo), live price, change as a toggle button
  (% ⇄ $), verdict label + confidence bars, three glance cells with ⓘ, a 52-week price
  position bar, watchlist and alert buttons, and a freshness line — *"Price live · analysis
  by Claude (cached this quarter) · as of 9:41 AM"* with **Refresh** and **Fresh deep-dive**
  (`?fresh=1`)
- *"Why this call?"* `<details>` ships **open**; *"Show the details"* (chart + 4 metrics +
  fundamental dimensions) ships **closed**
- Usage footer appears only when Claude is configured

**Pro view** (`ProView.tsx`)

- **Market conditions** — collapsible (persisted), zone pill, 3 headline cells, the 6
  signals with per-signal ⓘ that includes the live detail string, "updated Nm ago",
  Refresh button
- **Top-ranked stocks** — collapsible (persisted), Refresh + **Analyst** buttons, blend
  summary (candidates / upgrades / downgrades / avg blended), a "quant vs analyst
  disagreements (rank shift ≥ 3)" block, then up to 20 scrollable rows. Rows with analyst
  data expand to show dimension chips, the fundamental score, the rank move, and Claude's
  notes.
- **Latest from CNBC** — thumbnails, in-page `youtube-nocookie` embed, 5-min auto-refresh,
  manual Refresh
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
30 s · CNBC 5 min.

**Views** (`App.tsx`): the former Basic/Pro toggle is gone. Nav switches between `main` (the
Home dashboard — holdings/alerts/track-record teasers, macro, scanner, CNBC), `research` (the
ticker check tool — search, recents, watchlist, answer card), and `holdings`
(`HoldingsPage.tsx`). A `?check=SYM` query param opens the Research view on that ticker (used
by HA notifications).

**Client-side persistence** is three localStorage keys only: `changeMode` (`pct`/`abs`),
`macroCollapsed`, `scannerCollapsed`. Risk tolerance is **server-side** (`settings` table)
since it drives server math; watchlist, alerts, holdings, and recent checks also live
server-side.

**Glossary** (`lib/glossary.ts`) is the single source for all 19 ⓘ explanations — the
analyst dimension copy is the one exception and lives in `ProView.tsx`.

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

> `web/index.html` still loads **Instrument Sans** and **JetBrains Mono** from Google
> Fonts, and `web/src/App.css` references JetBrains Mono — but nothing imports `App.css`,
> and `index.css` sets the system font stack. Both are leftovers from the pre-Minset UI;
> the web fonts are downloaded and unused.

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
inferred from the docs.

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
- **Currency handling is inconsistent** — the Research check view threads `quote.currency`
  through, scanner rows hardcode `USD`, and the tape prints no currency symbol at all.
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
- **`/api/refresh/:layer` is unauthenticated and unthrottled** and can kick a paid analyst
  batch. Nothing in the app has auth; it is intended for LAN use only.
- **`computeBreadth` output is discarded** — the scanner computes market breadth and throws
  it away; the macro signal re-fetches its own 20-name sample.
- **`express.json()` has no explicit body-size limit override**, so `/api/holdings/import`
  relies on Express's default 100 kb cap. The verified sample export (~160 rows, 34 kb) is
  well under it, but a much larger multi-account CSV could hit the ceiling.

**Cosmetic / dead code**

- `price_cache.indicators_json` is declared and never used.
- `api.ts` exports `getWatchlistQuotes()` that nothing calls (`getAlerts()` is no longer
  dead — Phase 1.3's `AlertsPanel` uses it).
- `HoldingsResponse.demo: boolean` (`web/src/api.ts`) is vestigial: Phase 3.4's demo-mode
  toggle was built and then cut before shipping (see CHANGELOG's 2026-07-25 entry), and the
  server's `/api/holdings` never actually sends this field. Either finish 3.4 or drop the
  field.
- No UI path passes `deep=0` to `/api/check`, though the API supports it.
- `language.js` exports `macroWord()`, which no server module calls.

*Fixed on 2026-07-25 and removed from this list: the dead short-interest factor, UTC cron
drift, the per-request fundamentals subprocess, the unused Google Fonts, the orphaned
`App.css`, and the missing alert-management UI (Phase 1.3 added `AlertsPanel` + `PUT
/api/alerts/:id`). See [CHANGELOG.md](CHANGELOG.md).*
