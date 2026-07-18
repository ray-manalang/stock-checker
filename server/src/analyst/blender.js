// L3 blender. Merges the quant composite (60%) with the Claude fundamental
// score (40%), re-ranks, and flags rank shifts >= 3 as upgrades/downgrades.
// Ported from stock-analyzer/analyst/blender.py — both inputs are min-max
// normalized across the current candidate set before weighting (relative, not
// absolute), and missing fundamentals fill with the batch median.

export const QUANT_WEIGHT = 0.6;
export const FUNDAMENTAL_WEIGHT = 0.4;
export const RANK_SHIFT_THRESHOLD = 3;

function median(nums) {
  const a = nums.filter((v) => typeof v === "number" && !Number.isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function minMaxNorm(values) {
  const present = values.filter((v) => typeof v === "number");
  if (!present.length) return values.map(() => 0.5);
  const mn = Math.min(...present);
  const mx = Math.max(...present);
  if (mx === mn) return values.map(() => 0.5);
  return values.map((v) => (typeof v === "number" ? (v - mn) / (mx - mn) : 0.5));
}

// min-method ranking (1 = best), na sorted to the bottom.
function rankDesc(values) {
  const order = values
    .map((v, i) => ({ v: typeof v === "number" ? v : -Infinity, i }))
    .sort((a, b) => b.v - a.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const rank = i + 1; // min method
    for (let k = i; k <= j; k++) ranks[order[k].i] = rank;
    i = j + 1;
  }
  return ranks;
}

/**
 * @param rows array of { ticker, quant, fundamental } where `quant` is the
 *   scanner composite (0–100) and `fundamental` is the 1–10 score (or null).
 * @returns rows augmented with quantRank, blendedScore, blendedRank, rankDelta,
 *   rankFlag ("upgrade" | "downgrade" | ""), sorted by blendedRank ascending.
 */
export function blend(rows) {
  if (!rows.length) return [];

  const quantVals = rows.map((r) => (typeof r.quant === "number" ? r.quant : 0));
  const fundMedian = median(rows.map((r) => r.fundamental));
  const fundVals = rows.map((r) =>
    typeof r.fundamental === "number" ? r.fundamental : fundMedian ?? 0,
  );

  const quantRank = rankDesc(rows.map((r) => r.quant));
  const quantNorm = minMaxNorm(quantVals);
  const fundNorm = minMaxNorm(fundVals);

  const blended = rows.map((_, i) =>
    Number((QUANT_WEIGHT * quantNorm[i] + FUNDAMENTAL_WEIGHT * fundNorm[i]).toFixed(4)),
  );
  const blendedRank = rankDesc(blended);

  const out = rows.map((r, i) => {
    const rankDelta = quantRank[i] - blendedRank[i]; // positive = moved up
    let rankFlag = "";
    if (rankDelta >= RANK_SHIFT_THRESHOLD) rankFlag = "upgrade";
    else if (rankDelta <= -RANK_SHIFT_THRESHOLD) rankFlag = "downgrade";
    return {
      ...r,
      quantRank: quantRank[i],
      blendedScore: blended[i],
      blendedRank: blendedRank[i],
      rankDelta,
      rankFlag,
    };
  });
  out.sort((a, b) => a.blendedRank - b.blendedRank);
  return out;
}

export function blendSummary(blended) {
  const upgrades = blended.filter((r) => r.rankFlag === "upgrade");
  const downgrades = blended.filter((r) => r.rankFlag === "downgrade");
  return {
    count: blended.length,
    upgrades: upgrades.map((r) => r.ticker),
    downgrades: downgrades.map((r) => r.ticker),
    top5: blended.slice(0, 5).map((r) => r.ticker),
  };
}
