// Buy-zone price alerts. A scheduled job checks active alerts against the live
// price and triggers when the price enters the target zone. Notification is via
// Resend to each user's alert_email when set; otherwise the alert is simply
// marked triggered (visible in the UI).

import { fetchChart } from "./stocks.js";
import { listActiveAlertsAllUsers, markAlertTriggered } from "./db.js";

/** True when the live price has entered the alert's buy zone. */
export function alertHit(price, { targetLow, targetHigh }) {
  if (typeof price !== "number") return false;
  if (targetLow != null && targetHigh != null) {
    return price >= targetLow && price <= targetHigh;
  }
  const threshold = targetLow ?? targetHigh; // "at or below the target"
  return threshold != null && price <= threshold;
}

export async function checkAlerts() {
  const active = listActiveAlertsAllUsers();
  if (!active.length) return { checked: 0, triggered: 0 };

  const byTicker = new Map();
  for (const a of active) {
    if (!byTicker.has(a.ticker)) byTicker.set(a.ticker, []);
    byTicker.get(a.ticker).push(a);
  }

  let triggered = 0;
  for (const [ticker, alerts] of byTicker) {
    let price = null;
    try {
      const { quote } = await fetchChart(ticker, "5d");
      price = quote.price;
    } catch {
      continue;
    }
    for (const a of alerts) {
      if (alertHit(price, a)) {
        markAlertTriggered(a.id);
        triggered += 1;
        await notify(a, price).catch(() => {});
      }
    }
  }
  return { checked: active.length, triggered };
}

async function notify(alert, price) {
  const key = process.env.RESEND_API_KEY?.trim();
  const to = alert.alertEmail?.trim() || process.env.ALERT_EMAIL?.trim();
  if (!key || !to) return;

  const zone =
    alert.targetLow != null && alert.targetHigh != null
      ? `$${alert.targetLow}–$${alert.targetHigh}`
      : `$${alert.targetLow ?? alert.targetHigh}`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.ALERT_FROM?.trim() || "Market Specialist <onboarding@resend.dev>",
      to,
      subject: `${alert.ticker} hit your buy zone (${zone})`,
      html: `<p><strong>${alert.ticker}</strong> is at <strong>$${price.toFixed(
        2,
      )}</strong>, inside your target buy zone of ${zone}.</p><p>You set this alert in Market Specialist.</p>`,
    }),
  });
}
