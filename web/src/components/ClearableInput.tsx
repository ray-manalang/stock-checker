import type { CSSProperties, InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value"> & {
  value: string;
  onClear: () => void;
  /** Style for the wrapper span (use for flex/width so the field lays out right). */
  wrapperStyle?: CSSProperties;
  wrapperClassName?: string;
};

// A text input with a clear "×" button that appears when it has content. The
// input keeps its own className/style; the wrapper handles positioning.
export function ClearableInput({
  value,
  onClear,
  wrapperStyle,
  wrapperClassName,
  style,
  ...props
}: Props) {
  const hasValue = String(value ?? "").length > 0;
  return (
    <span
      className={`clearable${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      style={wrapperStyle}
    >
      <input
        {...props}
        value={value}
        style={{ ...style, paddingRight: hasValue ? 26 : style?.paddingRight }}
      />
      {hasValue && (
        <button
          type="button"
          className="clear-x"
          aria-label="Clear"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
        >
          ×
        </button>
      )}
    </span>
  );
}
