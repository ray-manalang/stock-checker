import { fetchFundamentals } from "../stocks.js";
import { scoreFundamentalsBatch, SONNET } from "../llm.js";
import { getAnalystScore, saveAnalystScore } from "../db.js";

/** The fiscal-quarter key a score is cached under. */
export function quarterEndFor(fundamentals) {
  const q = fundamentals?.quarters?.[0]?.endDate;
  if (q) return q;
  return calendarQuarterEnd();
}

function calendarQuarterEnd() {
  const d = new Date();
  const q = Math.floor(d.getUTCMonth() / 3); // 0..3
  const endMonth = q * 3 + 2; // last month of the quarter
  const year = d.getUTCFullYear();
  const lastDay = new Date(Date.UTC(year, endMonth + 1, 0)).getUTCDate();
  const mm = String(endMonth + 1).padStart(2, "0");
  return `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
}

/** Read a cached analysis blob for a ticker's current quarter (any model). */
export function getCachedAnalysis(ticker, quarterEnd) {
  const row = getAnalystScore(ticker, quarterEnd, null);
  if (!row) return null;
  try {
    return {
      analysis: row.dimensions_json ? JSON.parse(row.dimensions_json) : null,
      fundamentalScore: row.fundamental_score,
      model: row.model,
      computedAt: row.computed_at,
    };
  } catch {
    return null;
  }
}

/** Persist a full analysis blob (from the Opus deep-dive or Sonnet scorer). */
export function saveAnalysis(ticker, quarterEnd, analysis, model) {
  saveAnalystScore({
    ticker,
    quarterEnd,
    dimensions: analysis, // full analysis object stored as the JSON blob
    fundamentalScore: analysis?.fundamental_score ?? null,
    model,
  });
}

/**
 * Quarterly analyst writer. Fetches fundamentals for each ticker, skips names
 * already scored this quarter, batch-scores the rest on Sonnet (50% off, rubric
 * prompt-cached), and caches by (ticker, quarter_end). Returns a map
 * ticker -> fundamentalScore for the blender.
 */
export async function scoreAnalyst(tickers) {
  const toScore = [];
  const scores = {};

  for (const ticker of tickers) {
    const fundamentals = await fetchFundamentals(ticker);
    const quarterEnd = quarterEndFor(fundamentals);
    const cached = getCachedAnalysis(ticker, quarterEnd);
    if (cached?.fundamentalScore != null) {
      scores[ticker] = cached.fundamentalScore;
      continue;
    }
    if (fundamentals) toScore.push({ ticker, fundamentals, quarterEnd });
  }

  if (toScore.length) {
    const results = await scoreFundamentalsBatch(
      toScore.map(({ ticker, fundamentals }) => ({ ticker, fundamentals })),
    );
    for (const { ticker, quarterEnd } of toScore) {
      const r = results[ticker];
      if (!r) continue;
      // Store in the same shape the Check flow reads (fundamental_score + dimensions).
      const blob = {
        fundamental_score: r.fundamentalScore,
        dimensions: r.dimensions,
        analyst_notes: r.notes,
      };
      saveAnalystScore({
        ticker,
        quarterEnd,
        dimensions: blob,
        fundamentalScore: r.fundamentalScore,
        model: SONNET,
      });
      scores[ticker] = r.fundamentalScore;
    }
  }
  return scores;
}
