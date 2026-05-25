const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

export async function fetchQuote(ticker) {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) throw new Error("Ticker is required");

  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const res = await fetch(url, {
    headers: { "User-Agent": "stock-checker/1.0" },
  });

  if (!res.ok) {
    throw new Error(`Market data unavailable (${res.status})`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;

  if (!meta?.regularMarketPrice) {
    throw new Error(`No quote found for "${symbol}"`);
  }

  return {
    ticker: symbol,
    price: meta.regularMarketPrice,
    high52: meta.fiftyTwoWeekHigh ?? null,
    low52: meta.fiftyTwoWeekLow ?? null,
    currency: meta.currency ?? "USD",
  };
}
