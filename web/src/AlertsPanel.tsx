import { useEffect, useState } from "react";
import {
  getAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
  type Alert,
} from "./api";
import { ClearableInput } from "./components/ClearableInput";

function describe(a: Alert): string {
  if (a.status === "triggered") {
    const when = a.triggeredAt
      ? new Date(a.triggeredAt).toLocaleDateString([], { month: "short", day: "numeric" })
      : "";
    return `triggered ${when}`.trim();
  }
  if (a.targetLow != null && a.targetHigh != null) {
    return `alert between $${a.targetLow} and $${a.targetHigh}`;
  }
  return `alert at or below $${a.targetLow ?? a.targetHigh}`;
}

// Alert management UI (Phase 1.3). Alerts were create-only; this adds the
// list/edit/delete surface.
export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("alertsCollapsed") === "1",
  );
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("alertsCollapsed", next ? "1" : "0");
      return next;
    });

  const refresh = () => getAlerts().then(setAlerts).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  async function saveEdit(id: number) {
    const price = Number(editVal);
    if (!Number.isFinite(price) || price <= 0) return;
    setAlerts(await updateAlert(id, price));
    setEditing(null);
  }
  async function remove(id: number) {
    setAlerts(await deleteAlert(id));
  }
  async function add() {
    const t = newTicker.trim().toUpperCase();
    const price = Number(newPrice);
    if (!t || !Number.isFinite(price) || price <= 0) return;
    setAlerts(await createAlert(t, price));
    setNewTicker("");
    setNewPrice("");
    setAdding(false);
  }

  const header = (
    <div className="insight-head">
      <button
        className="collapse-btn"
        onClick={toggle}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand" : "Collapse"}
      >
        <span className="chev">{collapsed ? "▸" : "▾"}</span>
        <h3>Your alerts</h3>
      </button>
    </div>
  );

  if (alerts.length === 0 && !adding) {
    return (
      <div className="insight-card">
        {header}
        {!collapsed && (
          <div className="insight-foot" style={{ paddingTop: 6 }}>
            No price alerts yet. Set one from any stock's answer card, or{" "}
            <button className="linklike" onClick={() => setAdding(true)}>
              add one here
            </button>
            .
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="insight-card">
      {header}
      {!collapsed && (
      <>
      <div className="insight-divider" />
      {alerts.map((a) => (
        <div key={a.id} className={`alert-row${a.status === "triggered" ? " triggered" : ""}`}>
          <div className="alert-top">
            <div className="alert-left">
              <div className="alert-tk">
                {a.status === "triggered" ? "✓ " : ""}
                {a.ticker}
              </div>
              {editing === a.id ? (
                <ClearableInput
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onClear={() => setEditVal("")}
                  inputMode="decimal"
                  autoFocus
                  style={{
                    width: 100,
                    background: "var(--surface-2)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 8,
                    color: "var(--text)",
                    padding: "5px 9px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit(a.id)}
                />
              ) : (
                <div className="alert-desc">{describe(a)}</div>
              )}
            </div>
            <div className="alert-actions">
              {editing === a.id ? (
                <button className="icon-btn" title="Save" onClick={() => saveEdit(a.id)}>
                  ✓
                </button>
              ) : (
                a.status !== "triggered" && (
                  <button
                    className="icon-btn"
                    title="Edit"
                    onClick={() => {
                      setEditing(a.id);
                      setEditVal(String(a.targetLow ?? a.targetHigh ?? ""));
                    }}
                  >
                    ✎
                  </button>
                )
              )}
              <button className="icon-btn" title="Remove" onClick={() => remove(a.id)}>
                ×
              </button>
            </div>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="alert-row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ClearableInput
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              onClear={() => setNewTicker("")}
              placeholder="Ticker"
              spellCheck={false}
              style={{
                width: 90,
                background: "var(--surface-2)",
                border: "1px solid var(--hairline)",
                borderRadius: 8,
                color: "var(--text)",
                padding: "7px 10px",
              }}
            />
            <ClearableInput
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              onClear={() => setNewPrice("")}
              placeholder="≤ price"
              inputMode="decimal"
              style={{
                width: 90,
                background: "var(--surface-2)",
                border: "1px solid var(--hairline)",
                borderRadius: 8,
                color: "var(--text)",
                padding: "7px 10px",
                fontVariantNumeric: "tabular-nums",
              }}
            />
            <button className="btn-primary btn-sm" onClick={add}>
              Set
            </button>
          <button className="btn-ghost btn-sm" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="linklike"
          style={{ margin: "14px 18px", color: "var(--accent)", fontSize: 13 }}
          onClick={() => setAdding(true)}
        >
          + Set a new alert
        </button>
      )}
      </>
      )}
    </div>
  );
}
