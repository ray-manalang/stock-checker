import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeTicker } from "./analyze.js";
import { llmConfigured } from "./llm.js";
import {
  db,
  runPersonalDataMigration,
  latestMacro,
  latestScanner,
  latestFundamentalScores,
  listWatchlist,
  addWatchlist,
  removeWatchlist,
  listAlerts,
  addAlert,
  removeAlert,
  updateAlert,
  usageThisMonth,
  usageToday,
  getCachedSeries,
  setCachedSeries,
  freshSeriesMap,
  recordCheck,
  recentChecks,
  deleteRecentCheck,
  getAnalystDetail,
  logVerdict,
  getUserSetting,
  setUserSetting,
  setHoldingFlag,
  getCompanyMeta,
  upsertCompanyMeta,
  listWatchlistVerdictState,
  listUsers,
} from "./db.js";
import { fetchSeriesMulti, liveQuotes, fetchCompanyMeta } from "./stocks.js";
import {
  startScheduler,
  runMacro,
  runScannerJob,
  runAnalystJob,
} from "./scheduler.js";
import { blend } from "./analyst/blender.js";
import { resolveName, resolveSector } from "./scanner/universe.js";
import { checkAlerts } from "./alerts.js";
import { RISK_PROFILES, DEFAULT_RISK, normalizeRisk } from "./risk.js";
import {
  rollupHoldings,
  previewHoldingsCsv,
  importHoldingsCsv,
  heldTickers,
} from "./holdings.js";
import { haSummary } from "./notify.js";
import { buildBacktestReport } from "./backtest.js";
import { checkWatchlistSignals } from "./watchlistSignals.js";
import {
  requireAuth,
  requireAdmin,
  login,
  logout,
  registerWithInvite,
  createInviteFor,
  bootstrapAdminIfNeeded,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  SESSION_COOKIE,
  updateUserProfile,
  meFromReq,
  changePassword,
  deleteAccount,
} from "./auth.js";
import { rateLimit, clientIp } from "./rateLimit.js";

// ---------- boot ----------
db();
const boot = bootstrapAdminIfNeeded();
const admin = boot || listUsers().find((u) => u.role === "admin") || listUsers()[0];
if (admin) runPersonalDataMigration(admin.id);

const DAILY_LLM_BUDGET_USD = Number(process.env.DAILY_LLM_BUDGET_USD) || 5;

function normSym(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\./g, "-");
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function userRisk(userId) {
  return RISK_PROFILES[normalizeRisk(getUserSetting(userId, "riskTolerance", DEFAULT_RISK))];
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
    name: resolveName(t),
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

app.set("trust proxy", 1);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));

// ---------- public routes (no auth) ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, llm: llmConfigured() });
});

app.post("/api/auth/login", (req, res) => {
  if (!rateLimit(`login:${clientIp(req)}`, { limit: 20, windowMs: 15 * 60 * 1000 })) {
    return res.status(429).json({ error: "Too many login attempts. Try again later" });
  }
  const result = login(req.body?.username, req.body?.password);
  if (result.error) return res.status(result.status || 401).json({ error: result.error });
  setSessionCookie(res, result.sessionId);
  res.json({ user: result.user });
});

app.post("/api/auth/logout", (req, res) => {
  const sid = parseCookies(req)[SESSION_COOKIE];
  logout(sid);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/auth/register", (req, res) => {
  if (!rateLimit(`register:${clientIp(req)}`, { limit: 10, windowMs: 60 * 60 * 1000 })) {
    return res.status(429).json({ error: "Too many registration attempts" });
  }
  const result = registerWithInvite({
    token: req.body?.token ?? req.body?.invite,
    username: req.body?.username,
    password: req.body?.password,
    alertEmail: req.body?.alertEmail,
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  setSessionCookie(res, result.sessionId);
  res.json({ user: result.user });
});

// Soft session: no cookie → null; invalid/expired cookie → clear + null; else user.
app.get("/api/auth/me", (req, res) => {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return res.json({ user: null });
  let answered = false;
  const softRes = {
    status(code) {
      this._code = code;
      return this;
    },
    json(_body) {
      if (this._code === 401) {
        clearSessionCookie(res);
        res.json({ user: null });
        answered = true;
      }
      return this;
    },
  };
  requireAuth(req, softRes, () => {
    if (!answered) res.json({ user: meFromReq(req) });
  });
});

// Everything under /api except health + /auth/* requires a valid session.
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/auth/")) return next();
  return requireAuth(req, res, next);
});

async function runCheck(userId, ticker, res, opts) {
  if (!ticker || typeof ticker !== "string") {
    return res.status(400).json({ error: "ticker is required" });
  }
  try {
    const result = await analyzeTicker(ticker, opts);
    recordCheck(userId, {
      ticker: result.quote.ticker,
      name: result.quote.name,
      verdictLabel: result.verdict.label,
      verdictTone: result.verdict.tone,
      price: result.quote.price,
      llm: result.llm,
    });
    // Append-only history for Phase 4 backtesting (separate from recent_checks).
    logVerdict({
      ticker: result.quote.ticker,
      verdict: result.verdict.signal,
      label: result.verdict.label,
      confidence: result.confidence,
      price: result.quote.price,
      source: result.llm ? "claude" : "deterministic",
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    res.status(500).json({ error: message });
  }
}

function checkDeepAllowed(wantDeep) {
  if (!wantDeep) return false;
  const today = usageToday();
  if (today.cost >= DAILY_LLM_BUDGET_USD) return false;
  return true;
}

const KOFI_URL = (process.env.KOFI_URL || "https://ko-fi.com/ideadog").trim();

function llmBudgetPayload() {
  const siteToday = usageToday();
  return {
    dailyUsd: DAILY_LLM_BUDGET_USD,
    siteTodayCost: siteToday.cost,
    deepAllowed: siteToday.cost < DAILY_LLM_BUDGET_USD,
  };
}

// Per-user Claude usage + shared daily budget (and tip-jar URL).
app.get("/api/usage", (req, res) => {
  const payload = {
    llm: llmConfigured(),
    ...usageThisMonth(req.user.id),
    today: usageToday(req.user.id),
    budget: llmBudgetPayload(),
    support: {
      url: KOFI_URL,
      label: "Chip in for LLM costs",
      tooltip:
        "Market Specialist is free for invited friends. Tips help cover Claude usage when the daily budget runs out.",
    },
  };
  if (req.user.role === "admin") {
    payload.site = {
      ...usageThisMonth(),
      today: usageToday(),
    };
  }
  res.json(payload);
});

// Persisted history of checked stocks (survives reloads). Revisiting one
// re-opens instantly from the quarter cache — no new Claude call.
app.get("/api/checks", (req, res) => res.json({ data: recentChecks(req.user.id) }));
app.delete("/api/checks/:sym", (req, res) => {
  const sym = String(req.params.sym || "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "-");
  if (!sym) return res.status(400).json({ error: "ticker is required" });
  res.json({ ok: true, data: deleteRecentCheck(req.user.id, sym) });
});

// Instant Check: live price + technicals + deterministic verdict, with a
// cached/live Claude deep-dive when available. `?deep=0` skips the LLM;
// `?fresh=1` forces a live Opus deep-dive even if the quarter cache has one.
// Over daily spend budget, deep is forced off.
app.get("/api/check/:sym", (req, res) => {
  if (!rateLimit(`check:${req.user.id}:${clientIp(req)}`, { limit: 60, windowMs: 60_000 })) {
    return res.status(429).json({ error: "Too many checks. Slow down" });
  }
  let deep = req.query.deep !== "0" && req.query.deep !== "false";
  deep = checkDeepAllowed(deep);
  const fresh = req.query.fresh === "1" || req.query.fresh === "true";
  const risk = userRisk(req.user.id);
  return runCheck(req.user.id, req.params.sym, res, {
    deep,
    fresh,
    buyZoneScale: risk.buyZoneScale,
  });
});

// Back-compat: original POST endpoint.
app.post("/api/analyze", (req, res) => {
  if (!rateLimit(`check:${req.user.id}:${clientIp(req)}`, { limit: 60, windowMs: 60_000 })) {
    return res.status(429).json({ error: "Too many checks. Slow down" });
  }
  const deep = checkDeepAllowed(true);
  const risk = userRisk(req.user.id);
  return runCheck(req.user.id, req.body?.ticker, res, {
    deep,
    buyZoneScale: risk.buyZoneScale,
  });
});

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
// When cached L3 analyst scores exist, blends them in using the caller's risk
// quant weight and flags upgrades/downgrades.
app.get("/api/scanner", async (req, res) => {
  const run = latestScanner();
  if (!run) return res.status(200).json({ data: null, asOf: null, stale: true });
  const age = Date.now() - new Date(run.computedAt).getTime();

  let rows = run.rows;
  let blended = false;
  let summary = null;
  const risk = userRisk(req.user.id);
  const funds = latestFundamentalScores(run.rows.map((r) => r.ticker));
  if (Object.keys(funds).length) {
    const merged = blend(
      run.rows.map((r) => ({ ...r, quant: r.composite, fundamental: funds[r.ticker] ?? null })),
      { quantWeight: risk.quantWeight },
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
      sector: r.sector ?? null,
      sectorRank: r.sectorRank ?? null,
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

  // Live prices (cached ~60s) so the ranking updates each minute; fall back to
  // the cached daily series when a live quote isn't available.
  const live = await liveQuotes(rows.map((r) => r.ticker));

  res.json({
    asOf: run.computedAt,
    stale: age > SCANNER_STALE_MS,
    macroMode: run.macroMode,
    scannerActive: run.macroMode !== "DEFENSIVE",
    blended,
    summary,
    data: rows.map((r) => {
      let price = null;
      let changePct = null;
      const s = getCachedSeries(r.ticker);
      if (s?.closes?.length) {
        price = s.closes[s.closes.length - 1];
        const prev = s.closes[s.closes.length - 2];
        changePct = prev > 0 ? ((price - prev) / prev) * 100 : null;
      }
      const l = live[r.ticker];
      if (l && l.price != null) {
        price = l.price;
        changePct = l.changePct;
      }
      return { ...r, name: resolveName(r.ticker), price, changePct };
    }),
  });
});

// ---------- watchlist ----------
app.get("/api/watchlist", (req, res) => res.json({ data: listWatchlist(req.user.id) }));

// Quotes for the watched names (last close + daily change).
app.get("/api/watchlist/quotes", async (req, res) => {
  try {
    const tickers = listWatchlist(req.user.id).map((w) => w.ticker);
    res.json({ data: await watchlistQuotes(tickers) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "quotes failed" });
  }
});

// ---------- Market videos (YouTube RSS; per-user sources) ----------
const DEFAULT_VIDEO_SOURCES = [
  { channelId: "UCrp_UI8XtuYfpiqluWLD7Lw", label: "CNBC Television" },
];

function getVideoSources(userId) {
  const s = getUserSetting(userId, "videoSources", null);
  return Array.isArray(s) ? s : DEFAULT_VIDEO_SOURCES;
}

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

// The channel's own name (the first <title>, before any <entry>).
function feedTitle(xml) {
  const head = xml.split("<entry>")[0] ?? xml;
  const m = head.match(/<title>([^<]*)</);
  return m ? decodeEntities(m[1]) : null;
}

async function fetchChannelFeed(channelId) {
  const r = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
    { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) },
  );
  if (!r.ok) throw new Error(`youtube ${r.status}`);
  return r.text();
}

// Resolve a channel ID from a raw `UC…` id, a channel/feed URL, or a handle /
// custom URL (fetches the page and extracts the channelId).
async function resolveChannelId(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const uc = s.match(/UC[\w-]{20,}/);
  if (uc) return uc[0];
  const url = /^https?:\/\//.test(s)
    ? s
    : `https://www.youtube.com/${s.startsWith("@") ? s : "@" + s}`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m =
      html.match(/"(?:channelId|externalId)":"(UC[\w-]+)"/) ||
      html.match(/\/channel\/(UC[\w-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Per-user video RSS cache: userId → { at, key, data }. */
const videoCache = new Map();

// Merge the latest videos across this user's sources, newest first.
async function fetchAllVideos(userId) {
  const all = [];
  for (const src of getVideoSources(userId)) {
    try {
      for (const v of parseYtFeed(await fetchChannelFeed(src.channelId)).slice(0, 12)) {
        all.push({ ...v, source: src.label });
      }
    } catch {
      /* skip a failing source */
    }
  }
  all.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  return all.slice(0, 24);
}

function clearUserVideoCache(userId) {
  videoCache.delete(userId);
}

// Latest market videos across the configured sources. Cached ~5 min (keyed on
// user + source set); serves stale on upstream failure. `?force=1` bypasses cache.
app.get("/api/news/videos", async (req, res) => {
  const now = Date.now();
  const force = req.query.force === "1" || req.query.force === "true";
  const key = getVideoSources(req.user.id)
    .map((s) => s.channelId)
    .join(",");
  const cached = videoCache.get(req.user.id);
  if (!force && cached?.key === key && now - cached.at < 5 * 60 * 1000 && cached.data.length) {
    return res.json({ data: cached.data, cached: true });
  }
  try {
    const data = await fetchAllVideos(req.user.id);
    if (data.length) videoCache.set(req.user.id, { at: now, key, data });
    res.json({ data });
  } catch (err) {
    if (cached?.data?.length) return res.json({ data: cached.data, stale: true });
    res.status(502).json({ error: err instanceof Error ? err.message : "videos unavailable" });
  }
});

// ---------- video sources (per-user) ----------
app.get("/api/news/sources", (req, res) => res.json({ data: getVideoSources(req.user.id) }));

app.post("/api/news/sources", async (req, res) => {
  const channelId = await resolveChannelId(req.body?.url ?? req.body?.channelId);
  if (!channelId) {
    return res.status(400).json({
      error: "Couldn't find a YouTube channel there. Paste a channel URL, @handle, or channel ID.",
    });
  }
  const sources = getVideoSources(req.user.id);
  if (sources.some((s) => s.channelId === channelId)) {
    return res.status(409).json({ error: "That channel is already a source." });
  }
  let label = String(req.body?.label ?? "").trim();
  if (!label) {
    try {
      label = feedTitle(await fetchChannelFeed(channelId)) ?? channelId;
    } catch {
      label = channelId;
    }
  }
  const next = [...sources, { channelId, label }];
  setUserSetting(req.user.id, "videoSources", next);
  clearUserVideoCache(req.user.id);
  res.json({ ok: true, data: next });
});

app.delete("/api/news/sources/:channelId", (req, res) => {
  const next = getVideoSources(req.user.id).filter((s) => s.channelId !== req.params.channelId);
  setUserSetting(req.user.id, "videoSources", next);
  clearUserVideoCache(req.user.id);
  res.json({ ok: true, data: next });
});

// Market indexes pinned at the front of the tape.
const TAPE_INDEXES = [
  { ticker: "^GSPC", label: "S&P 500" },
  { ticker: "^IXIC", label: "Nasdaq" },
];

// Ticker-tape feed: market indexes, then this user's watchlist, then the
// scanner's current top-ranked names (deduped, watchlist wins). Recently
// checked names that aren't on the watchlist are omitted so the marquee
// doesn't re-surface one-off Research lookups.
app.get("/api/tape", async (req, res) => {
  try {
    // Indexes (pinned first).
    const idxLabel = Object.fromEntries(TAPE_INDEXES.map((i) => [i.ticker, i.label]));
    const indexItems = (await watchlistQuotes(TAPE_INDEXES.map((i) => i.ticker))).map((q) => ({
      ...q,
      label: idxLabel[q.ticker],
      source: "index",
    }));

    const watchTickers = listWatchlist(req.user.id).map((w) => w.ticker);
    const watchSet = new Set(watchTickers);
    const items = (await watchlistQuotes(watchTickers)).map((q) => ({
      ...q,
      source: "watch",
    }));
    const seen = new Set(watchTickers);
    const recentOnly = new Set(
      recentChecks(req.user.id)
        .map((c) => c.ticker)
        .filter((t) => t && !watchSet.has(t)),
    );

    const run = latestScanner();
    if (run && run.macroMode !== "DEFENSIVE") {
      for (const r of run.rows.slice(0, 20)) {
        if (seen.has(r.ticker) || recentOnly.has(r.ticker)) continue;
        seen.add(r.ticker);
        items.push({
          ticker: r.ticker,
          name: resolveName(r.ticker),
          ...priceChangeOf(getCachedSeries(r.ticker)),
          source: "scan",
        });
      }
    }

    // Overlay live prices (cached ~60s) so the tape updates each minute.
    const all = [...indexItems, ...items];
    const live = await liveQuotes(all.map((i) => i.ticker));
    const data = all.map((i) => {
      const l = live[i.ticker];
      return l && l.price != null ? { ...i, price: l.price, changePct: l.changePct } : i;
    });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "tape failed" });
  }
});

// Live quotes for an explicit set of symbols (used by the check card's minute
// refresh). `?symbols=AAPL,MSFT`.
app.get("/api/quotes", async (req, res) => {
  try {
    const symbols = String(req.query.symbols ?? "")
      .split(",")
      .map((s) => normSym(s))
      .filter(Boolean);
    res.json({ data: symbols.length ? await liveQuotes(symbols) : {} });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "quotes failed" });
  }
});

app.post("/api/watchlist", (req, res) => {
  const ticker = normSym(req.body?.ticker);
  if (!ticker) return res.status(400).json({ error: "ticker is required" });
  addWatchlist(req.user.id, ticker);
  res.json({ ok: true, data: listWatchlist(req.user.id) });
});

app.delete("/api/watchlist/:sym", (req, res) => {
  removeWatchlist(req.user.id, normSym(req.params.sym));
  res.json({ ok: true, data: listWatchlist(req.user.id) });
});

// ---------- alerts (buy-zone) ----------
app.get("/api/alerts", (req, res) => res.json({ data: listAlerts(req.user.id) }));

app.post("/api/alerts", (req, res) => {
  const ticker = normSym(req.body?.ticker);
  const targetLow = numOrNull(req.body?.targetLow);
  const targetHigh = numOrNull(req.body?.targetHigh);
  if (!ticker) return res.status(400).json({ error: "ticker is required" });
  if (targetLow == null && targetHigh == null) {
    return res.status(400).json({ error: "a target price is required" });
  }
  const alert = addAlert(req.user.id, { ticker, targetLow, targetHigh });
  res.json({ ok: true, alert, data: listAlerts(req.user.id) });
});

// Edit an existing alert's target(s) and re-arm it (alert management UI).
app.put("/api/alerts/:id", (req, res) => {
  const targetLow = numOrNull(req.body?.targetLow);
  const targetHigh = numOrNull(req.body?.targetHigh);
  if (targetLow == null && targetHigh == null) {
    return res.status(400).json({ error: "a target price is required" });
  }
  updateAlert(req.user.id, Number(req.params.id), { targetLow, targetHigh });
  res.json({ ok: true, data: listAlerts(req.user.id) });
});

app.delete("/api/alerts/:id", (req, res) => {
  removeAlert(req.user.id, Number(req.params.id));
  res.json({ ok: true, data: listAlerts(req.user.id) });
});

// ---------- settings (risk tolerance + alert email) ----------
app.get("/api/settings", (req, res) => {
  const profile = updateUserProfile(req.user.id, {});
  res.json({
    riskTolerance: normalizeRisk(getUserSetting(req.user.id, "riskTolerance", DEFAULT_RISK)),
    alertEmail: profile?.alertEmail ?? null,
    riskProfiles: Object.fromEntries(
      Object.entries(RISK_PROFILES).map(([k, v]) => [k, { label: v.label }]),
    ),
  });
});

app.put("/api/settings", (req, res) => {
  if (req.body?.riskTolerance != null) {
    setUserSetting(req.user.id, "riskTolerance", normalizeRisk(req.body.riskTolerance));
  }
  let alertEmail = req.user.alertEmail ?? null;
  if (req.body?.alertEmail !== undefined) {
    const updated = updateUserProfile(req.user.id, { alertEmail: req.body.alertEmail });
    alertEmail = updated?.alertEmail ?? null;
    req.user.alertEmail = alertEmail;
  }
  res.json({
    ok: true,
    riskTolerance: normalizeRisk(getUserSetting(req.user.id, "riskTolerance", DEFAULT_RISK)),
    alertEmail,
  });
});

app.put("/api/account/password", (req, res) => {
  const result = changePassword(
    req.user.id,
    req.sessionId,
    {
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
    },
    req.holdingsDek,
  );
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ ok: true });
});

app.delete("/api/account", (req, res) => {
  const result = deleteAccount(req.user.id, req.sessionId, {
    password: req.body?.password,
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- watchlist buy-signals (Phase 2.2) ----------
// Per-ticker last verdict + notification state for the "Watching to buy" panel.
app.get("/api/watchlist/signals", async (req, res) => {
  const rows = listWatchlistVerdictState(req.user.id);
  const tickers = rows.map((r) => r.ticker);
  // resolveName covers the S&P 500; fill ADRs/ETFs/foreign names from the meta
  // cache, then fetch anything still missing once via the sidecar (and cache it).
  const names = {};
  for (const [t, m] of Object.entries(getCompanyMeta(tickers))) {
    if (m.name) names[t] = m.name;
  }
  const unknown = tickers.filter((t) => !names[t] && !resolveName(t));
  if (unknown.length) {
    try {
      const fetched = await fetchCompanyMeta(unknown);
      if (Object.keys(fetched).length) {
        upsertCompanyMeta(fetched);
        for (const [t, m] of Object.entries(fetched)) if (m.name) names[t] = m.name;
      }
    } catch {
      /* best-effort — fall back to whatever resolved */
    }
  }
  res.json({
    data: rows.map((r) => ({
      ...r,
      name: names[r.ticker] ?? resolveName(r.ticker),
      ...priceChangeOf(getCachedSeries(r.ticker)),
    })),
  });
});

// Run the daily watchlist scan now (instead of waiting for the cron) — admin.
app.post("/api/watchlist/signals/check", requireAdmin, async (_req, res) => {
  try {
    res.json({ ok: true, ...(await checkWatchlistSignals()) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "check failed" });
  }
});

// ---------- holdings (Phase 3) ----------
// Gather a price map for a set of tickers from the shared daily-close cache.
// Holdings is a periodic snapshot ("as of <date>"), so last-close prices are
// the right granularity — and serving from cache keeps the page instant instead
// of spawning the sidecar for live quotes on every load. Only genuinely
// uncached tickers trigger a single batched fetch (then cached 24h). closes feed
// the local verdict.
async function holdingsPriceMap(tickers) {
  if (!tickers.length) return {};
  const { fresh, stale } = freshSeriesMap(tickers, 24 * 60 * 60 * 1000);
  const seriesMap = { ...fresh };
  if (stale.length) {
    try {
      const fetched = await fetchSeriesMulti(stale, "1y");
      for (const [t, series] of Object.entries(fetched)) {
        setCachedSeries(t, series);
        seriesMap[t] = series;
      }
    } catch {
      /* best-effort — show whatever is cached */
    }
  }
  const out = {};
  for (const t of tickers) {
    const s = seriesMap[t] ?? getCachedSeries(t);
    const { price, changePct } = priceChangeOf(s?.closes ? { closes: s.closes } : {});
    out[t] = { price: price ?? null, changePct: changePct ?? null, closes: s?.closes ?? null };
  }
  return out;
}

function requireHoldingsDek(req, res) {
  if (!req.holdingsDek) {
    res.status(401).json({
      error: "Holdings key unavailable. Sign out and sign in again to unlock your portfolio",
    });
    return false;
  }
  return true;
}

app.get("/api/holdings", async (req, res) => {
  if (!requireHoldingsDek(req, res)) return;
  try {
    const tickers = heldTickers(req.user.id, req.holdingsDek);
    const priceMap = await holdingsPriceMap(tickers);
    // Resolve company name + sector. resolveName/resolveSector cover the S&P 500
    // (scraped table + static map); fill the rest (ADRs, foreign names, ETFs)
    // from the meta cache, and fetch anything still missing once via the sidecar
    // (then cached — only runs the first time such a ticker is held).
    const names = {};
    const sectors = {};
    for (const [t, m] of Object.entries(getCompanyMeta(tickers))) {
      if (m.name) names[t] = m.name;
      if (m.sector) sectors[t] = m.sector;
    }
    const unknown = tickers.filter(
      (t) => (!names[t] && !resolveName(t)) || (!sectors[t] && !resolveSector(t)),
    );
    if (unknown.length) {
      const fetched = await fetchCompanyMeta(unknown);
      if (Object.keys(fetched).length) {
        upsertCompanyMeta(fetched);
        for (const [t, m] of Object.entries(fetched)) {
          if (m.name) names[t] = m.name;
          if (m.sector) sectors[t] = m.sector;
        }
      }
    }
    const portfolio = rollupHoldings(req.user.id, priceMap, names, sectors, req.holdingsDek);
    const macro = latestMacro();
    res.json({
      data: portfolio,
      macro: macro
        ? { zone: macro.zone, sizingPct: macro.meta?.sizingPct ?? null }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "holdings failed" });
  }
});

// Preview an uploaded CSV → detected headers, sample rows, suggested mapping.
app.post("/api/holdings/preview", (req, res) => {
  try {
    res.json({ data: previewHoldingsCsv(req.user.id, String(req.body?.csv ?? "")) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "preview failed" });
  }
});

// Import positions (snapshot; replaces holdings wholesale) using a column mapping.
app.post("/api/holdings/import", (req, res) => {
  if (!requireHoldingsDek(req, res)) return;
  try {
    const summary = importHoldingsCsv(
      req.user.id,
      String(req.body?.csv ?? ""),
      req.body?.mapping ?? {},
      req.body?.asOf ?? null,
      req.holdingsDek,
    );
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "import failed" });
  }
});

// Toggle a position's tax-advantaged flag (survives re-import) — Phase 3.3.
app.post("/api/holdings/:ticker/tax", (req, res) => {
  setHoldingFlag(req.user.id, normSym(req.params.ticker), !!req.body?.taxAdvantaged);
  res.json({ ok: true });
});

// ---------- Home Assistant (Phase 2.1) — admin ops tile ----------
app.get("/api/ha/summary", requireAdmin, (_req, res) => res.json(haSummary()));

// ---------- backtest report (Phase 4.4) ----------
app.get("/api/backtest", async (req, res) => {
  try {
    const windowDays = Number(req.query.window) || 90;
    res.json({ data: await buildBacktestReport({ windowDays }) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "backtest failed" });
  }
});

// Run the alert check now (instead of waiting for the 10-min cron) — admin.
app.post("/api/alerts/check", requireAdmin, async (_req, res) => {
  try {
    const result = await checkAlerts();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "check failed" });
  }
});

// Kick a background recompute; returns immediately — admin only.
app.post("/api/refresh/:layer", requireAdmin, (req, res) => {
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

// ---------- admin: invite links ----------
app.post("/api/admin/invites", requireAdmin, (req, res) => {
  const days = Number(req.body?.days) || 14;
  const invite = createInviteFor(req.user.id, { days });
  res.json({ ok: true, ...invite });
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
      ? `Market Specialist listening on http://0.0.0.0:${port} (UI + API)`
      : `Market Specialist listening on http://0.0.0.0:${port}`,
  );
  startScheduler();
});
