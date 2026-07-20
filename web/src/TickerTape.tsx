import { useEffect, useRef, useState } from "react";
import { getTape, type TapeItem } from "./api";
import { absChange, type ChangeMode } from "./lib/format";

/**
 * Fixed footer ticker-tape — a continuous horizontal marquee of the user's
 * watchlist plus the scanner's current top-ranked names (deduped server-side),
 * each showing symbol · price · daily change. Watchlist names get a ★. A pinned
 * %/$ toggle flips the change display (shared with the analysis card). Stays in
 * view on both Basic and Pro; hidden when there's nothing to show.
 */
export function TickerTape({
  watchlist,
  changeMode,
  onToggleChangeMode,
}: {
  watchlist: string[];
  changeMode: ChangeMode;
  onToggleChangeMode: () => void;
}) {
  const [items, setItems] = useState<TapeItem[]>([]);
  const live = useRef(true);

  // Re-pull when the watchlist changes; also poll so scanner updates land.
  const key = watchlist.join(",");
  useEffect(() => {
    live.current = true;
    const load = () =>
      getTape()
        .then((q) => live.current && setItems(q))
        .catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => {
      live.current = false;
      clearInterval(id);
    };
  }, [key]);

  if (!items.length) return null;

  // Indexes pinned first; the rest sorted alphabetically. Duplicate so the
  // -50% keyframe loops seamlessly.
  const indexes = items.filter((q) => q.source === "index");
  const rest = items
    .filter((q) => q.source !== "index")
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  const ordered = [...indexes, ...rest];
  const seq = [...ordered, ...ordered];
  // Keep per-item speed roughly constant regardless of how many names show.
  const duration = Math.max(30, ordered.length * 3);

  const yahoo = (symbol: string) =>
    `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;

  const changeText = (q: TapeItem): string | null => {
    if (q.changePct == null) return null;
    if (changeMode === "pct") return `${Math.abs(q.changePct).toFixed(2)}%`;
    const abs = absChange(q.price, q.changePct);
    return abs == null ? null : Math.abs(abs).toFixed(2);
  };

  return (
    <div className="tape" aria-label="Watchlist and top-ranked ticker">
      <button
        className="tape-toggle"
        onClick={onToggleChangeMode}
        title="Toggle percent / dollar change"
      >
        {changeMode === "pct" ? "%" : "$"}
      </button>
      <div className="tape-track" style={{ animationDuration: `${duration}s` }}>
        {seq.map((q, i) => {
          const chg = changeText(q);
          return (
            <span className="tape-item" key={`${q.ticker}-${i}`}>
              {q.source === "watch" && <span className="tape-star">★</span>}
              <a
                className="tape-sym"
                href={yahoo(q.ticker)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${q.label ?? q.ticker} on Yahoo Finance`}
              >
                {q.label ?? q.ticker}
              </a>
              {q.price != null && (
                <span className="tape-price">
                  {q.price.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              )}
              {chg != null && q.changePct != null && (
                <span className={q.changePct >= 0 ? "up" : "down"}>
                  {q.changePct >= 0 ? "▲" : "▼"} {chg}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
