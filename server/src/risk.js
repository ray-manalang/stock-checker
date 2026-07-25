// Risk-tolerance control (Phase 4.1). A plain three-way label — not a raw
// numeric weight — that shifts two knobs the app already has: the blender's
// quant-vs-fundamental weight and the suggested buy-zone width. Conservative
// leans on fundamentals and waits for a deeper pullback; Aggressive leans on
// momentum and buys closer to the current price. Persisted server-side in
// `settings` (it drives server-side math, so it isn't a client-only preference).

export const RISK_PROFILES = {
  conservative: { label: "Conservative", quantWeight: 0.45, buyZoneScale: 1.4 },
  balanced: { label: "Balanced", quantWeight: 0.6, buyZoneScale: 1.0 },
  aggressive: { label: "Aggressive", quantWeight: 0.75, buyZoneScale: 0.6 },
};

export const DEFAULT_RISK = "balanced";

export function normalizeRisk(value) {
  const v = String(value ?? "").toLowerCase();
  return RISK_PROFILES[v] ? v : DEFAULT_RISK;
}

export function riskProfile(value) {
  return RISK_PROFILES[normalizeRisk(value)];
}
