// L1 macro-gate signals. Pure scoring functions ported from the stock-analyzer
// Python. Each returns { signal, score (0–100), detail }. All scores clamp to
// [0,100]; insufficient data returns a neutral 50 (skippable by the composite).

const clip = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// Sample standard deviation (ddof=1), matching pandas .std().
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** Signal 1 — VIX Level. Low VIX = high score. */
export function vixLevel(vixCloses) {
  if (!vixCloses?.length) return { signal: "VIX Level", score: 50, detail: "no data" };
  const current = vixCloses[vixCloses.length - 1];
  const trailing = vixCloses.slice(-252);
  const pctRank = trailing.filter((v) => v >= current).length / trailing.length;
  let raw = pctRank * 100;
  if (current < 15) raw += 5;
  if (current > 30) raw -= 10;
  return {
    signal: "VIX Level",
    score: clip(raw),
    detail: `VIX ${current.toFixed(1)}`,
  };
}

/** Signal 2 — VIX Term Structure. Contango (ratio<1) = good. */
export function vixTermStructure(vixCloses, vix3mCloses) {
  if (!vixCloses?.length || !vix3mCloses?.length) {
    return { signal: "VIX Term Structure", score: 50, detail: "no overlap" };
  }
  const v = vixCloses[vixCloses.length - 1];
  const v3 = vix3mCloses[vix3mCloses.length - 1];
  const ratio = v3 === 0 ? 1.0 : v / v3;
  const score = clip(((1.15 - ratio) / (1.15 - 0.85)) * 100);
  return {
    signal: "VIX Term Structure",
    score,
    detail: ratio < 1 ? "contango" : "backwardation",
  };
}

/** Signal 3 — Market Breadth. `pctAbove` is the fraction (0–1) of the universe
 *  trading above its 200-day moving average. */
export function marketBreadth(pctAbove) {
  if (pctAbove == null) return { signal: "Market Breadth", score: 50, detail: "no data" };
  const score = clip(((pctAbove - 0.3) / (0.8 - 0.3)) * 100);
  return {
    signal: "Market Breadth",
    score,
    detail: `${(pctAbove * 100).toFixed(0)}% above 200-DMA`,
  };
}

/** Signal 4 — Credit Spreads. FRED HY OAS level; rising = stress. z-score the
 *  latest vs trailing 1y, then map z=-2→100 (tight), z=+2→0 (wide). */
export function creditSpreads(oasSeries) {
  if (!oasSeries || oasSeries.length < 30) {
    return { signal: "Credit Spreads", score: 50, detail: "no data" };
  }
  const trailing = oasSeries.slice(-252);
  const current = oasSeries[oasSeries.length - 1];
  const m = mean(trailing);
  const s = stdev(trailing);
  const z = s > 0 ? (current - m) / s : 0;
  const score = clip(((-z + 2) / 4) * 100);
  return {
    signal: "Credit Spreads",
    score,
    detail: `${z < 0 ? "tight" : "wide"} (OAS ${current.toFixed(2)})`,
  };
}

/** Signal 5 — Put/Call Sentiment (VIX 20-day rate-of-change proxy; CBOE feed is
 *  the fragile weak link, so this runs off ^VIX we already fetch). Rapid VIX
 *  rise = fear = low score. */
export function putCall(vixCloses) {
  if (!vixCloses || vixCloses.length < 21) {
    return { signal: "Put/Call Sentiment", score: 50, detail: "insufficient data" };
  }
  const current = vixCloses[vixCloses.length - 1];
  const prior = vixCloses[vixCloses.length - 21];
  const roc = prior !== 0 ? (current - prior) / prior : 0;
  const rocPct = roc * 100;
  const score = clip(((-rocPct + 50) / (50 + 30)) * 100);
  const sentiment = roc > 0.1 ? "fear" : roc < -0.1 ? "calm" : "neutral";
  return { signal: "Put/Call Sentiment", score, detail: sentiment };
}

/** Signal 6 — Factor Crowding (dispersion proxy across factor ETFs). Higher
 *  cross-factor return dispersion = factors decoupled = healthier = high score;
 *  tight clustering = crowded = low score. `returns` is the recent %-return of
 *  each factor ETF (MTUM/QUAL/VLUE/USMV/SIZE). */
export function factorCrowding(returns) {
  const vals = (returns ?? []).filter((v) => typeof v === "number");
  if (vals.length < 3) return { signal: "Factor Crowding", score: 50, detail: "no data" };
  const disp = stdev(vals); // in percentage points
  const score = clip(((disp - 3) / (15 - 3)) * 100);
  const crowding = disp < 4 ? "extreme" : disp < 7 ? "elevated" : "normal";
  return {
    signal: "Factor Crowding",
    score,
    detail: `${crowding} (dispersion ${disp.toFixed(1)}%)`,
  };
}

// ---------- composite ----------
export const WEIGHTS = {
  "VIX Level": 0.25,
  "VIX Term Structure": 0.2,
  "Market Breadth": 0.2,
  "Credit Spreads": 0.15,
  "Put/Call Sentiment": 0.1,
  "Factor Crowding": 0.1,
};

export const ZONES = {
  "FULL DEPLOY": { sizingPct: 100, newLongs: true, scannerActive: true, mode: "OFFENSIVE" },
  REDUCED: { sizingPct: 60, newLongs: true, scannerActive: true, mode: "REDUCED" },
  DEFENSIVE: { sizingPct: 25, newLongs: false, scannerActive: false, mode: "DEFENSIVE" },
};

export function getZone(composite) {
  if (composite >= 70) return "FULL DEPLOY";
  if (composite >= 40) return "REDUCED";
  return "DEFENSIVE";
}

const ZONE_ONE_LINER = {
  "FULL DEPLOY": "Market conditions favor buying — full sizing, scanner on.",
  REDUCED: "Market conditions say be cautious — trim sizing to 60%.",
  DEFENSIVE: "Market conditions say be defensive — no new longs, scanner off.",
};

/**
 * Weighted blend, normalizing by the weight of the signals actually present
 * (missing signals shrink the denominator). Returns the full macro snapshot.
 */
export function composite(signals) {
  let weighted = 0;
  let totalWeight = 0;
  for (const s of signals) {
    const w = WEIGHTS[s.signal];
    if (w != null && typeof s.score === "number") {
      weighted += s.score * w;
      totalWeight += w;
    }
  }
  const comp = totalWeight > 0 ? weighted / totalWeight : 50;
  const zone = getZone(comp);
  const z = ZONES[zone];
  return {
    composite: Number(comp.toFixed(1)),
    zone,
    sizingPct: z.sizingPct,
    newLongs: z.newLongs,
    scannerActive: z.scannerActive,
    scannerMode: z.mode,
    oneLiner: ZONE_ONE_LINER[zone],
    signals,
  };
}
