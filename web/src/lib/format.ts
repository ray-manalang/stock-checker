export function money(value: number | null | undefined, currency = "USD"): string {
  if (value == null || Number.isNaN(value)) return "—";
  const digits = Math.abs(value) >= 1000 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const s = value.toFixed(digits);
  return `${value > 0 ? "+" : ""}${s}%`;
}

export function num(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}
