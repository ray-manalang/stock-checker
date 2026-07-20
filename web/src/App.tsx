import { FormEvent, useEffect, useState } from "react";
import {
  checkTicker,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  createAlert,
  getUsage,
  getRecentChecks,
  getQuotes,
  type Usage,
  type RecentCheck,
} from "./api";
import type { CheckResponse, Tone, Word } from "./types";
import { InfoTip } from "./components/InfoTip";
import { PriceChart } from "./components/PriceChart";
import { SegmentedControl } from "./components/SegmentedControl";
import { ProView } from "./ProView";
import { TickerTape } from "./TickerTape";
import { GLOSSARY } from "./lib/glossary";
import { money, num, pct, pointStr, type ChangeMode } from "./lib/format";

function toneClass(t: Tone): string {
  return t;
}

export default function App() {
  const [mode, setMode] = useState<"simple" | "pro">("simple");
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CheckResponse | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchInput, setWatchInput] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [recent, setRecent] = useState<RecentCheck[]>([]);
  // Show daily change as percent or dollar/point — persisted, shared by the
  // analysis card and the ticker tape.
  const [changeMode, setChangeMode] = useState<ChangeMode>(() =>
    localStorage.getItem("changeMode") === "abs" ? "abs" : "pct",
  );
  const toggleChangeMode = () =>
    setChangeMode((m) => {
      const next = m === "pct" ? "abs" : "pct";
      localStorage.setItem("changeMode", next);
      return next;
    });

  const refreshRecent = () => getRecentChecks().then(setRecent).catch(() => {});
  useEffect(() => {
    getWatchlist()
      .then((w) => setWatchlist(w.map((x) => x.ticker)))
      .catch(() => {});
    refreshRecent();
  }, []);

  const refreshUsage = () => getUsage().then(setUsage).catch(() => {});
  useEffect(() => {
    refreshUsage();
  }, []);
  // Re-pull usage after a check (a deep-dive may have spent tokens).
  useEffect(() => {
    if (data) refreshUsage();
  }, [data]);

  // Live-refresh the checked stock's price every minute (no page reload).
  const activeTicker = data?.quote.ticker;
  useEffect(() => {
    if (!activeTicker) return;
    let live = true;
    const tick = async () => {
      try {
        const q = (await getQuotes([activeTicker]))[activeTicker];
        if (!live || !q || q.price == null) return;
        setData((d) =>
          d && d.quote.ticker === activeTicker
            ? { ...d, quote: { ...d.quote, price: q.price!, changePct: q.changePct } }
            : d,
        );
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 60000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [activeTicker]);

  async function toggleWatch(sym: string) {
    const symbol = sym.toUpperCase();
    try {
      const next = watchlist.includes(symbol)
        ? await removeFromWatchlist(symbol)
        : await addToWatchlist(symbol);
      setWatchlist(next.map((x) => x.ticker));
    } catch {
      /* ignore */
    }
  }

  async function addWatch(sym: string) {
    const symbol = sym.trim().toUpperCase();
    if (!symbol || watchlist.includes(symbol)) return;
    try {
      const next = await addToWatchlist(symbol);
      setWatchlist(next.map((x) => x.ticker));
    } catch {
      /* ignore */
    }
  }

  async function makeAlert(sym: string, price: number) {
    try {
      await createAlert(sym.toUpperCase(), price);
      return true;
    } catch {
      return false;
    }
  }

  async function run(sym: string, opts: { fresh?: boolean } = {}) {
    const symbol = sym.trim().toUpperCase();
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await checkTicker(symbol, opts);
      setData(res);
      setTicker(symbol);
      refreshRecent();
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run(ticker);
  }

  return (
    <>
    <div className={`page${mode === "pro" ? " pro" : ""}`}>
      <nav className="nav">
        <div className="brand">
          Market Specialist<span className="dot">.</span>
        </div>
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: "simple", label: "Basic" },
            { value: "pro", label: "Pro" },
          ]}
        />
      </nav>

      <div className={mode === "pro" ? "pro-dashboard" : "check-wrap"}>
      {mode === "pro" && (
        <ProView changeMode={changeMode} onToggleChangeMode={toggleChangeMode} />
      )}

      <div className="check-col">
      <div className="check-tool">
      <form className="search" onSubmit={onSubmit}>
        <label htmlFor="ticker" className="sr-only">
          Ticker symbol
        </label>
        <input
          id="ticker"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Type a ticker — AAPL"
          autoComplete="off"
          spellCheck={false}
          disabled={loading}
        />
        <button className="btn-primary" disabled={loading || !ticker.trim()}>
          {loading ? (
            <span
              className="spinner"
              style={{
                width: 15,
                height: 15,
                borderColor: "rgba(0,0,0,0.25)",
                borderTopColor: "#000",
                verticalAlign: "-2px",
              }}
            />
          ) : (
            "Check"
          )}
        </button>
      </form>

      {recent.length > 0 && (
        <div className="chips" style={{ alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>
            Recently checked:
          </span>
          {recent.map((r) => (
            <button
              key={r.ticker}
              className="chip"
              onClick={() => run(r.ticker)}
              disabled={loading}
              title={r.verdictLabel ?? ""}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: `var(--${r.verdictTone ?? "neutral"}, var(--text-3))`,
                  display: "inline-block",
                }}
              />
              {r.ticker}
            </button>
          ))}
        </div>
      )}

      <div className="chips" style={{ alignItems: "center" }}>
        <span className="star" style={{ color: "var(--star)", alignSelf: "center", fontSize: 13 }}>
          ★ Watchlist:
        </span>
        {watchlist.map((t) => (
          <span key={t} className="chip" style={{ display: "inline-flex", gap: 8 }}>
            <button
              onClick={() => run(t)}
              style={{ background: "none", border: "none", color: "inherit", padding: 0 }}
            >
              {t}
            </button>
            <button
              onClick={() => toggleWatch(t)}
              aria-label={`Remove ${t}`}
              style={{ background: "none", border: "none", color: "var(--text-3)", padding: 0 }}
            >
              ×
            </button>
          </span>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addWatch(watchInput);
            setWatchInput("");
          }}
          style={{ display: "inline-flex", gap: 6 }}
        >
          <input
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value.toUpperCase())}
            placeholder="+ Add ticker"
            aria-label="Add a ticker to your watchlist"
            spellCheck={false}
            autoComplete="off"
            style={{
              width: 120,
              background: "var(--surface-2)",
              border: "1px solid var(--hairline-soft)",
              borderRadius: 999,
              color: "var(--text)",
              padding: "6px 13px",
              fontSize: 13,
              letterSpacing: "0.03em",
              outline: "none",
            }}
          />
          {watchInput.trim() && (
            <button type="submit" className="chip" style={{ color: "var(--accent)" }}>
              Add
            </button>
          )}
        </form>
      </div>
      </div>{/* check-tool */}

      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="skeleton">
          <span className="spinner" /> &nbsp;Reading the market…
        </div>
      )}

      {data && (
        <AnswerCard
          data={data}
          onRefresh={() => run(data.quote.ticker)}
          onFresh={() => run(data.quote.ticker, { fresh: true })}
          loading={loading}
          watched={watchlist.includes(data.quote.ticker)}
          onToggleWatch={() => toggleWatch(data.quote.ticker)}
          onCreateAlert={(price) => makeAlert(data.quote.ticker, price)}
          changeMode={changeMode}
          onToggleChangeMode={toggleChangeMode}
        />
      )}

      {usage?.llm && (
        <div
          className="center muted"
          style={{ marginTop: 40, fontSize: 12, color: "var(--text-3)" }}
        >
          Claude usage this month: ${usage.cost.toFixed(2)} · {usage.calls}{" "}
          {usage.calls === 1 ? "call" : "calls"}
        </div>
      )}
      </div>{/* check-col */}
      </div>{/* pro-dashboard / check-wrap */}
    </div>
    <TickerTape
      watchlist={watchlist}
      changeMode={changeMode}
      onToggleChangeMode={toggleChangeMode}
    />
    </>
  );
}

function AnswerCard({
  data,
  onRefresh,
  onFresh,
  loading,
  watched,
  onToggleWatch,
  onCreateAlert,
  changeMode,
  onToggleChangeMode,
}: {
  data: CheckResponse;
  onRefresh: () => void;
  onFresh: () => void;
  loading: boolean;
  watched: boolean;
  onToggleWatch: () => void;
  onCreateAlert: (price: number) => Promise<boolean>;
  changeMode: ChangeMode;
  onToggleChangeMode: () => void;
}) {
  const { quote, verdict, glance, indicators, buyZone, analysis } = data;
  const changeUp = (quote.changePct ?? 0) >= 0;
  const rangePct = indicators.pctOfRange ?? 50;

  const [alertOpen, setAlertOpen] = useState(false);
  const [alertPrice, setAlertPrice] = useState(() =>
    buyZone ? String(buyZone.low) : quote.price ? (quote.price * 0.95).toFixed(2) : "",
  );
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  async function submitAlert() {
    const price = Number(alertPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    const ok = await onCreateAlert(price);
    setAlertMsg(ok ? `Alert set — we'll flag ${quote.ticker} at $${price}.` : "Couldn't set alert.");
    if (ok) setAlertOpen(false);
  }

  return (
    <>
      <section className="answer">
        <div className="answer-head">
          <div>
            <a
              className="ticker ticker-link"
              href={`https://finance.yahoo.com/quote/${encodeURIComponent(quote.ticker)}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${quote.ticker} on Yahoo Finance`}
            >
              {quote.ticker}
            </a>
            <div className="name">{quote.name}</div>
          </div>
          <div className="answer-price">
            <span className="px">{money(quote.price, quote.currency)}</span>
            {quote.changePct != null && (
              <button
                className={`chg chg-toggle ${changeUp ? "up" : "down"}`}
                onClick={onToggleChangeMode}
                title="Toggle percent / dollar change"
              >
                {changeMode === "pct"
                  ? pct(quote.changePct)
                  : pointStr(quote.price, quote.changePct, quote.currency)}
              </button>
            )}
          </div>
        </div>

        <div className="verdict">
          <div className={`label ${toneClass(verdict.tone)}`}>{verdict.label}</div>
          <div className="why">{data.why}</div>
          <div className="confidence" style={{ color: `var(--${verdict.tone})` }}>
            <div className="bars">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className={`bar ${n <= data.confidence ? "on" : ""}`} />
              ))}
            </div>
            <span className="txt">Confidence</span>
          </div>
        </div>

        <div className="glance">
          <GlanceCell k="Timing" word={glance.timing} info="timing" />
          <GlanceCell k="Quality" word={glance.quality} info="quality" />
          <GlanceCell k="Price" word={glance.price} info="price" />
        </div>

        <div className="pricepos">
          <div className="track">
            <div className="marker" style={{ left: `${rangePct}%` }} />
          </div>
          <div className="ends">
            <span>{money(quote.low52, quote.currency)}</span>
            <span>{money(quote.high52, quote.currency)}</span>
          </div>
          <div className="cap">
            Where today's price sits vs the past year{" "}
            <InfoTip
              title={GLOSSARY.pricepos.title}
              text={GLOSSARY.pricepos.text}
              label="price position"
            />
          </div>
        </div>

        <div className="actions">
          <button className="btn-ghost btn-sm" onClick={onToggleWatch}>
            {watched ? "★ On watchlist" : "☆ Save to watchlist"}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => setAlertOpen((v) => !v)}>
            🔔 Alert me at a price
          </button>
        </div>

        {alertOpen && (
          <div className="actions" style={{ marginTop: 12, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 14 }}>
              Alert me when {quote.ticker} drops to
            </span>
            <input
              value={alertPrice}
              onChange={(e) => setAlertPrice(e.target.value)}
              inputMode="decimal"
              style={{
                width: 110,
                background: "var(--surface-2)",
                border: "1px solid var(--hairline)",
                borderRadius: 10,
                color: "var(--text)",
                padding: "8px 12px",
                fontVariantNumeric: "tabular-nums",
              }}
            />
            <button className="btn-primary btn-sm" onClick={submitAlert}>
              Set alert
            </button>
          </div>
        )}
        {alertMsg && (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {alertMsg}
          </p>
        )}

        <div className="freshness">
          <span className="live">●</span>
          <span>
            Price live · analysis{" "}
            {data.llm
              ? data.cached
                ? "by Claude (cached this quarter)"
                : "by Claude"
              : "from the numbers"}{" "}
            · as of{" "}
            {new Date(data.asOf).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <button onClick={onRefresh} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
          <button onClick={onFresh} disabled={loading} title="Run a live Claude deep-dive">
            Fresh deep-dive
          </button>
        </div>
      </section>

      <WhyExpander data={data} />

      <details className="exp">
        <summary>
          Show the details <span className="caret">⌄</span>
        </summary>
        <div className="exp-body">
          <PriceChart
            timestamps={data.series.timestamp}
            closes={data.series.close}
            buyZone={buyZone}
            currency={quote.currency}
          />
          <div className="metrics">
            <Metric k="Momentum" info="momentum" v={momentumWord(indicators.rsi14)} />
            <Metric k="Trend" info="trend" v={glance.trend.word} />
            <Metric k="Ups & downs" info="updowns" v={glance.volatility.word} />
            <Metric k="From its high" info="fromhigh" v={glance.drawdown.word} />
          </div>
          {analysis && (
            <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
              Fundamental quality: <strong>{analysis.fundamental_score}/10</strong> ·
              growth {analysis.dimensions.growth}, profitability{" "}
              {analysis.dimensions.profitability}, balance sheet{" "}
              {analysis.dimensions.balance_sheet}, valuation{" "}
              {analysis.dimensions.valuation}, moat {analysis.dimensions.moat}
            </p>
          )}
          {!analysis && (
            <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
              A Claude deep-dive (bull/bear + quality score) appears here when an
              ANTHROPIC_API_KEY is configured.
            </p>
          )}
        </div>
      </details>
    </>
  );
}

function WhyExpander({ data }: { data: CheckResponse }) {
  const a = data.analysis;
  const inFavor = a?.bull ?? deterministicFavor(data);
  const watchOut = a?.bear ?? deterministicWatch(data);
  const plan = a?.invalidation ?? deterministicPlan(data);
  return (
    <details className="exp" open>
      <summary>
        Why this call? <span className="caret">⌄</span>
      </summary>
      <div className="exp-body">
        <div className="reason">
          <div className="rk up">In its favor</div>
          <div className="rv">
            <ul>
              {inFavor.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="reason">
          <div className="rk warn">Watch out</div>
          <div className="rv">
            <ul>
              {watchOut.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="reason">
          <div className="rk accent">A good plan</div>
          <div className="rv">{plan}</div>
        </div>
      </div>
    </details>
  );
}

function GlanceCell({ k, word, info }: { k: string; word: Word; info: string }) {
  const g = GLOSSARY[info];
  return (
    <div className="glance-cell">
      <div className="k">
        {k} <InfoTip title={g.title} text={g.text} label={k} />
      </div>
      <div className={`v ${word.tone}`}>{word.word}</div>
    </div>
  );
}

function Metric({ k, v, info }: { k: string; v: string; info: string }) {
  const g = GLOSSARY[info];
  return (
    <div className="metric">
      <div className="mk">
        {k} <InfoTip title={g.title} text={g.text} label={k} />
      </div>
      <div className="mv">{v}</div>
    </div>
  );
}

function momentumWord(rsi: number | null): string {
  if (rsi == null) return "—";
  return `${num(rsi, 0)} (${rsi >= 70 ? "hot" : rsi <= 30 ? "cold" : "neutral"})`;
}

// Deterministic "Why this call?" content when no LLM deep-dive is present.
function deterministicFavor(d: CheckResponse): string[] {
  const out: string[] = [];
  if (d.glance.trend.word === "Pointing up") out.push("The price trend is pointing up.");
  if (d.glance.price.word === "Looks cheap")
    out.push("It trades near the low end of its past-year range.");
  if (d.glance.volatility.word === "Calm") out.push("Day-to-day moves are calm.");
  if (!out.length) out.push("Nothing stands out as strongly in its favor right now.");
  return out;
}
function deterministicWatch(d: CheckResponse): string[] {
  const out: string[] = [];
  if (d.glance.trend.word === "Pointing down") out.push("The price trend is pointing down.");
  if (d.glance.price.word === "Looks pricey")
    out.push("It trades near the high end of its past-year range.");
  if (d.glance.timing.word === "Running hot")
    out.push("It has run hot recently — a pullback is possible.");
  if (d.glance.volatility.word === "Bumpy") out.push("Moves are bumpy — expect swings.");
  if (!out.length) out.push("No major red flags in the price data.");
  return out;
}
function deterministicPlan(d: CheckResponse): string {
  if (!d.buyZone) return "Wait for a clearer setup before buying.";
  return `Consider buying near ${money(d.buyZone.low, d.quote.currency)}–${money(
    d.buyZone.high,
    d.quote.currency,
  )} rather than chasing the current price.`;
}
