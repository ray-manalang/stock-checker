import { FormEvent, useState } from "react";
import { analyzeTicker } from "./api";
import type { AnalyzeResponse } from "./types";
import "./App.css";

function formatMoney(value: number | null, currency: string) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function signalClass(signal: string | null) {
  if (!signal) return "signal";
  const s = signal.toUpperCase();
  if (s.includes("BUY")) return "signal signal-buy";
  if (s.includes("SELL")) return "signal signal-sell";
  return "signal signal-hold";
}

export default function App() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const symbol = ticker.trim().toUpperCase();
    if (!symbol) return;

    setLoading(true);
    setError(null);

    try {
      const data = await analyzeTicker(symbol);
      setResult(data);
      setTicker(symbol);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const { quote, analysis } = result ?? {};
  const rangePct =
    quote?.price != null && quote.low52 != null && quote.high52 != null && quote.high52 > quote.low52
      ? ((quote.price - quote.low52) / (quote.high52 - quote.low52)) * 100
      : null;

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Personal equity brief</p>
        <h1>Stock Checker</h1>
        <p className="lede">
          Enter a ticker for live quotes and a structured AI outlook. Free Yahoo Finance data and
          Gemini analysis.
        </p>
      </header>

      <form className="search" onSubmit={onSubmit}>
        <label htmlFor="ticker" className="sr-only">
          Ticker symbol
        </label>
        <input
          id="ticker"
          name="ticker"
          type="text"
          placeholder="AAPL"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          disabled={loading}
        />
        <button type="submit" disabled={loading || !ticker.trim()}>
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}

      {quote && analysis && (
        <main className="results">
          <section className="card card-quote">
            <div className="card-head">
              <h2>{quote.ticker}</h2>
              <span className={signalClass(analysis.signal)}>{analysis.signal ?? "—"}</span>
            </div>

            <p className="price">{formatMoney(quote.price, quote.currency)}</p>

            <div className="metrics">
              <div>
                <span className="label">52-week high</span>
                <span className="value">{formatMoney(quote.high52, quote.currency)}</span>
              </div>
              <div>
                <span className="label">52-week low</span>
                <span className="value">{formatMoney(quote.low52, quote.currency)}</span>
              </div>
            </div>

            {rangePct != null && (
              <div className="range">
                <div className="range-track">
                  <div className="range-fill" style={{ width: `${rangePct}%` }} />
                  <div className="range-marker" style={{ left: `${rangePct}%` }} />
                </div>
                <p className="range-caption">
                  Price sits {rangePct.toFixed(0)}% up from the 52-week low toward the high.
                </p>
              </div>
            )}
          </section>

          <section className="card card-analysis">
            <h3>Outlook</h3>
            <dl className="analysis-grid">
              <div>
                <dt>Trend</dt>
                <dd>{analysis.trend ?? "—"}</dd>
              </div>
              <div>
                <dt>Target buy zone</dt>
                <dd>{analysis.buyZone ?? "—"}</dd>
              </div>
              <div className="span-full">
                <dt>Reasoning</dt>
                <dd>{analysis.reasoning ?? analysis.raw}</dd>
              </div>
            </dl>
          </section>
        </main>
      )}

      <footer className="footer">
        {quote && (
          <p>
            <a
              href={`https://finance.yahoo.com/quote/${quote.ticker}`}
              target="_blank"
              rel="noreferrer"
            >
              {quote.ticker} on Yahoo Finance
            </a>
          </p>
        )}
      </footer>
    </div>
  );
}
