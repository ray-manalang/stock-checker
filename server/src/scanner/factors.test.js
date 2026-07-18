import { test } from "node:test";
import assert from "node:assert/strict";
import {
  percentileRank,
  momentumFactor,
  volumeFactor,
  relStrengthFactor,
  high52Factor,
  shortInterestFactor,
  buildComposite,
} from "./factors.js";

const approx = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("percentileRank: pandas rank(pct=True)*100 semantics", () => {
  const r = percentileRank([10, 20, 30]);
  approx(r[0], 33.333);
  approx(r[1], 66.667);
  approx(r[2], 100);
});

test("percentileRank: ties get average rank", () => {
  const r = percentileRank([10, 10, 20]);
  approx(r[0], 50); // avg of ranks 1,2 = 1.5 => 1.5/3*100
  approx(r[1], 50);
  approx(r[2], 100);
});

test("percentileRank: nulls preserved and excluded from N", () => {
  const r = percentileRank([5, null, 15]);
  approx(r[0], 50); // rank 1 of 2
  assert.equal(r[1], null);
  approx(r[2], 100);
});

test("volumeFactor: linear map 0.7->0, 2.0->100 (not ranked)", () => {
  // Flat volume: avg5 == avg20 => ratio 1.0 => (1.0-0.7)/1.3*100 = 23.08
  approx(volumeFactor({ X: Array(20).fill(1000) }).X, 23.077, 0.01);
  // Surge: last 5 double => higher score than flat.
  const surge = Array(15).fill(1000).concat(Array(5).fill(2000));
  assert.ok(volumeFactor({ X: surge }).X > 23.077);
});

test("high52Factor: nearer the high ranks higher", () => {
  const atHigh = Array.from({ length: 260 }, (_, i) => 100 + i * 0.2); // last = highest
  const belowHigh = Array.from({ length: 260 }, (_, i) => 200 - i * 0.2); // last = lowest
  const s = high52Factor({ HI: atHigh, LO: belowHigh });
  assert.ok(s.HI > s.LO);
  approx(s.HI, 100); // top of 2
});

test("relStrengthFactor: outperformer ranks higher than underperformer", () => {
  const spy = Array.from({ length: 30 }, (_, i) => 100 + i);
  const strong = Array.from({ length: 30 }, (_, i) => 100 + i * 3);
  const weak = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5);
  const s = relStrengthFactor({ STRONG: strong, WEAK: weak }, spy);
  assert.ok(s.STRONG > s.WEAK);
});

test("momentumFactor: strong uptrend ranks above downtrend", () => {
  const up = Array.from({ length: 120 }, (_, i) => 100 + i);
  const down = Array.from({ length: 120 }, (_, i) => 200 - i);
  const s = momentumFactor({ UP: up, DOWN: down });
  assert.ok(s.UP > s.DOWN);
});

test("shortInterestFactor: low short ratio (inverted high) ranks higher; missing->null", () => {
  const s = shortInterestFactor({ A: 1, B: 5, C: NaN }, ["A", "B", "C"]);
  assert.ok(s.A > s.B); // lower short ratio => higher score
  assert.equal(s.C, null);
});

test("buildComposite: equal-weight mean skipping nulls, ranked desc", () => {
  const rows = buildComposite(
    ["A", "B"],
    {
      f1: { A: 80, B: 40 },
      f2: { A: 60, B: null }, // B missing f2 -> averaged over f1 only
    },
  );
  const a = rows.find((r) => r.ticker === "A");
  const b = rows.find((r) => r.ticker === "B");
  approx(a.composite, 70); // (80+60)/2
  approx(b.composite, 40); // f1 only
  assert.equal(rows[0].ticker, "A");
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].rank, 2);
});
