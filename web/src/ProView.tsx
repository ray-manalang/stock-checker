import { useCallback, useEffect, useRef, useState } from "react";
import { InfoTip } from "./components/InfoTip";
import { refreshLayer } from "./api";
import { GLOSSARY } from "./lib/glossary";
import { num } from "./lib/format";

type Envelope<T> = { data: T; asOf: string; stale?: boolean };

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
  composite: number;
  rank: number;
  rankFlag?: string;
  blendedScore?: number;
};

const ZONE_TONE: Record<string, string> = {
  "FULL DEPLOY": "up",
  REDUCED: "warn",
  DEFENSIVE: "down",
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
  const [scanner, setScanner] = useState<Envelope<ScannerRow[]> | null>(null);
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
    return j as Envelope<ScannerRow[]> | null;
  }, []);

  useEffect(() => {
    liveRef.current = true;
    loadMacro().finally(() => liveRef.current && setMacroReady(true));
    loadScanner().finally(() => liveRef.current && setScanReady(true));
    return () => {
      liveRef.current = false;
    };
  }, [loadMacro, loadScanner]);

  // Kick a background recompute, then poll the read endpoint until its "as of"
  // stamp changes (or we give up). Scanner can take minutes on first run.
  async function refresh(layer: "macro" | "scanner") {
    const prevAsOf = (layer === "macro" ? macro : scanner)?.asOf;
    const load = layer === "macro" ? loadMacro : loadScanner;
    const attempts = layer === "macro" ? 30 : 60; // ~2.5 min / ~15 min
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
                <div className="label">Deploy score</div>
                <div className="val hl">{num(m.composite, 0)}</div>
              </div>
              <div className="insight-cell">
                <div className="label">Sizing</div>
                <div className="val">{m.sizingPct}%</div>
              </div>
              <div className="insight-cell">
                <div className="label">Scanner</div>
                <div className="val">{m.scannerActive ? "On" : "Off"}</div>
              </div>
            </div>
            <div className="sig-grid">
              {m.signals.map((s) => (
                <div className="sig" key={s.signal}>
                  <span className="sn">{s.signal}</span>
                  <span className="ss">{num(s.score, 0)}</span>
                </div>
              ))}
            </div>
            <div className="insight-foot">
              updated {agoLabel(macro?.asOf)} · loads instantly
            </div>
          </>
        ) : (
          <div className="insight-foot" style={{ padding: "18px" }}>
            {macroReady
              ? "Enable the macro gate (Phase 1) to see the deploy score and 6-signal grid here."
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
            Rescanning… this can take a few minutes on the free data tier.
          </div>
        )}
        <div className="insight-divider" />
        {rows.length > 0 ? (
          <div className="rows" style={{ border: "none", borderRadius: 0 }}>
            {rows.slice(0, 10).map((r) => (
              <div className="s-row" key={r.ticker}>
                <span className="s-rank">{r.rank}</span>
                <span className="s-name">
                  {r.ticker}
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
                <span className="s-score">{num(r.composite, 0)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="insight-foot" style={{ padding: "18px" }}>
            {scanReady
              ? refreshing.scanner
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
