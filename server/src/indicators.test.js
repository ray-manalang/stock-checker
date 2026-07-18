import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sma,
  ema,
  emaSeries,
  rsi,
  volatility,
  drawdownFromHigh,
  pctOfRange,
  relativeStrength,
  trailingReturn,
  computeIndicators,
} from "./indicators.js";

const approx = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

test("sma: mean of last n", () => {
  approx(sma([1, 2, 3, 4, 5], 5), 3);
  approx(sma([1, 2, 3, 4, 5], 2), 4.5); // (4+5)/2
  assert.equal(sma([1, 2], 5), null);
});

test("ema: seed with SMA then recurse", () => {
  // Period 3, k=0.5. Seed = SMA(first 3) of [2,4,6]=4.
  // t=3 (val 8): 8*0.5 + 4*0.5 = 6
  // t=4 (val 10): 10*0.5 + 6*0.5 = 8
  approx(ema([2, 4, 6, 8, 10], 3), 8);
  assert.equal(ema([1], 3), null);
});

test("emaSeries: nulls until seed, then values", () => {
  const s = emaSeries([2, 4, 6, 8, 10], 3);
  assert.equal(s[0], null);
  assert.equal(s[1], null);
  approx(s[2], 4);
  approx(s[3], 6);
  approx(s[4], 8);
});

test("rsi: all-gains = 100, all-losses = 100->0 side", () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 + i);
  assert.equal(rsi(up, 14), 100);
  const down = Array.from({ length: 20 }, (_, i) => 100 - i);
  approx(rsi(down, 14), 0);
});

test("rsi: hand-computed Wilder fixture (period 2)", () => {
  // closes [10,11,10,11], period 2. deltas: +1,-1,+1.
  // seed over first 2 deltas: avgGain=0.5, avgLoss=0.5.
  // final step (delta +1): avgGain=(0.5+1)/2=0.75, avgLoss=(0.5+0)/2=0.25.
  // RS=3 => RSI = 100 - 100/4 = 75.
  approx(rsi([10, 11, 10, 11], 2), 75);
});

test("rsi: too short returns null", () => {
  assert.equal(rsi([1, 2, 3], 14), null);
});

test("volatility: constant series = 0", () => {
  const flat = Array(40).fill(100);
  approx(volatility(flat, 30), 0);
});

test("volatility: positive for varying series", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
  const v = volatility(closes, 30);
  assert.ok(v > 0);
});

test("drawdownFromHigh: below high is negative", () => {
  approx(drawdownFromHigh(90, [100, 80, 90]), (90 / 100 - 1) * 100); // -10
  approx(drawdownFromHigh(100, [100, 80, 90]), 0);
});

test("pctOfRange: endpoints and mid", () => {
  approx(pctOfRange(80, 80, 120), 0);
  approx(pctOfRange(120, 80, 120), 100);
  approx(pctOfRange(100, 80, 120), 50);
  assert.equal(pctOfRange(100, 120, 80), null); // degenerate
});

test("relativeStrength: outperformance is positive", () => {
  // stock +20%, spy +10% over lookback 2
  const stock = [100, 110, 120];
  const spy = [100, 105, 110];
  const rs = relativeStrength(stock, spy, 2);
  approx(rs, (120 / 100 - 110 / 100) * 100); // 10
});

test("trailingReturn: simple pct", () => {
  approx(trailingReturn([100, 110], 1), 10);
  assert.equal(trailingReturn([100], 5), null);
});

test("computeIndicators: assembles a bundle without throwing on short data", () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1);
  const series = { close: closes, high: closes, low: closes, volume: Array(260).fill(1e6) };
  const quote = { price: closes[closes.length - 1], high52: 130, low52: 100 };
  const ind = computeIndicators(series, quote, closes);
  assert.equal(typeof ind.rsi14, "number");
  assert.equal(typeof ind.pctOfRange, "number");
  assert.equal(ind.aboveSma50, true);
  assert.equal(ind.emaCrossUp, true); // uptrend
});
