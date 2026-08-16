import { FormEvent, useEffect, useState } from "react";
import {
  changePassword,
  getSettings,
  updateSettings,
  type AuthUser,
} from "./api";

type Props = {
  user: AuthUser;
  onUser: (u: AuthUser) => void;
};

export function ProfilePage({ user, onUser }: Props) {
  const [alertEmail, setAlertEmail] = useState(user.alertEmail ?? "");
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s.alertEmail != null) setAlertEmail(s.alertEmail);
      })
      .catch(() => {});
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

  return (
    <div className="profile-page">
      <header className="profile-hero">
        <h2>Profile</h2>
        <p className="subtitle">Account settings for {user.username}</p>
      </header>

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
    </div>
  );
}
