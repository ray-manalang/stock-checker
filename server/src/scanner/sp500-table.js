// Pure parser for Wikipedia's "List of S&P 500 companies" constituents table.
// Extracts ticker + company name (Security) + GICS Sector from each row. Kept as
// a standalone, dependency-free module so it's cheaply unit-testable. The scraper
// in universe.js already fetches this table every 24h for the ticker universe;
// this pulls the name/sector out of the same rows.
//
// Real column layout: Symbol | Security | GICS Sector | GICS Sub-Industry | … —
// so ticker is cell 0, name is cell 1, sector is cell 2.

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Strip HTML tags → collapsed, entity-decoded text.
function cellText(cell) {
  return decodeEntities(String(cell).replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the constituents table HTML → [{ ticker, name, sector }], deduped by
 * ticker (dots normalised to hyphens, e.g. BRK.B → BRK-B). Rows without a
 * recognisable ticker or fewer than three cells (e.g. the header row) are
 * skipped.
 */
export function parseSp500Table(html) {
  const src = String(html ?? "");
  const table = src.split('id="constituents"')[1] ?? src;
  const body = table.split("</table>")[0] ?? "";
  const out = [];
  const seen = new Set();
  // Rows carry attributes in Wikipedia's current Parsoid output (`<tr id="…">`),
  // so split on the opening tag with any attributes, not a literal `<tr>`.
  for (const row of body.split(/<tr[^>]*>/).slice(1)) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = cellRe.exec(row)) !== null) cells.push(m[1]);
    if (cells.length < 3) continue;

    const tickerM =
      cells[0].match(/<a[^>]*>\s*([A-Z][A-Z.\-]{0,6})\s*<\/a>/) ||
      cellText(cells[0]).match(/^([A-Z][A-Z.\-]{0,6})$/);
    if (!tickerM) continue;
    const ticker = tickerM[1].replace(/\./g, "-");
    if (seen.has(ticker)) continue;
    seen.add(ticker);

    out.push({
      ticker,
      name: cellText(cells[1]) || null,
      sector: cellText(cells[2]) || null,
    });
  }
  return out;
}
