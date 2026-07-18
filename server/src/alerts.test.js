import { test } from "node:test";
import assert from "node:assert/strict";
import { alertHit } from "./alerts.js";

test("alertHit: single target = at or below", () => {
  assert.equal(alertHit(95, { targetLow: 100 }), true);
  assert.equal(alertHit(100, { targetLow: 100 }), true);
  assert.equal(alertHit(101, { targetLow: 100 }), false);
  // targetHigh-only behaves the same (at or below)
  assert.equal(alertHit(90, { targetHigh: 100 }), true);
});

test("alertHit: band = inside [low, high]", () => {
  assert.equal(alertHit(95, { targetLow: 90, targetHigh: 100 }), true);
  assert.equal(alertHit(89, { targetLow: 90, targetHigh: 100 }), false);
  assert.equal(alertHit(101, { targetLow: 90, targetHigh: 100 }), false);
});

test("alertHit: guards non-numeric price and empty target", () => {
  assert.equal(alertHit(null, { targetLow: 100 }), false);
  assert.equal(alertHit(95, {}), false);
});
