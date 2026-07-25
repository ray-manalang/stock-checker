import { FormEvent, useState } from "react";
import { checkTicker } from "./api";
import type { CheckResponse } from "./types";
import { money, pct } from "./lib/format";
import { PriceChart } from "./components/PriceChart";

// Compare view (Phase 5.2). Two or three tickers side by side — same glance
// cells and chart, laid out for comparison rather than one at a time.
export function CompareView({ onBack }: { onBack: () => void }) {
  const [input, setInput] = useState("");
  const [cols, setCols] = useState<CheckResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(sym: string) {
    const t = sym.trim().toUpperCase();
    if (!t || cols.length >= 3 || cols.some((c) => c.quote.ticker === t)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await checkTicker(t, { deep: false });
      setCols((c) => [...c, res]);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that ticker");
    } finally {
      setLoading(false);
    }
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    add(input);
  }
  function remove(ticker: string) {
    setCols((c) => c.filter((x) => x.quote.ticker !== ticker));
  }

  return (
    <>
      <div className="page-head">
        <button className="linklike" onClick={onBack} style={{ marginBottom: 8 }}>
          ‹ Back
        </button>
        <h2 style={{ margin: "0 0 4px", fontSize: 24 }}>Compare</h2>
        <div className="insight-foot" style={{ marginTop: 0 }}>
          Line up two or three tickers side by side. Add up to three.
        </div>
      </div>

      <form className="search" onSubmit={onSubmit} style={{ marginTop: 16, maxWidth: 360 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder="Add a ticker — MSFT"
          spellCheck={false}
          autoComplete="off"
          disabled={loading || cols.length >= 3}
        />
        <button className="btn-primary" disabled={loading || !input.trim() || cols.length >= 3}>
          Add
        </button>
      </form>
      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}

      {cols.length === 0 ? (
        <div className="insight-foot" style={{ padding: 8 }}>
          No tickers yet — add one above.
        </div>
      ) : (
        <div className="compare-grid" style={{ marginTop: 16 }}>
          {cols.map((c) => (
            <div key={c.quote.ticker} className="insight-card">
              <div className="insight-head">
                <div>
                  <h3>{c.quote.ticker}</h3>
                  <div className="subtitle">{c.quote.name}</div>
                </div>
                <button className="icon-btn" title="Remove" onClick={() => remove(c.quote.ticker)}>
                  ×
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "10px 0" }}>
                <span style={{ fontSize: 22, fontWeight: 800 }}>
                  {money(c.quote.price, c.quote.currency)}
                </span>
                {c.quote.changePct != null && (
                  <span className={c.quote.changePct >= 0 ? "up" : "down"} style={{ fontWeight: 600 }}>
                    {pct(c.quote.changePct)}
                  </span>
                )}
              </div>
              <div className={`label ${c.verdict.tone}`} style={{ fontWeight: 700, marginBottom: 8 }}>
                {c.verdict.label}
              </div>
              <div className="glance" style={{ marginBottom: 12 }}>
                <GlanceMini k="Timing" word={c.glance.timing.word} tone={c.glance.timing.tone} />
                <GlanceMini k="Quality" word={c.glance.quality.word} tone={c.glance.quality.tone} />
                <GlanceMini k="Price" word={c.glance.price.word} tone={c.glance.price.tone} />
              </div>
              <PriceChart
                timestamps={c.series.timestamp}
                closes={c.series.close}
                buyZone={c.buyZone}
                currency={c.quote.currency}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function GlanceMini({ k, word, tone }: { k: string; word: string; tone: string }) {
  return (
    <div className="glance-cell">
      <div className="k">{k}</div>
      <div className={`v ${tone}`}>{word}</div>
    </div>
  );
}
