import { fetchChart, fetchCloses, fetchFundamentals } from "./stocks.js";
import { computeIndicators } from "./indicators.js";
import { buildGlance, scoreVerdict, suggestBuyZone } from "./verdict.js";
import { deepDiveTicker, LlmUnavailable, OPUS } from "./llm.js";
import {
  quarterEndFor,
  getCachedAnalysis,
  getLatestCachedAnalysis,
  saveAnalysis,
} from "./analyst/analyzer.js";

const VERDICT_LABEL = {
  BUY: { label: "Good time to buy", tone: "up" },
  HOLD: { label: "No rush — wait", tone: "neutral" },
  SELL: { label: "Avoid for now", tone: "down" },
};

/**
 * Full single-ticker Check. Everything except the LLM deep-dive is
 * deterministic and instant; the deep-dive enriches the response when a Claude
 * key is available and never blocks the core answer.
 */
export async function analyzeTicker(ticker, { deep = true, fresh = false } = {}) {
  const { quote, series } = await fetchChart(ticker);

  // Benchmark for relative strength (best-effort — never fail the whole call).
  let spyCloses = null;
  try {
    spyCloses = await fetchCloses("SPY");
  } catch {
    spyCloses = null;
  }

  const indicators = computeIndicators(series, quote, spyCloses);

  // Fundamentals are fragile; fail soft.
  const fundamentals = await fetchFundamentals(ticker);
  const quarterEnd = quarterEndFor(fundamentals);

  // L3 analyst: cache-first. A cached full Opus deep-dive (has `signal`) serves
  // instantly; `fresh` forces a new live call. A Sonnet-only cache row provides
  // just the fundamental score (used for the quality glance).
  let analysis = null;
  let cached = false;
  let llmError = null;
  let cachedFundamentalScore = null;

  // Cache-first. Prefer an exact quarter match; if fundamentals couldn't be
  // fetched (so quarterEnd fell back to the calendar quarter and may not match
  // how a prior deep-dive was keyed — e.g. fiscal-quarter names like WDAY),
  // fall back to the latest cached deep-dive rather than re-paying Claude.
  let hit = getCachedAnalysis(quote.ticker, quarterEnd);
  if (!hit && !fundamentals) hit = getLatestCachedAnalysis(quote.ticker);
  if (hit?.analysis?.signal && !fresh) {
    analysis = hit.analysis; // full deep-dive
    cached = true;
  } else if (hit?.fundamentalScore != null) {
    cachedFundamentalScore = hit.fundamentalScore;
  }

  if (!analysis && deep) {
    try {
      analysis = await deepDiveTicker({ quote, indicators, fundamentals });
      saveAnalysis(quote.ticker, quarterEnd, analysis, OPUS);
    } catch (err) {
      if (!(err instanceof LlmUnavailable)) {
        llmError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const fundamentalScore =
    analysis?.fundamental_score ?? cachedFundamentalScore ?? null;
  const glance = buildGlance(indicators, fundamentalScore);
  const det = scoreVerdict(indicators, fundamentalScore);

  // Prefer the LLM's verdict when available; otherwise the deterministic one.
  let verdict;
  let confidence;
  let why;
  let buyZone;
  if (analysis) {
    const mapped = VERDICT_LABEL[analysis.signal] ?? VERDICT_LABEL.HOLD;
    verdict = { ...mapped, signal: analysis.signal };
    confidence = analysis.confidence;
    why = analysis.verdict_plain;
    buyZone = analysis.buy_zone;
  } else {
    verdict = det.verdict;
    confidence = det.confidence;
    why = det.why;
    buyZone = suggestBuyZone(quote.price, quote.low52, quote.high52);
  }

  return {
    quote,
    series: { timestamp: series.timestamp, close: series.close },
    indicators,
    glance,
    verdict,
    confidence,
    why,
    buyZone,
    analysis, // null when LLM unavailable; full structured object otherwise
    llm: Boolean(analysis),
    cached, // true when the deep-dive was served from the quarter cache
    quarterEnd,
    llmError,
    asOf: new Date().toISOString(),
  };
}
