# Changelog

All notable changes to **Market Specialist** (repo: `stock-checker`).

This file was reconstructed from git history on 2026-07-25 and starts from the baseline
below. Entries are grouped by the day the work landed on `main`.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The
project is not versioned; commits are the unit of record.

---

## 2026-07-25 — Enhancement roadmap (Phases 1–5)

Implemented the full [ROADMAP.md](ROADMAP.md) backlog: personalization (holdings),
proactive notifications, trust (backtesting), and deeper analysis.

### Added

- **Holdings (Phase 3).** New `Holdings` view with multi-brokerage CSV import
  (`POST /api/holdings/preview` + `/import`, remembered column mapping), snapshot
  semantics (re-import replaces wholesale), same-ticker roll-up across sources with a
  share-weighted blended cost basis, and non-tradable rows (cash/bonds/CUSIPs) skipped.
  Portfolio view (`GET /api/holdings`) surfaces concentration %, unrealized gain/loss,
  add-on-dip framing on held BUYs, and Tier-1 tax-loss notes with a per-position
  tax-advantaged toggle (`POST /api/holdings/:ticker/tax`). New `holdings` +
  `holdings_flags` tables.
- **Watching to buy (Phase 2.2).** Daily ET-pinned `checkWatchlistSignals` job runs the
  Check pipeline over the watchlist and notifies only on the *transition into* "Good time
  to buy", macro-gated on `newLongs`. New `watchlist_verdict_state` table;
  `GET /api/watchlist/signals` + manual `POST /api/watchlist/signals/check`.
- **Home Assistant push (Phase 2.1).** `notify.js` calls HA's `notify.mobile_app_*` via a
  long-lived token (deep-links into the ticker via `APP_BASE_URL`); `GET /api/ha/summary`
  for a passive HA dashboard tile. No-op without `HA_BASE_URL`/`HA_TOKEN`.
- **Fixtures end-to-end.** `STOCK_FIXTURES` now serves `fetchSeriesMulti`/`liveQuotes` too
  (previously only the scanner/macro fixture paths), so offline/demo data is believable
  across every surface — including Holdings. (Phase 3.4's demo-mode toggle and the "Hide $"
  blur were built and then cut before shipping; only this fixtures fix remains.)
- **Alert management UI (Phase 1.3).** List/edit/delete surface for the previously
  create-only alerts; `PUT /api/alerts/:id`.
- **Verdict logging + backtest (Phase 1.2 + 4.4).** Every check appends to a new
  `verdict_log`; `GET /api/backtest` grades verdicts ≥90 days old on direction (Hold graded
  loosely) and reports a hit rate. Track-record card in the UI.
- **Risk tolerance (Phase 4.1).** Conservative/Balanced/Aggressive control shifts the
  blender's quant/fundamental weight and the buy-zone width; persisted in `settings`.
  `GET`/`PUT /api/settings`.
- **Sector-relative ranking (Phase 4.2).** Scanner tags each name with its GICS sector and
  within-sector rank (static map + sidecar `sector`); shown in Top-ranked rows.
- **Dividend awareness (Phase 4.3).** Sidecar surfaces `dividendYield`; shown in a stock's
  details.
- **PWA (Phase 5.1).** Manifest, generated PNG icons, and a network-first service worker —
  installable to the homescreen. `GET /api/backtest`, offline shell (API always hits network).
- **Compare view (Phase 5.2).** Two or three tickers side by side. _(Later removed — see
  the follow-up note below.)_

### Changed

- **Dropped the Basic/Pro toggle (Phase 1.1).** The former Pro layout is the only screen.
- **Scanner defaults to the full S&P 500 (Phase 1.3).** `SCANNER_FULL_UNIVERSE` is on by
  default (set `=0` for the curated large-cap list); universe cap defaults to 550.

### Follow-ups (same day)

- **Navigation reworked** to Home / Research / Holdings. Home is a dashboard (holdings,
  alerts, track-record teasers + macro/scanner/CNBC); the ticker check tool moved to its own
  **Research** page. Personal cards lead the dashboard instead of sitting below the market
  cards. Restored a text-only **Hide $** privacy toggle. Removed the Compare view.
- **Holdings:** added filtering (search + All/Gainers/Losers/Tax-loss); serve last-close
  prices from the shared cache instead of spawning the live-quote sidecar per load (was slow).
- **Fixed a sidecar bug that surfaced as "Market data unavailable (429)".** `yf_fetch.py`
  emitted `NaN` for tickers whose latest bar was a partial/NaN close (e.g. WDAY, SPCX); `NaN`
  is invalid JSON, so Node's parse threw and the check fell through to the plain-Node Yahoo
  path that Yahoo always 429s. The sidecar now drops NaN closes and sanitizes all output.

---

## 2026-07-25

Documentation baseline, then a pass fixing what the audit turned up.

### Added

- `ARCHITECTURE.md` — full API, module, schema, and layer-math reference with a maintained
  *Known limitations* list
- `CHANGELOG.md` — this file
- `MARKET_TZ` (default `America/New_York`) pins the market-clock crons
- The sidecar's `fundamentals` command now returns `shortRatio`, so
  `SCANNER_SHORT_INTEREST=1` produces a real factor instead of an all-null column
- `DEPLOY-HAOS.md` gained the alert env vars (`RESEND_API_KEY`, `ALERT_EMAIL`,
  `ALERT_FROM`), `MARKET_TZ`, `SCANNER_UNIVERSE_SIZE`, and a schedules table

### Changed

- `README.md` rewritten — it still described the pre-2026-07-18 Gemini quote tool
- `CLAUDE.md` refreshed against the shipped code
- **Nightly scan moved from 22:15 UTC to 21:15 ET**, and the weekly analyst job to 03:00 ET.
  Both are DST-aware; the interval jobs (macro, alerts) are unchanged.
- `fetchFundamentals` is memoized per symbol (6 h on a hit, 30 min on a miss). `/api/check`
  was spawning a Python subprocess on every request, including ones a cached deep-dive
  answered.
- `server/.env.example` corrected — `SCANNER_UNIVERSE_SIZE` documents the real default (50,
  not 100) and `ALERT_FROM` shows the Market Specialist sender

### Removed

- Unused Instrument Sans / JetBrains Mono web fonts from `web/index.html` — the design
  system uses the system font stack, so these were downloaded on every page load and
  never applied
- Orphaned `web/src/App.css` (nothing imported it)

### Fixed

- Stale "REDUCED filters to composite >= 75" comments in `scanner/engine.js`; the rule has
  been a top-20 slice since `a2c3575`

---

## [Baseline] — `47b3e2a`, 2026-07-23

The documented state of the app. 49 commits, ~7,900 lines of source across
`server/` and `web/`. `README.md`, `ARCHITECTURE.md`, and `CLAUDE.md` describe this commit.

**What exists at baseline**

- Two-tab React 19 SPA — **Basic** (single-ticker plain-English answer) and **Pro**
  (macro gate, quant scanner, Claude analyst, CNBC video)
- Express API with 20 routes, node-cron precompute jobs, and a SQLite snapshot store
- Market data via a Python `yfinance` sidecar, with Twelve Data → Yahoo spark → Stooq →
  fixtures behind it
- Claude Opus deep-dive per ticker (cached by quarter) and Sonnet Message-Batch
  fundamental scoring blended into the scanner ranking
- Watchlist, buy-zone price alerts with Resend email, shared 60 s live-price poller,
  scrolling ticker tape
- Single-container Docker deployment on Home Assistant OS via Portainer

---

## 2026-07-23

### Changed

- Market conditions card is collapsible, with the state persisted (`47b3e2a`)
- Top-ranked stocks card is collapsible, with the state persisted (`5d271b0`)

## 2026-07-20

### Added

- **Latest from CNBC** video card in Pro — YouTube-backed, plays in-app (`461937a`)
- `%` / `$` change toggle on the answer card and the tape; answer-card symbol deep-links to
  Yahoo Finance (`f4aa2c1`)
- S&P 500 and Nasdaq pinned to the ticker tape; Yahoo links on tape symbols; `%`/`$` toggle
  on Top-ranked rows (`a77b0c0`)
- CNBC videos refresh every 5 minutes and gained a manual Refresh button (`af9c5cd`)

### Changed

- Live prices refresh the tape, Top-ranked, and the check card every minute (`060293e`)
- Consolidated onto one shared live-price poller so the tape and Top-ranked can't disagree
  (`5f8b3f1`), then the check card joined the same store (`973a381`)

## 2026-07-19

### Added

- Analyst L3 wired to real 4-quarter fundamentals via the sidecar (`efe6d94`)
- Analyst detail in Pro — KPI strip, quant-vs-analyst disagreements, expandable per-row
  notes (`fc51179`)
- Dedicated **Analyst** refresh button in Pro (`2253f07`)
- Watchlist ticker-tape footer, fixed and scrolling, in both views (`20d834e`), later
  sorted alphabetically (`9aafa84`) and extended with scanner top-ranked names (`daaacaf`)
- Info icons on analyst sub-scores (`1cf33bd`)

### Changed

- Pro layout iterated: side-by-side cards (`7a16de9`) → 3-column dashboard (`c64cbf3`) →
  settled on a single wider column with a slimmer search box (`8f83441`)
- Basic and Pro views matched at 900px width (`08163e7`)
- "Simple" tab renamed to **Basic** (`1cf33bd`)
- Default ticker pills removed from Pro (`2253f07`)

### Fixed

- Stopped re-billing Claude for tickers that were already cached (`c64cbf3`)
- Watchlist row no longer collides with the search box (`33bfaf3`)

## 2026-07-18

The day the app was rebuilt. Started as a Gemini-backed quote tool, ended as the
three-layer beginner-first app.

### Added

- **Evolved into a beginner-first equity app with the 3-layer pipeline** — macro gate,
  quant scanner, Claude analyst, Minset design system (`823d1b2`)
- Claude usage counter; **renamed the product to Market Specialist** (`45813c9`)
- Yahoo via the Python `yfinance`/`curl_cffi` sidecar as the primary data source
  (`3d1c804`), bundled into the Docker image (`72dcffc`)
- Twelve Data as an alternate source during the Yahoo outage (`6f274b4`), with company
  names resolved and cached from its `/quote` endpoint (`791669e`)
- FRED as the macro data source when Yahoo was unreachable (`b2c1690`)
- Batched Yahoo spark fetch plus a 24-hour price cache for the Pro layer (`dde098c`)
- Pro-view Refresh buttons and direct watchlist add (`af0e915`); background polling so
  refreshed data appears without a reload (`4b32c04`)
- Info tooltips on the macro card's cells and all 6 signals (`9318e53`)
- Company names and Yahoo links on scanner rows (`a6bea9c`); last price and daily change
  (`95ddd0d`)
- Persisted "recently checked" chips and a scrollable scanner list (`ffcac0b`)
- Buy-zone alert emails via Resend, plus a manual check endpoint (`8fe0475`)
- Spinner on the Check button while fetching (`6f272bc`)

### Changed

- Deployment switched from Gemini to Claude; SQLite moved onto a persistent named volume
  (`1418310`)
- Pro view shows the top 20 scanner rows, up from 10 (`7c5d7a4`)
- `.dockerignore` tracked, excluding the venv and DB, for clean Portainer builds (`c09bb01`)

### Fixed

- Yahoo session priming (cookie + crumb) to survive 429 anti-bot throttling (`f38fa29`)
- Deep-dive cache never hitting — Claude was re-run on every revisit (`5c51801`)
- Empty scanner ranking in a `REDUCED` market (`a2c3575`)
- Stale macro empty-state copy (`a3d1213`)

## 2026-05-25 — Initial

- Web app with Gemini analysis and Yahoo Finance quotes (`62977e7`)
- `docker-compose.yml` (`dd43398`), `Dockerfile` (`0c21758`)
- Static file serving for production/Docker mode (`f6030d5`)
- Footer replaced with a Yahoo Finance link for the analyzed ticker (`1605fb2`)

---

## Notes for future entries

- Add new work at the top under a dated heading, grouped as **Added / Changed / Fixed /
  Removed**, with the short SHA in parentheses.
- When behaviour documented in `ARCHITECTURE.md` changes — a cron cadence, a factor weight,
  a zone cutoff, a model ID, an env var — update that file in the same commit.
- Items listed under *Known limitations* in `ARCHITECTURE.md` should be struck from that
  list and noted here under **Fixed** when resolved.
