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

export type ChangeMode = "pct" | "abs";

/** Absolute point change derived from a last price and its daily % change. */
export function absChange(
  price: number | null | undefined,
  changePct: number | null | undefined,
): number | null {
  if (price == null || changePct == null || Number.isNaN(price) || Number.isNaN(changePct)) {
    return null;
  }
  const prev = price / (1 + changePct / 100);
  return price - prev;
}

/** Signed dollar/point change, e.g. "+$7.12" / "-$7.12". */
export function pointStr(
  price: number | null | undefined,
  changePct: number | null | undefined,
  currency = "USD",
): string {
  const abs = absChange(price, changePct);
  if (abs == null) return "—";
  const sign = abs > 0 ? "+" : abs < 0 ? "-" : "";
  return `${sign}${money(Math.abs(abs), currency)}`;
}
