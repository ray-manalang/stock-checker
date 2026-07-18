// Deterministic technical indicators (§7 of the build spec).
// All functions are pure and defensive: they take arrays of numbers and never
// throw on short/empty input — they return null when there isn't enough data.

const TRADING_DAYS = 252;

/** Mean of the last n values. Returns null if fewer than n values. */
export function sma(values, n) {
  if (!Array.isArray(values) || values.length < n || n <= 0) return null;
  const window = values.slice(-n);
  return window.reduce((a, b) => a + b, 0) / n;
}

/**
 * Exponential moving average of period n, seeded with SMA(n).
 * k = 2/(n+1); EMA_t = c_t·k + EMA_{t-1}·(1-k).
 * Returns the final EMA value, or null if fewer than n values.
 */
export function ema(values, n) {
  if (!Array.isArray(values) || values.length < n || n <= 0) return null;
  const k = 2 / (n + 1);
  // Seed with SMA of the first n values, then walk forward.
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/**
 * Full EMA series (same length as input; the first n-1 entries are null).
 * Useful for crossover detection.
 */
export function emaSeries(values, n) {
  if (!Array.isArray(values) || values.length < n || n <= 0) return [];
  const k = 2 / (n + 1);
  const out = new Array(values.length).fill(null);
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * RSI(period) using Wilder smoothing. Returns 0..100, or null if too short.
 * avgGain/avgLoss seeded over the first `period` deltas, then Wilder-smoothed.
 */
export function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gainSum += delta;
    else lossSum -= delta;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Annualized volatility from the last `window` daily log returns, as a percent.
 * stdev(log returns) × √252 × 100. Returns null if too short.
 */
export function volatility(closes, window = 30) {
  if (!Array.isArray(closes) || closes.length < window + 1) return null;
  const slice = closes.slice(-(window + 1));
  const logReturns = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] <= 0 || slice[i] <= 0) continue;
    logReturns.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (logReturns.length < 2) return null;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance =
    logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100;
}

/**
 * Drawdown from the 52-week (max-of-series) high: price / max(closes) − 1.
 * Returned as a percent (negative or zero). Null if no data.
 */
export function drawdownFromHigh(price, closes) {
  if (typeof price !== "number" || !Array.isArray(closes) || closes.length === 0) {
    return null;
  }
  const high = Math.max(...closes, price);
  if (high <= 0) return null;
  return (price / high - 1) * 100;
}

/**
 * Percent position within a 52-week range: (price − low) / (high − low) × 100.
 * Clamped to 0..100. Null if the range is degenerate.
 */
export function pctOfRange(price, low52, high52) {
  if (
    typeof price !== "number" ||
    typeof low52 !== "number" ||
    typeof high52 !== "number" ||
    high52 <= low52
  ) {
    return null;
  }
  const pct = ((price - low52) / (high52 - low52)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Relative strength over ~1y: (price/price_252d_ago) − (spy/spy_252d_ago),
 * expressed as a percent. Falls back to the longest common lookback available.
 * Returns null if either series is too short.
 */
export function relativeStrength(closes, spyCloses, lookback = TRADING_DAYS) {
  if (!Array.isArray(closes) || !Array.isArray(spyCloses)) return null;
  const lb = Math.min(lookback, closes.length - 1, spyCloses.length - 1);
  if (lb < 1) return null;
  const p0 = closes[closes.length - 1 - lb];
  const p1 = closes[closes.length - 1];
  const s0 = spyCloses[spyCloses.length - 1 - lb];
  const s1 = spyCloses[spyCloses.length - 1];
  if (p0 <= 0 || s0 <= 0) return null;
  return (p1 / p0 - s1 / s0) * 100;
}

/** Simple N-day trailing return as a percent. Null if too short. */
export function trailingReturn(closes, days) {
  if (!Array.isArray(closes) || closes.length <= days || days <= 0) return null;
  const p0 = closes[closes.length - 1 - days];
  const p1 = closes[closes.length - 1];
  if (p0 <= 0) return null;
  return (p1 / p0 - 1) * 100;
}

/**
 * Compute the full single-ticker indicator bundle from an OHLCV series.
 * `series` = { close: number[], high: number[], low: number[], volume: number[] }
 * `quote`  = { price, high52, low52 }
 * `spyCloses` optional benchmark closes for relative strength.
 */
export function computeIndicators(series, quote, spyCloses = null) {
  const closes = (series?.close ?? []).filter((v) => typeof v === "number");
  const price = quote?.price ?? closes[closes.length - 1] ?? null;

  const ema10 = ema(closes, 10);
  const ema50 = ema(closes, 50);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);

  return {
    price,
    rsi14: rsi(closes, 14),
    ema10,
    ema50,
    sma50,
    sma200,
    // trend posture: is price above its 50 / 200-day averages?
    aboveSma50: price != null && sma50 != null ? price > sma50 : null,
    aboveSma200: price != null && sma200 != null ? price > sma200 : null,
    emaCrossUp: ema10 != null && ema50 != null ? ema10 > ema50 : null,
    volatility30: volatility(closes, 30),
    drawdownFromHigh: drawdownFromHigh(price, closes),
    pctOfRange: pctOfRange(price, quote?.low52, quote?.high52),
    return3m: trailingReturn(closes, 63),
    return1y: trailingReturn(closes, TRADING_DAYS),
    relativeStrength: spyCloses ? relativeStrength(closes, spyCloses) : null,
  };
}
