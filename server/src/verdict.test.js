import { test } from "node:test";
import assert from "node:assert/strict";
import {
  timingWord,
  qualityWord,
  priceWord,
  trendWord,
  volatilityWord,
  drawdownWord,
  macroWord,
} from "./language.js";
import { scoreVerdict, suggestBuyZone, buildGlance } from "./verdict.js";

test("language: timing from RSI", () => {
  assert.equal(timingWord(80).word, "Running hot");
  assert.equal(timingWord(25).word, "Beaten down");
  assert.equal(timingWord(50).word, "Steady");
  assert.equal(timingWord(null).tone, "neutral");
});

test("language: quality from fundamental score", () => {
  assert.equal(qualityWord(8).word, "Healthy");
  assert.equal(qualityWord(5).word, "Decent");
  assert.equal(qualityWord(2).word, "Shaky");
  assert.equal(qualityWord(null).word, "Not rated");
});

test("language: price from % of range", () => {
  assert.equal(priceWord(80).word, "Looks pricey");
  assert.equal(priceWord(20).word, "Looks cheap");
  assert.equal(priceWord(50).word, "Around fair");
});

test("language: trend from MA posture", () => {
  assert.equal(
    trendWord({ aboveSma50: true, aboveSma200: true, emaCrossUp: true }).word,
    "Pointing up",
  );
  assert.equal(
    trendWord({ aboveSma50: false, aboveSma200: false, emaCrossUp: false }).word,
    "Pointing down",
  );
  assert.equal(
    trendWord({ aboveSma50: true, aboveSma200: false, emaCrossUp: false }).word,
    "Sideways",
  );
});

test("language: volatility + drawdown + macro", () => {
  assert.equal(volatilityWord(50).word, "Bumpy");
  assert.equal(volatilityWord(10).word, "Calm");
  assert.equal(drawdownWord(-1).word, "At its high");
  assert.equal(drawdownWord(-25).tone, "up");
  assert.equal(macroWord("FULL DEPLOY").tone, "up");
  assert.equal(macroWord("DEFENSIVE").tone, "down");
});

test("verdict: strong uptrend + cheap + healthy => BUY", () => {
  const ind = {
    rsi14: 45,
    pctOfRange: 20,
    aboveSma50: true,
    aboveSma200: true,
    emaCrossUp: true,
    volatility30: 15,
    drawdownFromHigh: -10,
  };
  const v = scoreVerdict(ind, 8);
  assert.equal(v.verdict.signal, "BUY");
  assert.ok(v.confidence >= 3);
});

test("verdict: downtrend + shaky => AVOID", () => {
  const ind = {
    rsi14: 50,
    pctOfRange: 60,
    aboveSma50: false,
    aboveSma200: false,
    emaCrossUp: false,
    volatility30: 30,
    drawdownFromHigh: -20,
  };
  const v = scoreVerdict(ind, 2);
  assert.equal(v.verdict.signal, "SELL");
});

test("verdict: healthy but pricey/hot => Wait for a dip", () => {
  const ind = {
    rsi14: 75,
    pctOfRange: 90,
    aboveSma50: true,
    aboveSma200: true,
    emaCrossUp: true,
    volatility30: 20,
    drawdownFromHigh: -2,
  };
  const v = scoreVerdict(ind, 8);
  assert.equal(v.verdict.label, "Wait for a dip");
});

test("suggestBuyZone: band below price, respects 52w low", () => {
  const z = suggestBuyZone(100, 90, 130);
  assert.ok(z.low >= 90 && z.low < z.high && z.high <= 100);
  assert.equal(suggestBuyZone(null, 1, 2), null);
});

test("buildGlance: assembles six words", () => {
  const g = buildGlance(
    { rsi14: 50, pctOfRange: 50, aboveSma50: true, aboveSma200: true, emaCrossUp: true, volatility30: 20, drawdownFromHigh: -5 },
    7,
  );
  assert.deepEqual(Object.keys(g).sort(), [
    "drawdown",
    "price",
    "quality",
    "timing",
    "trend",
    "volatility",
  ]);
  assert.equal(g.quality.word, "Healthy");
});
