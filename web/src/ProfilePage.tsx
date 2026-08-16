import { FormEvent, useEffect, useState } from "react";
import {
  changePassword,
  deleteAccount,
  getSettings,
  getUsage,
  updateSettings,
  type AuthUser,
  type Usage,
} from "./api";

type Props = {
  user: AuthUser;
  onUser: (u: AuthUser) => void;
  onDeleted: () => void;
};

export function ProfilePage({ user, onUser, onDeleted }: Props) {
  const [alertEmail, setAlertEmail] = useState(user.alertEmail ?? "");
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const [usage, setUsage] = useState<Usage | null>(null);

  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s.alertEmail != null) setAlertEmail(s.alertEmail);
      })
      .catch(() => {});
    getUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  async function onSaveEmail(e: FormEvent) {
    e.preventDefault();
    setEmailStatus(null);
    setEmailBusy(true);
    try {
      const s = await updateSettings({ alertEmail: alertEmail.trim() || null });
      const next = s.alertEmail ?? null;
      setAlertEmail(next ?? "");
      onUser({ ...user, alertEmail: next });
      setEmailStatus("Saved");
      window.setTimeout(() => setEmailStatus(null), 2500);
    } catch (err) {
      setEmailStatus(err instanceof Error ? err.message : "Couldn’t save");
    } finally {
      setEmailBusy(false);
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwStatus(null);
    if (newPassword !== confirmPassword) {
      setPwStatus("New passwords don’t match");
      return;
    }
    if (newPassword.length < 8) {
      setPwStatus("New password must be at least 8 characters");
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwStatus("Password updated");
      window.setTimeout(() => setPwStatus(null), 2500);
    } catch (err) {
      setPwStatus(err instanceof Error ? err.message : "Couldn’t update password");
    } finally {
      setPwBusy(false);
    }
  }

  async function onDeleteAccount(e: FormEvent) {
    e.preventDefault();
    setDeleteStatus(null);
    if (deleteConfirm.trim().toUpperCase() !== "DELETE") {
      setDeleteStatus('Type DELETE to confirm');
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteAccount(deletePassword);
      onDeleted();
    } catch (err) {
      setDeleteStatus(err instanceof Error ? err.message : "Couldn’t delete account");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="profile-page">
      <header className="profile-hero">
        <h2>Profile</h2>
        <p className="subtitle">Account settings for {user.username}</p>
      </header>

      <section className="insight-card profile-card">
        <h3>Claude usage</h3>
        <p className="subtitle">
          Cost of deep-dives attributed to your checks this month
          {usage?.llm ? "" : " (LLM not configured on this server)"}.
        </p>
        {usage ? (
          <dl className="profile-dl">
            <div>
              <dt>This month</dt>
              <dd>
                ${usage.cost.toFixed(2)} · {usage.calls} {usage.calls === 1 ? "call" : "calls"}
              </dd>
            </div>
            {usage.today && (
              <div>
                <dt>Today</dt>
                <dd>
                  ${Number(usage.today.cost).toFixed(2)} · {usage.today.calls}{" "}
                  {usage.today.calls === 1 ? "call" : "calls"}
                </dd>
              </div>
            )}
            {usage.site && (
              <div>
                <dt>Site-wide (admin)</dt>
                <dd>
                  ${usage.site.cost.toFixed(2)} · {usage.site.calls} calls this month
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="subtitle" style={{ marginTop: 10 }}>
            Usage unavailable.
          </p>
        )}
      </section>

      <section className="insight-card profile-card">
        <h3>Alert email</h3>
        <p className="subtitle">Where buy-zone alert emails are sent (optional).</p>
        <form className="profile-form" onSubmit={onSaveEmail}>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={alertEmail}
              onChange={(e) => {
                setAlertEmail(e.target.value);
                setEmailStatus(null);
              }}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <div className="profile-actions">
            <button type="submit" className="pill-btn" disabled={emailBusy}>
              {emailBusy ? "…" : "Save email"}
            </button>
            {emailStatus && (
              <span
                className="account-status"
                style={{ color: emailStatus === "Saved" ? "var(--up)" : "var(--down)" }}
                role="status"
              >
                {emailStatus}
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="insight-card profile-card">
        <h3>Password</h3>
        <p className="subtitle">Change the password you use to sign in.</p>
        <form className="profile-form" onSubmit={onChangePassword}>
          <label className="auth-field">
            <span>Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setPwStatus(null);
              }}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="auth-field">
            <span>New password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPwStatus(null);
              }}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </label>
          <label className="auth-field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPwStatus(null);
              }}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </label>
          <div className="profile-actions">
            <button type="submit" className="pill-btn" disabled={pwBusy}>
              {pwBusy ? "…" : "Update password"}
            </button>
            {pwStatus && (
              <span
                className="account-status"
                style={{
                  color: pwStatus === "Password updated" ? "var(--up)" : "var(--down)",
                }}
                role="status"
              >
                {pwStatus}
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="insight-card profile-card profile-meta">
        <h3>Account</h3>
        <dl className="profile-dl">
          <div>
            <dt>Username</dt>
            <dd>{user.username}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{user.role === "admin" ? "Admin" : "Member"}</dd>
          </div>
        </dl>
      </section>

      <section className="insight-card profile-card profile-danger">
        <h3>Delete account</h3>
        <p className="subtitle">
          Permanently removes your watchlist, holdings, alerts, and settings from this server.
          Shared market data is kept. This cannot be undone.
        </p>
        <form className="profile-form" onSubmit={onDeleteAccount}>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => {
                setDeletePassword(e.target.value);
                setDeleteStatus(null);
              }}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="auth-field">
            <span>
              Type <strong>DELETE</strong> to confirm
            </span>
            <input
              value={deleteConfirm}
              onChange={(e) => {
                setDeleteConfirm(e.target.value);
                setDeleteStatus(null);
              }}
              autoComplete="off"
              required
            />
          </label>
          <div className="profile-actions">
            <button type="submit" className="pill-btn pill-btn-danger" disabled={deleteBusy}>
              {deleteBusy ? "…" : "Delete my account"}
            </button>
            {deleteStatus && (
              <span className="account-status" style={{ color: "var(--down)" }} role="status">
                {deleteStatus}
              </span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
