import { useEffect, useState } from "react";
import { getWatchSignals, type WatchSignal } from "./api";

function agoLabel(iso?: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

// "Watching to buy" (Phase 2.2). Surfaces each watched ticker's latest verdict
// and — for names that turned into a buy — when the notification went out. The
// daily job pushes only on the transition into "Good time to buy", macro
// permitting; this panel is the passive, in-app view of that same state.
export function WatchingToBuy({ onOpen }: { onOpen: (ticker: string) => void }) {
  const [signals, setSignals] = useState<WatchSignal[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    getWatchSignals()
      .then((s) => live && setSignals(s))
      .catch(() => {})
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  if (ready && signals.length === 0) return null;

  return (
    <div className="insight-card">
      <div className="insight-head">
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <h3>Watching to buy</h3>
          <span className="new-badge">NEW</span>
        </div>
      </div>
      <div className="caption">
        Notifies only the day a verdict first turns into "Good time to buy" — not every day it
        stays one — and only while market conditions currently allow new positions.
      </div>
      {signals.map((s) => {
        const isBuy = s.lastVerdict === "BUY";
        return (
          <div
            key={s.ticker}
            className="watch-row"
            onClick={() => onOpen(s.ticker)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onOpen(s.ticker)}
          >
            <div className="w-tk">{s.ticker}</div>
            <div className="w-signal">
              {isBuy ? (
                <>
                  <div className="buy-badge">🔔 Good time to buy</div>
                  {s.notifiedAt && (
                    <div className="notif-meta">Notified {agoLabel(s.notifiedAt)}</div>
                  )}
                </>
              ) : (
                <span className="verdict-quiet">{s.lastLabel ?? "No reading yet"}</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="insight-foot">
        Reuses your existing watchlist — nothing new to add. A ticker can sit here and in Holdings
        at once.
      </div>
    </div>
  );
}
