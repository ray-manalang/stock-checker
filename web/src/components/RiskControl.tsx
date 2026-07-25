import type { RiskTolerance } from "../api";

const OPTIONS: { value: RiskTolerance; label: string }[] = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Aggressive" },
];

// Plain-label risk-tolerance control (Phase 4.1). Shifts the quant/fundamental
// blend and the buy-zone width, not any raw weight the user sees.
export function RiskControl({
  value,
  onChange,
}: {
  value: RiskTolerance;
  onChange: (v: RiskTolerance) => void;
}) {
  return (
    <div className="risk-seg" role="group" aria-label="Risk tolerance">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? "active" : ""}
          onClick={() => onChange(o.value)}
          title={`Risk tolerance: ${o.label}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
