import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./AuthGate";
import { setUnauthorizedHandler, type AuthUser } from "./api";
import "./index.css";

function Root() {
  const [user, setUser] = useState<AuthUser | null>(null);

  const onAuthed = useCallback((u: AuthUser) => setUser(u), []);
  const onLogout = useCallback(() => setUser(null), []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (!user) return <AuthGate onAuthed={onAuthed} />;
  return <App user={user} onLogout={onLogout} onUser={setUser} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
