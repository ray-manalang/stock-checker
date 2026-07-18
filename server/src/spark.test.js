import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpark } from "./stocks.js";

test("parseSpark: extracts closes + timestamps per symbol", () => {
  const json = {
    spark: {
      result: [
        {
          symbol: "AAPL",
          response: [
            {
              timestamp: [1, 2, 3],
              indicators: { quote: [{ close: [10, 11, 12] }] },
            },
          ],
        },
        {
          symbol: "MSFT",
          response: [
            {
              timestamp: [1, 2, 3],
              indicators: { quote: [{ close: [100, 101, 102] }] },
            },
          ],
        },
      ],
    },
  };
  const out = parseSpark(json);
  assert.deepEqual(out.AAPL.closes, [10, 11, 12]);
  assert.deepEqual(out.MSFT.closes, [100, 101, 102]);
  assert.deepEqual(out.AAPL.timestamp, [1, 2, 3]);
});

test("parseSpark: drops null closes and keeps aligned timestamps", () => {
  const json = {
    spark: {
      result: [
        {
          symbol: "X",
          response: [
            { timestamp: [1, 2, 3, 4], indicators: { quote: [{ close: [10, null, 12, NaN] }] } },
          ],
        },
      ],
    },
  };
  const out = parseSpark(json);
  assert.deepEqual(out.X.closes, [10, 12]);
  assert.deepEqual(out.X.timestamp, [1, 3]);
});

test("parseSpark: tolerates empty/malformed input", () => {
  assert.deepEqual(parseSpark(null), {});
  assert.deepEqual(parseSpark({ spark: { result: [] } }), {});
  assert.deepEqual(parseSpark({ spark: { result: [{ symbol: "Z", response: [] }] } }), {});
});
