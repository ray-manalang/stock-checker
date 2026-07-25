import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchFundamentals, fetchSeriesMulti } from "../stocks.js";
import { sma } from "../indicators.js";
import {
  momentumFactor,
  volumeFactor,
  relStrengthFactor,
  high52Factor,
  shortInterestFactor,
  buildComposite,
  sectorRanks,
} from "./factors.js";
import { sectorOf } from "./sectors.js";
import { saveScanner, freshSeriesMap, setCachedSeries } from "../db.js";

const PRICE_TTL_MS = 24 * 60 * 60 * 1000;
// The full S&P 500 is now the default (the Yahoo sidecar batches the universe in
// one fast call and has no per-symbol rate cap). SCANNER_FULL_UNIVERSE=0 is the
// escape hatch back to the curated large-cap list if the sidecar ever has to
// fall back to Twelve Data's 8-req/min pacing for a stretch.
const FULL_UNIVERSE = process.env.SCANNER_FULL_UNIVERSE !== "0";
// Universe cap. Defaults high enough for the full S&P 500; on the curated list
// the old 50-name default still applies. Override with SCANNER_UNIVERSE_SIZE.
const UNIVERSE_SIZE =
  Number(process.env.SCANNER_UNIVERSE_SIZE) || (FULL_UNIVERSE ? 550 : 50);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", ".cache");
const UNIVERSE_CACHE = path.join(CACHE_DIR, "sp500.json");
const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000;
// In a REDUCED (cautious) market, show fewer, higher-ranked names — but never an
// empty list. (The old absolute composite>=75 cutoff filtered everything out,
// since the composite is a mean of percentile ranks and rarely clears 75.)
const REDUCED_TOP = 20;

// ~100 largest US names, size-ordered — the curated fallback universe, used
// when SCANNER_FULL_UNIVERSE=0 or the Wikipedia scrape fails.
const LARGE_CAP_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "BRK-B", "JPM",
  "LLY", "V", "UNH", "XOM", "JNJ", "WMT", "MA", "PG", "HD", "COST",
  "ORCL", "MRK", "ABBV", "CVX", "KO", "PEP", "ADBE", "CRM", "BAC", "NFLX",
  "AMD", "TMO", "MCD", "CSCO", "ACN", "LIN", "ABT", "DHR", "WFC", "TXN",
  "QCOM", "INTC", "INTU", "VZ", "IBM", "AMGN", "PM", "CAT", "GE", "NOW",
  "UNP", "NKE", "COP", "HON", "SPGI", "UBER", "LOW", "GS", "BKNG", "MS",
  "AXP", "T", "BLK", "PFE", "SCHW", "ISRG", "RTX", "ELV", "PLD", "BA",
  "SYK", "TJX", "MDT", "GILD", "C", "VRTX", "LMT", "ADP", "MMC", "REGN",
  "CB", "ETN", "ZTS", "AMT", "MO", "BSX", "CI", "PGR", "SO", "BMY",
  "DE", "MU", "FI", "DUK", "PANW", "SLB", "APH", "KLAC", "SNPS", "CDNS",
];

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * The scan universe. Default: the full S&P 500, scraped from Wikipedia (cached
 * 24h), falling back to the curated large-cap list on failure.
 * SCANNER_FULL_UNIVERSE=0 forces the curated list.
 */
export async function getUniverse() {
  if (!FULL_UNIVERSE) return LARGE_CAP_UNIVERSE;
  ensureCacheDir();
  try {
    const cached = JSON.parse(fs.readFileSync(UNIVERSE_CACHE, "utf8"));
    if (Date.now() - cached.fetchedAt < UNIVERSE_TTL_MS && cached.tickers?.length) {
      return cached.tickers;
    }
  } catch {
    /* no cache */
  }
  try {
    const tickers = await scrapeSp500();
    if (tickers.length >= 400) {
      fs.writeFileSync(UNIVERSE_CACHE, JSON.stringify({ fetchedAt: Date.now(), tickers }));
      return tickers;
    }
    throw new Error(`only ${tickers.length} tickers scraped`);
  } catch (err) {
    console.warn(
      `[scanner] S&P 500 scrape failed (${
        err instanceof Error ? err.message : err
      }); using ${LARGE_CAP_UNIVERSE.length}-name large-cap universe.`,
    );
    return LARGE_CAP_UNIVERSE;
  }
}

async function scrapeSp500() {
  const res = await fetch("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", {
    headers: { "User-Agent": "stock-checker/1.0" },
  });
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  const html = await res.text();
  const table = html.split('id="constituents"')[1] ?? html;
  const body = table.split("</table>")[0] ?? "";
  const tickers = [];
  for (const row of body.split("<tr>").slice(1)) {
    const m = row.match(/<td[^>]*>\s*<a[^>]*>([A-Z][A-Z.\-]{0,6})<\/a>/);
    if (m) tickers.push(m[1].replace(/\./g, "-"));
  }
  return [...new Set(tickers)];
}

// Series for the universe, served from the 24h price cache where possible and
// back-filled via the provider-agnostic multi-fetch (Twelve Data or spark).
async function fetchUniverseSeries(tickers) {
  const { fresh, stale } = freshSeriesMap(tickers, PRICE_TTL_MS);
  if (stale.length) {
    const fetched = await fetchSeriesMulti(stale, "1y");
    for (const [t, series] of Object.entries(fetched)) {
      setCachedSeries(t, series);
      fresh[t] = series;
    }
  }
  const closesMap = {};
  const volumesMap = {};
  for (const [t, series] of Object.entries(fresh)) {
    if (Array.isArray(series?.closes) && series.closes.length >= 200) {
      closesMap[t] = series.closes;
      if (Array.isArray(series.volumes) && series.volumes.length) {
        volumesMap[t] = series.volumes;
      }
    }
  }
  return { closesMap, volumesMap };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the L2 scanner. Respects the macro gate: DEFENSIVE returns empty (scanner
 * off), REDUCED slices to the top REDUCED_TOP names, OFFENSIVE returns the full
 * ranking. Uses batched closes + the 24h price cache.
 * Returns { rows, macroMode, breadth }.
 */
export async function runScanner({ macroMode = "OFFENSIVE", top = 100 } = {}) {
  if (macroMode === "DEFENSIVE") {
    saveScanner([], macroMode);
    return { rows: [], macroMode, breadth: null };
  }

  if (process.env.STOCK_FIXTURES === "1") {
    const rows = fixtureScanner(macroMode);
    saveScanner(rows, macroMode);
    return { rows, macroMode, breadth: 0.62 };
  }

  const universe = (await getUniverse()).slice(0, UNIVERSE_SIZE);
  // SPY rides along in the same fetch (needed for relative strength).
  const withSpy = universe.includes("SPY") ? universe : [...universe, "SPY"];
  const { closesMap, volumesMap } = await fetchUniverseSeries(withSpy);
  const spyCloses = closesMap.SPY ?? null;
  delete closesMap.SPY;
  delete volumesMap.SPY;

  const tickers = Object.keys(closesMap);
  if (!tickers.length) {
    saveScanner([], macroMode);
    return { rows: [], macroMode, breadth: null };
  }

  // Short interest is fragile and expensive across the universe (one Python
  // subprocess per ticker) — opt-in only. The sidecar surfaces shortRatio on the
  // fundamentals payload; names without it simply drop out of the factor.
  const shortRatioMap = {};
  if (process.env.SCANNER_SHORT_INTEREST === "1") {
    for (const t of tickers) {
      const f = await fetchFundamentals(t);
      if (f?.shortRatio != null) shortRatioMap[t] = f.shortRatio;
      await sleep(120);
    }
  }

  // Volume-surge is included only when the provider supplies volume (Twelve
  // Data does; Yahoo spark doesn't). The composite averages present factors.
  const factorMaps = {
    momentum: momentumFactor(closesMap),
    rel_strength: relStrengthFactor(closesMap, spyCloses),
    high_52wk_prox: high52Factor(closesMap),
  };
  if (Object.keys(volumesMap).length) {
    factorMaps.volume_surge = volumeFactor(volumesMap);
  }
  if (process.env.SCANNER_SHORT_INTEREST === "1") {
    factorMaps.short_interest = shortInterestFactor(shortRatioMap, tickers);
  }

  let rows = buildComposite(tickers, factorMaps);
  // Sector-relative ranking (Phase 4.2): tag each row with its GICS sector and
  // its rank *within* that sector, so a chip name isn't only judged against a
  // utility. Sector comes from the static map (null for unmapped names).
  for (const r of rows) r.sector = sectorOf(r.ticker);
  const sRanks = sectorRanks(rows);
  for (const r of rows) r.sectorRank = sRanks[r.ticker] ?? null;

  const limit = macroMode === "REDUCED" ? Math.min(top, REDUCED_TOP) : top;
  rows = rows.slice(0, limit);

  const breadth = computeBreadth(closesMap);
  saveScanner(rows, macroMode);
  return { rows, macroMode, breadth };
}

// % of the fetched universe trading above its 200-DMA — feeds Market Breadth
// without a second fetch (satisfies §7's "no new fetch").
export function computeBreadth(closesMap) {
  let above = 0;
  let total = 0;
  for (const c of Object.values(closesMap)) {
    if (!c || c.length < 200) continue;
    const ma = sma(c, 200);
    total += 1;
    if (ma != null && c[c.length - 1] > ma) above += 1;
  }
  return total > 0 ? above / total : null;
}

function fixtureScanner(macroMode) {
  const seed = [
    ["NVDA", 94], ["AVGO", 89], ["META", 86], ["AMZN", 83], ["MSFT", 81],
    ["AAPL", 78], ["GOOGL", 76], ["AMD", 74], ["CRM", 71], ["ORCL", 69],
    ["NFLX", 66], ["COST", 63], ["JPM", 60], ["V", 58], ["MA", 55],
  ];
  let rows = seed.map(([ticker, composite]) => ({
    ticker,
    composite,
    factors: {
      momentum: composite,
      volume_surge: composite - 8,
      rel_strength: composite + 3,
      high_52wk_prox: composite - 2,
    },
  }));
  if (macroMode === "REDUCED") rows = rows.slice(0, REDUCED_TOP);
  rows.forEach((r, i) => (r.rank = i + 1));
  for (const r of rows) r.sector = sectorOf(r.ticker);
  const sRanks = sectorRanks(rows);
  for (const r of rows) r.sectorRank = sRanks[r.ticker] ?? null;
  return rows;
}
