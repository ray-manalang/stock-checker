import { useCallback, useEffect, useRef, useState } from "react";
import { InfoTip } from "./components/InfoTip";
import { refreshLayer } from "./api";
import { GLOSSARY } from "./lib/glossary";
import { money, num } from "./lib/format";

type Envelope<T> = { data: T; asOf: string; stale?: boolean };
type BlendSummary = {
  candidates: number;
  upgrades: number;
  downgrades: number;
  avgBlended: number;
  top5: string[];
};
type ScannerEnv = Envelope<ScannerRow[]> & {
  macroMode?: string;
  scannerActive?: boolean;
  blended?: boolean;
  summary?: BlendSummary | null;
};
type AnalystDetail = {
  dimensions: Record<string, number> | null;
  notes: string | null;
  fundamentalScore: number | null;
  model?: string | null;
};

type MacroSignal = { signal: string; score: number; detail?: string };
type Macro = {
  composite: number;
  zone: string;
  sizingPct: number;
  scannerActive: boolean;
  oneLiner: string;
  signals: MacroSignal[];
};
type ScannerRow = {
  ticker: string;
  name?: string | null;
  composite: number;
  rank: number;
  quantRank?: number;
  rankDelta?: number;
  rankFlag?: string;
  blendedScore?: number;
  price?: number | null;
  changePct?: number | null;
  analyst?: AnalystDetail | null;
};

const DIM_LABELS: Record<string, string> = {
  earnings_quality: "Earnings quality",
  growth_trajectory: "Growth",
  balance_sheet_health: "Balance sheet",
  margin_trends: "Margins",
  red_flags: "Red flags (inv.)",
  growth: "Growth",
  profitability: "Profitability",
  balance_sheet: "Balance sheet",
  valuation: "Valuation",
  moat: "Moat",
};
const dimLabel = (k: string) =>
  DIM_LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const ZONE_TONE: Record<string, string> = {
  "FULL DEPLOY": "up",
  REDUCED: "warn",
  DEFENSIVE: "down",
};

// Map each macro signal name to its glossary entry.
const SIGNAL_KEY: Record<string, string> = {
  "VIX Level": "sigVixLevel",
  "VIX Term Structure": "sigVixTerm",
  "Market Breadth": "sigBreadth",
  "Credit Spreads": "sigCredit",
  "Put/Call Sentiment": "sigPutCall",
  "Factor Crowding": "sigCrowding",
};

function agoLabel(iso?: string): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ProView() {
  const [macro, setMacro] = useState<Envelope<Macro> | null>(null);
  const [scanner, setScanner] = useState<ScannerEnv | null>(null);
  const [macroReady, setMacroReady] = useState(false);
  const [scanReady, setScanReady] = useState(false);
  const [refreshing, setRefreshing] = useState<{ macro?: boolean; scanner?: boolean; analyst?: boolean }>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const liveRef = useRef(true);

  const toggleRow = (ticker: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(ticker) ? next.delete(ticker) : next.add(ticker);
      return next;
    });

  const loadMacro = useCallback(async () => {
    const j = await fetch("/api/macro").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (liveRef.current) setMacro(j);
    return j as Envelope<Macro> | null;
  }, []);

  const loadScanner = useCallback(async () => {
    const j = await fetch("/api/scanner").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (liveRef.current) setScanner(j);
    return j as ScannerEnv | null;
  }, []);

  useEffect(() => {
    liveRef.current = true;
    loadMacro().finally(() => liveRef.current && setMacroReady(true));
    loadScanner().finally(() => liveRef.current && setScanReady(true));
    // Poll in the background so the cards pick up any completed job (a manual
    // refresh, the boot compute, or a scheduled run) without a page reload.
    const id = setInterval(() => {
      loadMacro();
      loadScanner();
    }, 30000);
    return () => {
      liveRef.current = false;
      clearInterval(id);
    };
  }, [loadMacro, loadScanner]);

  // Kick a background recompute, then poll the read endpoint until its "as of"
  // stamp changes (or we give up). Scanner can take minutes on first run.
  async function refresh(layer: "macro" | "scanner" | "analyst") {
    // Macro & scanner restamp their read endpoint; analyst blends into the
    // scanner feed, so we poll /api/scanner and watch for the blend to appear.
    const load = layer === "macro" ? loadMacro : loadScanner;
    const prevAsOf = (layer === "macro" ? macro : scanner)?.asOf;
    const alreadyBlended = !!scanner?.blended;
    // Windows sized to each job (Twelve Data paces at 8/min; analyst uses the
    // async Message Batch API).
    const attempts = layer === "macro" ? 60 : 80; // ~5 min / ~20 min
    const interval = layer === "macro" ? 5000 : 15000;
    const done = (j: (ScannerEnv & Envelope<Macro>) | null) => {
      if (layer === "analyst") return !alreadyBlended && !!j?.blended;
      return !!j?.asOf && j.asOf !== prevAsOf;
    };
    setRefreshing((s) => ({ ...s, [layer]: true }));
    try {
      await refreshLayer(layer);
      for (let i = 0; i < attempts && liveRef.current; i++) {
        await sleep(interval);
        const j = (await load()) as (ScannerEnv & Envelope<Macro>) | null;
        if (done(j)) break;
      }
    } catch {
      /* ignore */
    } finally {
      if (liveRef.current) setRefreshing((s) => ({ ...s, [layer]: false }));
    }
  }

  const m = macro?.data;
  const rows = scanner?.data ?? [];
  const summary = scanner?.summary ?? null;
  const upgrades = rows.filter((r) => r.rankFlag === "upgrade");
  const downgrades = rows.filter((r) => r.rankFlag === "downgrade");

  return (
    <div className="pro-grid">
      {/* Market conditions */}
      <div className="insight-card">
        <div className="insight-head">
          <div>
            <h3>
              Market conditions{" "}
              <InfoTip title={GLOSSARY.macro.title} text={GLOSSARY.macro.text} label="market conditions" />
            </h3>
            <div className="subtitle">
              {m ? m.oneLiner : "The macro gate scores the whole market's risk backdrop."}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {m && <span className={`pill ${ZONE_TONE[m.zone] ?? "accent"}`}>{m.zone}</span>}
            <RefreshBtn onClick={() => refresh("macro")} busy={!!refreshing.macro} />
          </div>
        </div>
        <div className="insight-divider" />
        {m ? (
          <>
            <div className="insight-cells">
              <div className="insight-cell">
                <div className="label">
                  Deploy score{" "}
                  <InfoTip title={GLOSSARY.deployScore.title} text={GLOSSARY.deployScore.text} label="deploy score" />
                </div>
                <div className="val hl">{num(m.composite, 0)}</div>
              </div>
              <div className="insight-cell">
                <div className="label">
                  Sizing{" "}
                  <InfoTip title={GLOSSARY.sizing.title} text={GLOSSARY.sizing.text} label="sizing" />
                </div>
                <div className="val">{m.sizingPct}%</div>
              </div>
              <div className="insight-cell">
                <div className="label">
                  Scanner{" "}
                  <InfoTip title={GLOSSARY.scannerState.title} text={GLOSSARY.scannerState.text} label="scanner" />
                </div>
                <div className="val">{m.scannerActive ? "On" : "Off"}</div>
              </div>
            </div>
            <div className="sig-grid">
              {m.signals.map((s) => {
                const g = GLOSSARY[SIGNAL_KEY[s.signal]];
                const text = g ? (s.detail ? `${g.text} Now: ${s.detail}.` : g.text) : s.detail ?? "";
                return (
                  <div className="sig" key={s.signal}>
                    <span className="sn">
                      {s.signal}{" "}
                      {g && <InfoTip title={g.title} text={text} label={s.signal} />}
                    </span>
                    <span className="ss">{num(s.score, 0)}</span>
                  </div>
                );
              })}
            </div>
            <div className="insight-foot">
              updated {agoLabel(macro?.asOf)} · loads instantly
            </div>
          </>
        ) : (
          <div className="insight-foot" style={{ padding: "18px" }}>
            {macroReady
              ? refreshing.macro
                ? "Computing market conditions…"
                : "No reading yet — hit Refresh to score market conditions."
              : "Loading…"}
          </div>
        )}
      </div>

      {/* Top-ranked stocks */}
      <div className="insight-card">
        <div className="insight-head">
          <div>
            <h3>Top-ranked stocks</h3>
            <div className="subtitle">Quant scanner across the largest US names.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {rows.length > 0 && (
              <span className="subtitle">ranked {agoLabel(scanner?.asOf)}</span>
            )}
            <RefreshBtn onClick={() => refresh("scanner")} busy={!!refreshing.scanner} />
            <RefreshBtn
              onClick={() => refresh("analyst")}
              busy={!!refreshing.analyst}
              label="Analyst"
              title="Score fundamentals with Claude and blend into the ranking"
            />
          </div>
        </div>
        {refreshing.scanner && (
          <div className="insight-foot" style={{ paddingTop: 4 }}>
            Rescanning… this can take a few minutes.
          </div>
        )}
        {refreshing.analyst && (
          <div className="insight-foot" style={{ paddingTop: 4 }}>
            Scoring fundamentals with Claude… this can take a few minutes.
          </div>
        )}
        <div className="insight-divider" />

        {/* L3 analyst summary + disagreements (only once fundamentals are blended in) */}
        {scanner?.blended && summary && (
          <>
            <div className="insight-cells">
              <div className="insight-cell">
                <div className="label">Candidates</div>
                <div className="val">{summary.candidates}</div>
              </div>
              <div className="insight-cell">
                <div className="label">Upgrades</div>
                <div className="val up">{summary.upgrades}</div>
              </div>
              <div className="insight-cell">
                <div className="label">Downgrades</div>
                <div className="val down">{summary.downgrades}</div>
              </div>
              <div className="insight-cell">
                <div className="label">Avg blended</div>
                <div className="val">{summary.avgBlended.toFixed(2)}</div>
              </div>
            </div>
            {(upgrades.length > 0 || downgrades.length > 0) && (
              <div style={{ padding: "0 18px 14px" }}>
                <div
                  className="subtitle"
                  style={{ marginBottom: 8, color: "var(--text-2)" }}
                >
                  Quant vs analyst disagreements (rank shift ≥ 3)
                </div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13 }}>
                  <Disagreement rows={upgrades} tone="up" arrow="▲" empty="No upgrades" />
                  <Disagreement rows={downgrades} tone="down" arrow="▼" empty="No downgrades" />
                </div>
              </div>
            )}
            <div className="insight-divider" />
          </>
        )}

        {rows.length > 0 ? (
          <div
            className="rows"
            style={{ border: "none", borderRadius: 0, maxHeight: 460, overflowY: "auto" }}
          >
            {rows.slice(0, 20).map((r) => {
              const hasDetail = !!r.analyst;
              const open = expanded.has(r.ticker);
              return (
                <div key={r.ticker}>
                  <div
                    className="s-row"
                    onClick={hasDetail ? () => toggleRow(r.ticker) : undefined}
                    style={{ cursor: hasDetail ? "pointer" : "default" }}
                  >
                    <span className="s-rank">{r.rank}</span>
                    <span className="s-main">
                      <span className="s-name">
                        <a
                          href={`https://finance.yahoo.com/quote/${r.ticker}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: "var(--text)", textDecoration: "none" }}
                        >
                          {r.ticker}
                        </a>
                        {r.rankFlag === "upgrade" && (
                          <span className="pill up" style={{ marginLeft: 8, fontSize: 11 }}>
                            ▲ upgrade
                          </span>
                        )}
                        {r.rankFlag === "downgrade" && (
                          <span className="pill down" style={{ marginLeft: 8, fontSize: 11 }}>
                            ▼ downgrade
                          </span>
                        )}
                        {hasDetail && (
                          <span className="caret" style={{ marginLeft: 8, color: "var(--text-3)", fontSize: 12 }}>
                            {open ? "▴" : "▾"}
                          </span>
                        )}
                      </span>
                      {r.name && <span className="s-sub">{r.name}</span>}
                    </span>
                    <span className="s-meta">
                      <span className="s-px">{money(r.price, "USD")}</span>
                      {r.changePct != null ? (
                        <span className={`s-chg ${r.changePct >= 0 ? "up" : "down"}`}>
                          {r.changePct >= 0 ? "▲" : "▼"} {Math.abs(r.changePct).toFixed(2)}%
                        </span>
                      ) : (
                        <span className="s-chg" style={{ color: "var(--text-3)" }}>
                          score {num(r.composite, 0)}
                        </span>
                      )}
                    </span>
                  </div>
                  {open && r.analyst && <AnalystPanel row={r} />}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="insight-foot" style={{ padding: "18px" }}>
            {scanReady
              ? scanner?.scannerActive === false
                ? "Scanner is off — market conditions are defensive (no new longs)."
                : refreshing.scanner
                  ? "Building the first ranking…"
                  : "No ranking yet — hit Refresh to run the scanner."
              : "Loading…"}
          </div>
        )}
      </div>
    </div>
  );
}

function Disagreement({
  rows,
  tone,
  arrow,
  empty,
}: {
  rows: ScannerRow[];
  tone: "up" | "down";
  arrow: string;
  empty: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {empty}
        </div>
      ) : (
        rows
          .slice()
          .sort((a, b) => Math.abs(b.rankDelta ?? 0) - Math.abs(a.rankDelta ?? 0))
          .map((r) => (
            <div key={r.ticker} style={{ padding: "2px 0" }}>
              <span className={tone} style={{ fontWeight: 700 }}>
                {arrow} {r.ticker}
              </span>{" "}
              <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                #{r.quantRank} → #{r.rank} (Δ{(r.rankDelta ?? 0) > 0 ? "+" : ""}
                {r.rankDelta})
              </span>
            </div>
          ))
      )}
    </div>
  );
}

function AnalystPanel({ row }: { row: ScannerRow }) {
  const a = row.analyst!;
  return (
    <div
      style={{
        padding: "12px 16px 16px 54px",
        borderBottom: "1px solid var(--hairline-soft)",
        background: "var(--surface-2)",
      }}
    >
      {a.dimensions && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", marginBottom: 10 }}>
          {Object.entries(a.dimensions).map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>{dimLabel(k)}</div>
              <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {v}/10
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 13, marginBottom: a.notes ? 8 : 0 }}>
        Fundamental score:{" "}
        <strong>{a.fundamentalScore != null ? `${a.fundamentalScore}/10` : "—"}</strong>
        {row.rankDelta != null && (
          <span className="muted">
            {" · "}quant #{row.quantRank} → blended #{row.rank} (Δ
            {row.rankDelta > 0 ? "+" : ""}
            {row.rankDelta})
          </span>
        )}
      </div>
      {a.notes && (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-2)",
            borderLeft: "3px solid var(--accent)",
            paddingLeft: 12,
          }}
        >
          {a.notes}
        </div>
      )}
    </div>
  );
}

function RefreshBtn({
  onClick,
  busy,
  label = "Refresh",
  title = "Recompute now",
}: {
  onClick: () => void;
  busy: boolean;
  label?: string;
  title?: string;
}) {
  return (
    <button
      className="btn-ghost btn-sm"
      onClick={onClick}
      disabled={busy}
      title={title}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {busy ? <span className="spinner" style={{ width: 13, height: 13 }} /> : "↻"} {label}
    </button>
  );
}
