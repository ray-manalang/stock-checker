// Watchlist buy-signal notifications. Daily job runs analyzeTicker against each
// user's watchlist and pushes HA notify only for the admin user's BUY transitions
// (avoids spamming the host's phone with friends' tickers). Verdict state is
// per-user.

import { analyzeTicker } from "./analyze.js";
import {
  listWatchlist,
  latestMacro,
  getWatchlistVerdictState,
  saveWatchlistVerdictState,
  listUserIdsWithWatchlist,
  findUserById,
} from "./db.js";
import { notifyPush } from "./notify.js";
import { resolveName } from "./scanner/universe.js";
import { runWithUser } from "./requestContext.js";

function appBaseUrl() {
  return process.env.APP_BASE_URL?.trim().replace(/\/$/, "") || "";
}

/**
 * Check every watched ticker's verdict per user, notify on fresh BUY transitions
 * (macro permitting) for admin users only via HA, and persist last verdict.
 */
export async function checkWatchlistSignals() {
  const userIds = listUserIdsWithWatchlist();
  if (!userIds.length) return { checked: 0, notified: 0 };

  const macro = latestMacro();
  const newLongs = macro?.meta?.newLongs ?? true;

  let checked = 0;
  let notified = 0;

  for (const userId of userIds) {
    const user = findUserById(userId);
    const watch = listWatchlist(userId);
    const pushHa = user?.role === "admin";

    for (const { ticker } of watch) {
      checked++;
      let result;
      try {
        result = await runWithUser(userId, () => analyzeTicker(ticker, { deep: true }));
      } catch {
        continue;
      }
      const signal = result.verdict.signal;
      const label = result.verdict.label;
      const prev = getWatchlistVerdictState(userId, ticker);
      const wasBuy = prev?.lastVerdict === "BUY";
      const wasNotified = !!prev?.notifiedAt;

      let notifiedAt = signal === "BUY" ? (prev?.notifiedAt ?? null) : null;
      if (signal === "BUY" && newLongs && (!wasBuy || !wasNotified)) {
        if (pushHa) {
          const name = resolveName(ticker) ?? result.quote.name ?? ticker;
          const base = appBaseUrl();
          const push = await notifyPush({
            title: `${ticker} — good time to buy`,
            message: `${name}: ${result.why}`,
            url: base ? `${base}/?check=${encodeURIComponent(ticker)}` : undefined,
          });
          notifiedAt = new Date().toISOString();
          if (push.sent) notified++;
        } else {
          // Friends: mark notified so we don't re-evaluate forever; in-app panel shows state.
          notifiedAt = new Date().toISOString();
        }
      }

      saveWatchlistVerdictState({
        userId,
        ticker,
        lastVerdict: signal,
        lastLabel: label,
        notifiedAt,
      });
    }
  }
  return { checked, notified };
}
