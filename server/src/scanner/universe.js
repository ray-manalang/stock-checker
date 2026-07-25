// Scanner universe + company-name/sector metadata.
//
// The scan universe defaults to the full S&P 500, scraped from Wikipedia once
// every 24h (cached to .cache/sp500.json). That same constituents table carries
// each name's Security (name) and GICS Sector, so we cache all three fields and
// expose resolveName/resolveSector lookups — scraped data first, the static
// NAMES/SECTORS maps as the fallback (used when SCANNER_FULL_UNIVERSE=0 or the
// scrape fails). No new fetch, no new schedule; it rides the existing scrape.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { NAMES } from "./names.js";
import { sectorOf } from "./sectors.js";
import { parseSp500Table } from "./sp500-table.js";

export const FULL_UNIVERSE = process.env.SCANNER_FULL_UNIVERSE !== "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", ".cache");
const UNIVERSE_CACHE = path.join(CACHE_DIR, "sp500.json");
const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000;

// ~100 largest US names, size-ordered — the curated fallback universe, used when
// SCANNER_FULL_UNIVERSE=0 or the Wikipedia scrape fails.
export const LARGE_CAP_UNIVERSE = [
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

// In-memory { ticker: { name, sector } } from the scrape. Populated whenever the
// universe is (re)loaded; getUniverseMeta lazily reads the on-disk cache if it
// has never been set (e.g. holdings loads before the first scanner run).
let _meta = null;

function metaFrom(constituents) {
  const m = {};
  for (const c of constituents ?? []) {
    if (c?.ticker) m[c.ticker] = { name: c.name ?? null, sector: c.sector ?? null };
  }
  return m;
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

async function scrapeSp500() {
  const res = await fetch("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", {
    headers: { "User-Agent": "stock-checker/1.0" },
  });
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  return parseSp500Table(await res.text());
}

/**
 * The scan universe. Default: the full S&P 500, scraped from Wikipedia (cached
 * 24h with name + sector), falling back to the curated large-cap list on
 * failure. SCANNER_FULL_UNIVERSE=0 forces the curated list.
 */
export async function getUniverse() {
  if (!FULL_UNIVERSE) return LARGE_CAP_UNIVERSE;
  ensureCacheDir();
  try {
    const cached = JSON.parse(fs.readFileSync(UNIVERSE_CACHE, "utf8"));
    if (Date.now() - cached.fetchedAt < UNIVERSE_TTL_MS && cached.constituents?.length) {
      _meta = metaFrom(cached.constituents);
      return cached.constituents.map((c) => c.ticker);
    }
  } catch {
    /* no cache (or an old tickers-only cache) → re-scrape */
  }
  try {
    const constituents = await scrapeSp500();
    if (constituents.length >= 400) {
      fs.writeFileSync(UNIVERSE_CACHE, JSON.stringify({ fetchedAt: Date.now(), constituents }));
      _meta = metaFrom(constituents);
      return constituents.map((c) => c.ticker);
    }
    throw new Error(`only ${constituents.length} constituents scraped`);
  } catch (err) {
    console.warn(
      `[scanner] S&P 500 scrape failed (${
        err instanceof Error ? err.message : err
      }); using ${LARGE_CAP_UNIVERSE.length}-name large-cap universe.`,
    );
    return LARGE_CAP_UNIVERSE;
  }
}

/** Scraped { ticker: { name, sector } } (cached 24h). Lazily reads the on-disk
 *  cache if not already in memory; {} if there's no scrape yet. */
export function getUniverseMeta() {
  if (_meta) return _meta;
  try {
    const cached = JSON.parse(fs.readFileSync(UNIVERSE_CACHE, "utf8"));
    _meta = metaFrom(cached.constituents);
  } catch {
    _meta = {};
  }
  return _meta;
}

/** Company name: the scraped S&P 500 table first, then the static NAMES map. */
export function resolveName(ticker) {
  return getUniverseMeta()[ticker]?.name ?? NAMES[ticker] ?? null;
}

/** GICS sector: the scraped S&P 500 table first, then the static SECTORS map. */
export function resolveSector(ticker) {
  return getUniverseMeta()[ticker]?.sector ?? sectorOf(ticker) ?? null;
}
