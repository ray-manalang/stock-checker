# Market Specialist — User guide

How to use the invite-only equity app at your shared instance (e.g.
`https://sc.knr-manalang.net`). Same content lives in the app under **Guide**.

---

## Overview

Market Specialist answers *“is this a good time to buy?”* in plain English. It’s
invite-only: each person has their own watchlist, holdings, alerts, and settings.
Shared market snapshots (macro, scanner, analyst) are the same for everyone on the
server.

| Tab | What it’s for |
|-----|----------------|
| **Home** | Market conditions, top-ranked names, market videos, holdings peek |
| **Research** | Ticker check, watchlist, alerts, track record |
| **Holdings** | Brokerage CSV import, gain/loss, concentration |
| **Profile** | Alert email, password, Claude usage, delete account |
| **Guide** | This documentation, in-app |

**Hide $** in the nav blurs dollar amounts. Open `?check=AAPL` to jump into Research
for that ticker.

**Ticker tape (footer marquee)** — major indexes, then your watchlist (★), then up to
20 top-ranked scanner names. Names you’ve recently checked in Research but haven’t
added to the watchlist are left off so one-off lookups don’t clutter the strip. Tap a
symbol for Yahoo Finance; use %/$ to match the rest of the app.

---

## Home

Nothing heavy is computed on page load. Scheduled jobs write snapshots; Home reads
the latest cache and shows freshness.

- **Market conditions** — six macro signals → composite → zone (`FULL DEPLOY` /
  `REDUCED` / `DEFENSIVE`). The zone gates how aggressive the scanner list is.
- **Top-ranked stocks** — quant ranking over a large US universe, optionally
  blended with Claude fundamentals. The list shows every current candidate (same
  count as Candidates). Tap a name to open Research.
- **Quant vs analyst disagreements** — when fundamentals are blended in, names
  whose blended rank moves **3+ spots** vs pure momentum are flagged as upgrades
  or downgrades. An **upgrade** means the business looks stronger than the chart
  alone; a **downgrade** means momentum may be ahead of fundamentals. Use them as
  a second look, not an automatic trade.
- **Risk tolerance** (Conservative / Balanced / Aggressive) — shifts how much
  rankings lean on fundamentals vs momentum, and (when there’s no Claude buy zone)
  how wide the suggested buy zone is.
- **Market videos** — YouTube clips; add/remove sources on Home.

Manual **Refresh** on market cards is **admin-only** so friends don’t burn API
quota by accident.

---

## Research

Enter a ticker (hyphens for share classes, e.g. `BRK-B`). You get:

- Live price and day change (toggle % / $)
- A plain-English verdict and confidence meter
- At-a-glance Timing / Quality / Price
- **Why this call?** — in its favor / watch outs / a plan
- **Show the details** — chart, buy zone, technicals

**Watchlist** — star a name or add chips under search. **Watching to buy** shows
watched names with their latest verdict and can notify the day one first becomes
“Good time to buy.”

**Your alerts** — set a price alert from the answer card; emails go to the address
on Profile (when the server has email configured).

**Track record** — how past verdicts scored, at the bottom of Research.

Tap ⓘ for glossary definitions. Recents reopen a prior check from cache when
possible so you don’t burn a new Claude call.

---

## Holdings

Import a brokerage CSV (the empty state shows the expected format and a sample
download). You’ll see positions, gain/loss, concentration, and sector mix.

Share counts and cost basis are **encrypted at rest** for your account. Other
people on this server — including admins via the app — cannot see your portfolio.

---

## Profile

- **Alert email** — where buy-zone emails are sent (optional)
- **Password** — change anytime (current password required)
- **Claude usage** — your attributed deep-dive spend (today / this month) and the
  **shared daily budget** for the whole site
- **Delete account** — permanently removes your personal data; shared market data stays

New accounts need an **invite link** from an admin (**Invite** in the nav). Your
host may also need your email on a Cloudflare Access allowlist.

---

## Claude deep-dives & daily budget

When Claude is configured, Research can add a fundamental deep-dive (bull/bear,
quality score, buy zone). Deep-dives are cached by quarter; **Fresh deep-dive**
forces a live call.

This server caps **site-wide** Claude spend with `DAILY_LLM_BUDGET_USD` (default
**$5 per UTC day**). When the cap is hit, new deep-dives pause until the next UTC
day — checks still work with the numbers-only verdict.

Your Profile and Guide pages show the cap, today’s site spend, and whether
deep-dives are currently allowed.

---

## Tip jar (LLM costs)

The app is free for invited friends. Each Claude answer costs a little real money.
Tips are **optional** and **never unlock features** — they help keep deep-dives
funded when the shared daily budget runs out.

The tip jar is a Ko-fi link (same pattern as [AptResume](https://github.com/ray-manalang/aptresume)):
configure `KOFI_URL` on the server (default `https://ko-fi.com/ideadog`). Use
**Chip in for LLM costs** on Profile or Guide; it opens Ko-fi in a new tab.

---

## Privacy & etiquette (short)

- Your watchlist, holdings, alerts, and settings are yours alone.
- Don’t share invite links broadly — they create real accounts on this instance.
- Prefer Recents / cached checks over hammering **Fresh deep-dive** so everyone
  stays under the daily Claude budget.
