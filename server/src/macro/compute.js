import { fetchCloses, fetchChart } from "../stocks.js";
import { sma } from "../indicators.js";
import {
  vixLevel,
  vixTermStructure,
  marketBreadth,
  creditSpreads,
  putCall,
  factorCrowding,
  composite,
} from "./signals.js";
import { saveMacro } from "../db.js";

const FACTOR_ETFS = ["MTUM", "QUAL", "VLUE", "USMV", "SIZE"];
// A compact megacap sample for breadth when the scanner universe isn't loaded.
const BREADTH_SAMPLE = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK-B", "JPM", "V",
  "UNH", "XOM", "JNJ", "WMT", "MA", "PG", "HD", "COST", "ORCL", "MRK",
];

const FRED_HY_OAS =
  "https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2";

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function fetchFredSeries(url) {
  const res = await fetch(url, { headers: { "User-Agent": "stock-checker/1.0" } });
  if (!res.ok) throw new Error(`FRED ${res.status}`);
  const text = await res.text();
  const rows = text.trim().split("\n").slice(1);
  const out = [];
  for (const line of rows) {
    const [, v] = line.split(",");
    const n = Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function trailingReturnPct(closes, days) {
  if (!closes || closes.length <= days) return null;
  const p0 = closes[closes.length - 1 - days];
  const p1 = closes[closes.length - 1];
  return p0 > 0 ? (p1 / p0 - 1) * 100 : null;
}

/**
 * Compute the macro gate. Each signal degrades independently — a failed fetch
 * yields a neutral 50, and the composite re-normalizes over the signals present.
 * `breadthOverride` (0–1) lets the scanner supply breadth without a new fetch.
 */
export async function computeMacro({ breadthOverride = null } = {}) {
  if (process.env.STOCK_FIXTURES === "1") {
    return persist(fixtureMacro());
  }

  // VIX family (also feeds put/call).
  const vix = await safe(() => fetchCloses("^VIX", "1y"), null);
  const vix3m = await safe(() => fetchCloses("^VIX3M", "1y"), null);

  // Credit spreads via FRED HY OAS.
  const oas = await safe(() => fetchFredSeries(FRED_HY_OAS), null);

  // Factor ETF dispersion (60-day returns).
  const factorReturns = [];
  for (const etf of FACTOR_ETFS) {
    const closes = await safe(() => fetchCloses(etf, "1y"), null);
    const r = closes ? trailingReturnPct(closes, 60) : null;
    if (r != null) factorReturns.push(r);
  }

  // Market breadth: fraction of the sample above its 200-DMA.
  let breadth = breadthOverride;
  if (breadth == null) {
    let above = 0;
    let total = 0;
    for (const t of BREADTH_SAMPLE) {
      const closes = await safe(() => fetchCloses(t, "1y"), null);
      if (!closes || closes.length < 200) continue;
      const ma = sma(closes, 200);
      total += 1;
      if (ma != null && closes[closes.length - 1] > ma) above += 1;
    }
    breadth = total > 0 ? above / total : null;
  }

  const signals = [
    vixLevel(vix),
    vixTermStructure(vix, vix3m),
    marketBreadth(breadth),
    creditSpreads(oas),
    putCall(vix),
    factorCrowding(factorReturns),
  ];

  return persist(composite(signals));
}

function persist(snapshot) {
  const at = saveMacro({
    composite: snapshot.composite,
    zone: snapshot.zone,
    signals: snapshot.signals,
    meta: {
      sizingPct: snapshot.sizingPct,
      newLongs: snapshot.newLongs,
      scannerActive: snapshot.scannerActive,
      scannerMode: snapshot.scannerMode,
      oneLiner: snapshot.oneLiner,
    },
  });
  return { ...snapshot, computedAt: at };
}

// Deterministic demo snapshot for offline development.
function fixtureMacro() {
  const signals = [
    { signal: "VIX Level", score: 72, detail: "VIX 14.8" },
    { signal: "VIX Term Structure", score: 78, detail: "contango" },
    { signal: "Market Breadth", score: 64, detail: "62% above 200-DMA" },
    { signal: "Credit Spreads", score: 68, detail: "tight (OAS 3.10)" },
    { signal: "Put/Call Sentiment", score: 55, detail: "neutral" },
    { signal: "Factor Crowding", score: 58, detail: "normal (dispersion 7.9%)" },
  ];
  return composite(signals);
}
