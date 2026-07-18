import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vixLevel,
  vixTermStructure,
  marketBreadth,
  creditSpreads,
  putCall,
  factorCrowding,
  composite,
  getZone,
  WEIGHTS,
} from "./signals.js";

const approx = (a, b, eps = 0.5) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("vixLevel: low VIX scores high", () => {
  const lowNow = [...Array(252).fill(25), 12]; // current well below trailing
  const hi = vixLevel(lowNow);
  assert.ok(hi.score > 90, `score ${hi.score}`);
  const highNow = [...Array(252).fill(15), 40];
  const lo = vixLevel(highNow);
  assert.ok(lo.score < 15, `score ${lo.score}`);
});

test("vixTermStructure: contango vs backwardation", () => {
  // ratio 0.9 -> (1.15-0.9)/0.30*100 = 83.3
  approx(vixTermStructure([18], [20]).score, 83.3);
  assert.equal(vixTermStructure([18], [20]).detail, "contango");
  assert.equal(vixTermStructure([25], [20]).detail, "backwardation");
  assert.equal(vixTermStructure(null, null).score, 50);
});

test("marketBreadth: linear map 30%->0, 80%->100", () => {
  approx(marketBreadth(0.3).score, 0);
  approx(marketBreadth(0.8).score, 100);
  approx(marketBreadth(0.55).score, 50);
  assert.equal(marketBreadth(null).score, 50);
});

test("creditSpreads: tight (below mean) scores high", () => {
  const tight = [...Array(60).fill(4), ...Array(60).fill(4), 3]; // current below mean
  assert.ok(creditSpreads([...Array(252).fill(4), 3]).score > 55);
  assert.ok(creditSpreads([...Array(252).fill(4), 6]).score < 45);
  assert.equal(creditSpreads([1, 2]).score, 50);
  void tight;
});

test("putCall: rising VIX = fear = low score", () => {
  const rising = Array.from({ length: 25 }, (_, i) => 15 + i); // ROC positive
  assert.ok(putCall(rising).score < 50);
  const falling = Array.from({ length: 25 }, (_, i) => 40 - i);
  assert.ok(putCall(falling).score > 50);
  assert.equal(putCall([1, 2, 3]).score, 50);
});

test("factorCrowding: tight clustering = crowded = lower score", () => {
  const crowded = factorCrowding([1, 1.1, 0.9, 1, 1.05]); // low dispersion
  const decoupled = factorCrowding([-8, 12, 2, -3, 9]); // high dispersion
  assert.ok(crowded.score < 20, `crowded ${crowded.score}`);
  assert.equal(crowded.detail.startsWith("extreme"), true);
  assert.ok(decoupled.score > crowded.score, "higher dispersion scores higher");
  assert.equal(factorCrowding([1]).score, 50); // insufficient data
});

test("composite: weights sum to 1", () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  approx(sum, 1.0, 1e-9);
});

test("composite: weighted blend + zone thresholds", () => {
  const all80 = Object.keys(WEIGHTS).map((signal) => ({ signal, score: 80 }));
  const c = composite(all80);
  approx(c.composite, 80);
  assert.equal(c.zone, "FULL DEPLOY");
  assert.equal(c.scannerActive, true);
  assert.equal(c.sizingPct, 100);
});

test("composite: re-normalizes over present signals only", () => {
  // Only two signals present — denominator shrinks, average is over those two.
  const partial = [
    { signal: "VIX Level", score: 60 },
    { signal: "Credit Spreads", score: 20 },
  ];
  // weighted: 60*0.25 + 20*0.15 = 18; totalWeight 0.40 => 45
  approx(composite(partial).composite, 45);
});

test("getZone thresholds", () => {
  assert.equal(getZone(70), "FULL DEPLOY");
  assert.equal(getZone(69.9), "REDUCED");
  assert.equal(getZone(40), "REDUCED");
  assert.equal(getZone(39.9), "DEFENSIVE");
});
