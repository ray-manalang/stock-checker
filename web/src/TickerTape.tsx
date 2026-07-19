import { useEffect, useRef, useState } from "react";
import { getTape, type TapeItem } from "./api";

/**
 * Fixed footer ticker-tape — a continuous horizontal marquee of the user's
 * watchlist plus the scanner's current top-ranked names (deduped server-side),
 * each showing symbol · price · daily change. Watchlist names get a ★. Stays in
 * view on both Simple and Pro; hidden when there's nothing to show.
 */
export function TickerTape({ watchlist }: { watchlist: string[] }) {
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

  // Sort alphabetically, then duplicate so the -50% keyframe loops seamlessly.
  const sorted = [...items].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const seq = [...sorted, ...sorted];
  // Keep per-item speed roughly constant regardless of how many names show.
  const duration = Math.max(30, sorted.length * 3);

  return (
    <div className="tape" aria-label="Watchlist and top-ranked ticker">
      <div className="tape-track" style={{ animationDuration: `${duration}s` }}>
        {seq.map((q, i) => (
          <span className="tape-item" key={`${q.ticker}-${i}`}>
            {q.source === "watch" && <span className="tape-star">★</span>}
            <span className="tape-sym">{q.ticker}</span>
            {q.price != null && (
              <span className="tape-price">
                {q.price.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            )}
            {q.changePct != null && (
              <span className={q.changePct >= 0 ? "up" : "down"}>
                {q.changePct >= 0 ? "▲" : "▼"} {Math.abs(q.changePct).toFixed(2)}%
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
