// Deterministic verdict engine. Turns the computed indicators into the plain
// verdict shown on the Simple view. This runs instantly with zero external
// calls, so the page always has an answer even when the LLM is unavailable.
// When Claude is wired in, its richer signal/bull/bear enrich (but do not
// block) this baseline.

import {
  timingWord,
  qualityWord,
  priceWord,
  trendWord,
  volatilityWord,
  drawdownWord,
} from "./language.js";

const VERDICTS = {
  BUY: { label: "Good time to buy", tone: "up", signal: "BUY" },
  WAIT_DIP: { label: "Wait for a dip", tone: "warn", signal: "HOLD" },
  NO_RUSH: { label: "No rush — wait", tone: "neutral", signal: "HOLD" },
  AVOID: { label: "Avoid for now", tone: "down", signal: "SELL" },
};

/**
 * Score the indicators toward a buy decision.
 * Returns { verdict, confidence (1-4), why, score }.
 */
export function scoreVerdict(ind, fundamentalScore = null) {
  let score = 0;

  const trend = trendWord(ind);
  if (trend.word === "Pointing up") score += 2;
  else if (trend.word === "Pointing down") score -= 2;

  const price = priceWord(ind.pctOfRange);
  if (price.word === "Looks cheap") score += 2;
  else if (price.word === "Around fair") score += 0.5;
  else if (price.word === "Looks pricey") score -= 1.5;

  const timing = timingWord(ind.rsi14);
  if (timing.tone === "up") score += 1; // beaten down / cooling = better entry
  else if (timing.word === "Running hot") score -= 1.5;
  else if (timing.word === "Warming up") score -= 0.5;

  const quality = qualityWord(fundamentalScore);
  if (quality.word === "Healthy") score += 1.5;
  else if (quality.word === "Shaky") score -= 1.5;

  // Pick a verdict bucket.
  let key;
  const qualityGoodButExpensive =
    quality.word !== "Shaky" &&
    (price.word === "Looks pricey" || timing.word === "Running hot");

  if (score >= 2.5) key = "BUY";
  else if (score <= -1.5) key = "AVOID";
  else if (qualityGoodButExpensive) key = "WAIT_DIP";
  else key = "NO_RUSH";

  // Confidence 1-4 from the magnitude of the (dis)agreement.
  const mag = Math.abs(score);
  let confidence = 1;
  if (mag >= 3.5) confidence = 4;
  else if (mag >= 2) confidence = 3;
  else if (mag >= 1) confidence = 2;

  const why = buildWhy(key, { trend, price, timing, quality });

  return { verdict: VERDICTS[key], confidence, why, score: Number(score.toFixed(2)) };
}

function buildWhy(key, { trend, price, timing, quality }) {
  const priceLc = price.word.toLowerCase();
  const trendLc = trend.word.toLowerCase();
  switch (key) {
    case "BUY":
      return `The trend is ${trendLc} and the price ${priceLc} versus the past year.`;
    case "AVOID":
      return `The trend is ${trendLc}${
        quality.word === "Shaky" ? " and the business looks shaky" : ""
      } — better to wait.`;
    case "WAIT_DIP":
      return quality.word === "Not rated"
        ? `It ${priceLc} right now — a pullback would be a better entry.`
        : `The business looks ${quality.word.toLowerCase()}, but it ${priceLc} right now — a pullback would be a better entry.`;
    default:
      return `Nothing here is compelling yet — the trend is ${trendLc} and the price ${priceLc}.`;
  }
}

/**
 * Suggested buy zone as a deterministic fallback: a band a little below the
 * current price, anchored toward the lower half of the 52-week range.
 */
export function suggestBuyZone(price, low52, high52) {
  if (typeof price !== "number") return null;
  // Target the 5–12% pullback band, but never below the 52-week low.
  let low = price * 0.88;
  let high = price * 0.95;
  if (typeof low52 === "number") low = Math.max(low, low52);
  if (typeof high52 === "number") high = Math.min(high, high52);
  if (low > high) [low, high] = [high, low];
  return { low: Number(low.toFixed(2)), high: Number(high.toFixed(2)) };
}

/**
 * Assemble the full "glance" object the Simple view renders: the three headline
 * cells (Timing / Quality / Price) plus the Details metrics.
 */
export function buildGlance(ind, fundamentalScore = null) {
  return {
    timing: timingWord(ind.rsi14),
    quality: qualityWord(fundamentalScore),
    price: priceWord(ind.pctOfRange),
    trend: trendWord(ind),
    volatility: volatilityWord(ind.volatility30),
    drawdown: drawdownWord(ind.drawdownFromHigh),
  };
}
