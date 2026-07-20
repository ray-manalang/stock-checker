// Free Yahoo Finance data. No API key.
// The chart endpoint returns a full range of daily OHLCV — we keep the whole
// series so every technical indicator downstream is free.

import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Yahoo blocks by TLS fingerprint, so Node's fetch is 429'd. We shell out to a
// small Python sidecar (yfinance/curl_cffi, which impersonates a browser TLS
// handshake) for real Yahoo data. Point YF_PYTHON at a python that has yfinance
// installed (default: python3); set YF_DISABLE=1 to skip it entirely.
const YF_PYTHON = process.env.YF_PYTHON?.trim() || "python3";
const YF_SCRIPT = path.join(__dirname, "..", "scripts", "yf_fetch.py");
let _yfState = null; // null unknown · true available · false unavailable

function yfEnabled() {
  return process.env.YF_DISABLE !== "1" && _yfState !== false;
}
function markYfError(err) {
  const msg = `${err?.code ?? ""} ${err?.stderr ?? err?.message ?? ""}`;
  // Missing python or yfinance → stop trying the sidecar this process.
  if (/ENOENT|No module named|ModuleNotFoundError/i.test(msg)) _yfState = false;
}
async function runYf(args, timeoutMs = 60000) {
  const { stdout } = await execFileP(YF_PYTHON, [YF_SCRIPT, ...args], {
    timeout: timeoutMs,
    maxBuffer: 96 * 1024 * 1024,
  });
  _yfState = true;
  return JSON.parse(stdout);
}

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function normalizeSymbol(ticker) {
  const symbol = String(ticker ?? "").trim().toUpperCase();
  if (!symbol) throw new Error("Ticker is required");
  // yfinance ticker format uses hyphens not dots (BRK-B not BRK.B).
  return symbol.replace(/\./g, "-");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSER_HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/json,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

// Yahoo increasingly 429s requests that lack a session cookie + crumb (the same
// anti-bot flow yfinance works around). We prime one once and reuse it.
let _session = { cookie: null, crumb: null, ts: 0 };
const SESSION_TTL_MS = 30 * 60 * 1000;

function parseCookies(res) {
  const setCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  const pairs = setCookie.map((c) => c.split(";")[0]).filter(Boolean);
  return pairs.join("; ");
}

async function getYahooSession(force = false) {
  if (!force && _session.cookie && Date.now() - _session.ts < SESSION_TTL_MS) {
    return _session;
  }
  // 1) Prime a cookie. fc.yahoo.com 404s but sets the A1/A3 cookies we need.
  let cookie = "";
  for (const url of ["https://fc.yahoo.com/", "https://finance.yahoo.com/"]) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
      const c = parseCookies(res);
      if (c) {
        cookie = c;
        break;
      }
    } catch {
      /* try next */
    }
  }
  // 2) Fetch a crumb using that cookie (needed for quoteSummary; harmless for chart).
  let crumb = null;
  if (cookie) {
    try {
      const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
        headers: { ...BROWSER_HEADERS, Cookie: cookie },
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text && !text.includes("<")) crumb = text;
      }
    } catch {
      /* crumb optional for chart */
    }
  }
  _session = { cookie, crumb, ts: Date.now() };
  return _session;
}

/**
 * Fetch a ticker's quote + full daily OHLCV series.
 * Returns { quote, series } where
 *   quote  = { ticker, name, price, changePct, high52, low52, currency }
 *   series = { timestamp[], open[], high[], low[], close[], volume[] }
 *
 * Yahoo is the primary source but rate-limits aggressively (429). We rotate
 * hosts with backoff, then fall back to Stooq's free daily CSV so the app keeps
 * working when Yahoo blocks us.
 */
export async function fetchChart(ticker, range = "1y") {
  const symbol = normalizeSymbol(ticker);

  // Explicit offline/demo mode — never used unless opted in.
  if (process.env.STOCK_FIXTURES === "1") {
    const { fixtureChart } = await import("./fixtures.js");
    return fixtureChart(symbol, range);
  }

  // Preferred: Yahoo via the yfinance sidecar (free, full history, no rate cap).
  if (yfEnabled()) {
    try {
      const r = await runYf(["chart", symbol, range]);
      if (r?.quote?.price) return r;
    } catch (err) {
      markYfError(err);
    }
  }

  // Then a keyed provider with a free tier (Twelve Data).
  if (process.env.TWELVE_DATA_API_KEY?.trim()) {
    try {
      return await fetchTwelveDataChart(symbol, range);
    } catch {
      /* fall through to Yahoo/Stooq */
    }
  }

  try {
    return await fetchYahooChart(symbol, range);
  } catch (yahooErr) {
    try {
      return await fetchStooqChart(symbol, range);
    } catch {
      // Last-resort demo fallback when every live source is blocked.
      if (process.env.STOCK_FIXTURES_FALLBACK === "1") {
        const { fixtureChart } = await import("./fixtures.js");
        return fixtureChart(symbol, range);
      }
      throw yahooErr; // surface the primary error
    }
  }
}

// Company names are static — cache them so we only spend one extra request the
// first time a symbol is seen.
const _tdNameCache = new Map();
async function twelveDataName(key, tdSym) {
  if (_tdNameCache.has(tdSym)) return _tdNameCache.get(tdSym);
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(
      tdSym,
    )}&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) {
      const q = await res.json();
      const name = typeof q?.name === "string" && q.name ? q.name : null;
      if (name) _tdNameCache.set(tdSym, name);
      return name;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

// Free daily OHLCV via Twelve Data (https://twelvedata.com — free API key).
async function fetchTwelveDataChart(symbol, range) {
  const key = process.env.TWELVE_DATA_API_KEY.trim();
  const outputsize = range === "5y" ? 1300 : range === "5d" ? 10 : 300;
  // Twelve Data uses dotted class shares (BRK.B); we store hyphens internally.
  const tdSym = symbol.replace(/-/g, ".");
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSym)}` +
    `&interval=1day&outputsize=${outputsize}&order=ASC&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Twelve Data ${res.status}`);
  const data = await res.json();
  if (data.status === "error" || !Array.isArray(data.values)) {
    throw new Error(data.message || `No Twelve Data for "${symbol}"`);
  }

  const timestamp = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  const volume = [];
  for (const row of data.values) {
    const c = Number(row.close);
    if (!Number.isFinite(c)) continue;
    timestamp.push(Math.floor(new Date(row.datetime).getTime() / 1000));
    open.push(Number(row.open) || c);
    high.push(Number(row.high) || c);
    low.push(Number(row.low) || c);
    close.push(c);
    volume.push(Number(row.volume) || 0);
  }
  if (close.length < 2) throw new Error(`No Twelve Data for "${symbol}"`);

  const price = close[close.length - 1];
  const prev = close[close.length - 2];
  const oneYear = close.slice(-252);
  // meta.name is usually empty on the free tier — fall back to a cached /quote.
  let name = data.meta?.name;
  if (!name || name === tdSym) name = (await twelveDataName(key, tdSym)) ?? symbol;
  return {
    quote: {
      ticker: symbol,
      name,
      price,
      changePct: prev > 0 ? ((price - prev) / prev) * 100 : null,
      high52: Math.max(...oneYear),
      low52: Math.min(...oneYear),
      currency: data.meta?.currency ?? "USD",
    },
    series: { timestamp, open, high, low, close, volume },
  };
}

async function fetchYahooChart(symbol, range) {
  const hosts = ["query1", "query2"];
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Prime (or refresh, on a later attempt) the anti-bot session.
    const session = await getYahooSession(attempt > 0);
    const headers = { ...BROWSER_HEADERS };
    if (session.cookie) headers.Cookie = session.cookie;

    for (const host of hosts) {
      let url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol,
      )}?interval=1d&range=${encodeURIComponent(range)}`;
      if (session.crumb) url += `&crumb=${encodeURIComponent(session.crumb)}`;
      const res = await fetch(url, { headers });
      if (res.ok) return parseYahooChart(symbol, await res.json());
      lastStatus = res.status;
      if (res.status !== 429 && res.status !== 401 && res.status < 500) break;
    }
    await sleep(500 * (attempt + 1));
  }
  throw new Error(`Market data unavailable (${lastStatus || "network"})`);
}

function parseYahooChart(symbol, data) {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`No quote found for "${symbol}"`);

  const q = result.indicators?.quote?.[0] ?? {};
  const rawTs = result.timestamp ?? [];
  const timestamp = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  const volume = [];
  for (let i = 0; i < rawTs.length; i++) {
    const c = q.close?.[i];
    if (typeof c !== "number" || Number.isNaN(c)) continue;
    timestamp.push(rawTs[i]);
    open.push(q.open?.[i] ?? c);
    high.push(q.high?.[i] ?? c);
    low.push(q.low?.[i] ?? c);
    close.push(c);
    volume.push(q.volume?.[i] ?? 0);
  }

  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const price = meta.regularMarketPrice;
  const changePct =
    prevClose && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null;

  return {
    quote: {
      ticker: symbol,
      name: meta.longName ?? meta.shortName ?? symbol,
      price,
      changePct,
      high52: meta.fiftyTwoWeekHigh ?? (close.length ? Math.max(...close) : null),
      low52: meta.fiftyTwoWeekLow ?? (close.length ? Math.min(...close) : null),
      currency: meta.currency ?? "USD",
    },
    series: { timestamp, open, high, low, close, volume },
  };
}

// Free daily CSV fallback (no key). Columns: Date,Open,High,Low,Close,Volume.
async function fetchStooqChart(symbol, range) {
  const days = range === "5y" ? 1300 : range === "5d" ? 7 : 400;
  const stooqSym = symbol.replace(/-/g, ".").toLowerCase() + ".us";
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Stooq unavailable (${res.status})`);
  const text = await res.text();
  const rows = text.trim().split("\n").slice(1); // drop header
  if (rows.length < 2 || text.includes("N/D")) {
    throw new Error(`No Stooq data for "${symbol}"`);
  }

  const timestamp = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  const volume = [];
  for (const line of rows.slice(-days)) {
    const [d, o, h, l, c, v] = line.split(",");
    const cl = Number(c);
    if (!Number.isFinite(cl)) continue;
    timestamp.push(Math.floor(new Date(d).getTime() / 1000));
    open.push(Number(o) || cl);
    high.push(Number(h) || cl);
    low.push(Number(l) || cl);
    close.push(cl);
    volume.push(Number(v) || 0);
  }
  if (close.length < 2) throw new Error(`No Stooq data for "${symbol}"`);

  const price = close[close.length - 1];
  const prev = close[close.length - 2];
  const oneYear = close.slice(-252);
  return {
    quote: {
      ticker: symbol,
      name: symbol,
      price,
      changePct: prev > 0 ? ((price - prev) / prev) * 100 : null,
      high52: Math.max(...oneYear),
      low52: Math.min(...oneYear),
      currency: "USD",
    },
    series: { timestamp, open, high, low, close, volume },
  };
}

/** Back-compat thin wrapper used by older callers/tests. */
export async function fetchQuote(ticker) {
  const { quote } = await fetchChart(ticker);
  return quote;
}

/** Fetch just the close series for a benchmark (e.g. SPY) — used for RS. */
export async function fetchCloses(ticker, range = "1y") {
  const { series } = await fetchChart(ticker, range);
  return series.close;
}

/**
 * Parse Yahoo's multi-symbol spark response into { symbol: { closes, timestamp } }.
 * Pure — unit-tested against a fixture. Spark is close-only (no volume/OHLC).
 */
export function parseSpark(json) {
  const out = {};
  for (const r of json?.spark?.result ?? []) {
    const resp = r?.response?.[0];
    const close = resp?.indicators?.quote?.[0]?.close;
    const ts = resp?.timestamp;
    if (!Array.isArray(close) || !Array.isArray(ts)) continue;
    const closes = [];
    const timestamp = [];
    for (let i = 0; i < close.length; i++) {
      const c = close[i];
      if (typeof c === "number" && !Number.isNaN(c)) {
        closes.push(c);
        timestamp.push(ts[i]);
      }
    }
    if (closes.length) out[r.symbol] = { closes, timestamp };
  }
  return out;
}

/**
 * Provider-agnostic multi-symbol series fetch for the Pro layer. Uses Twelve
 * Data when a key is set (returns volume too, paced to the free tier's 8
 * credits/min), otherwise Yahoo's batched spark endpoint (close-only). Returns
 * { symbol: { closes, volumes?, timestamp } }; failed symbols are simply absent.
 */
export async function fetchSeriesMulti(symbols, range = "1y") {
  // Yahoo via the sidecar batches hundreds of symbols in one fast call.
  if (yfEnabled()) {
    try {
      const r = await runYf(["multi", range, ...symbols]);
      if (r && Object.keys(r).length) return r;
    } catch (err) {
      markYfError(err);
    }
  }
  if (process.env.TWELVE_DATA_API_KEY?.trim()) {
    return fetchTwelveDataMulti(symbols, range);
  }
  return fetchSparkCloses(symbols, range);
}

async function fetchTwelveDataMulti(symbols, range) {
  const key = process.env.TWELVE_DATA_API_KEY.trim();
  const outputsize = range === "5y" ? 1300 : range === "5d" ? 10 : 300;
  const out = {};
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const tdSym = sym.replace(/-/g, ".");
    const url =
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSym)}` +
      `&interval=1day&outputsize=${outputsize}&order=ASC&apikey=${encodeURIComponent(key)}`;
    try {
      // Per-request timeout so one stuck connection can't stall the whole run.
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status !== "error" && Array.isArray(data.values)) {
          const closes = [];
          const volumes = [];
          const timestamp = [];
          for (const row of data.values) {
            const c = Number(row.close);
            if (!Number.isFinite(c)) continue;
            closes.push(c);
            volumes.push(Number(row.volume) || 0);
            timestamp.push(Math.floor(new Date(row.datetime).getTime() / 1000));
          }
          if (closes.length) out[sym] = { closes, volumes, timestamp };
        }
      }
    } catch {
      /* skip; caller degrades */
    }
    // Pace under the free tier's 8 credits/minute.
    if (i + 1 < symbols.length) await sleep(8000);
  }
  return out;
}

/**
 * Batched close series for many symbols via Yahoo's spark endpoint — one HTTP
 * request per ~chunkSize symbols instead of one per symbol. This is what makes
 * the macro gate and scanner viable without tripping Yahoo's per-request
 * rate-limiter. Returns { symbol: { closes, timestamp } }; symbols that fail are
 * simply absent (callers degrade).
 */
export async function fetchSparkCloses(symbols, range = "1y", { chunkSize = 50 } = {}) {
  const out = {};
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    const session = await getYahooSession(i > 0 && Object.keys(out).length === 0);
    const headers = { ...BROWSER_HEADERS };
    if (session.cookie) headers.Cookie = session.cookie;
    for (const host of ["query1", "query2"]) {
      let url =
        `https://${host}.finance.yahoo.com/v8/finance/spark?symbols=` +
        `${chunk.map((s) => encodeURIComponent(s)).join(",")}` +
        `&range=${encodeURIComponent(range)}&interval=1d`;
      if (session.crumb) url += `&crumb=${encodeURIComponent(session.crumb)}`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        Object.assign(out, parseSpark(await res.json()));
        break;
      }
      if (res.status !== 429 && res.status !== 401 && res.status < 500) break;
    }
    if (i + chunkSize < symbols.length) await sleep(300);
  }
  return out;
}

/**
 * 4-quarter fundamentals via the yfinance sidecar (income/cashflow/balance
 * statements + derived ratios). Returns { quarterEnd, financials } or null.
 * (Yahoo's quoteSummary is TLS-blocked over raw HTTP, so the sidecar is the
 * only reliable source.)
 */
// Live last price + daily % change for a batch of symbols, cached ~60s per
// symbol so the minute-refresh across tape/scanner/card shares one fetch.
const _quoteCache = new Map(); // symbol -> { at, price, changePct }
const QUOTE_TTL_MS = 60_000;

export async function liveQuotes(symbols) {
  const now = Date.now();
  const out = {};
  const need = [];
  for (const s of symbols) {
    const c = _quoteCache.get(s);
    if (c && now - c.at < QUOTE_TTL_MS) out[s] = { price: c.price, changePct: c.changePct };
    else if (!need.includes(s)) need.push(s);
  }
  if (need.length && yfEnabled()) {
    try {
      const r = await runYf(["quote", ...need]);
      for (const s of need) {
        const q = r?.[s];
        if (q && q.price != null) {
          const prev = q.prevClose;
          const changePct = prev > 0 ? ((q.price - prev) / prev) * 100 : null;
          _quoteCache.set(s, { at: now, price: q.price, changePct });
          out[s] = { price: q.price, changePct };
        }
      }
    } catch (err) {
      markYfError(err);
    }
  }
  return out;
}

export async function fetchFundamentals(ticker) {
  const symbol = normalizeSymbol(ticker);
  if (yfEnabled()) {
    try {
      const r = await runYf(["fundamentals", symbol]);
      if (r?.financials) return { quarterEnd: r.quarterEnd ?? null, financials: r.financials };
    } catch (err) {
      markYfError(err);
    }
  }
  return null;
}
