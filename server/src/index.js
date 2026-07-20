import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeTicker } from "./analyze.js";
import { llmConfigured } from "./llm.js";
import {
  latestMacro,
  latestScanner,
  latestFundamentalScores,
  listWatchlist,
  addWatchlist,
  removeWatchlist,
  listAlerts,
  addAlert,
  removeAlert,
  usageThisMonth,
  getCachedSeries,
  setCachedSeries,
  freshSeriesMap,
  recordCheck,
  recentChecks,
  getAnalystDetail,
} from "./db.js";
import { fetchSeriesMulti } from "./stocks.js";
import {
  startScheduler,
  runMacro,
  runScannerJob,
  runAnalystJob,
} from "./scheduler.js";
import { blend } from "./analyst/blender.js";
import { NAMES } from "./scanner/names.js";
import { checkAlerts } from "./alerts.js";

function normSym(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\./g, "-");
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Last close + daily % change from a cached series.
function priceChangeOf(series) {
  if (!series?.closes?.length) return { price: null, changePct: null };
  const price = series.closes[series.closes.length - 1];
  const prev = series.closes[series.closes.length - 2];
  const changePct = prev > 0 ? ((price - prev) / prev) * 100 : null;
  return { price, changePct };
}

// Quotes for a set of tickers, reusing the shared 1y price cache and fetching
// any missing/stale names best-effort via the sidecar.
async function watchlistQuotes(tickers) {
  if (!tickers.length) return [];
  const { fresh, stale } = freshSeriesMap(tickers, 6 * 60 * 60 * 1000);
  const map = { ...fresh };
  if (stale.length) {
    try {
      const fetched = await fetchSeriesMulti(stale, "1y");
      for (const [t, series] of Object.entries(fetched)) {
        setCachedSeries(t, series);
        map[t] = series;
      }
    } catch {
      /* best-effort — show whatever is cached */
    }
  }
  return tickers.map((t) => ({
    ticker: t,
    name: NAMES[t] ?? null,
    ...priceChangeOf(map[t] ?? getCachedSeries(t)),
  }));
}

// age in ms beyond which a snapshot is flagged stale
const MACRO_STALE_MS = 45 * 60 * 1000;
const SCANNER_STALE_MS = 36 * 60 * 60 * 1000;

function envelope(row, staleMs) {
  if (!row) return { data: null, asOf: null, stale: true };
  const age = Date.now() - new Date(row.computedAt).getTime();
  return { asOf: row.computedAt, stale: age > staleMs };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3001;
const staticDir = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : null;

app.use(cors({ origin: process.env.CORS_ORIGIN ?? true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, llm: llmConfigured() });
});

// Month-to-date Claude usage + cost.
app.get("/api/usage", (_req, res) => {
  res.json({ llm: llmConfigured(), ...usageThisMonth() });
});

async function runCheck(ticker, res, opts) {
  if (!ticker || typeof ticker !== "string") {
    return res.status(400).json({ error: "ticker is required" });
  }
  try {
    const result = await analyzeTicker(ticker, opts);
    recordCheck({
      ticker: result.quote.ticker,
      name: result.quote.name,
      verdictLabel: result.verdict.label,
      verdictTone: result.verdict.tone,
      price: result.quote.price,
      llm: result.llm,
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    res.status(500).json({ error: message });
  }
}

// Persisted history of checked stocks (survives reloads). Revisiting one
// re-opens instantly from the quarter cache — no new Claude call.
app.get("/api/checks", (_req, res) => res.json({ data: recentChecks() }));

// Instant Check: live price + technicals + deterministic verdict, with a
// cached/live Claude deep-dive when available. `?deep=0` skips the LLM;
// `?fresh=1` forces a live Opus deep-dive even if the quarter cache has one.
app.get("/api/check/:sym", (req, res) => {
  const deep = req.query.deep !== "0" && req.query.deep !== "false";
  const fresh = req.query.fresh === "1" || req.query.fresh === "true";
  return runCheck(req.params.sym, res, { deep, fresh });
});

// Back-compat: original POST endpoint.
app.post("/api/analyze", (req, res) => runCheck(req.body?.ticker, res, {}));

// L1 macro gate — reads the latest cached snapshot instantly.
app.get("/api/macro", (_req, res) => {
  const row = latestMacro();
  const env = envelope(row, MACRO_STALE_MS);
  if (!row) return res.status(200).json(env);
  res.json({
    ...env,
    data: {
      composite: row.composite,
      zone: row.zone,
      sizingPct: row.meta?.sizingPct ?? null,
      scannerActive: row.meta?.scannerActive ?? false,
      scannerMode: row.meta?.scannerMode ?? null,
      oneLiner: row.meta?.oneLiner ?? "",
      signals: row.signals,
    },
  });
});

// L2 scanner — reads the latest nightly ranking; gated OFF when DEFENSIVE.
// When cached L3 analyst scores exist, blends them in (60/40) and flags
// upgrades/downgrades.
app.get("/api/scanner", (_req, res) => {
  const run = latestScanner();
  if (!run) return res.status(200).json({ data: null, asOf: null, stale: true });
  const age = Date.now() - new Date(run.computedAt).getTime();

  let rows = run.rows;
  let blended = false;
  let summary = null;
  const funds = latestFundamentalScores(run.rows.map((r) => r.ticker));
  if (Object.keys(funds).length) {
    const merged = blend(
      run.rows.map((r) => ({ ...r, quant: r.composite, fundamental: funds[r.ticker] ?? null })),
    );
    const detail = getAnalystDetail(merged.map((r) => r.ticker));
    rows = merged.map((r) => ({
      ticker: r.ticker,
      composite: r.composite,
      rank: r.blendedRank,
      quantRank: r.quantRank,
      blendedScore: r.blendedScore,
      rankDelta: r.rankDelta,
      rankFlag: r.rankFlag,
      fundamental: r.fundamental,
      factors: r.factors,
      analyst: detail[r.ticker] ?? null,
    }));
    const n = merged.length || 1;
    summary = {
      candidates: merged.length,
      upgrades: merged.filter((r) => r.rankFlag === "upgrade").length,
      downgrades: merged.filter((r) => r.rankFlag === "downgrade").length,
      avgBlended: Number((merged.reduce((s, r) => s + (r.blendedScore ?? 0), 0) / n).toFixed(3)),
      top5: merged.slice(0, 5).map((r) => r.ticker),
    };
    blended = true;
  }

  res.json({
    asOf: run.computedAt,
    stale: age > SCANNER_STALE_MS,
    macroMode: run.macroMode,
    scannerActive: run.macroMode !== "DEFENSIVE",
    blended,
    summary,
    data: rows.map((r) => {
      // Last close + daily change from the cached series (no extra fetch).
      const s = getCachedSeries(r.ticker);
      let price = null;
      let changePct = null;
      if (s?.closes?.length) {
        price = s.closes[s.closes.length - 1];
        const prev = s.closes[s.closes.length - 2];
        changePct = prev > 0 ? ((price - prev) / prev) * 100 : null;
      }
      return { ...r, name: NAMES[r.ticker] ?? null, price, changePct };
    }),
  });
});

// ---------- watchlist ----------
app.get("/api/watchlist", (_req, res) => res.json({ data: listWatchlist() }));

// Quotes for the watched names (last close + daily change).
app.get("/api/watchlist/quotes", async (_req, res) => {
  try {
    const tickers = listWatchlist().map((w) => w.ticker);
    res.json({ data: await watchlistQuotes(tickers) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "quotes failed" });
  }
});

// ---------- CNBC videos (via CNBC Television's YouTube feed) ----------
const CNBC_YT_CHANNEL = "UCrp_UI8XtuYfpiqluWLD7Lw"; // "CNBC Television"
let _cnbcVideos = { at: 0, data: [] };

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// Minimal parse of a YouTube channel RSS feed → [{ id, title, thumbnail, published }].
function parseYtFeed(xml) {
  const out = [];
  for (const e of xml.split("<entry>").slice(1)) {
    const id = (e.match(/<yt:videoId>([^<]+)</) || [])[1];
    const title = (e.match(/<title>([^<]*)</) || [])[1];
    const thumbnail = (e.match(/<media:thumbnail url="([^"]+)"/) || [])[1] ?? null;
    const published = (e.match(/<published>([^<]+)</) || [])[1] ?? null;
    if (id && title) out.push({ id, title: decodeEntities(title), thumbnail, published });
  }
  return out;
}

// Latest CNBC market videos. Cached ~10 min; serves stale on upstream failure.
app.get("/api/news/videos", async (_req, res) => {
  const now = Date.now();
  if (now - _cnbcVideos.at < 10 * 60 * 1000 && _cnbcVideos.data.length) {
    return res.json({ data: _cnbcVideos.data, cached: true });
  }
  try {
    const r = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CNBC_YT_CHANNEL}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) },
    );
    if (!r.ok) throw new Error(`youtube ${r.status}`);
    const data = parseYtFeed(await r.text()).slice(0, 12);
    if (data.length) _cnbcVideos = { at: now, data };
    res.json({ data: _cnbcVideos.data });
  } catch (err) {
    if (_cnbcVideos.data.length) return res.json({ data: _cnbcVideos.data, stale: true });
    res.status(502).json({ error: err instanceof Error ? err.message : "videos unavailable" });
  }
});

// Market indexes pinned at the front of the tape.
const TAPE_INDEXES = [
  { ticker: "^GSPC", label: "S&P 500" },
  { ticker: "^IXIC", label: "Nasdaq" },
];

// Ticker-tape feed: market indexes, then the watchlist, then the scanner's
// current top-ranked names (deduped, watchlist wins), each tagged with source.
app.get("/api/tape", async (_req, res) => {
  try {
    // Indexes (pinned first).
    const idxLabel = Object.fromEntries(TAPE_INDEXES.map((i) => [i.ticker, i.label]));
    const indexItems = (await watchlistQuotes(TAPE_INDEXES.map((i) => i.ticker))).map((q) => ({
      ...q,
      label: idxLabel[q.ticker],
      source: "index",
    }));

    const watchTickers = listWatchlist().map((w) => w.ticker);
    const items = (await watchlistQuotes(watchTickers)).map((q) => ({
      ...q,
      source: "watch",
    }));
    const seen = new Set(watchTickers);

    const run = latestScanner();
    if (run && run.macroMode !== "DEFENSIVE") {
      for (const r of run.rows.slice(0, 20)) {
        if (seen.has(r.ticker)) continue;
        seen.add(r.ticker);
        items.push({
          ticker: r.ticker,
          name: NAMES[r.ticker] ?? null,
          ...priceChangeOf(getCachedSeries(r.ticker)),
          source: "scan",
        });
      }
    }
    res.json({ data: [...indexItems, ...items] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "tape failed" });
  }
});

app.post("/api/watchlist", (req, res) => {
  const ticker = normSym(req.body?.ticker);
  if (!ticker) return res.status(400).json({ error: "ticker is required" });
  addWatchlist(ticker);
  res.json({ ok: true, data: listWatchlist() });
});

app.delete("/api/watchlist/:sym", (req, res) => {
  removeWatchlist(normSym(req.params.sym));
  res.json({ ok: true, data: listWatchlist() });
});

// ---------- alerts (buy-zone) ----------
app.get("/api/alerts", (_req, res) => res.json({ data: listAlerts() }));

app.post("/api/alerts", (req, res) => {
  const ticker = normSym(req.body?.ticker);
  const targetLow = numOrNull(req.body?.targetLow);
  const targetHigh = numOrNull(req.body?.targetHigh);
  if (!ticker) return res.status(400).json({ error: "ticker is required" });
  if (targetLow == null && targetHigh == null) {
    return res.status(400).json({ error: "a target price is required" });
  }
  const alert = addAlert({ ticker, targetLow, targetHigh });
  res.json({ ok: true, alert, data: listAlerts() });
});

app.delete("/api/alerts/:id", (req, res) => {
  removeAlert(Number(req.params.id));
  res.json({ ok: true, data: listAlerts() });
});

// Run the alert check now (instead of waiting for the 10-min cron) — useful for
// testing email delivery.
app.post("/api/alerts/check", async (_req, res) => {
  try {
    const result = await checkAlerts();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "check failed" });
  }
});

// Kick a background recompute; returns immediately.
app.post("/api/refresh/:layer", (req, res) => {
  const layer = req.params.layer;
  if (layer === "macro") {
    runMacro();
    return res.json({ ok: true, layer, started: true });
  }
  if (layer === "scanner") {
    runScannerJob();
    return res.json({ ok: true, layer, started: true });
  }
  if (layer === "analyst") {
    runAnalystJob();
    return res.json({ ok: true, layer, started: true });
  }
  res.status(404).json({ error: `unknown layer "${layer}"` });
});

if (staticDir) {
  app.use(express.static(staticDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

app.listen(port, "0.0.0.0", () => {
  console.log(
    staticDir
      ? `Stock Checker listening on http://0.0.0.0:${port} (UI + API)`
      : `API listening on http://0.0.0.0:${port}`,
  );
  startScheduler();
});
