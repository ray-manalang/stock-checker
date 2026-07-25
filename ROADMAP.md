# Market Specialist — Enhancement Roadmap (PRD)

Written 2026-07-25, from a brainstorming session following the doc baseline at `main` @
`b544af4`. Read [ARCHITECTURE.md](ARCHITECTURE.md) for how the shipped app works today —
this document only covers what's new, and assumes that baseline throughout.

This is a **full backlog, not a v1 cut**. Every idea from the brainstorm is in here,
ordered into phases by dependency and by which items need lead time to pay off — not by
what's "essential" versus "nice to have." Nothing below is scoped out unless it's
explicitly marked as a non-goal.

Where I made a judgment call rather than confirming it with Ray, it's marked
**[assumption]** so it's easy to spot and override.

---

## Context

The app answers "is this a good time to buy?" well for a single ticker, but today it's
entirely reactive: it only tells you anything when you open it and search. It doesn't
know what you actually own, doesn't reach out when something you're watching becomes
attractive, and has no way to tell you whether its own verdicts have been any good. This
roadmap closes those three gaps, plus a handful of smaller ones the doc-baseline audit
surfaced (an alerts feature with no management UI, a scanner universe capped for a
data-source constraint that no longer applies) and some depth the analysis layer is
still missing (risk tolerance, sector context, dividends).

## Goals

- **Personalize** — verdicts should reflect what Ray actually owns and is watching, not
  just abstract per-ticker analysis.
- **Reach out** — surface a genuine buying opportunity without requiring Ray to remember
  to check.
- **Earn trust** — measure whether verdicts are actually right, not just confident-sounding.
- **Simplify** — one screen, not an unused toggle.
- **Finish, don't accumulate** — close known half-built gaps before adding new surface area.
- **Go deeper where it's real signal** — risk tolerance, sector context, dividends.

## Non-goals (ruled out, not deferred)

These were considered and explicitly rejected — revisiting them isn't "later," it's a
decision that would need new information to reopen.

- **Live brokerage sync** (Plaid, SnapTrade, or a direct Fidelity/E*TRADE integration).
  Fidelity has no retail read-only API; E*TRADE's is OAuth-gated and built for placing
  trades, not casually reading a balance; aggregators are commercial products with
  per-user fees that break the "data stays free" principle this app has held to
  everywhere else. A periodic CSV snapshot gets the personalization value without
  carrying brokerage credentials or tokens in the app's SQLite store.
- **Multi-user / authentication.** Stays a personal tool on the LAN.
- **Paid market data.** Stays Yahoo + FRED + the existing free fallback chain.

---

## Phase 1 — Foundation

Low-effort, no new dependencies, or work that needs lead time before it pays off.

### 1.1 Drop the Basic tab

**Problem:** the Basic/Pro toggle isn't used.

**Solution:** the check tool (search, answer card, watchlist, alerts) already renders
*inside* the current Pro layout — `App.tsx`'s `check-col` sits alongside `ProView`, it
isn't replaced by it. Dropping Basic means removing the `SegmentedControl` and the
`mode` state, and making today's Pro layout the only screen. No functional loss; nothing
that exists today needs to move.

**Effort:** small — a state/routing change, not a redesign.

### 1.2 Start logging verdicts (for Phase 4's backtesting)

**Problem:** there's no way to know whether a BUY verdict was actually a good call.

**Solution:** every `/api/check/:sym` response gets logged to a new table — ticker,
verdict, confidence, price at the time, and whether it came from the deterministic
engine or Claude. This is deliberately separate from `recent_checks`, which only keeps
the latest row per ticker for the UI chips and isn't a history.

**Why now, reported later:** the data needs weeks to months to accrue before a hit-rate
means anything. Starting the clock in Phase 1 — with zero user-facing change — means the
reporting UI in Phase 4 has real history to show instead of shipping empty.

**Technical note:** new `verdict_log` table (`id`, `ticker`, `verdict`, `confidence`,
`price`, `source`, `created_at`). No UI change in this phase.

### 1.3 Finish two known gaps

- **Alert management UI.** Alerts are create-only today — `getAlerts()` is exported from
  `api.ts` and never called. Add a list/edit/delete surface (a small "Your alerts" panel
  is enough; it doesn't need its own page).
- **Default the scanner to the full S&P 500.** `SCANNER_UNIVERSE_SIZE` defaults to 50
  because Twelve Data's 8-req/min pacing made 500 names impractical — but the Yahoo
  sidecar is primary now and doesn't have that constraint. Flip `SCANNER_FULL_UNIVERSE`
  on by default; keep both env vars as an escape hatch back to the curated list if the
  sidecar ever needs to fall back to Twelve Data for a stretch.

---

## Phase 2 — Proactive core

This is the actual behavior change: the app starts reaching out instead of waiting to
be opened.

### 2.1 Home Assistant as the push channel

**Problem:** Resend email is a weak, easy-to-miss channel, and it's running on the same
box as Home Assistant, which already reaches Ray's phone.

**Solution:** the Node app calls HA's own `notify.mobile_app_<device>` service directly
via a long-lived HA access token — real push notifications with no new external service
and no new app to install, since the HA mobile app is already the thing HA uses to reach
Ray's phone for everything else. Paired with a small `GET /api/ha/summary` endpoint HA
can poll (current macro zone, anything notable) so the state is also visible passively
on an HA dashboard if wanted.

**Existing alerts stay put:** the price-threshold alert feature (`alerts` table, Resend)
isn't being replaced — it's deprioritized. It keeps working; 2.2 below is the feature
that actually gets attention.

**Effort:** small-to-medium — one outbound HTTP call plus a small polling endpoint, no
new infrastructure to run.

### 2.2 Watchlist buy-signal notifications

**Problem:** "if there's a stock I'm interested in acquiring, tell me when it's a good
time to buy it" — today nothing runs against the watchlist proactively at all.

**Solution:** this reuses the *existing* watchlist rather than inventing a new list — a
ticker you don't yet own but want to buy is exactly what the watchlist already
represents (it's independent of the new Holdings table in Phase 3; a ticker can sit in
both if you want to add to something you already hold on a dip). A new daily job runs
the same pipeline that already powers a manual check (`analyzeTicker`) against every
watchlisted ticker, stores the last verdict it saw per ticker, and pushes a notification
via 2.1 only on the **transition into "Good time to buy"** — not every day the verdict
stays a BUY. That's the actual noise-avoidance mechanism, independent of delivery channel.

**Macro-gated:** the notification is suppressed unless the macro zone's `newLongs` flag
is currently true (it's `false` in `DEFENSIVE`). It would be self-defeating to ping
"buy X" while the app's own market-wide read says hold off on new positions — this is
the one place the macro gate (L1) and a per-ticker verdict actually meet today.

**Cost stays low:** the Claude deep-dive is already cached per fiscal quarter, so a daily
scan doesn't add meaningful Opus spend beyond the first check on a ticker each quarter.

**Decisions locked in:**
- **Cadence: once daily**, timed near market close — similar time-of-day to the
  scanner's existing 21:15 ET run, though it's an independent job over a different
  ticker set (the watchlist, not the scanner universe). No reason to check more often
  for a long-term holder who isn't chasing intraday moves.
- **Tap-through: yes.** The notification deep-links into that ticker's check view. A
  bare "AAPL looks good" with nowhere to go undercuts the reasoning/chart/buy-zone
  context that's the actual value here.

**Technical note:** new `watchlist_verdict_state` table (`ticker`, `last_verdict`,
`last_checked_at`, `notified_at`); new cron job (e.g. `checkWatchlistSignals`) following
the existing `guard()` pattern in `scheduler.js`, pinned to `MARKET_TZ` like the scanner
and analyst jobs already are.

---

## Phase 3 — Portfolio awareness

### 3.1 Holdings — multi-brokerage import

**Problem:** positions are spread across Fidelity, E*TRADE, Morgan Stanley, and possibly
others; nothing in the app knows what's actually owned.

**Solution:** a new **Holdings** table, separate from Watchlist — ticker, shares,
blended cost basis, and a `source` tag per institution.

- **CSV upload, not live sync.** Checked against a real sample export: it's a *single
  aggregated multi-institution* file (one `Institution` column per row covering several
  brokerages/custodians at once) rather than one export per brokerage — so the importer
  needs to handle one column schema, not a parser per source. First import, map which
  column is ticker/shares/cost-basis once; the mapping is remembered so re-imports are
  just "drop file."
- **Snapshot, not transaction log.** Re-importing replaces holdings wholesale rather
  than diffing buys/sells — much more robust, and it matches how this actually gets used
  (an occasional refresh, not real-time reconciliation). **[assumption]** given Ray holds
  long-term and re-imports infrequently, no "stale holdings" nudge is needed — a plain
  "holdings as of `<date>`" label is enough, the same pattern the app already uses for
  macro/scanner freshness.
- **Rolls up across sources, blended.** Same ticker at the same institution — even
  across what are likely separate accounts (e.g. taxable vs. Roth) — combines into one
  blended position, since the sample export has no per-row account label once account
  numbers are stripped out. **[decision]** no account-type field at import time; see 3.3
  for how tax-advantaged status gets handled instead, since that's the only place it
  actually matters.
- **Scope: tradable tickers only.** **[decision]** rows without a real market-tradable
  symbol — bonds, cash-sweep balances, private placements/REITs — are skipped entirely,
  not just hidden from verdicts, and don't count toward Holdings' total value or
  concentration %. The app's verdict engine is ticker-based via Yahoo Finance, so there's
  no analogous signal for these, and including their value without a verdict would make
  "% of portfolio" numbers that don't mean what they look like they mean.

### 3.2 Portfolio-aware macro gate

**Problem:** the macro gate already outputs a recommended sizing % by zone, but nothing
compares that against what's actually held.

**Solution, reshaped for a long-term holder** (exit-timing signals matter less here than
they would for an active trader):
- **Concentration** — surface what % of tracked holdings a position represents, so
  "AAPL is 38% of your portfolio" shows up rather than staying implicit.
- **Add-on-dips framing over exit framing** — a BUY verdict on something already held
  reads as "consider adding," not a binary in/out signal.
- **Gain/loss context next to the verdict** — a BUY signal on a position already up 60%
  reads differently than the same signal on something fresh; showing unrealized
  gain/loss inline makes that visible instead of leaving Ray to do the math.

### 3.3 Tax-loss harvesting — Tier 1 (aggregate)

**Problem:** a long-term holder cares about this more than a trader would, and the
gain/loss data 3.2 already needs is most of what a lightweight version requires.

**Solution:** when a holding's blended cost basis shows an unrealized loss **and** it's
marked taxable, surface it plainly — *"down $840 from cost basis — some investors sell
losers like this to offset gains elsewhere, then wait 30+ days before rebuying to avoid
the wash-sale rule."* Always paired with "this isn't tax advice."

**Depends on:** since 3.1 no longer derives account type from the CSV, this needs a
lightweight manual toggle in the Holdings UI instead — mark a position "tax-advantaged"
once after import. Defaults to taxable (the conservative direction: an unnecessary
wash-sale note is a minor annoyance, a missed one is a real one).

**Deliberately not attempted here** (see the backlog item below): lot-level precision
and cross-account wash-sale detection. This tier uses the same blended, aggregate cost
basis as 3.2 — it's a label on data already being computed, not new computation.

**Effort:** small — mostly copy plus the manual tax-advantaged toggle.

---

### 3.4 Demo mode for sharing

**Problem:** wanting to show the app to other people without exposing real holdings —
dollar amounts, share counts, cost basis, which brokerage.

**Solution:** reuse the pattern the app already has for offline demo data
(`STOCK_FIXTURES=1`, which serves deterministic synthetic data end-to-end) rather than
inventing a new mechanism — extend it with a canned example Holdings/Watching-to-buy/
Alerts dataset, and add a **UI toggle** (not just an env var, since this needs to flip
on mid-conversation, not require a restart) that swaps personal data for the sample set
app-wide. A small persistent banner marks it clearly ("Demo mode — showing example
data, not your real holdings") so it's never ambiguous which one you're looking at,
mirroring how this document's own mockup banner works.

Market conditions and Top-ranked stay live either way — that's public market data, not
personal, and there's no reason to fake it.

**Why this, not just blurring numbers:** a blur/hide toggle (common in banking apps) is
worth having too as a fast "someone glanced at my screen" reflex — I'd add it as a
lighter companion, not instead of demo mode. But for an actual walkthrough, showing
believable example data reads as a real feature, where blurred numbers read as
"something's broken" or unfinished.

**Scope note:** this is purely a display concern. Holdings data never leaves your box
for a Claude call today — the personalization (gain/loss, concentration %) is
arithmetic on top of the existing ticker-level verdict, not a new prompt that includes
your positions. The only exposure surface is literally what's rendered on screen.

**Effort:** small — the fixture-swap plumbing already exists; this is a canned dataset,
a toggle, and a banner.

---

## Phase 4 — Sharper analysis

Independent of everything above; deepens existing layers rather than filling a gap.

### 4.1 Risk-tolerance control

A simple control (Conservative / Balanced / Aggressive — **[assumption]** plain labels
rather than a raw numeric weight, consistent with the app's jargon-free design) that
shifts the blender's 60/40 quant-vs-fundamental weight and/or the suggested buy-zone
width, rather than exposing the raw weights directly.

### 4.2 Sector-relative ranking

Rank scanner candidates within their sector as well as (or instead of) across the whole
universe — a semiconductor name shouldn't only be judged against a utility. Sector
metadata is available from yfinance's ticker info; this is mostly a ranking-methodology
change in `scanner/factors.js`, not a new data source.

### 4.3 Dividend awareness

Surface yield and dividend history where relevant. **[assumption, worth confirming]** —
this was floated as a natural fit for a long-term holder but wasn't discussed in depth;
flag if it's not actually something Ray tracks, since it's easy to cut without
disturbing anything else in this phase.

### 4.4 Backtest reporting

Surfaces what Phase 1.2 has been quietly logging — a plain-English hit rate ("verdicts
issued 90+ days ago: correct direction X% of the time" — **[assumption]** a 90-day
forward window, graded on direction rather than magnitude; HOLD verdicts are the
trickiest to grade and may need their own, looser rule, e.g. "no large move either way").
This can't ship meaningfully until Phase 1.2 has had months to accrue data — sequenced
here deliberately, not because it's low-value.

---

## Phase 5 — Reach

Purely additive; no dependency on anything above.

### 5.1 PWA install

Installable to the homescreen so it feels like an app rather than a browser tab.

### 5.2 Compare view

Two or three tickers side by side — same glance cells, same chart, laid out for
comparison rather than one at a time.

---

## Backlog — kept, not cut

### Tax-loss harvesting — Tier 2 (lot-level + cross-account wash-sale detection)

**Why this is real, not just ambitious:** the wash-sale rule applies across *all*
accounts combined on a 61-day window — and neither Fidelity's nor E*TRADE's own tools
see across that boundary. Since Phase 3.1 already unifies holdings across sources, this
is the one place the app could see something neither brokerage can individually.

**Why it's deferred rather than built now:**
- Requires importing lot-level cost basis (a heavier export than the current-positions
  CSV in 3.1), not just a blended aggregate.
- "Substantially identical security" is a fuzzy legal standard past an exact-ticker
  match — a wrong answer here doesn't just look bad, it costs real tax dollars if
  trusted blindly. Not something to half-build for a beginner investor.
- The check is forward-looking as well as backward — flagging a harvest also means
  warning "don't rebuy for 30 days," which is a different kind of feature than anything
  else in this app.

Revisit if/when lot-level import is worth the lift on its own merits, not bundled into
a phase that doesn't need it.

---

## Assumptions log

Everything marked **[assumption]** above, in one place:

1. No "stale holdings" nudge needed — a plain "as of `<date>`" label is enough, given
   infrequent re-imports (3.1).
2. Risk-tolerance control uses plain labels (Conservative/Balanced/Aggressive), not a
   raw numeric weight (4.1).
3. Dividend awareness is worth building — unconfirmed; cheap to cut if not (4.3).
4. Backtest grading uses a 90-day forward window, graded on direction not magnitude, with
   HOLD graded more loosely than BUY/SELL (4.4).
5. Confirmed against a real sample export, not an assumption: Holdings blends same-
   ticker-same-institution rows with no account-type split, and skips non-tradable rows
   (bonds/cash/private holdings) entirely rather than counting their value (3.1); tax-
   advantaged status becomes a manual per-position toggle rather than a CSV field (3.3).

## Keeping this current

When a phase ships, move its items into `CHANGELOG.md` the same way the 2026-07-25 fix
pass was recorded, and update `ARCHITECTURE.md` with the new tables/jobs/endpoints in the
same commit — this document describes intent going in, not the state of the code once
it's built.
