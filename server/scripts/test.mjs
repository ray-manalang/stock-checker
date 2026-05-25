import "dotenv/config";
import { fetchQuote } from "../src/stocks.js";
import { parseAnalysis } from "../src/parseAnalysis.js";
import { buildAnalysisPrompt } from "../src/prompt.js";
import { callLlm } from "../src/llm.js";

let failed = 0;

function assert(name, condition) {
  if (!condition) {
    console.error(`FAIL: ${name}`);
    failed++;
    return;
  }
  console.log(`ok: ${name}`);
}

const sampleAnalysis = `Trend: Neutral/Bullish
Target Buy Zone: $145.00 - $150.00
Signal: HOLD
Reasoning: The stock trades at 78% of its 52-week range, only $4.20 below the high.
A sustained drop below $140 would invalidate the bullish bias.`;

const parsed = parseAnalysis(sampleAnalysis);
assert("parseAnalysis trend", parsed.trend === "Neutral/Bullish");
assert("parseAnalysis signal", parsed.signal === "HOLD");
assert("parseAnalysis buyZone", parsed.buyZone === "$145.00 - $150.00");
assert("parseAnalysis reasoning multiline", parsed.reasoning?.includes("78%"));
assert("parseAnalysis reasoning second sentence", parsed.reasoning?.includes("$140"));

try {
  const quote = await fetchQuote("AAPL");
  assert("fetchQuote ticker", quote.ticker === "AAPL");
  assert("fetchQuote price", typeof quote.price === "number" && quote.price > 0);
} catch (err) {
  console.error(`FAIL: fetchQuote — ${err.message}`);
  failed++;
}

const prompt = buildAnalysisPrompt({
  ticker: "AAPL",
  price: 100,
  high52: 120,
  low52: 80,
});
assert("buildAnalysisPrompt ticker", prompt.includes("Ticker: AAPL"));
assert("buildAnalysisPrompt derived metrics", prompt.includes("Price as % of range"));

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.log("skip: Gemini live test (set GEMINI_API_KEY in server/.env)");
} else {
  try {
    const text = await callLlm("Reply with exactly: Trend: Bullish\nTarget Buy Zone: $1\nSignal: BUY\nReasoning: Test only.");
    assert("callLlm returns text", typeof text === "string" && text.length > 0);
    const liveParsed = parseAnalysis(text);
    assert("callLlm parseable", liveParsed.trend != null || liveParsed.raw.length > 0);
  } catch (err) {
    console.error(`FAIL: callLlm — ${err.message}`);
    failed++;
  }
}

if (failed > 0) {
  process.exit(1);
}
console.log("\nAll tests passed.");
