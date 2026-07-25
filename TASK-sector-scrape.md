# Task: Get sector + name for the full scanner universe from the existing Wikipedia scrape

## Problem

The scanner defaults to the full S&P 500 (`SCANNER_FULL_UNIVERSE`, ~550 names — Phase
1.3), but `scanner/names.js` and `scanner/sectors.js` are both static maps sized for the
old ~100-name curated large-cap list. Tickers outside those maps render as a bare symbol
with no sector rank in Top-ranked/scanner rows — roughly 450 of 550 names today. This
degrades gracefully (not an error), but it means Phase 4.2's sector-relative ranking is
effectively silent past the mega/large-caps. Documented in `ARCHITECTURE.md`'s Known
limitations.

## Solution

`scanner/engine.js`'s `scrapeSp500()` already fetches the full constituents table from
Wikipedia once every 24h (cached to `.cache/sp500.json`) to build the ticker universe.
That same table has the company name and GICS sector as adjacent `<td>` columns in every
row — the scraper currently regexes out only the ticker and discards the rest:

```js
// current — server/src/scanner/engine.js
async function scrapeSp500() {
  const res = await fetch("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", {
    headers: { "User-Agent": "stock-checker/1.0" },
  });
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  const html = await res.text();
  const table = html.split('id="constituents"')[1] ?? html;
  const body = table.split("</table>")[0] ?? "";
  const tickers = [];
  for (const row of body.split("<tr>").slice(1)) {
    const m = row.match(/<td[^>]*>\s*<a[^>]*>([A-Z][A-Z.\-]{0,6})<\/a>/);
    if (m) tickers.push(m[1].replace(/\./g, "-"));
  }
  return [...new Set(tickers)];
}
```

Extend the per-row parse to also capture the **Security** (name) and **GICS Sector**
cells — they're the 2nd and 4th `<td>` in the same row already being iterated. Cache all
three fields together (still `sp500.json`, still the existing 24h TTL — no new fetch, no
new schedule), and expose a lookup (e.g. `getUniverseMeta()` returning
`{ [ticker]: { name, sector } }`) that `holdings.js` and the scanner's row-building code
can check *before* falling back to the static `NAMES`/`SECTORS` maps.

Keep the static maps as-is — they remain the fallback when `SCANNER_FULL_UNIVERSE=0` or
the scrape fails, which is exactly the mode they were originally sized for. This is
additive, not a replacement.

## Why this over hand-expanding the static maps

- **Zero new network calls** — same fetch that already runs today.
- **Self-updating** — S&P 500 membership and GICS sector classifications change over
  time (reconstitutions, reclassifications); a scraped source tracks that automatically,
  a hand-typed 550-entry list would silently drift.
- **Fixes both gaps at once** — name and sector are the same missing-data problem, same
  table, same row.
- **No regression risk** — falls back to exactly today's behavior if the scrape fails.

## Acceptance criteria

- With `SCANNER_FULL_UNIVERSE` on (default), a scanner/Top-ranked row for a ticker
  outside the current ~100-name static maps shows a real company name and a
  within-sector rank, not a bare ticker / no rank.
- Holdings resolves a name for a held ticker outside the static map from the scraped
  data before falling back to the sidecar's per-symbol `fetchCompanyNames` call — cheaper
  and already-cached, so this should reduce (not eliminate) sidecar name lookups.
- `SCANNER_FULL_UNIVERSE=0` and a forced scrape failure both still work exactly as
  today, using the static `LARGE_CAP_UNIVERSE` / `NAMES` / `SECTORS`.
- A unit test on the parser: given a small fixture HTML snippet with a few `<tr>` rows,
  confirms ticker + name + sector all extract correctly, including a row with an `&amp;`
  or similar HTML entity in the company name (e.g. "AT&T", "Johnson & Johnson").

## Files likely touched

- `server/src/scanner/engine.js` — `scrapeSp500()` and the universe cache shape
- `server/src/scanner/names.js` / `server/src/scanner/sectors.js` — lookup order (check
  scraped data first, static map as fallback), or a small new module if that reads
  cleaner
- `server/src/holdings.js` — name resolution order
- `ARCHITECTURE.md` — update the "External data" section's Wikipedia-scrape description
  and strike this item from Known limitations once shipped
