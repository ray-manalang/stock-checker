import { test } from "node:test";
import assert from "node:assert/strict";
import { blend, blendSummary, QUANT_WEIGHT, FUNDAMENTAL_WEIGHT } from "./blender.js";

test("weights are 60/40", () => {
  assert.equal(QUANT_WEIGHT, 0.6);
  assert.equal(FUNDAMENTAL_WEIGHT, 0.4);
});

test("blend: strong fundamentals lift a mid-quant name >=3 ranks -> upgrade", () => {
  const rows = [
    { ticker: "A", quant: 60, fundamental: 1 },
    { ticker: "B", quant: 58, fundamental: 1 },
    { ticker: "C", quant: 56, fundamental: 1 },
    { ticker: "D", quant: 40, fundamental: 10 },
    { ticker: "E", quant: 20, fundamental: 1 },
    { ticker: "F", quant: 10, fundamental: 1 },
  ];
  const out = blend(rows);
  const d = out.find((r) => r.ticker === "D");
  assert.equal(d.quantRank, 4);
  assert.equal(d.blendedRank, 1);
  assert.equal(d.rankDelta, 3);
  assert.equal(d.rankFlag, "upgrade");
  assert.equal(out[0].ticker, "D"); // sorted by blended rank
});

test("blend: weak fundamentals sink a top-quant name -> downgrade", () => {
  // A leads on quant but has the worst fundamentals; three near-peers with
  // strong fundamentals overtake it, dropping it from rank 1 to rank 4.
  const rows = [
    { ticker: "A", quant: 100, fundamental: 1 },
    { ticker: "B", quant: 99, fundamental: 10 },
    { ticker: "C", quant: 98, fundamental: 10 },
    { ticker: "D", quant: 97, fundamental: 10 },
    { ticker: "E", quant: 80, fundamental: 1 },
  ];
  const out = blend(rows);
  const a = out.find((r) => r.ticker === "A");
  assert.equal(a.quantRank, 1);
  assert.equal(a.blendedRank, 4);
  assert.equal(a.rankDelta, -3);
  assert.equal(a.rankFlag, "downgrade");
});

test("blend: missing fundamental fills with batch median (no crash, stays mid)", () => {
  const rows = [
    { ticker: "A", quant: 80, fundamental: 8 },
    { ticker: "B", quant: 60, fundamental: null },
    { ticker: "C", quant: 40, fundamental: 2 },
  ];
  const out = blend(rows);
  assert.equal(out.length, 3);
  // B has no fundamental -> filled with median(8,2)=5, so it stays middle-ish.
  const b = out.find((r) => r.ticker === "B");
  assert.equal(b.blendedRank, 2);
});

test("blendSummary: reports upgrades/downgrades/top5", () => {
  const out = blend([
    { ticker: "A", quant: 60, fundamental: 1 },
    { ticker: "B", quant: 58, fundamental: 1 },
    { ticker: "C", quant: 56, fundamental: 1 },
    { ticker: "D", quant: 40, fundamental: 10 },
    { ticker: "E", quant: 20, fundamental: 1 },
    { ticker: "F", quant: 10, fundamental: 1 },
  ]);
  const s = blendSummary(out);
  assert.ok(s.upgrades.includes("D"));
  assert.equal(s.count, 6);
  assert.equal(s.top5.length, 5);
});

test("blend: empty input -> empty output", () => {
  assert.deepEqual(blend([]), []);
});
