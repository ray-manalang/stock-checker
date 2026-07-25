// Scheduled writers. Jobs compute snapshots on a cadence; read endpoints serve
// the latest. Runs are guarded so a slow job never overlaps itself, and a
// startup kick fills empty tables on first boot.

import cron from "node-cron";
import { computeMacro } from "./macro/compute.js";
import { runScanner } from "./scanner/engine.js";
import { scoreAnalyst } from "./analyst/analyzer.js";
import { checkAlerts } from "./alerts.js";
import { checkWatchlistSignals } from "./watchlistSignals.js";
import { latestMacro, latestScanner } from "./db.js";
import { llmConfigured } from "./llm.js";

const running = new Set();

async function guard(name, fn) {
  if (running.has(name)) return;
  running.add(name);
  try {
    await fn();
    console.log(`[job] ${name} ok`);
  } catch (err) {
    console.error(`[job] ${name} failed:`, err instanceof Error ? err.message : err);
  } finally {
    running.delete(name);
  }
}

export function runMacro() {
  return guard("computeMacro", () => computeMacro());
}

export function runScannerJob() {
  return guard("runScanner", async () => {
    const macro = latestMacro();
    const mode = macro?.meta?.scannerMode ?? "OFFENSIVE";
    await runScanner({ macroMode: mode });
  });
}

// Score the current scanner universe's fundamentals (Sonnet Batch). Quarter
// cache means most names are already scored — only new/uncached ones cost.
export function runAnalystJob() {
  return guard("scoreAnalyst", async () => {
    if (!llmConfigured()) {
      console.log("[job] scoreAnalyst skipped — no ANTHROPIC_API_KEY");
      return;
    }
    const run = latestScanner();
    const tickers = (run?.rows ?? []).map((r) => r.ticker);
    if (tickers.length) await scoreAnalyst(tickers);
  });
}

export function runAlertsJob() {
  return guard("checkAlerts", () => checkAlerts());
}

// Watchlist buy-signal scan — once daily near the close (Phase 2.2). Notifies
// only on a fresh transition into "Good time to buy", macro permitting.
export function runWatchlistSignalsJob() {
  return guard("checkWatchlistSignals", () => checkWatchlistSignals());
}

// Market-clock jobs are pinned to US market time so they don't drift with DST
// (and don't silently run mid-afternoon ET when the container's clock is UTC).
const MARKET_TZ = process.env.MARKET_TZ || "America/New_York";
const inMarketTz = { timezone: MARKET_TZ };

export function startScheduler() {
  // Macro gate ~ every 20 minutes (interval-based — timezone is irrelevant).
  cron.schedule("*/20 * * * *", () => runMacro());
  // Scanner nightly at 21:15 ET — well after the close and any late revisions.
  cron.schedule("15 21 * * *", () => runScannerJob(), inMarketTz);
  // Analyst weekly (Sunday 03:00 ET) — the quarter cache bounds the real cost.
  cron.schedule("0 3 * * 0", () => runAnalystJob(), inMarketTz);
  // Buy-zone alerts ~ every 10 minutes during the day.
  cron.schedule("*/10 * * * *", () => runAlertsJob());
  // Watchlist buy-signals once daily at 16:10 ET — just after the close, near
  // the scanner's time-of-day but over the watchlist rather than the universe.
  cron.schedule("10 16 * * 1-5", () => runWatchlistSignalsJob(), inMarketTz);

  // Kick initial computes on boot if the tables are empty (background).
  if (!latestMacro()) runMacro();
  if (!latestScanner()) runScannerJob();
}

export function isRunning(name) {
  return running.has(name);
}
