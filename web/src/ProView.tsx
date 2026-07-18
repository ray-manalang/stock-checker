import { useCallback, useEffect, useRef, useState } from "react";
import { InfoTip } from "./components/InfoTip";
import { refreshLayer } from "./api";
import { GLOSSARY } from "./lib/glossary";
import { money, num } from "./lib/format";

type Envelope<T> = { data: T; asOf: string; stale?: boolean };
type ScannerEnv = Envelope<ScannerRow[]> & { macroMode?: string; scannerActive?: boolean };

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
  rankFlag?: string;
  blendedScore?: number;
  price?: number | null;
  changePct?: number | null;
};

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
  const [refreshing, setRefreshing] = useState<{ macro?: boolean; scanner?: boolean }>({});
  const liveRef = useRef(true);

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
  async function refresh(layer: "macro" | "scanner") {
    const prevAsOf = (layer === "macro" ? macro : scanner)?.asOf;
    const load = layer === "macro" ? loadMacro : loadScanner;
    // Windows sized to the first-run compute (Twelve Data paces at 8/min).
    const attempts = layer === "macro" ? 60 : 80; // ~5 min / ~20 min
    setRefreshing((s) => ({ ...s, [layer]: true }));
    try {
      await refreshLayer(layer);
      for (let i = 0; i < attempts && liveRef.current; i++) {
        await sleep(layer === "macro" ? 5000 : 15000);
        const j = await load();
        if (j?.asOf && j.asOf !== prevAsOf) break;
      }
    } catch {
      /* ignore */
    } finally {
      if (liveRef.current) setRefreshing((s) => ({ ...s, [layer]: false }));
    }
  }

  const m = macro?.data;
  const rows = scanner?.data ?? [];

  return (
    <>
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
          </div>
        </div>
        {refreshing.scanner && (
          <div className="insight-foot" style={{ paddingTop: 4 }}>
            Rescanning… this can take a few minutes.
          </div>
        )}
        <div className="insight-divider" />
        {rows.length > 0 ? (
          <div className="rows" style={{ border: "none", borderRadius: 0 }}>
            {rows.slice(0, 20).map((r) => (
              <div className="s-row" key={r.ticker}>
                <span className="s-rank">{r.rank}</span>
                <span className="s-main">
                  <span className="s-name">
                    <a
                      href={`https://finance.yahoo.com/quote/${r.ticker}`}
                      target="_blank"
                      rel="noreferrer"
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
            ))}
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
    </>
  );
}

function RefreshBtn({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      className="btn-ghost btn-sm"
      onClick={onClick}
      disabled={busy}
      title="Recompute now"
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {busy ? <span className="spinner" style={{ width: 13, height: 13 }} /> : "↻"} Refresh
    </button>
  );
}
