import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Clickable ⓘ that opens a plain-language explanation in a portal popover. */
export function InfoTip({
  title,
  text,
  label,
}: {
  title?: string;
  text: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 260 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function place() {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.min(
      Math.max(12, b.left - width / 2 + b.width / 2),
      window.innerWidth - width - 12,
    );
    const popH = popRef.current?.offsetHeight ?? 96;
    const spaceBelow = window.innerHeight - b.bottom;
    const top = spaceBelow > popH + 12 ? b.bottom + 8 : Math.max(12, b.top - popH - 8);
    setPos({ top, left, width });
  }

  useLayoutEffect(() => {
    if (open) {
      place();
      requestAnimationFrame(place);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onMove() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  return (
    <span className="infotip">
      <button
        ref={btnRef}
        type="button"
        className="infotip-btn"
        aria-label={label ? `About ${label}` : "More info"}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        i
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="infotip-pop"
            role="tooltip"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          >
            {title && <div className="infotip-title">{title}</div>}
            <div className="infotip-text">{text}</div>
          </div>,
          document.body,
        )}
    </span>
  );
}
