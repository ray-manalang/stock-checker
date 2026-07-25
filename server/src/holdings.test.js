import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  suggestMapping,
  isTradableSymbol,
  blendPositions,
  buildPortfolio,
  positionNotes,
  sectorAllocation,
} from "./holdings.js";

test("parseCsv: handles quoted fields with commas and embedded quotes", () => {
  const { headers, rows } = parseCsv(
    'Symbol,Name,Qty\nAAPL,"Apple, Inc.",10\nMSFT,"Micro ""soft""",5\n',
  );
  assert.deepEqual(headers, ["Symbol", "Name", "Qty"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Name, "Apple, Inc.");
  assert.equal(rows[1].Name, 'Micro "soft"');
});

test("suggestMapping: guesses ticker/shares/cost/source columns", () => {
  const m = suggestMapping(["Account Name", "Symbol", "Quantity", "Average Cost Basis"]);
  assert.equal(m.ticker, "Symbol");
  assert.equal(m.shares, "Quantity");
  assert.equal(m.costBasis, "Average Cost Basis");
  assert.equal(m.costBasisMode, "pershare");
  assert.equal(m.source, "Account Name");
});

test("suggestMapping: falls back to total-cost column", () => {
  const m = suggestMapping(["Ticker", "Shares", "Cost Basis Total"]);
  assert.equal(m.costBasis, "Cost Basis Total");
  assert.equal(m.costBasisMode, "total");
});

test("isTradableSymbol: keeps real tickers, skips cash/CUSIP/blank", () => {
  assert.ok(isTradableSymbol("AAPL"));
  assert.ok(isTradableSymbol("BRK.B"));
  assert.ok(!isTradableSymbol("SPAXX"));
  assert.ok(!isTradableSymbol("CASH"));
  assert.ok(!isTradableSymbol("037833100")); // CUSIP
  assert.ok(!isTradableSymbol(""));
  assert.ok(!isTradableSymbol("MONEY MARKET"));
});

test("blendPositions: rolls up same ticker across sources, share-weighted basis", () => {
  const rows = [
    { ticker: "AAPL", shares: 10, costBasis: 138.1, source: "Fidelity" },
    { ticker: "AAPL", shares: 5, costBasis: 151.0, source: "E*TRADE" },
  ];
  const [aapl] = blendPositions(rows);
  assert.equal(aapl.shares, 15);
  // (10*138.10 + 5*151.00) / 15 = 142.40
  assert.equal(aapl.costBasis, 142.4);
  assert.equal(aapl.sources.length, 2);
});

test("buildPortfolio: computes gain/loss, concentration, and totals", () => {
  const raw = [
    { ticker: "AAPL", shares: 10, costBasis: 100, source: "Fidelity" },
    { ticker: "MSFT", shares: 10, costBasis: 100, source: "Fidelity" },
  ];
  const priceMap = {
    AAPL: { price: 150, changePct: 1, closes: null },
    MSFT: { price: 50, changePct: -1, closes: null },
  };
  const p = buildPortfolio(raw, {}, priceMap, { asOf: "2026-07-20" });
  assert.equal(p.totalValue, 2000); // 1500 + 500
  assert.equal(p.unrealized, 0); // +500 on AAPL, -500 on MSFT
  const aapl = p.positions.find((x) => x.ticker === "AAPL");
  assert.equal(aapl.gainLoss, 500);
  assert.equal(aapl.concentrationPct, 75); // 1500 / 2000
});

test("positionNotes: tax-loss note only for taxable losers; muted for tax-advantaged", () => {
  const taxable = positionNotes({ gainLoss: -840, taxAdvantaged: false, signal: "HOLD" });
  assert.equal(taxable[0].kind, "tax");
  const roth = positionNotes({ gainLoss: -840, taxAdvantaged: true, signal: "HOLD" });
  assert.equal(roth[0].kind, "muted");
  const winner = positionNotes({ gainLoss: 500, taxAdvantaged: false, signal: "HOLD" });
  assert.equal(winner.length, 0);
});

test("positionNotes: BUY signal on a held name yields an add-on-dip note", () => {
  const notes = positionNotes({ gainLoss: 500, taxAdvantaged: false, signal: "BUY" });
  assert.ok(notes.some((n) => n.kind === "addon"));
});

test("buildPortfolio: tags positions with a GICS sector and groups bySector", () => {
  const raw = [
    { ticker: "AAPL", shares: 10, costBasis: 100, source: "Fidelity" }, // Info Tech
    { ticker: "MSFT", shares: 10, costBasis: 100, source: "Fidelity" }, // Info Tech
    { ticker: "JPM", shares: 10, costBasis: 100, source: "Fidelity" }, // Financials
  ];
  const priceMap = {
    AAPL: { price: 100 },
    MSFT: { price: 100 },
    JPM: { price: 200 },
  };
  const p = buildPortfolio(raw, {}, priceMap, {});
  assert.equal(p.positions.find((x) => x.ticker === "AAPL").sector, "Information Technology");
  // IT = 2000 (AAPL 1000 + MSFT 1000), Financials = 2000 (JPM) → both 50%.
  const it = p.bySector.find((s) => s.sector === "Information Technology");
  assert.equal(it.count, 2);
  assert.equal(it.value, 2000);
  assert.equal(it.pct, 50);
  // Sorted by value descending, and pct sums to ~100.
  const totalPct = p.bySector.reduce((s, x) => s + (x.pct ?? 0), 0);
  assert.ok(Math.abs(totalPct - 100) < 0.5);
});

test("sectorAllocation: unmapped tickers fall into Unclassified", () => {
  const positions = [
    { ticker: "ZZZZ", sector: "Unclassified", marketValue: 500 },
    { ticker: "AAPL", sector: "Information Technology", marketValue: 500 },
  ];
  const alloc = sectorAllocation(positions, 1000);
  assert.ok(alloc.some((s) => s.sector === "Unclassified" && s.pct === 50));
});
