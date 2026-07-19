import { useEffect, useRef, useState } from "react";
import { getWatchlistQuotes, type WatchQuote } from "./api";

/**
 * Fixed footer ticker-tape of the user's watchlist — a continuous horizontal
 * marquee of symbol · price · daily change. Stays in view on both Simple and
 * Pro. Hidden entirely when the watchlist is empty.
 */
export function TickerTape({ watchlist }: { watchlist: string[] }) {
  const [quotes, setQuotes] = useState<WatchQuote[]>([]);
  const live = useRef(true);

  const key = watchlist.join(",");
  useEffect(() => {
    live.current = true;
    const load = () =>
      getWatchlistQuotes()
        .then((q) => live.current && setQuotes(q))
        .catch(() => {});
    load();
    const id = setInterval(load, 60000); // refresh prices ~1/min
    return () => {
      live.current = false;
      clearInterval(id);
    };
  }, [key]);

  if (!watchlist.length || !quotes.length) return null;

  // Duplicate the sequence so the -50% keyframe loops seamlessly.
  const seq = [...quotes, ...quotes];

  return (
    <div className="tape" aria-label="Watchlist ticker">
      <div className="tape-track">
        {seq.map((q, i) => (
          <span className="tape-item" key={`${q.ticker}-${i}`}>
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
