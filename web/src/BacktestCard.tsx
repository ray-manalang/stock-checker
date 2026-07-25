import { useState } from "react";
import { getBacktest, type Backtest } from "./api";

const LABELS: Record<string, string> = {
  BUY: "Buy calls",
  HOLD: "Hold / wait calls",
  SELL: "Avoid calls",
};

// Backtest report (Phase 4.4). Surfaces the hit rate of verdicts Phase 1.2 has
// been logging. Loaded on demand (it fetches series to grade) and honest about
// not having enough history yet.
export function BacktestCard() {
  const [data, setData] = useState<Backtest | null>(null);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);

  async function load() {
    setOpened(true);
    setLoading(true);
    try {
      setData(await getBacktest());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="insight-card">
      <div className="insight-head">
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <h3>Track record</h3>
          <span className="new-badge">NEW</span>
        </div>
        {!opened && (
          <button className="btn-ghost btn-sm" onClick={load}>
            Show hit rate
          </button>
        )}
      </div>
      <div className="insight-foot" style={{ marginTop: 4 }}>
        Were past verdicts right? Graded on direction over a 90-day window (Hold graded loosely —
        no large move either way).
      </div>

      {opened && (
        <>
          <div className="insight-divider" />
          {loading ? (
            <div className="insight-foot" style={{ padding: "6px 0" }}>
              <span className="spinner" style={{ width: 13, height: 13 }} /> Grading history…
            </div>
          ) : !data ? (
            <div className="insight-foot">Couldn't load the report.</div>
          ) : !data.ready ? (
            <div className="insight-foot" style={{ padding: "6px 0" }}>
              {data.logged === 0
                ? "No verdicts logged yet — this fills in as you check stocks over the coming weeks."
                : `${data.logged} verdict${data.logged === 1 ? "" : "s"} logged, but none are 90 days old yet. Check back once history accrues.`}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 32, fontWeight: 800 }}>{data.overall}%</span>
                <span className="insight-foot" style={{ margin: 0 }}>
                  correct direction · {data.graded} graded of {data.logged} logged
                </span>
              </div>
              <div className="bt-buckets">
                {["BUY", "HOLD", "SELL"].map((k) => {
                  const b = data.buckets[k];
                  if (!b || b.total === 0) return null;
                  return (
                    <div key={k} className="bt-bucket">
                      <div className="bt-k">{LABELS[k] ?? k}</div>
                      <div className="bt-v">{b.hitRate}%</div>
                      <div className="bt-k">
                        {b.correct}/{b.total}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
