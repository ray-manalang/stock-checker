// Deterministic offline fixtures. Enabled with STOCK_FIXTURES=1 (or used as a
// last-resort fallback when STOCK_FIXTURES_FALLBACK=1 and every live source is
// blocked). Data is synthetic but shaped like a real daily series so the UI and
// pipeline can be developed and demoed without hitting Yahoo/Stooq. Never used
// unless explicitly enabled — production serves live data.

// A tiny seeded PRNG (mulberry32) so a given ticker always yields the same
// series — stable across runs, no Math.random.
function seeded(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START_PRICE = {
  AAPL: 190,
  MSFT: 420,
  NVDA: 120,
  SPY: 560,
  TSLA: 250,
  GOOGL: 175,
  AMZN: 185,
};

const DAY = 86400;

export function fixtureChart(ticker, range = "1y") {
  const symbol = String(ticker).trim().toUpperCase().replace(/\./g, "-");
  const rand = seeded(symbol);
  const n = range === "5y" ? 1250 : range === "5d" ? 6 : 260;
  const base = START_PRICE[symbol] ?? 50 + Math.floor(rand() * 250);
  // A gentle drift plus daily noise; drift sign varies by ticker.
  const drift = (rand() - 0.45) * 0.0012;
  const vol = 0.012 + rand() * 0.014;

  const close = [];
  const open = [];
  const high = [];
  const low = [];
  const volume = [];
  const timestamp = [];

  const nowSec = Math.floor(Date.now() / 1000);
  let price = base * (0.8 + rand() * 0.2);
  for (let i = n - 1; i >= 0; i--) {
    const shock = (rand() - 0.5) * 2 * vol;
    price = Math.max(1, price * (1 + drift + shock));
    const o = price * (1 + (rand() - 0.5) * 0.006);
    const hi = Math.max(o, price) * (1 + rand() * 0.008);
    const lo = Math.min(o, price) * (1 - rand() * 0.008);
    close.push(Number(price.toFixed(2)));
    open.push(Number(o.toFixed(2)));
    high.push(Number(hi.toFixed(2)));
    low.push(Number(lo.toFixed(2)));
    volume.push(Math.floor(2_000_000 + rand() * 8_000_000));
    timestamp.push(nowSec - i * DAY);
  }

  const last = close[close.length - 1];
  const prev = close[close.length - 2] ?? last;
  const oneYear = close.slice(-252);
  return {
    quote: {
      ticker: symbol,
      name: `${symbol} (demo data)`,
      price: last,
      changePct: prev > 0 ? ((last - prev) / prev) * 100 : null,
      high52: Math.max(...oneYear),
      low52: Math.min(...oneYear),
      currency: "USD",
    },
    series: { timestamp, open, high, low, close, volume },
  };
}
