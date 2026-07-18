// L2 scanner factor math, ported from stock-analyzer/scanner/engine.py.
// Each stock is scored 0–100 per factor; the composite is the equal-weight mean
// across the factors that have data (NaN skipped, not penalized).

/**
 * Percentile rank across the universe, matching pandas rank(pct=True)*100:
 * average rank for ties, divided by the count of non-null values. Null in →
 * null out (preserved through the rank).
 */
export function percentileRank(values) {
  const idx = [];
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] === "number" && !Number.isNaN(values[i])) idx.push(i);
  }
  const n = idx.length;
  const out = new Array(values.length).fill(null);
  if (n === 0) return out;

  const sorted = [...idx].sort((a, b) => values[a] - values[b]);
  // Assign average (1-based) rank to ties.
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[sorted[j + 1]] === values[sorted[i]]) j++;
    const avgRank = (i + 1 + (j + 1)) / 2; // 1-based inclusive
    for (let k = i; k <= j; k++) out[sorted[k]] = (avgRank / n) * 100;
    i = j + 1;
  }
  return out;
}

const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// EMA with adjust=False (seed = first value), matching pandas ewm(adjust=False).
function emaAdjustFalse(values, span) {
  if (!values?.length) return [];
  const k = 2 / (span + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/** Factor 1 — Momentum Crossover: EMA(10)/EMA(50) gap + crossover bonus +
 *  3-month return, then percentile-ranked. `closesMap` = {ticker: closes[]}. */
export function momentumFactor(closesMap) {
  const tickers = Object.keys(closesMap);
  const raw = tickers.map((t) => {
    const c = closesMap[t];
    if (!c || c.length < 63) return null;
    const e10 = emaAdjustFalse(c, 10);
    const e50 = emaAdjustFalse(c, 50);
    const last = c.length - 1;
    if (e50[last] === 0) return null;
    const gap = (e10[last] - e50[last]) / e50[last];

    // crossover: EMA10 above in the last 5d AND was <= in the prior 5d window.
    let crossed = false;
    if (c.length >= 55) {
      const recentAbove = e10.slice(-5).some((v, i) => v > e50.slice(-5)[i]);
      const priorBelow = e10.slice(-10, -5).some((v, i) => v <= e50.slice(-10, -5)[i]);
      crossed = recentAbove && priorBelow;
    }
    const c63 = c[c.length - 63];
    const ret63 = c63 > 0 ? clip(c[last] / c63 - 1, -1, 5) : 0;
    return gap * (1 + (crossed ? 1 : 0)) + ret63 * 0.5;
  });
  return zip(tickers, percentileRank(raw));
}

/** Factor 2 — Volume Surge: 5d/20d avg-volume ratio mapped 0.7→0, 2.0→100.
 *  Direct linear map (NOT percentile-ranked). */
export function volumeFactor(volumesMap) {
  const tickers = Object.keys(volumesMap);
  const scores = tickers.map((t) => {
    const v = volumesMap[t];
    if (!v || v.length < 20) return null;
    const avg5 = mean(v.slice(-5));
    const avg20 = mean(v.slice(-20));
    if (avg20 === 0) return null;
    const ratio = Math.max(0, avg5 / avg20);
    return clip(((ratio - 0.7) / (2.0 - 0.7)) * 100, 0, 100);
  });
  return zip(tickers, scores);
}

/** Factor 3 — Relative Strength: 20-day return spread vs SPY, percentile-ranked. */
export function relStrengthFactor(closesMap, spyCloses) {
  const tickers = Object.keys(closesMap);
  const spyRet = ret20(spyCloses);
  const raw = tickers.map((t) => {
    const r = ret20(closesMap[t]);
    return r == null || spyRet == null ? null : r - spyRet;
  });
  return zip(tickers, percentileRank(raw));
}

/** Factor 4 — 52-Week High Proximity: price / 52-week high, percentile-ranked. */
export function high52Factor(closesMap) {
  const tickers = Object.keys(closesMap);
  const raw = tickers.map((t) => {
    const c = closesMap[t];
    if (!c || c.length < 200) return null;
    const window = c.slice(-252);
    const high = Math.max(...window);
    const last = c[c.length - 1];
    return high > 0 ? clip(last / high, 0, 1) : null;
  });
  return zip(tickers, percentileRank(raw));
}

/** Factor 5 — Short Interest: shortRatio inverted, percentile-ranked. Missing → null. */
export function shortInterestFactor(shortRatioMap, tickers) {
  const values = tickers.map((t) => {
    const v = shortRatioMap[t];
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  });
  const present = values.filter((v) => v != null);
  const max = present.length ? Math.max(...present) : 0;
  const inverted = values.map((v) => (v == null ? null : max - v));
  return zip(tickers, percentileRank(inverted));
}

/**
 * Combine factor score maps into ranked rows. `factorMaps` is an object of
 * { name: {ticker: score} }. Composite = mean of the present factor scores.
 */
export function buildComposite(tickers, factorMaps) {
  const names = Object.keys(factorMaps);
  const rows = tickers.map((ticker) => {
    const factors = {};
    const present = [];
    for (const name of names) {
      const s = factorMaps[name][ticker];
      factors[name] = s ?? null;
      if (s != null) present.push(s);
    }
    const composite = present.length ? mean(present) : null;
    return { ticker, composite, factors };
  });
  rows.sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// ---------- helpers ----------
function mean(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function ret20(c) {
  if (!c || c.length < 21) return null;
  const p0 = c[c.length - 21];
  return p0 > 0 ? c[c.length - 1] / p0 - 1 : null;
}
function zip(keys, vals) {
  const out = {};
  keys.forEach((k, i) => (out[k] = vals[i]));
  return out;
}
