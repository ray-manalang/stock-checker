import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRisk, riskProfile, RISK_PROFILES } from "./risk.js";
import { blend } from "./analyst/blender.js";
import { sectorRanks } from "./scanner/factors.js";

test("normalizeRisk: coerces unknown/blank to balanced", () => {
  assert.equal(normalizeRisk("aggressive"), "aggressive");
  assert.equal(normalizeRisk("CONSERVATIVE"), "conservative");
  assert.equal(normalizeRisk("nonsense"), "balanced");
  assert.equal(normalizeRisk(null), "balanced");
});

test("risk profiles: conservative waits for a deeper dip than aggressive", () => {
  assert.ok(riskProfile("conservative").buyZoneScale > riskProfile("aggressive").buyZoneScale);
  assert.ok(RISK_PROFILES.conservative.quantWeight < RISK_PROFILES.aggressive.quantWeight);
});

test("blend: quantWeight override shifts the blended ranking toward quant", () => {
  const rows = [
    { ticker: "A", quant: 90, fundamental: 2 },
    { ticker: "B", quant: 10, fundamental: 9 },
  ];
  const quantHeavy = blend(rows, { quantWeight: 0.9 });
  const fundHeavy = blend(rows, { quantWeight: 0.1 });
  // With quant dominating, A ranks first; with fundamentals dominating, B does.
  assert.equal(quantHeavy[0].ticker, "A");
  assert.equal(fundHeavy[0].ticker, "B");
});

test("sectorRanks: ranks within sector by composite, ignores unsectored rows", () => {
  const rows = [
    { ticker: "NVDA", composite: 90, sector: "Information Technology" },
    { ticker: "AMD", composite: 70, sector: "Information Technology" },
    { ticker: "XOM", composite: 95, sector: "Energy" },
    { ticker: "ZZZ", composite: 99, sector: null },
  ];
  const r = sectorRanks(rows);
  assert.equal(r.NVDA, 1);
  assert.equal(r.AMD, 2);
  assert.equal(r.XOM, 1);
  assert.equal(r.ZZZ, undefined);
});
