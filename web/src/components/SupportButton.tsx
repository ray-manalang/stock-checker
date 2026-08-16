type Props = {
  url: string;
  label?: string;
  tooltip?: string;
  className?: string;
};

/** Outbound Ko-fi tip jar — never gates features (same pattern as AptResume). */
export function SupportButton({
  url,
  label = "Chip in for LLM costs",
  tooltip = "Tips help cover Claude usage. Optional: nothing is gated behind this.",
  className = "",
}: Props) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip}
      className={`support-btn${className ? ` ${className}` : ""}`}
    >
      <span aria-hidden="true">☕</span>
      {label}
    </a>
  );
}
