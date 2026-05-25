function formatPrice(value) {
  return typeof value === "number" && !Number.isNaN(value)
    ? `$${value.toFixed(2)}`
    : "N/A";
}

function buildDerivedMetrics(price, high52, low52) {
  if (
    typeof price !== "number" ||
    typeof high52 !== "number" ||
    typeof low52 !== "number" ||
    high52 <= low52
  ) {
    return null;
  }

  const range = high52 - low52;
  const pctOfRange = ((price - low52) / range) * 100;
  const mid = (high52 + low52) / 2;
  const vsMid = ((price - mid) / mid) * 100;

  return {
    range: range.toFixed(2),
    pctOfRange: pctOfRange.toFixed(1),
    distanceFromHigh: (high52 - price).toFixed(2),
    distanceFromLow: (price - low52).toFixed(2),
    vsMid: vsMid.toFixed(1),
  };
}

export function buildAnalysisPrompt({ ticker, price, high52, low52 }) {
  const metrics = buildDerivedMetrics(price, high52, low52);
  const derivedBlock = metrics
    ? `Derived metrics:
- 52-week range width: ${formatPrice(Number(metrics.range))}
- Price as % of range (0% = low, 100% = high): ${metrics.pctOfRange}%
- Distance from 52-week high: ${formatPrice(Number(metrics.distanceFromHigh))}
- Distance from 52-week low: ${formatPrice(Number(metrics.distanceFromLow))}
- Price vs midpoint of range: ${metrics.vsMid}%`
    : "Derived metrics: unavailable (missing or invalid high/low).";

  return `### ROLE ###
You are a senior equity research analyst writing a concise briefing for a private investor.

### TASK ###
Using ONLY the price data below, produce a structured outlook for ${ticker}. Ground every claim in the numbers provided—do not invent news, earnings, volume, or macro events.

### OUTPUT FORMAT (strict) ###
Output exactly these four labeled fields in this order. No title, no preamble, no markdown, no bullet lists.
1. Trend: (one line — e.g. Bullish, Bearish, Neutral/Bullish, Neutral/Bearish)
2. Target Buy Zone: (one line — a concrete dollar range, e.g. $145.00 - $150.00)
3. Signal: (one line — exactly one of: BUY, HOLD, SELL)
4. Reasoning: (see reasoning rules below — this MUST be the last field)

### REASONING RULES ###
Write 3 to 5 complete sentences for Reasoning. Cover ALL of the following:
(a) Where price sits within the 52-week range (cite % of range or distances from high/low).
(b) What that position implies for upside vs downside skew (near high = limited upside / pullback risk; near low = rebound potential / room to run).
(c) How your Target Buy Zone relates to current price and the 52-week low/high (support, pullback entry, or breakout level).
(d) One explicit risk or invalidation (e.g. "breakdown below $X would weaken the thesis").
Use specific dollar amounts from the data. Be direct and analytical—not promotional.

### DATA ###
Ticker: ${ticker}
Current Price: ${formatPrice(price)}
52-Week High: ${formatPrice(high52)}
52-Week Low: ${formatPrice(low52)}
${derivedBlock}

### EXAMPLE (format only; do not copy prices) ###
Trend: Neutral/Bullish
Target Buy Zone: $145.00 - $150.00
Signal: HOLD
Reasoning: The stock trades at 78% of its 52-week range, only $4.20 below the high, which limits near-term upside without a breakout. The proposed buy zone sits on a pullback toward prior support between the midpoint and the low, offering a better risk/reward than chasing current levels. HOLD is appropriate until price either retests the zone on weakness or clears the high with conviction. A sustained drop below $140 would invalidate the bullish bias and suggest range breakdown.

### OUTPUT ###`;
}
