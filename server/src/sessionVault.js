// In-memory holdings DEK vault keyed by session id. Cleared on logout/expiry.
// Never persisted — forgetting the password loses access to ciphertext (by design).

const vault = new Map();

export function putSessionDek(sessionId, dek, expiresAtMs) {
  vault.set(sessionId, { dek: Buffer.from(dek), expiresAt: expiresAtMs });
}

export function getSessionDek(sessionId) {
  const e = vault.get(sessionId);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    vault.delete(sessionId);
    return null;
  }
  return e.dek;
}

export function clearSessionDek(sessionId) {
  vault.delete(sessionId);
}

export function touchSessionDek(sessionId, expiresAtMs) {
  const e = vault.get(sessionId);
  if (e) e.expiresAt = expiresAtMs;
}
