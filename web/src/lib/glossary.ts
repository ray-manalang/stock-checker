// Single source of plain-English explanations. Every ⓘ pulls its wording here.
export const GLOSSARY: Record<string, { title: string; text: string }> = {
  timing: {
    title: "Timing",
    text: "How hot or cold the recent price action has been. 'Running hot' means it may have climbed too fast; 'Beaten down' means it has sold off and could bounce.",
  },
  quality: {
    title: "Quality",
    text: "A read on the health of the business — profit margins, growth, and debt. 'Healthy' is strong, 'Shaky' is weak. Needs a fundamental deep-dive to rate.",
  },
  price: {
    title: "Price",
    text: "Where today's price sits versus its own past year — not a full valuation. 'Looks cheap' is near the yearly low, 'Looks pricey' is near the high.",
  },
  pricepos: {
    title: "Price position",
    text: "The marker shows where today's price falls between the lowest and highest price of the past year.",
  },
  momentum: {
    title: "Momentum (RSI)",
    text: "A 0–100 gauge of recent up-vs-down moves. Above 70 is 'overbought' (running hot); below 30 is 'oversold' (beaten down).",
  },
  trend: {
    title: "Trend",
    text: "Whether the price is above or below its longer-term averages. Above = pointing up; below = pointing down.",
  },
  updowns: {
    title: "Ups & downs",
    text: "How much the price bounces around day to day (volatility). 'Calm' is steady; 'Bumpy' swings a lot.",
  },
  fromhigh: {
    title: "From its high",
    text: "How far below the highest price of the past year it trades today.",
  },
  macro: {
    title: "Market conditions",
    text: "A read on the whole market's risk backdrop. When conditions favor buying, new positions are safer; when defensive, it pays to wait.",
  },
};
