import { FormEvent, useEffect, useState } from "react";
import {
  checkTicker,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  createAlert,
  getUsage,
  getRecentChecks,
  getSettings,
  updateSettings,
  getHoldings,
  logout,
  createInvite,
  type Usage,
  type RecentCheck,
  type RiskTolerance,
  type Portfolio,
  type AuthUser,
} from "./api";
import { useLivePrices } from "./livePrices";
import type { CheckResponse, Tone, Word } from "./types";
import { InfoTip } from "./components/InfoTip";
import { PriceChart } from "./components/PriceChart";
import { ClearableInput } from "./components/ClearableInput";
import { ProView } from "./ProView";
import { TickerTape } from "./TickerTape";
import { WatchingToBuy } from "./WatchingToBuy";
import { AlertsPanel } from "./AlertsPanel";
import { BacktestCard } from "./BacktestCard";
import { HoldingsPage } from "./HoldingsPage";
import { ProfilePage } from "./ProfilePage";
import { GuidePage } from "./GuidePage";
import { SupportButton } from "./components/SupportButton";
import { GLOSSARY } from "./lib/glossary";
import { money, num, pct, pointStr, type ChangeMode } from "./lib/format";
import { useCollapsed } from "./lib/useCollapsed";

function toneClass(t: Tone): string {
  return t;
}

type View = "main" | "research" | "holdings" | "profile" | "guide";

type AppProps = {
  user: AuthUser;
  onLogout: () => void;
  onUser: (u: AuthUser) => void;
};

export default function App({ user, onLogout, onUser }: AppProps) {
  const isAdmin = user.role === "admin";
  const [view, setView] = useState<View>("main");
  const [risk, setRisk] = useState<RiskTolerance>("balanced");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [blur, setBlur] = useState(() => localStorage.getItem("blurAmounts") === "1");
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CheckResponse | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchInput, setWatchInput] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [recent, setRecent] = useState<RecentCheck[]>([]);
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
  const refreshWatchlist = () =>
    getWatchlist()
      .then((w) => setWatchlist(w.map((x) => x.ticker)))
      .catch(() => {});
  useEffect(() => {
    refreshWatchlist();
    refreshRecent();
  }, []);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setRisk(s.riskTolerance);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sym = new URLSearchParams(window.location.search).get("check");
    if (sym) {
      setView("research");
      setTicker(sym.toUpperCase());
      run(sym);
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeRisk(next: RiskTolerance) {
    setRisk(next);
    try {
      await updateSettings({ riskTolerance: next });
      if (data) run(data.quote.ticker);
    } catch {
      /* ignore */
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      /* ignore */
    }
    onLogout();
  }

  async function copyInviteLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2500);
    } catch {
      setInviteCopied(false);
    }
  }

  async function handleInvite() {
    try {
      const inv = await createInvite(14);
      setInviteUrl(inv.url);
      setInviteCopied(false);
      await copyInviteLink(inv.url);
    } catch (err) {
      setInviteUrl(err instanceof Error ? err.message : "Invite failed");
      setInviteCopied(false);
    }
  }

  function toggleBlur() {
    setBlur((b) => {
      const next = !b;
      localStorage.setItem("blurAmounts", next ? "1" : "0");
      return next;
    });
  }

  const refreshUsage = () => {
    getUsage().then(setUsage).catch(() => setUsage(null));
  };
  useEffect(() => {
    refreshUsage();
  }, []);
  useEffect(() => {
    if (data) refreshUsage();
  }, [data]);

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
    <div className={`page${blur ? " blur-amounts" : ""}`}>
      <nav className="nav">
        <div className="brand">
          Market Specialist<span className="dot">.</span>
        </div>
        <div className="nav-links">
          <button
            className={`nav-link${view === "main" ? " active" : ""}`}
            onClick={() => setView("main")}
          >
            Home
          </button>
          <button
            className={`nav-link${view === "research" ? " active" : ""}`}
            onClick={() => setView("research")}
          >
            Research
          </button>
          <button
            className={`nav-link${view === "holdings" ? " active" : ""}`}
            onClick={() => setView("holdings")}
          >
            Holdings
          </button>
          <button
            className={`nav-link${view === "profile" ? " active" : ""}`}
            onClick={() => setView("profile")}
          >
            Profile
          </button>
          <button
            className={`nav-link${view === "guide" ? " active" : ""}`}
            onClick={() => setView("guide")}
          >
            Guide
          </button>
          <button
            className="nav-link"
            onClick={toggleBlur}
            title={blur ? "Show dollar amounts" : "Hide dollar amounts"}
          >
            {blur ? "Show $" : "Hide $"}
          </button>
          {isAdmin && (
            <button className="nav-link" type="button" onClick={handleInvite} title="Copy invite link">
              Invite
            </button>
          )}
          <button
            className="nav-link"
            type="button"
            onClick={() => setView("profile")}
            title={user.username}
          >
            {user.username}
          </button>
          <button className="nav-link" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </nav>
      {inviteUrl && (
        <p className="invite-banner" role="status">
          {inviteUrl.startsWith("http") ? (
            <>
              Invite link:{" "}
              <a
                href={inviteUrl}
                className="invite-link"
                title="Click to copy"
                onClick={(e) => {
                  e.preventDefault();
                  void copyInviteLink(inviteUrl);
                }}
              >
                {inviteUrl}
              </a>
              <button
                type="button"
                className="invite-copy-btn"
                onClick={() => void copyInviteLink(inviteUrl)}
              >
                {inviteCopied ? "Copied" : "Copy"}
              </button>
            </>
          ) : (
            inviteUrl
          )}
        </p>
      )}

      {view === "holdings" && <HoldingsPage onBack={() => setView("main")} />}
      {view === "profile" && (
        <ProfilePage user={user} onUser={onUser} onDeleted={onLogout} />
      )}
      {view === "guide" && <GuidePage usage={usage} />}

      {/* Research — the ticker check tool (search, recents, watchlist, answer) */}
      <div className="check-col" style={{ display: view === "research" ? undefined : "none" }}>
      {usage?.budget && !usage.budget.deepAllowed && (
        <p className="budget-banner" role="status">
          Shared daily Claude budget (${usage.budget.dailyUsd.toFixed(2)}) reached — new
          deep-dives are paused until tomorrow (UTC). Numbers-only checks still work.
          {usage.support?.url && (
            <>
              {" "}
              <SupportButton
                url={usage.support.url}
                label={usage.support.label}
                tooltip={usage.support.tooltip}
                className="support-btn-inline"
              />
            </>
          )}
        </p>
      )}
      <div className="check-tool">
      <form className="search" onSubmit={onSubmit}>
        <label htmlFor="ticker" className="sr-only">
          Ticker symbol
        </label>
        <ClearableInput
          id="ticker"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onClear={() => setTicker("")}
          placeholder="Type a ticker — AAPL"
          autoComplete="off"
          spellCheck={false}
          disabled={loading}
          wrapperStyle={{ flex: 1 }}
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
          <ClearableInput
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value.toUpperCase())}
            onClear={() => setWatchInput("")}
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

      {/* Watchlist-driven cards live with the watchlist, on Research */}
      <WatchingToBuy onOpen={(t) => run(t)} />

      <AlertsPanel />

      {/* Track record — a low-frequency credibility stat, tucked at the bottom */}
      <BacktestCard />

      {usage?.llm && (
        <div
          className="center muted"
          style={{ marginTop: 40, fontSize: 12, color: "var(--text-3)" }}
        >
          Claude usage this month: ${usage.cost.toFixed(2)} · {usage.calls}{" "}
          {usage.calls === 1 ? "call" : "calls"}
          {usage.budget && (
            <>
              {" "}
              · site today ${Number(usage.budget.siteTodayCost).toFixed(2)} / $
              {usage.budget.dailyUsd.toFixed(2)}
            </>
          )}
          {usage.support?.url && (
            <>
              {" · "}
              <SupportButton
                url={usage.support.url}
                label="Tip jar"
                tooltip={usage.support.tooltip}
                className="support-btn-link"
              />
            </>
          )}
        </div>
      )}
      </div>{/* check-col (research) */}

      {/* Home dashboard */}
      <div className="pro-dashboard" style={{ display: view === "main" ? undefined : "none" }}>
      <HoldingsTeaser onOpen={() => setView("holdings")} />

      <ProView
        changeMode={changeMode}
        onToggleChangeMode={toggleChangeMode}
        risk={risk}
        onRiskChange={changeRisk}
        canRefresh={isAdmin}
      />
      </div>{/* pro-dashboard (home) */}
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
  // Live price from the shared store so the card stays in sync with the tape.
  const lq = useLivePrices([quote.ticker])[quote.ticker];
  const price = lq?.price ?? quote.price;
  const changePct = lq?.changePct ?? quote.changePct;
  const changeUp = (changePct ?? 0) >= 0;
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
            <span className="px">{money(price, quote.currency)}</span>
            {changePct != null && (
              <button
                className={`chg chg-toggle ${changeUp ? "up" : "down"}`}
                onClick={onToggleChangeMode}
                title="Toggle percent / dollar change"
              >
                {changeMode === "pct"
                  ? pct(changePct)
                  : pointStr(price, changePct, quote.currency)}
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
            <ClearableInput
              value={alertPrice}
              onChange={(e) => setAlertPrice(e.target.value)}
              onClear={() => setAlertPrice("")}
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
          {data.dividendYield != null && data.dividendYield > 0 && (
            <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
              Dividend yield: <strong>{(data.dividendYield * 100).toFixed(2)}%</strong>{" "}
              <InfoTip
                title="Dividend yield"
                text="The annual dividend as a percent of the current price. A steadier income stream that matters more to long-term holders than to short-term traders."
                label="dividend yield"
              />
            </p>
          )}
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

// Home-page holdings teaser — a two-cell summary that links to the full page.
function HoldingsTeaser({ onOpen }: { onOpen: () => void }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, toggle] = useCollapsed("holdingsTeaserCollapsed");
  useEffect(() => {
    let live = true;
    getHoldings()
      .then((r) => live && setPortfolio(r.data))
      .catch(() => {})
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const has = portfolio && portfolio.count > 0;
  return (
    <div className="insight-card">
      <div className="insight-head">
        <button
          className="collapse-btn"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <span className="chev">{collapsed ? "▸" : "▾"}</span>
          <h3>Your holdings</h3>
        </button>
        <button className="btn-ghost btn-sm" onClick={onOpen}>
          {has ? "View holdings →" : "Import →"}
        </button>
      </div>
      {!collapsed &&
        (has ? (
        <div className="insight-cells" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          <div className="insight-cell">
            <div className="label">Total value</div>
            <div className="val sensitive">{money(portfolio!.totalValue)}</div>
          </div>
          <div className="insight-cell">
            <div className="label">Unrealized</div>
            <div className={`val sensitive ${(portfolio!.unrealized ?? 0) >= 0 ? "up" : "down"}`}>
              {portfolio!.unrealized == null
                ? "—"
                : `${portfolio!.unrealized >= 0 ? "+" : "−"}${money(Math.abs(portfolio!.unrealized))}`}
            </div>
          </div>
        </div>
        ) : (
          <div className="insight-foot" style={{ paddingTop: 6 }}>
            {ready
              ? "See what you own alongside the verdicts — import an aggregated positions CSV to personalize the app."
              : "Loading…"}
          </div>
        ))}
    </div>
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
