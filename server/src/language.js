// Beginner-language mapping (§10 of the build spec). Pure functions that turn
// raw indicators into plain words. Each returns { word, tone } where tone is
// one of "up" | "down" | "warn" | "neutral" — used to color the copy.
//
// Tone is framed around the buyer's question ("is this a good time to buy?"):
// cheaper / beaten-down / healthy read as "up" (favorable), pricey / hot /
// shaky read as "warn"/"down".

/** Timing from RSI(14). "Momentum" in the Details view. */
export function timingWord(rsi14) {
  if (rsi14 == null) return { word: "Unclear", tone: "neutral" };
  if (rsi14 >= 70) return { word: "Running hot", tone: "warn" };
  if (rsi14 >= 60) return { word: "Warming up", tone: "warn" };
  if (rsi14 <= 30) return { word: "Beaten down", tone: "up" };
  if (rsi14 <= 40) return { word: "Cooling off", tone: "up" };
  return { word: "Steady", tone: "neutral" };
}

/** Quality from the fundamental score (1–10). */
export function qualityWord(fundamentalScore) {
  if (fundamentalScore == null) return { word: "Not rated", tone: "neutral" };
  if (fundamentalScore >= 7) return { word: "Healthy", tone: "up" };
  if (fundamentalScore >= 4) return { word: "Decent", tone: "neutral" };
  return { word: "Shaky", tone: "down" };
}

/** Price position from % of the 52-week range (vs its own past year). */
export function priceWord(pctOfRange) {
  if (pctOfRange == null) return { word: "Unclear", tone: "neutral" };
  if (pctOfRange >= 66) return { word: "Looks pricey", tone: "warn" };
  if (pctOfRange <= 33) return { word: "Looks cheap", tone: "up" };
  return { word: "Around fair", tone: "neutral" };
}

/** Trend from price vs its moving averages. */
export function trendWord({ aboveSma50, aboveSma200, emaCrossUp }) {
  const up = [aboveSma50, aboveSma200, emaCrossUp].filter((v) => v === true).length;
  const down = [aboveSma50, aboveSma200, emaCrossUp].filter((v) => v === false).length;
  if (up >= 2 && down === 0) return { word: "Pointing up", tone: "up" };
  if (down >= 2 && up === 0) return { word: "Pointing down", tone: "down" };
  return { word: "Sideways", tone: "neutral" };
}

/** "Ups & downs" from annualized volatility (%). */
export function volatilityWord(vol) {
  if (vol == null) return { word: "Unclear", tone: "neutral" };
  if (vol >= 40) return { word: "Bumpy", tone: "warn" };
  if (vol >= 20) return { word: "Moderate", tone: "neutral" };
  return { word: "Calm", tone: "up" };
}

/** "From its high" — how far below the yearly high. */
export function drawdownWord(drawdownPct) {
  if (drawdownPct == null) return { word: "Unclear", tone: "neutral" };
  const d = Math.abs(drawdownPct);
  if (d < 3) return { word: "At its high", tone: "warn" };
  if (d < 12) return { word: `${d.toFixed(0)}% below high`, tone: "neutral" };
  return { word: `${d.toFixed(0)}% below high`, tone: "up" };
}

/** Macro zone → plain one-liner. */
export function macroWord(zone) {
  switch (zone) {
    case "FULL DEPLOY":
      return { word: "Market conditions favor buying", tone: "up" };
    case "REDUCED":
      return { word: "Market conditions say be cautious", tone: "warn" };
    case "DEFENSIVE":
      return { word: "Market conditions say be defensive", tone: "down" };
    default:
      return { word: "Market conditions unclear", tone: "neutral" };
  }
}
