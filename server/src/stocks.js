// Free Yahoo Finance data. No API key.
// The chart endpoint returns a full range of daily OHLCV — we keep the whole
// series so every technical indicator downstream is free.

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_QUOTESUMMARY =
  "https://query1.finance.yahoo.com/v10/finance/quoteSummary";

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

async function fetchYahooChart(symbol, range) {
  const hosts = ["query1", "query2"];
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const host of hosts) {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol,
      )}?interval=1d&range=${encodeURIComponent(range)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (res.ok) return parseYahooChart(symbol, await res.json());
      lastStatus = res.status;
      if (res.status !== 429 && res.status < 500) break; // 404 etc. — don't retry
    }
    await sleep(400 * (attempt + 1));
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
 * Fundamentals + short interest via quoteSummary. FRAGILE (may need a
 * crumb/cookie, rate-limits, changes shape). Never throws — returns null on
 * failure so callers can skip/re-weight rather than error.
 */
export async function fetchFundamentals(ticker) {
  try {
    const symbol = normalizeSymbol(ticker);
    const modules =
      "defaultKeyStatistics,financialData,incomeStatementHistoryQuarterly";
    const url = `${YAHOO_QUOTESUMMARY}/${encodeURIComponent(
      symbol,
    )}?modules=${modules}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.quoteSummary?.result?.[0];
    if (!r) return null;

    const num = (v) => (typeof v?.raw === "number" ? v.raw : null);
    const fd = r.financialData ?? {};
    const ks = r.defaultKeyStatistics ?? {};
    const quarters =
      r.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];

    return {
      shortRatio: num(ks.shortRatio),
      grossMargin: num(fd.grossMargins),
      operatingMargin: num(fd.operatingMargins),
      profitMargin: num(fd.profitMargins),
      revenueGrowth: num(fd.revenueGrowth),
      earningsGrowth: num(fd.earningsGrowth),
      debtToEquity: num(fd.debtToEquity),
      returnOnEquity: num(fd.returnOnEquity),
      freeCashflow: num(fd.freeCashflow),
      quarters: quarters.slice(0, 4).map((qr) => ({
        endDate: qr.endDate?.fmt ?? null,
        totalRevenue: num(qr.totalRevenue),
        netIncome: num(qr.netIncome),
        operatingIncome: num(qr.operatingIncome),
        grossProfit: num(qr.grossProfit),
      })),
    };
  } catch {
    return null;
  }
}
