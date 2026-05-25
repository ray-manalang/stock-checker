const SINGLE_LINE_FIELDS = [
  { key: "trend", pattern: /^Trend:\s*(.+)$/im },
  { key: "buyZone", pattern: /^Target Buy Zone:\s*(.+)$/im },
  { key: "signal", pattern: /^Signal:\s*(.+)$/im },
];

export function parseAnalysis(raw) {
  const text = String(raw ?? "").trim();
  const parsed = { raw: text };

  for (const { key, pattern } of SINGLE_LINE_FIELDS) {
    const match = text.match(pattern);
    parsed[key] = match?.[1]?.trim() ?? null;
  }

  // Reasoning is last and may span multiple lines
  const reasoningMatch = text.match(/^Reasoning:\s*([\s\S]+)$/im);
  parsed.reasoning = reasoningMatch?.[1]?.trim() ?? null;

  return parsed;
}
