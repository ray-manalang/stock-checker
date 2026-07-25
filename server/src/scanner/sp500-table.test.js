import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSp500Table } from "./sp500-table.js";

// A small snippet mirroring the real Wikipedia constituents table — including
// Parsoid-style `id="…"` attributes on <tr>/<td>/<a> (the current markup), a
// header row (th, skipped), HTML entities in two names, and a dotted ticker.
const FIXTURE = `
<table id="constituents" class="wikitable sortable">
<tbody>
<tr id="mwH"><th>Symbol</th><th>Security</th><th>GICS Sector</th><th>GICS Sub-Industry</th></tr>
<tr id="mwLQ">
<td id="mwLg"><a rel="mw:ExtLink nofollow" class="external text" href="https://www.nyse.com/quote/XNYS:MMM" data-mw='{"parts":[]}'>MMM</a></td>
<td id="mwMA"><a rel="mw:WikiLink" href="./3M" title="3M">3M</a></td>
<td id="mwMB">Industrials</td>
<td id="mwMC">Industrial Conglomerates</td>
</tr>
<tr id="mwN1">
<td><a rel="mw:ExtLink nofollow" class="external text" href="https://www.nyse.com/quote/XNYS:T">T</a></td>
<td><a rel="mw:WikiLink" href="./AT%26T" title="AT&amp;T">AT&amp;T</a></td>
<td>Communication Services</td>
<td>Integrated Telecommunication Services</td>
</tr>
<tr id="mwP2">
<td><a rel="mw:ExtLink nofollow" class="external text" href="https://www.nyse.com/quote/XNYS:JNJ">JNJ</a></td>
<td><a rel="mw:WikiLink" href="./Johnson_%26_Johnson" title="Johnson &amp; Johnson">Johnson &amp; Johnson</a></td>
<td>Health Care</td>
<td>Pharmaceuticals</td>
</tr>
<tr id="mwQ3">
<td><a rel="mw:ExtLink nofollow" class="external text" href="https://www.nyse.com/quote/XNYS:BRK.B">BRK.B</a></td>
<td><a rel="mw:WikiLink" href="./Berkshire_Hathaway" title="Berkshire Hathaway">Berkshire Hathaway</a></td>
<td>Financials</td>
<td>Multi-Sector Holdings</td>
</tr>
</tbody>
</table>`;

test("parseSp500Table: extracts ticker, name, and sector per row", () => {
  const rows = parseSp500Table(FIXTURE);
  assert.equal(rows.length, 4);
  const by = Object.fromEntries(rows.map((r) => [r.ticker, r]));

  assert.deepEqual(by.MMM, { ticker: "MMM", name: "3M", sector: "Industrials" });
});

test("parseSp500Table: decodes HTML entities in company names", () => {
  const by = Object.fromEntries(parseSp500Table(FIXTURE).map((r) => [r.ticker, r]));
  assert.equal(by.T.name, "AT&T");
  assert.equal(by.T.sector, "Communication Services");
  assert.equal(by.JNJ.name, "Johnson & Johnson");
  assert.equal(by.JNJ.sector, "Health Care");
});

test("parseSp500Table: normalises dotted tickers (BRK.B → BRK-B)", () => {
  const by = Object.fromEntries(parseSp500Table(FIXTURE).map((r) => [r.ticker, r]));
  assert.ok(by["BRK-B"], "BRK.B should be keyed as BRK-B");
  assert.equal(by["BRK-B"].name, "Berkshire Hathaway");
  assert.equal(by["BRK-B"].sector, "Financials");
  assert.equal(by.BRK, undefined);
});

test("parseSp500Table: skips the header row and empty input", () => {
  assert.deepEqual(parseSp500Table(""), []);
  assert.deepEqual(parseSp500Table("<table id=\"constituents\"></table>"), []);
});
