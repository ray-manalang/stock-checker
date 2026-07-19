// Claude LLM layer (replaces Gemini). Uses the Anthropic SDK with structured
// output via output_config.format — no brittle regex parsing.
//
// The single-ticker deep-dive runs on Opus 4.8 with adaptive extended thinking.
// If ANTHROPIC_API_KEY is unset the functions throw LlmUnavailable, which
// callers catch to fall back to the deterministic verdict — the app never
// breaks just because the key is missing.

import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./db.js";

// Price per 1M tokens (input, output). Cache reads bill ~0.1x input, cache
// writes ~1.25x; the Batch API is 50% off.
const PRICING = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
};

function costOf(model, usage, { batch = false } = {}) {
  const p = PRICING[model] ?? PRICING["claude-opus-4-8"];
  const u = usage ?? {};
  const inTok = u.input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const outTok = u.output_tokens ?? 0;
  let cost =
    (inTok * p.in + cacheWrite * p.in * 1.25 + cacheRead * p.in * 0.1 + outTok * p.out) /
    1e6;
  if (batch) cost *= 0.5;
  return { cost, inputTokens: inTok + cacheWrite + cacheRead, outputTokens: outTok };
}

function logUsage(kind, model, usage, opts) {
  try {
    const c = costOf(model, usage, opts);
    recordUsage({ kind, model, inputTokens: c.inputTokens, outputTokens: c.outputTokens, cost: c.cost });
  } catch {
    /* never let accounting break a request */
  }
}

export class LlmUnavailable extends Error {
  constructor(message) {
    super(message ?? "ANTHROPIC_API_KEY is not set");
    this.name = "LlmUnavailable";
  }
}

const OPUS = process.env.ANTHROPIC_DEEPDIVE_MODEL?.trim() || "claude-opus-4-8";
const SONNET =
  process.env.ANTHROPIC_ANALYST_MODEL?.trim() || "claude-sonnet-4-6";

let _client = null;
function client() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new LlmUnavailable();
  if (!_client) _client = new Anthropic({ apiKey: key });
  return _client;
}

export function llmConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

// Structured-output schema for the deep-dive (§8 of the build spec). Structured
// outputs don't support numeric min/max, so ranges are enforced via the prompt
// and clamped after parsing; enums are supported and used for the signal.
const DEEP_DIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    signal: { type: "string", enum: ["BUY", "HOLD", "SELL"] },
    confidence: { type: "integer" }, // 1–4
    verdict_plain: { type: "string" },
    buy_zone: {
      type: "object",
      additionalProperties: false,
      properties: { low: { type: "number" }, high: { type: "number" } },
      required: ["low", "high"],
    },
    trend: { type: "string" },
    bull: { type: "array", items: { type: "string" } },
    bear: { type: "array", items: { type: "string" } },
    invalidation: { type: "string" },
    dimensions: {
      type: "object",
      additionalProperties: false,
      properties: {
        growth: { type: "integer" },
        profitability: { type: "integer" },
        balance_sheet: { type: "integer" },
        valuation: { type: "integer" },
        moat: { type: "integer" },
      },
      required: ["growth", "profitability", "balance_sheet", "valuation", "moat"],
    },
    fundamental_score: { type: "integer" }, // 1–10
  },
  required: [
    "signal",
    "confidence",
    "verdict_plain",
    "buy_zone",
    "trend",
    "bull",
    "bear",
    "invalidation",
    "dimensions",
    "fundamental_score",
  ],
};

const clampInt = (v, lo, hi) =>
  typeof v === "number" ? Math.max(lo, Math.min(hi, Math.round(v))) : null;

/**
 * On-demand single-ticker deep-dive. Feeds Claude the price context plus the
 * computed technicals and (optional) fundamentals. Returns the parsed,
 * clamped structured object. Throws LlmUnavailable if no key is set.
 */
export async function deepDiveTicker({ quote, indicators, fundamentals }) {
  const c = client();
  const prompt = buildDeepDivePrompt({ quote, indicators, fundamentals });

  const res = await c.messages.create({
    model: OPUS,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: DEEP_DIVE_SCHEMA } },
    system:
      "You are a disciplined equity analyst writing for a beginner investor. " +
      "Use ONLY the data provided — do not invent news, earnings surprises, or macro events. " +
      "Ground every claim in the numbers given. Keep bull/bear points to plain, concrete sentences.",
    messages: [{ role: "user", content: prompt }],
  });
  logUsage("deep_dive", OPUS, res.usage);

  const text = res.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no structured output");
  const raw = JSON.parse(text);

  // Clamp numeric ranges the schema can't enforce.
  raw.confidence = clampInt(raw.confidence, 1, 4) ?? 2;
  raw.fundamental_score = clampInt(raw.fundamental_score, 1, 10) ?? 5;
  for (const k of Object.keys(raw.dimensions ?? {})) {
    raw.dimensions[k] = clampInt(raw.dimensions[k], 1, 10) ?? 5;
  }
  return raw;
}

function fmt(v, digits = 2) {
  return typeof v === "number" && !Number.isNaN(v) ? v.toFixed(digits) : "n/a";
}

function buildDeepDivePrompt({ quote, indicators, fundamentals }) {
  const i = indicators ?? {};
  const lines = [
    `Ticker: ${quote.ticker} (${quote.name ?? ""})`,
    `Current price: $${fmt(quote.price)} ${quote.currency ?? "USD"}`,
    `52-week high / low: $${fmt(quote.high52)} / $${fmt(quote.low52)}`,
    `% of 52-week range: ${fmt(i.pctOfRange, 1)}%`,
    `RSI(14): ${fmt(i.rsi14, 1)}`,
    `Trend: price ${i.aboveSma50 ? "above" : "below"} its 50-day avg, ${
      i.aboveSma200 ? "above" : "below"
    } its 200-day avg; EMA10 ${i.emaCrossUp ? "above" : "below"} EMA50`,
    `Annualized volatility (30d): ${fmt(i.volatility30, 1)}%`,
    `Drawdown from 1-year high: ${fmt(i.drawdownFromHigh, 1)}%`,
    `3-month return: ${fmt(i.return3m, 1)}%   1-year return: ${fmt(i.return1y, 1)}%`,
  ];
  if (i.relativeStrength != null) {
    lines.push(`Relative strength vs SPY (1y): ${fmt(i.relativeStrength, 1)}%`);
  }
  if (fundamentals?.financials) {
    lines.push(
      "",
      "Fundamentals — last 4 quarters (most recent first), via yfinance:",
      JSON.stringify(fundamentals.financials, null, 2),
    );
  } else {
    lines.push("", "Fundamentals: unavailable — score valuation/quality conservatively.");
  }

  lines.push(
    "",
    "Produce a structured outlook. Rules:",
    "- signal: BUY / HOLD / SELL.",
    "- confidence: integer 1 (low) to 4 (high).",
    "- verdict_plain: one plain-English sentence a beginner understands.",
    "- buy_zone: a concrete dollar range that is a sensible entry.",
    "- trend: one short phrase (e.g. 'uptrend', 'range-bound', 'downtrend').",
    "- bull / bear: 2–3 concrete points each, grounded in the numbers above.",
    "- invalidation: one line — what would break the thesis (e.g. a price level).",
    "- dimensions: score growth, profitability, balance_sheet, valuation, moat 1–10.",
    "- fundamental_score: overall 1–10 fundamental quality.",
  );
  return lines.join("\n");
}

// ---------- L3 analyst: fundamental scoring (Sonnet, batchable) ----------

const ANALYST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    earnings_quality: { type: "integer" },
    growth_trajectory: { type: "integer" },
    balance_sheet_health: { type: "integer" },
    margin_trends: { type: "integer" },
    red_flags: { type: "integer" },
    composite_fundamental_score: { type: "integer" }, // 1–10, produced by the model
    analyst_notes: { type: "string" },
  },
  required: [
    "earnings_quality",
    "growth_trajectory",
    "balance_sheet_health",
    "margin_trends",
    "red_flags",
    "composite_fundamental_score",
    "analyst_notes",
  ],
};

const ANALYST_SYSTEM =
  "You are a senior equity analyst scoring a company's fundamentals 1–10 on five " +
  "dimensions: earnings_quality (accruals, CFO/NI, revenue-recognition red flags), " +
  "growth_trajectory (revenue/income/FCF trend and acceleration), balance_sheet_health " +
  "(debt/equity, leverage trend, liquidity), margin_trends (gross & operating margin " +
  "direction/stability), and red_flags (manipulation signals, AR growing faster than " +
  "revenue, unusual items). Then give an overall composite_fundamental_score (1–10) and a " +
  "one-line analyst_notes. Use ONLY the data provided; do not invent news.";

function analystPrompt({ ticker, fundamentals }) {
  const financials = fundamentals?.financials;
  if (financials) {
    return (
      `Please score this company's fundamental quality.\n\n` +
      `Financial data (last 4 quarters, most recent first):\n` +
      JSON.stringify(financials, null, 2)
    );
  }
  return `Ticker: ${ticker}\nQuarterly financials unavailable — score conservatively.`;
}

function clampAnalyst(raw) {
  const c = (v) => clampInt(v, 1, 10) ?? 5;
  return {
    dimensions: {
      earnings_quality: c(raw.earnings_quality),
      growth_trajectory: c(raw.growth_trajectory),
      balance_sheet_health: c(raw.balance_sheet_health),
      margin_trends: c(raw.margin_trends),
      red_flags: c(raw.red_flags),
    },
    fundamentalScore: c(raw.composite_fundamental_score),
    notes: typeof raw.analyst_notes === "string" ? raw.analyst_notes : "",
  };
}

/** Score one ticker's fundamentals (Sonnet, structured). Throws LlmUnavailable if no key. */
export async function scoreFundamentals({ ticker, fundamentals }) {
  const c = client();
  const res = await c.messages.create({
    model: SONNET,
    max_tokens: 1000,
    system: ANALYST_SYSTEM,
    output_config: { format: { type: "json_schema", schema: ANALYST_SCHEMA } },
    messages: [{ role: "user", content: analystPrompt({ ticker, fundamentals }) }],
  });
  logUsage("analyst", SONNET, res.usage);
  const text = res.content.find((b) => b.type === "text")?.text;
  return clampAnalyst(JSON.parse(text));
}

/**
 * Batch-score many tickers via the Message Batches API (50% off), with the
 * shared rubric prompt-cached. `items` = [{ ticker, fundamentals }]. Returns a
 * map ticker -> { dimensions, fundamentalScore, notes }. Throws LlmUnavailable.
 */
export async function scoreFundamentalsBatch(items) {
  const c = client();
  const system = [{ type: "text", text: ANALYST_SYSTEM, cache_control: { type: "ephemeral" } }];
  const batch = await c.messages.batches.create({
    requests: items.map((it) => ({
      custom_id: it.ticker,
      params: {
        model: SONNET,
        max_tokens: 1000,
        system,
        output_config: { format: { type: "json_schema", schema: ANALYST_SCHEMA } },
        messages: [{ role: "user", content: analystPrompt(it) }],
      },
    })),
  });

  // Poll until the batch ends.
  let status = batch;
  while (status.processing_status !== "ended") {
    await new Promise((r) => setTimeout(r, 15000));
    status = await c.messages.batches.retrieve(batch.id);
  }

  const out = {};
  for await (const result of await c.messages.batches.results(batch.id)) {
    if (result.result.type !== "succeeded") continue;
    logUsage("analyst_batch", SONNET, result.result.message.usage, { batch: true });
    const text = result.result.message.content.find((b) => b.type === "text")?.text;
    if (!text) continue;
    try {
      out[result.custom_id] = clampAnalyst(JSON.parse(text));
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export { OPUS, SONNET };
