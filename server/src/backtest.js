// Backtest reporting (Phase 4.4). Grades the verdicts Phase 1.2 has been
// logging: for each verdict at least `windowDays` old, compare the price then to
// the price ~windowDays later and score direction (not magnitude). BUY is right
// if the price rose, SELL if it fell; HOLD is graded loosely — "no large move
// either way." This is meaningless until months of history accrue, which is why
// it's sequenced last; the logic ships now so the report isn't empty later.

import { fetchChart } from "./stocks.js";
import { verdictsOlderThan, verdictLogStats } from "./db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_BAND_PCT = 10; // |move| < this ⇒ a HOLD "no large move" is correct

/** Close in `series` nearest to (but not long before) `targetMs`. Null if the
 *  series doesn't reach the target date. */
function closeNear(series, targetMs) {
  const ts = series?.timestamp ?? [];
  const cl = series?.close ?? [];
  if (!ts.length) return null;
  const targetSec = targetMs / 1000;
  let best = null;
  let bestDiff = Infinity;
  for (let i = 0; i < ts.length; i++) {
    const diff = Math.abs(ts[i] - targetSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cl[i];
    }
  }
  // Require the series to actually span near the target (within ~10 days).
  if (bestDiff > 10 * DAY_MS / 1000) return null;
  return best;
}

function grade(verdict, fwdReturnPct) {
  if (fwdReturnPct == null) return null;
  switch (verdict) {
    case "BUY":
      return fwdReturnPct > 0;
    case "SELL":
      return fwdReturnPct < 0;
    case "HOLD":
    default:
      return Math.abs(fwdReturnPct) < HOLD_BAND_PCT;
  }
}

/**
 * Build the report. `windowDays` (default 90) is the forward grading horizon.
 * Fetches each held ticker's series once. Returns a plain-English-ready object.
 */
export async function buildBacktestReport({ windowDays = 90 } = {}) {
  const stats = verdictLogStats();
  const aged = verdictsOlderThan(windowDays * DAY_MS);
  const base = {
    windowDays,
    logged: stats.count,
    since: stats.since,
    graded: 0,
    ready: false,
  };
  if (!aged.length) return { ...base, buckets: {}, overall: null };

  // Fetch each unique ticker's series once (best-effort).
  const tickers = [...new Set(aged.map((v) => v.ticker))];
  const seriesByTicker = {};
  for (const t of tickers) {
    try {
      const { series } = await fetchChart(t, "1y");
      seriesByTicker[t] = series;
    } catch {
      seriesByTicker[t] = null;
    }
  }

  const buckets = {
    BUY: { total: 0, correct: 0 },
    HOLD: { total: 0, correct: 0 },
    SELL: { total: 0, correct: 0 },
  };
  let graded = 0;
  let correct = 0;

  for (const v of aged) {
    const series = seriesByTicker[v.ticker];
    if (!series || v.price == null) continue;
    const targetMs = new Date(v.createdAt).getTime() + windowDays * DAY_MS;
    const fwd = closeNear(series, targetMs);
    if (fwd == null) continue;
    const ret = ((fwd - v.price) / v.price) * 100;
    const ok = grade(v.verdict, ret);
    if (ok == null) continue;
    const b = buckets[v.verdict] ?? (buckets[v.verdict] = { total: 0, correct: 0 });
    b.total++;
    graded++;
    if (ok) {
      b.correct++;
      correct++;
    }
  }

  const pct = (c, t) => (t > 0 ? Math.round((c / t) * 100) : null);
  return {
    ...base,
    graded,
    ready: graded > 0,
    overall: pct(correct, graded),
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([k, b]) => [
        k,
        { total: b.total, correct: b.correct, hitRate: pct(b.correct, b.total) },
      ]),
    ),
  };
}
