import { FormEvent, useEffect, useState } from "react";
import { getMe, login, register, type AuthUser } from "./api";

type Props = {
  onAuthed: (user: AuthUser) => void;
};

export function AuthGate({ onAuthed }: Props) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"login" | "invite">("login");
  const [invite, setInvite] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [alertEmail, setAlertEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get("invite");
    if (tok) {
      setInvite(tok);
      setMode("invite");
    }
    getMe()
      .then((u) => {
        if (u) onAuthed(u);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [onAuthed]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user =
        mode === "invite"
          ? await register(invite.trim(), username.trim(), password, alertEmail.trim() || undefined)
          : await login(username.trim(), password);
      if (mode === "invite") {
        window.history.replaceState({}, "", window.location.pathname);
      }
      onAuthed(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="page auth-page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="page auth-page">
      <div className="auth-card">
        <div className="brand auth-brand">
          Market Specialist<span className="dot">.</span>
        </div>
        <p className="auth-lead">
          {mode === "invite" ? "Create your account with an invite link." : "Sign in to continue."}
        </p>
        <form className="auth-form" onSubmit={onSubmit}>
          {mode === "invite" && (
            <label className="auth-field">
              <span>Invite code</span>
              <input
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
          )}
          <label className="auth-field">
            <span>Username or email</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "invite" ? "new-password" : "current-password"}
              required
              minLength={mode === "invite" ? 8 : 1}
            />
          </label>
          {mode === "invite" && (
            <label className="auth-field">
              <span>Alert email (optional)</span>
              <input
                type="email"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
          )}
          {error && <p className="auth-error">{error}</p>}
          <button className="pill-btn" type="submit" disabled={busy}>
            {busy ? "…" : mode === "invite" ? "Create account" : "Sign in"}
          </button>
        </form>
        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode((m) => (m === "login" ? "invite" : "login"));
            setError(null);
          }}
        >
          {mode === "invite" ? "Already have an account? Sign in" : "Have an invite? Create account"}
        </button>
      </div>
    </div>
  );
}
