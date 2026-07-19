// SQLite store (writer/reader split per the freshness architecture). Scheduled
// jobs write snapshots; read endpoints serve the latest instantly.

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.DB_PATH?.trim() || path.join(__dirname, "..", "stock-checker.db");

let _db = null;

export function db() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS macro_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      composite REAL NOT NULL,
      zone TEXT NOT NULL,
      signals_json TEXT NOT NULL,
      meta_json TEXT,
      computed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scanner_results (
      ticker TEXT NOT NULL,
      composite REAL,
      factors_json TEXT,
      rank INTEGER,
      macro_mode TEXT,
      computed_at TEXT NOT NULL,
      PRIMARY KEY (ticker, computed_at)
    );
    CREATE TABLE IF NOT EXISTS scanner_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      macro_mode TEXT,
      count INTEGER,
      computed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analyst_scores (
      ticker TEXT NOT NULL,
      quarter_end TEXT NOT NULL,
      dimensions_json TEXT,
      fundamental_score REAL,
      model TEXT,
      computed_at TEXT NOT NULL,
      PRIMARY KEY (ticker, quarter_end)
    );
    CREATE TABLE IF NOT EXISTS price_cache (
      ticker TEXT PRIMARY KEY,
      series_json TEXT NOT NULL,
      indicators_json TEXT,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      ticker TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      target_low REAL,
      target_high REAL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      triggered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS recent_checks (
      ticker TEXT PRIMARY KEY,
      name TEXT,
      verdict_label TEXT,
      verdict_tone TEXT,
      price REAL,
      llm INTEGER DEFAULT 0,
      checked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  return _db;
}

// ---------- macro ----------
export function saveMacro({ composite, zone, signals, meta }) {
  const at = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO macro_snapshot (composite, zone, signals_json, meta_json, computed_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(composite, zone, JSON.stringify(signals), JSON.stringify(meta ?? {}), at);
  return at;
}

export function latestMacro() {
  const row = db()
    .prepare(`SELECT * FROM macro_snapshot ORDER BY id DESC LIMIT 1`)
    .get();
  if (!row) return null;
  return {
    composite: row.composite,
    zone: row.zone,
    signals: JSON.parse(row.signals_json),
    meta: row.meta_json ? JSON.parse(row.meta_json) : {},
    computedAt: row.computed_at,
  };
}

// ---------- scanner ----------
export function saveScanner(rows, macroMode) {
  const at = new Date().toISOString();
  const insert = db().prepare(
    `INSERT OR REPLACE INTO scanner_results
       (ticker, composite, factors_json, rank, macro_mode, computed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = db().transaction((list) => {
    for (const r of list) {
      insert.run(
        r.ticker,
        r.composite,
        JSON.stringify(r.factors ?? {}),
        r.rank,
        macroMode,
        at,
      );
    }
    db()
      .prepare(
        `INSERT INTO scanner_run (macro_mode, count, computed_at) VALUES (?, ?, ?)`,
      )
      .run(macroMode, list.length, at);
  });
  tx(rows);
  return at;
}

export function latestScanner(limit = 50) {
  const run = db()
    .prepare(`SELECT * FROM scanner_run ORDER BY id DESC LIMIT 1`)
    .get();
  if (!run) return null;
  const rows = db()
    .prepare(
      `SELECT ticker, composite, factors_json, rank FROM scanner_results
       WHERE computed_at = ? ORDER BY rank ASC LIMIT ?`,
    )
    .all(run.computed_at, limit)
    .map((r) => ({
      ticker: r.ticker,
      composite: r.composite,
      rank: r.rank,
      factors: r.factors_json ? JSON.parse(r.factors_json) : {},
    }));
  return { rows, macroMode: run.macro_mode, computedAt: run.computed_at };
}

// ---------- analyst ----------
export function getAnalystScore(ticker, quarterEnd, model) {
  // No model → match any cached row for this ticker+quarter (the Check flow
  // caches under the deep-dive model, so a null filter must not exclude it).
  if (model == null) {
    return db()
      .prepare(
        `SELECT * FROM analyst_scores WHERE ticker = ? AND quarter_end = ?
         ORDER BY computed_at DESC LIMIT 1`,
      )
      .get(ticker, quarterEnd);
  }
  return db()
    .prepare(
      `SELECT * FROM analyst_scores WHERE ticker = ? AND quarter_end = ?
       AND (model = ? OR model IS NULL) LIMIT 1`,
    )
    .get(ticker, quarterEnd, model);
}

/**
 * Most recent cached row for a ticker, ignoring the quarter. Used as a
 * fallback when fundamentals can't be fetched (so the quarter key is unknown)
 * to avoid needlessly re-running a paid deep-dive we already have.
 */
export function getLatestAnalystScore(ticker) {
  return db()
    .prepare(
      `SELECT * FROM analyst_scores WHERE ticker = ?
       ORDER BY computed_at DESC LIMIT 1`,
    )
    .get(ticker);
}

/** Latest fundamental score per ticker (any quarter), for the blender. */
export function latestFundamentalScores(tickers) {
  if (!tickers?.length) return {};
  const placeholders = tickers.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT ticker, fundamental_score FROM analyst_scores
       WHERE ticker IN (${placeholders})
       GROUP BY ticker HAVING MAX(computed_at)`,
    )
    .all(...tickers);
  const out = {};
  for (const r of rows) out[r.ticker] = r.fundamental_score;
  return out;
}

/** Latest analyst detail per ticker (dimensions + notes + score) for the UI. */
export function getAnalystDetail(tickers) {
  if (!tickers?.length) return {};
  const placeholders = tickers.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT ticker, dimensions_json, fundamental_score, model FROM analyst_scores
       WHERE ticker IN (${placeholders}) GROUP BY ticker HAVING MAX(computed_at)`,
    )
    .all(...tickers);
  const out = {};
  for (const r of rows) {
    let blob = {};
    try {
      blob = r.dimensions_json ? JSON.parse(r.dimensions_json) : {};
    } catch {
      blob = {};
    }
    out[r.ticker] = {
      dimensions: blob.dimensions ?? null,
      notes: blob.analyst_notes ?? blob.verdict_plain ?? null,
      fundamentalScore: r.fundamental_score,
      model: r.model,
    };
  }
  return out;
}

export function saveAnalystScore({ ticker, quarterEnd, dimensions, fundamentalScore, model }) {
  db()
    .prepare(
      `INSERT OR REPLACE INTO analyst_scores
         (ticker, quarter_end, dimensions_json, fundamental_score, model, computed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ticker,
      quarterEnd,
      JSON.stringify(dimensions ?? {}),
      fundamentalScore,
      model ?? null,
      new Date().toISOString(),
    );
}

// ---------- recent checks ----------
export function recordCheck({ ticker, name, verdictLabel, verdictTone, price, llm }) {
  db()
    .prepare(
      `INSERT OR REPLACE INTO recent_checks
         (ticker, name, verdict_label, verdict_tone, price, llm, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ticker, name ?? null, verdictLabel ?? null, verdictTone ?? null, price ?? null, llm ? 1 : 0, new Date().toISOString());
}

export function recentChecks(limit = 12) {
  return db()
    .prepare(`SELECT * FROM recent_checks ORDER BY checked_at DESC LIMIT ?`)
    .all(limit)
    .map((r) => ({
      ticker: r.ticker,
      name: r.name,
      verdictLabel: r.verdict_label,
      verdictTone: r.verdict_tone,
      price: r.price,
      llm: !!r.llm,
      checkedAt: r.checked_at,
    }));
}

// ---------- LLM usage ----------
export function recordUsage({ kind, model, inputTokens, outputTokens, cost }) {
  db()
    .prepare(
      `INSERT INTO llm_usage (kind, model, input_tokens, output_tokens, cost, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(kind, model, inputTokens ?? 0, outputTokens ?? 0, cost ?? 0, new Date().toISOString());
}

/** Cost + call/token totals for the current calendar month (UTC). */
export function usageThisMonth() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(cost), 0) AS cost,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM llm_usage WHERE created_at >= ?`,
    )
    .get(monthStart);
  return {
    calls: row.calls,
    cost: Number(row.cost.toFixed(4)),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    since: monthStart,
  };
}

// ---------- price cache (24h) ----------
export function getCachedSeries(ticker) {
  const row = db()
    .prepare(`SELECT series_json, fetched_at FROM price_cache WHERE ticker = ?`)
    .get(ticker);
  if (!row) return null;
  return { ...JSON.parse(row.series_json), fetchedAt: row.fetched_at };
}

export function setCachedSeries(ticker, series) {
  db()
    .prepare(
      `INSERT OR REPLACE INTO price_cache (ticker, series_json, fetched_at)
       VALUES (?, ?, ?)`,
    )
    .run(ticker, JSON.stringify(series), new Date().toISOString());
}

/** Split tickers into cached-and-fresh (< ttl) vs. stale/missing (need fetch). */
export function freshSeriesMap(tickers, ttlMs) {
  const now = Date.now();
  const fresh = {};
  const stale = [];
  const get = db().prepare(
    `SELECT series_json, fetched_at FROM price_cache WHERE ticker = ?`,
  );
  for (const t of tickers) {
    const row = get.get(t);
    if (row && now - new Date(row.fetched_at).getTime() < ttlMs) {
      fresh[t] = JSON.parse(row.series_json);
    } else {
      stale.push(t);
    }
  }
  return { fresh, stale };
}

// ---------- watchlist ----------
export function listWatchlist() {
  return db()
    .prepare(`SELECT ticker, added_at FROM watchlist ORDER BY added_at DESC`)
    .all()
    .map((r) => ({ ticker: r.ticker, addedAt: r.added_at }));
}

export function addWatchlist(ticker) {
  db()
    .prepare(`INSERT OR IGNORE INTO watchlist (ticker, added_at) VALUES (?, ?)`)
    .run(ticker, new Date().toISOString());
}

export function removeWatchlist(ticker) {
  db().prepare(`DELETE FROM watchlist WHERE ticker = ?`).run(ticker);
}

// ---------- alerts ----------
export function listAlerts(status) {
  const sql = status
    ? `SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC`
    : `SELECT * FROM alerts ORDER BY created_at DESC`;
  const rows = status ? db().prepare(sql).all(status) : db().prepare(sql).all();
  return rows.map(mapAlert);
}

export function addAlert({ ticker, targetLow, targetHigh }) {
  const at = new Date().toISOString();
  const info = db()
    .prepare(
      `INSERT INTO alerts (ticker, target_low, target_high, status, created_at)
       VALUES (?, ?, ?, 'active', ?)`,
    )
    .run(ticker, targetLow ?? null, targetHigh ?? null, at);
  return { id: info.lastInsertRowid, ticker, targetLow, targetHigh, status: "active", createdAt: at };
}

export function removeAlert(id) {
  db().prepare(`DELETE FROM alerts WHERE id = ?`).run(id);
}

export function markAlertTriggered(id) {
  db()
    .prepare(`UPDATE alerts SET status = 'triggered', triggered_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
}

function mapAlert(r) {
  return {
    id: r.id,
    ticker: r.ticker,
    targetLow: r.target_low,
    targetHigh: r.target_high,
    status: r.status,
    createdAt: r.created_at,
    triggeredAt: r.triggered_at,
  };
}
