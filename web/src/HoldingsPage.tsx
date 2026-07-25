import { useEffect, useState } from "react";
import {
  getHoldings,
  previewHoldings,
  importHoldings,
  setHoldingTax,
  type Portfolio,
  type Holding,
  type CsvMapping,
  type HoldingsPreview,
  type ImportSummary,
} from "./api";
import { money } from "./lib/format";

function signedMoney(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
}

function asOfLabel(iso: string | null): string {
  if (!iso) return "not yet imported";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// Holdings page (Phase 3). CSV import, blended positions, concentration,
// gain/loss, tax-loss + add-on-dip notes, and the per-position tax-advantaged
// toggle. All arithmetic on top of the existing ticker-level verdict — holdings
// never leave the box.
export function HoldingsPage({ onBack }: { onBack: () => void }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [macro, setMacro] = useState<{ zone: string; sizingPct: number | null } | null>(null);
  const [ready, setReady] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = () =>
    getHoldings()
      .then((r) => {
        setPortfolio(r.data);
        setMacro(r.macro);
      })
      .catch(() => {})
      .finally(() => setReady(true));

  useEffect(() => {
    load();
  }, []);

  async function toggleTax(ticker: string, next: boolean) {
    setPortfolio((p) =>
      p
        ? {
            ...p,
            positions: p.positions.map((x) =>
              x.ticker === ticker ? { ...x, taxAdvantaged: next } : x,
            ),
          }
        : p,
    );
    try {
      await setHoldingTax(ticker, next);
      load(); // notes depend on the flag
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div
        className="page-head"
        style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <button className="linklike" onClick={onBack} style={{ marginBottom: 8 }}>
            ‹ Back
          </button>
          <h2 style={{ margin: 0, fontSize: 24 }}>Holdings</h2>
          <div className="insight-foot" style={{ marginTop: 4, padding: 0, textAlign: "left" }}>
            {portfolio?.sources?.length
              ? `Rolled up across ${portfolio.sources.join(" + ")} · as of ${asOfLabel(portfolio.asOf)}`
              : "Import a positions CSV to get started."}
          </div>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => setImporting((v) => !v)}>
          ↻ Import positions
        </button>
      </div>

      {importing && (
        <ImportPanel
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            load();
          }}
        />
      )}

      <div className="insight-card" style={{ marginTop: 18 }}>
        {portfolio && portfolio.count > 0 ? (
          <>
            <div className="insight-cells">
              <div className="insight-cell">
                <div className="label">Total value</div>
                <div className="val">{money(portfolio.totalValue)}</div>
              </div>
              <div className="insight-cell">
                <div className="label">Unrealized</div>
                <div
                  className={`val ${
                    (portfolio.unrealized ?? 0) >= 0 ? "up" : "down"
                  }`}
                >
                  {signedMoney(portfolio.unrealized)}
                </div>
              </div>
              <div className="insight-cell">
                <div className="label">Market conditions</div>
                <div className="val" style={{ fontSize: 15, paddingTop: 3 }}>
                  {macro ? `${macro.zone}${macro.sizingPct != null ? ` · ${macro.sizingPct}%` : ""}` : "—"}
                </div>
              </div>
            </div>
            <div className="insight-divider" />
            {portfolio.positions.map((p) => (
              <Position key={p.ticker} p={p} onToggleTax={toggleTax} />
            ))}
            <div className="insight-foot">
              {portfolio.count} tracked position{portfolio.count === 1 ? "" : "s"} · re-import
              anytime after a trade — this isn't meant to stay in sync automatically.
            </div>
          </>
        ) : (
          <div className="insight-foot" style={{ padding: 8 }}>
            {ready
              ? "No holdings yet. Use “Import positions” to drop in a CSV export from your brokerage."
              : "Loading…"}
          </div>
        )}
      </div>
    </>
  );
}

function Position({
  p,
  onToggleTax,
}: {
  p: Holding;
  onToggleTax: (ticker: string, next: boolean) => void;
}) {
  const up = (p.gainLoss ?? 0) >= 0;
  const srcLabel = p.sources
    .map((s) => `${s.source}${p.sources.length > 1 ? ` (${s.shares})` : ""}`)
    .join(" + ");
  return (
    <div className="holding">
      <div className="h-top">
        <div className="h-id">
          <div className="tk">
            {p.ticker}
            {p.name && <span className="co">{p.name}</span>}
          </div>
          <div className="src">
            {p.shares} sh · {money(p.costBasis)} cost basis · {srcLabel}
            {p.taxAdvantaged ? " · tax-advantaged" : ""}
          </div>
        </div>
        <div className="h-vals">
          <div className="px">{money(p.price)}</div>
          <div className={`chg ${up ? "up" : "down"}`}>
            {signedMoney(p.gainLoss)}
            {p.gainLossPct != null ? ` · ${up ? "+" : "−"}${Math.abs(p.gainLossPct).toFixed(1)}%` : ""}
          </div>
        </div>
      </div>

      {p.concentrationPct != null && (
        <div className="meter">
          <div className="meter-label">
            <span>Share of tracked holdings</span>
            <span>{p.concentrationPct}%</span>
          </div>
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${Math.min(100, p.concentrationPct)}%` }} />
          </div>
        </div>
      )}

      {p.notes.map((n, i) => (
        <div key={i} className={`note-row ${n.kind}`}>
          <span>◆</span>
          <span className="txt">
            {n.title && <b>{n.title}</b>}
            {n.title ? " — " : ""}
            {n.text}
          </span>
        </div>
      ))}

      <label className="tax-toggle">
        <input
          type="checkbox"
          checked={p.taxAdvantaged}
          onChange={(e) => onToggleTax(p.ticker, e.target.checked)}
        />
        Tax-advantaged account (IRA/401k) — suppresses tax-loss notes
      </label>
    </div>
  );
}

// Import flow: paste or upload a CSV → preview → confirm the column mapping →
// import (replaces holdings wholesale). The mapping is remembered server-side.
function ImportPanel({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<HoldingsPreview | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doPreview(text: string) {
    setError(null);
    setBusy(true);
    try {
      const p = await previewHoldings(text);
      setPreview(p);
      setMapping(p.suggestedMapping);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsv(text);
      doPreview(text);
    };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!mapping) return;
    setError(null);
    setBusy(true);
    try {
      setSummary(await importHoldings(csv, mapping));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const headers = preview?.headers ?? [];
  const field = (key: keyof CsvMapping, label: string) => (
    <>
      <label>{label}</label>
      <select
        value={(mapping?.[key] as string) ?? ""}
        onChange={(e) => setMapping((m) => (m ? { ...m, [key]: e.target.value || null } : m))}
      >
        <option value="">— none —</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </>
  );

  return (
    <div className="insight-card import-panel" style={{ marginTop: 16 }}>
      <div className="insight-head">
        <h3>Import positions</h3>
        <button className="icon-btn" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="insight-foot" style={{ marginTop: 0 }}>
        Drop your aggregated positions CSV (one file across all brokerages). Re-importing replaces
        your holdings — it's a snapshot, not a running log. Nothing is uploaded anywhere; parsing
        happens on your own box.
      </div>

      {summary ? (
        <div>
          <p style={{ fontSize: 14 }}>
            Imported <strong>{summary.positions}</strong> position
            {summary.positions === 1 ? "" : "s"} ({summary.imported} rows).{" "}
            {summary.skipped > 0 && (
              <span className="insight-foot">
                Skipped {summary.skipped} non-tradable row{summary.skipped === 1 ? "" : "s"}
                {summary.skippedSymbols.length ? ` (${summary.skippedSymbols.join(", ")})` : ""}.
              </span>
            )}
          </p>
          <button className="btn-primary btn-sm" onClick={onImported}>
            Done
          </button>
        </div>
      ) : (
        <>
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
          <textarea
            placeholder="…or paste CSV contents here"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            onBlur={() => csv.trim() && !preview && doPreview(csv)}
          />
          {!preview && (
            <button
              className="btn-ghost btn-sm"
              disabled={!csv.trim() || busy}
              onClick={() => doPreview(csv)}
            >
              Preview
            </button>
          )}
          {preview && mapping && (
            <>
              <div className="insight-foot" style={{ margin: 0 }}>
                Map your columns (remembered for next time):
              </div>
              <div className="map-grid">
                {field("ticker", "Ticker")}
                {field("shares", "Shares")}
                {field("costBasis", "Cost basis")}
                <label>Cost basis is</label>
                <select
                  value={mapping.costBasisMode}
                  onChange={(e) =>
                    setMapping((m) =>
                      m ? { ...m, costBasisMode: e.target.value as "pershare" | "total" } : m,
                    )
                  }
                >
                  <option value="pershare">per share</option>
                  <option value="total">total (all shares)</option>
                </select>
                {field("source", "Institution")}
              </div>
              <button
                className="btn-primary btn-sm"
                disabled={busy || !mapping.ticker || !mapping.shares}
                onClick={doImport}
              >
                {busy ? "Importing…" : `Import ${preview.rowCount} rows`}
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
