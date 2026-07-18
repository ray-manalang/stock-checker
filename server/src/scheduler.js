// Scheduled writers. Jobs compute snapshots on a cadence; read endpoints serve
// the latest. Runs are guarded so a slow job never overlaps itself, and a
// startup kick fills empty tables on first boot.

import cron from "node-cron";
import { computeMacro } from "./macro/compute.js";
import { runScanner } from "./scanner/engine.js";
import { scoreAnalyst } from "./analyst/analyzer.js";
import { checkAlerts } from "./alerts.js";
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

export function startScheduler() {
  // Macro gate ~ every 20 minutes.
  cron.schedule("*/20 * * * *", () => runMacro());
  // Scanner nightly at 22:15 (after the close).
  cron.schedule("15 22 * * *", () => runScannerJob());
  // Analyst weekly (Sunday 03:00) — the quarter cache bounds the real cost.
  cron.schedule("0 3 * * 0", () => runAnalystJob());
  // Buy-zone alerts ~ every 10 minutes during the day.
  cron.schedule("*/10 * * * *", () => runAlertsJob());

  // Kick initial computes on boot if the tables are empty (background).
  if (!latestMacro()) runMacro();
  if (!latestScanner()) runScannerJob();
}

export function isRunning(name) {
  return running.has(name);
}
