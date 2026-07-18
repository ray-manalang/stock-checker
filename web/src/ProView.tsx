import { useEffect, useState } from "react";
import { InfoTip } from "./components/InfoTip";
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

export function ProView() {
  const [macro, setMacro] = useState<Envelope<Macro> | null>(null);
  const [scanner, setScanner] = useState<Envelope<ScannerRow[]> | null>(null);
  const [macroReady, setMacroReady] = useState(false);
  const [scanReady, setScanReady] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/macro")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setMacro(j))
      .catch(() => {})
      .finally(() => live && setMacroReady(true));
    fetch("/api/scanner")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setScanner(j))
      .catch(() => {})
      .finally(() => live && setScanReady(true));
    return () => {
      live = false;
    };
  }, []);

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
          {m && (
            <span className={`pill ${ZONE_TONE[m.zone] ?? "accent"}`}>{m.zone}</span>
          )}
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
            <div className="subtitle">Quant scanner across the S&amp;P 500.</div>
          </div>
          {rows.length > 0 && (
            <span className="subtitle">ranked {agoLabel(scanner?.asOf)}</span>
          )}
        </div>
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
              ? "Enable the scanner (Phase 2) to see the top-ranked names here."
              : "Loading…"}
          </div>
        )}
      </div>
    </>
  );
}
