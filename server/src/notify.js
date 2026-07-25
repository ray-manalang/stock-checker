// Push notifications via Home Assistant (Phase 2.1). Instead of standing up a
// new external service, the Node app calls HA's own `notify.mobile_app_<device>`
// service with a long-lived access token — the HA mobile app already reaches
// Ray's phone for everything else, so this is a real push channel with no new
// app to install. Everything is optional: with no HA config, `notifyPush` is a
// no-op that returns { sent: false } so callers never break.
//
// Config (server/.env):
//   HA_BASE_URL=http://homeassistant.local:8123
//   HA_TOKEN=<long-lived access token>
//   HA_NOTIFY_SERVICE=mobile_app_ray_phone   (the notify.<service> to call)

import { latestMacro } from "./db.js";

export function haConfigured() {
  return Boolean(process.env.HA_BASE_URL?.trim() && process.env.HA_TOKEN?.trim());
}

function notifyService() {
  return process.env.HA_NOTIFY_SERVICE?.trim() || "notify";
}

/**
 * Fire an HA mobile-app push. `data` can carry an actionable deep link via
 * data.url (the HA app opens it on tap) so notifications tap through to the
 * ticker's check view. Best-effort — never throws.
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
export async function notifyPush({ title, message, url }) {
  const base = process.env.HA_BASE_URL?.trim();
  const token = process.env.HA_TOKEN?.trim();
  if (!base || !token) return { sent: false, reason: "HA not configured" };

  const service = notifyService();
  const body = { title, message };
  if (url) {
    // HA mobile app: `clickAction`/`url` in the notification data deep-links.
    body.data = { url, clickAction: url };
  }
  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/api/services/notify/${encodeURIComponent(service)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return { sent: false, reason: `HA ${res.status}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "push failed" };
  }
}

/**
 * Compact state payload HA can poll (GET /api/ha/summary) to show the macro
 * zone passively on a dashboard. Kept small and stable.
 */
export function haSummary() {
  const macro = latestMacro();
  if (!macro) {
    return { zone: null, composite: null, sizingPct: null, newLongs: null, asOf: null };
  }
  return {
    zone: macro.zone,
    composite: macro.composite,
    sizingPct: macro.meta?.sizingPct ?? null,
    newLongs: macro.meta?.newLongs ?? null,
    oneLiner: macro.meta?.oneLiner ?? "",
    asOf: macro.computedAt,
  };
}
