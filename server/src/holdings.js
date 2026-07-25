// Holdings — multi-brokerage CSV import + portfolio rollup (Phase 3).
//
// Import model (confirmed against a real sample export, see ROADMAP §3.1):
//  - A single aggregated multi-institution CSV (one Institution column per row),
//    not one file per brokerage — so one column schema, not a parser per source.
//  - Snapshot, not transaction log: re-importing replaces holdings wholesale.
//  - Rolls up same ticker across sources into one blended position.
//  - Tradable tickers only: bonds, cash sweeps, private placements are skipped
//    entirely (not counted toward total value or concentration).
//
// Column mapping is remembered (settings.holdingsMapping) so re-imports are just
// "drop file." Personalization here is pure arithmetic on top of the existing
// ticker-level verdict — holdings never leave the box for a Claude call.

import { computeIndicators } from "./indicators.js";
import { scoreVerdict } from "./verdict.js";
import {
  replaceHoldings,
  listHoldingsRaw,
  holdingsFlags,
  getSetting,
  setSetting,
} from "./db.js";
import { NAMES } from "./scanner/names.js";
import { sectorOf } from "./scanner/sectors.js";

const UNCLASSIFIED = "Unclassified";

// ---------- CSV parsing ----------
/** Parse CSV text into { headers, rows: object[] }. Handles quoted fields and
 *  commas/newlines inside quotes. Tolerant of trailing blank lines. */
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const src = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || record.length) {
    record.push(field);
    rows.push(record);
  }
  // Drop fully-empty rows.
  const nonEmpty = rows.filter((r) => r.some((v) => String(v).trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const objRows = nonEmpty.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, idx) => (o[h] = (r[idx] ?? "").trim()));
    return o;
  });
  return { headers, rows: objRows };
}

// ---------- column mapping ----------
const HEADER_HINTS = {
  ticker: /(^|[\s_])(symbol|ticker)([\s_]|$)/i,
  shares: /(quantity|shares|qty|units)/i,
  costBasis: /(average cost|avg.*cost|cost.*(per|\/).*share|unit cost|cost basis per)/i,
  costBasisTotal: /(cost basis( total)?|total cost|book value)/i,
  source: /(institution|custodian|brokerage|account name|source|firm)/i,
};

/** Best-guess mapping from a header list. costBasisMode is "pershare" unless
 *  only a total-cost column is present. */
export function suggestMapping(headers) {
  const find = (re) => headers.find((h) => re.test(h)) ?? null;
  const perShare = find(HEADER_HINTS.costBasis);
  const total = find(HEADER_HINTS.costBasisTotal);
  return {
    ticker: find(HEADER_HINTS.ticker),
    shares: find(HEADER_HINTS.shares),
    costBasis: perShare ?? total,
    costBasisMode: perShare ? "pershare" : total ? "total" : "pershare",
    source: find(HEADER_HINTS.source),
  };
}

// ---------- tradable filter ----------
const CASH_LIKE = new Set([
  "CASH", "SPAXX", "FDRXX", "FZFXX", "VMFXX", "SWVXX", "FGXX", "USD",
  "PENDING", "MMKT", "MONEY MARKET",
]);

/** True when a symbol is a real market-tradable ticker (not cash/bond/private).
 *  Heuristic: 1–5 chars, letters + optional . or - , not a known cash sweep,
 *  not a CUSIP (9 alphanumerics) or a number. */
export function isTradableSymbol(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return false;
  if (CASH_LIKE.has(s)) return false;
  if (/\s/.test(s)) return false;
  if (/^\d/.test(s)) return false; // CUSIPs / account numbers start numeric
  if (s.length > 6) return false;
  return /^[A-Z][A-Z.\-]{0,5}$/.test(s);
}

function normSym(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\./g, "-");
}

function toNumber(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------- import ----------
/** Preview a CSV: headers, a few sample rows, and a suggested mapping (merged
 *  with any remembered mapping). No DB writes. */
export function previewHoldingsCsv(csv) {
  const { headers, rows } = parseCsv(csv);
  const saved = getSetting("holdingsMapping", null);
  const suggested = suggestMapping(headers);
  return {
    headers,
    sample: rows.slice(0, 5),
    rowCount: rows.length,
    suggestedMapping: saved && headers.includes(saved.ticker) ? saved : suggested,
  };
}

/** Apply a mapping to a CSV and replace holdings wholesale. Returns a summary
 *  ({ imported, positions, skipped, skippedSymbols, asOf }). Remembers the
 *  mapping for next time. */
export function importHoldingsCsv(csv, mapping, asOf) {
  const { rows } = parseCsv(csv);
  if (!mapping?.ticker || !mapping?.shares) {
    throw new Error("mapping must include at least ticker and shares columns");
  }
  const out = [];
  const skippedSymbols = [];
  let skipped = 0;
  for (const r of rows) {
    const rawTicker = r[mapping.ticker];
    if (!isTradableSymbol(rawTicker)) {
      if (String(rawTicker ?? "").trim()) skippedSymbols.push(String(rawTicker).trim());
      skipped++;
      continue;
    }
    const ticker = normSym(rawTicker);
    const shares = toNumber(r[mapping.shares]);
    if (shares == null || shares <= 0) {
      skipped++;
      continue;
    }
    let costBasis = mapping.costBasis ? toNumber(r[mapping.costBasis]) : null;
    if (costBasis != null && mapping.costBasisMode === "total" && shares > 0) {
      costBasis = costBasis / shares; // total → per-share
    }
    const source = (mapping.source && r[mapping.source]?.trim()) || "Imported";
    out.push({ ticker, shares, costBasis, source });
  }
  const at = replaceHoldings(out, asOf);
  setSetting("holdingsMapping", { ...mapping });
  return {
    imported: out.length,
    positions: new Set(out.map((r) => r.ticker)).size,
    skipped,
    skippedSymbols: [...new Set(skippedSymbols)].slice(0, 20),
    asOf: getSetting("holdingsAsOf", at),
  };
}

// ---------- rollup ----------
/** Blend raw ticker+source rows into one position per ticker: summed shares,
 *  share-weighted cost basis, and a per-source breakdown. Pure. */
export function blendPositions(rawRows) {
  const byTicker = new Map();
  for (const r of rawRows) {
    if (!byTicker.has(r.ticker)) {
      byTicker.set(r.ticker, { ticker: r.ticker, shares: 0, costTotal: 0, hasCost: false, sources: [] });
    }
    const p = byTicker.get(r.ticker);
    const shares = r.shares ?? 0;
    p.shares += shares;
    if (r.costBasis != null) {
      p.costTotal += r.costBasis * shares;
      p.hasCost = true;
    }
    p.sources.push({ source: r.source ?? "Imported", shares, costBasis: r.costBasis ?? null });
  }
  return [...byTicker.values()].map((p) => ({
    ticker: p.ticker,
    shares: Number(p.shares.toFixed(4)),
    costBasis: p.hasCost && p.shares > 0 ? Number((p.costTotal / p.shares).toFixed(4)) : null,
    sources: p.sources,
  }));
}

// Lightweight deterministic verdict from cached closes — no network, no LLM.
// Enough to frame a held position as "in its buy zone / consider adding."
function localSignal(closes, price) {
  if (!Array.isArray(closes) || closes.length < 60 || price == null) return null;
  const window = closes.slice(-252);
  const low52 = Math.min(...window);
  const high52 = Math.max(...window);
  const ind = computeIndicators({ close: closes }, { price, low52, high52 });
  return scoreVerdict(ind).verdict.signal; // "BUY" | "HOLD" | "SELL"
}

/**
 * Build the full portfolio view. `priceMap[ticker] = { price, changePct, closes }`.
 * Returns positions (with gain/loss, concentration %, notes), totals, and the
 * "as of" date. Pure aside from reading demo state via the caller.
 */
export function buildPortfolio(rawRows, flags, priceMap, { asOf } = {}) {
  const positions = blendPositions(rawRows).map((p) => {
    const pm = priceMap[p.ticker] ?? {};
    const price = pm.price ?? null;
    const marketValue = price != null ? price * p.shares : null;
    const costValue = p.costBasis != null ? p.costBasis * p.shares : null;
    const gainLoss = marketValue != null && costValue != null ? marketValue - costValue : null;
    const gainLossPct =
      gainLoss != null && costValue ? (gainLoss / costValue) * 100 : null;
    const taxAdvantaged = !!flags[p.ticker]?.taxAdvantaged;
    const signal = localSignal(pm.closes, price);
    return {
      ...p,
      name: NAMES[p.ticker] ?? null,
      sector: sectorOf(p.ticker) ?? UNCLASSIFIED,
      price,
      changePct: pm.changePct ?? null,
      marketValue,
      costValue,
      gainLoss,
      gainLossPct: gainLossPct != null ? Number(gainLossPct.toFixed(2)) : null,
      taxAdvantaged,
      signal,
    };
  });

  const totalValue = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const totalCost = positions.reduce((s, p) => s + (p.costValue ?? 0), 0);
  const unrealized = totalValue && totalCost ? totalValue - totalCost : null;

  for (const p of positions) {
    p.concentrationPct =
      totalValue > 0 && p.marketValue != null
        ? Number(((p.marketValue / totalValue) * 100).toFixed(1))
        : null;
    p.notes = positionNotes(p);
  }
  positions.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  return {
    positions,
    bySector: sectorAllocation(positions, totalValue),
    totalValue: Number(totalValue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    unrealized: unrealized != null ? Number(unrealized.toFixed(2)) : null,
    unrealizedPct:
      unrealized != null && totalCost ? Number(((unrealized / totalCost) * 100).toFixed(2)) : null,
    count: positions.length,
    sources: [...new Set(rawRows.map((r) => r.source).filter(Boolean))],
    asOf: asOf ?? null,
  };
}

/** Portfolio allocation grouped by GICS sector ("industry"): value, %, and
 *  position count per sector, sorted by value descending. */
export function sectorAllocation(positions, totalValue) {
  const bySector = new Map();
  for (const p of positions) {
    const key = p.sector ?? UNCLASSIFIED;
    const cur = bySector.get(key) ?? { sector: key, value: 0, count: 0 };
    cur.value += p.marketValue ?? 0;
    cur.count += 1;
    bySector.set(key, cur);
  }
  return [...bySector.values()]
    .map((s) => ({
      sector: s.sector,
      value: Number(s.value.toFixed(2)),
      count: s.count,
      pct: totalValue > 0 ? Number(((s.value / totalValue) * 100).toFixed(1)) : null,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Per-position plain-English notes: tax-loss candidate (3.3), add-on-dip
 *  framing (3.2), or the tax-advantaged-so-no-harvest muted note. */
export function positionNotes(p) {
  const notes = [];
  const loss = p.gainLoss != null && p.gainLoss < -1;
  if (loss && p.taxAdvantaged) {
    notes.push({
      kind: "muted",
      text: `Down ${fmtLoss(p.gainLoss)}, but held in a tax-advantaged account — those aren't harvest-eligible, so no tax-loss note here.`,
    });
  } else if (loss) {
    notes.push({
      kind: "tax",
      title: "Tax-loss candidate",
      text: `Down ${fmtLoss(p.gainLoss)} from cost basis. Some investors sell losers like this to offset gains elsewhere, then wait 30+ days before rebuying to avoid the wash-sale rule. This isn't tax advice.`,
    });
  }
  if (p.signal === "BUY") {
    notes.push({
      kind: "addon",
      title: "Trading in your buy zone",
      text: `The verdict is currently "Good time to buy." Since you already hold this, consider it in add-on-dip terms rather than a fresh entry.`,
    });
  }
  return notes;
}

function fmtLoss(gainLoss) {
  return `$${Math.abs(gainLoss).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ---------- entry point used by the route ----------
/** Read holdings and return the built portfolio. `priceMap` is supplied by the
 *  caller (index.js gathers prices via the shared cache). */
export function rollupHoldings(priceMap) {
  return buildPortfolio(listHoldingsRaw(), holdingsFlags(), priceMap, {
    asOf: getSetting("holdingsAsOf", null),
  });
}

/** Unique tradable tickers currently held — for price fetching. */
export function heldTickers() {
  return [...new Set(listHoldingsRaw().map((r) => r.ticker))];
}
