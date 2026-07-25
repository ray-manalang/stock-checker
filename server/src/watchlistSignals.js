// Watchlist buy-signal notifications (Phase 2.2). A daily job runs the same
// pipeline a manual Check uses (analyzeTicker) against every watchlisted ticker
// and pushes a notification — via the Home Assistant channel (Phase 2.1) — only
// on the *transition into* "Good time to buy", never every day it stays a BUY.
// That transition rule is the noise-avoidance mechanism, independent of channel.
//
// Macro-gated: suppressed unless the macro zone currently allows new longs
// (newLongs is false in DEFENSIVE) — it's self-defeating to ping "buy X" while
// the app's own market read says hold off. Cost stays low because the Claude
// deep-dive is cached per fiscal quarter.

import { analyzeTicker } from "./analyze.js";
import {
  listWatchlist,
  latestMacro,
  getWatchlistVerdictState,
  saveWatchlistVerdictState,
} from "./db.js";
import { notifyPush } from "./notify.js";
import { resolveName } from "./scanner/universe.js";

function appBaseUrl() {
  return process.env.APP_BASE_URL?.trim().replace(/\/$/, "") || "";
}

/**
 * Check every watched ticker's verdict, notify on fresh BUY transitions (macro
 * permitting), and persist the last verdict seen. Returns a summary.
 */
export async function checkWatchlistSignals() {
  const watch = listWatchlist();
  if (!watch.length) return { checked: 0, notified: 0 };

  const macro = latestMacro();
  const newLongs = macro?.meta?.newLongs ?? true; // default permissive if no macro yet

  let notified = 0;
  for (const { ticker } of watch) {
    let result;
    try {
      result = await analyzeTicker(ticker, { deep: true });
    } catch {
      continue; // skip on fetch/analysis failure; retried next run
    }
    const signal = result.verdict.signal; // BUY | HOLD | SELL
    const label = result.verdict.label;
    const prev = getWatchlistVerdictState(ticker);
    const wasBuy = prev?.lastVerdict === "BUY";
    const wasNotified = !!prev?.notifiedAt;

    // Notify when it's BUY, macro allows new longs, and either this is a fresh
    // transition into BUY or a prior BUY that was suppressed by the macro gate
    // and hasn't been delivered yet.
    let notifiedAt = signal === "BUY" ? (prev?.notifiedAt ?? null) : null;
    if (signal === "BUY" && newLongs && (!wasBuy || !wasNotified)) {
      const name = resolveName(ticker) ?? result.quote.name ?? ticker;
      const base = appBaseUrl();
      const push = await notifyPush({
        title: `${ticker} — good time to buy`,
        message: `${name}: ${result.why}`,
        url: base ? `${base}/?check=${encodeURIComponent(ticker)}` : undefined,
      });
      notifiedAt = new Date().toISOString();
      if (push.sent) notified++;
    }

    saveWatchlistVerdictState({ ticker, lastVerdict: signal, lastLabel: label, notifiedAt });
  }
  return { checked: watch.length, notified };
}
