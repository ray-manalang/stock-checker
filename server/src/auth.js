// Session cookie auth + invite registration.

import {
  hashPassword,
  verifyPassword,
  randomToken,
  newSalt,
  deriveKek,
  generateDek,
  wrapDek,
  unwrapDek,
} from "./cryptoUtil.js";
import {
  createUser,
  findUserByUsername,
  findUserById,
  createSession,
  getSession,
  deleteSession,
  touchSession,
  createInvite,
  consumeInvite,
  getInvite,
  countUsers,
  setUserHoldingsKeys,
  getUserHoldingsKeys,
  listUsers,
  updateUserProfile,
  setUserPasswordHash,
  setSessionHoldingsDekBlob,
} from "./db.js";
import { putSessionDek, getSessionDek, clearSessionDek, touchSessionDek } from "./sessionVault.js";
import { encryptExistingHoldingsForUser } from "./holdingsCrypto.js";
import crypto from "crypto";

export const SESSION_COOKIE = "ms_session";
const SESSION_DAYS = 14;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/** Server key that wraps the holdings DEK for the lifetime of a session row
 *  (survives page refresh / process restart; still needs SESSION_SECRET). */
function sessionWrapKey() {
  const secret =
    process.env.SESSION_SECRET?.trim() ||
    process.env.BOOTSTRAP_ADMIN_PASS?.trim() ||
    "dev-insecure-session-secret";
  return crypto.scryptSync(secret, "ms-session-wrap-v1", 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function sealDekForSession(dek) {
  return wrapDek(dek, sessionWrapKey());
}

function openDekFromSession(blob) {
  if (!blob) return null;
  try {
    return unwrapDek(blob, sessionWrapKey());
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const h = req.headers.cookie;
  if (!h) return {};
  const out = {};
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function cookieSecure() {
  // Behind Cloudflare HTTPS; also honor explicit override.
  if (process.env.COOKIE_SECURE === "0") return false;
  if (process.env.COOKIE_SECURE === "1") return true;
  const base = process.env.APP_BASE_URL || "";
  return base.startsWith("https://");
}

export function setSessionCookie(res, sessionId) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  if (cookieSecure()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (cookieSecure()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    alertEmail: u.alertEmail ?? null,
  };
}

/** Unlock (or create) the holdings DEK for this password and stash in vault. */
function unlockHoldingsDek(user, password, sessionId, expiresAtMs) {
  const keys = getUserHoldingsKeys(user.id);
  let dek;
  if (keys?.dekWrapped && keys?.kdfSalt) {
    const kek = deriveKek(password, Buffer.from(keys.kdfSalt, "base64"));
    dek = unwrapDek(keys.dekWrapped, kek);
  } else {
    // First login after migrate (or brand-new user without keys yet).
    dek = generateDek();
    const salt = newSalt();
    const kek = deriveKek(password, salt);
    setUserHoldingsKeys(user.id, {
      dekWrapped: wrapDek(dek, kek),
      kdfSalt: salt.toString("base64"),
    });
  }
  putSessionDek(sessionId, dek, expiresAtMs);
  try {
    encryptExistingHoldingsForUser(user.id, dek);
  } catch (err) {
    console.error("[auth] holdings encrypt-on-login failed:", err?.message || err);
  }
  return dek;
}

export function bootstrapAdminIfNeeded() {
  if (countUsers() > 0) return null;
  const username = process.env.BOOTSTRAP_ADMIN_USER?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASS;
  if (!username || !password) {
    console.warn(
      "[auth] No users yet. Set BOOTSTRAP_ADMIN_USER and BOOTSTRAP_ADMIN_PASS to create the admin on next boot.",
    );
    return null;
  }
  const alertEmail = process.env.ALERT_EMAIL?.trim() || null;
  const user = createUser({
    username,
    passwordHash: hashPassword(password),
    role: "admin",
    alertEmail,
  });
  // Mint holdings keys immediately so first login only unlocks.
  const salt = newSalt();
  const dek = generateDek();
  const kek = deriveKek(password, salt);
  setUserHoldingsKeys(user.id, {
    dekWrapped: wrapDek(dek, kek),
    kdfSalt: salt.toString("base64"),
  });
  console.log(`[auth] Bootstrap admin "${username}" created (id=${user.id})`);
  return user;
}

export function login(username, password) {
  const user = findUserByUsername(String(username ?? "").trim());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: "Invalid username or password", status: 401 };
  }
  const sessionId = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  const dek = unlockHoldingsDek(user, password, sessionId, Date.now() + SESSION_MS);
  createSession(sessionId, user.id, expiresAt, sealDekForSession(dek));
  return { user: publicUser(user), sessionId, expiresAt };
}

export function logout(sessionId) {
  if (sessionId) {
    deleteSession(sessionId);
    clearSessionDek(sessionId);
  }
}

export function registerWithInvite({ token, username, password, alertEmail }) {
  const invite = getInvite(token);
  if (!invite) return { error: "Invalid or expired invite", status: 400 };
  if (invite.usedBy) return { error: "Invite already used", status: 400 };
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    return { error: "Invite expired", status: 400 };
  }
  const name = String(username ?? "").trim();
  const usernameOk = /^[a-zA-Z0-9_]{3,32}$/.test(name);
  // Practical email check (local@domain); length capped for the username column use.
  const emailOk =
    name.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name);
  if (!usernameOk && !emailOk) {
    return {
      error: "Use a username (3–32 letters, numbers, or _) or an email address",
      status: 400,
    };
  }
  if (!password || String(password).length < 8) {
    return { error: "Password must be at least 8 characters", status: 400 };
  }
  if (findUserByUsername(name)) {
    return { error: "Username taken", status: 409 };
  }
  const salt = newSalt();
  const dek = generateDek();
  const kek = deriveKek(password, salt);
  const user = createUser({
    username: name,
    passwordHash: hashPassword(password),
    role: "user",
    alertEmail: alertEmail?.trim() || null,
  });
  setUserHoldingsKeys(user.id, {
    dekWrapped: wrapDek(dek, kek),
    kdfSalt: salt.toString("base64"),
  });
  consumeInvite(token, user.id);
  const sessionId = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  createSession(sessionId, user.id, expiresAt, sealDekForSession(dek));
  putSessionDek(sessionId, dek, Date.now() + SESSION_MS);
  return { user: publicUser(user), sessionId, expiresAt };
}

export function createInviteFor(adminUserId, { days = 14 } = {}) {
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  createInvite({ token, createdBy: adminUserId, expiresAt });
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const url = base ? `${base}/?invite=${encodeURIComponent(token)}` : `/?invite=${encodeURIComponent(token)}`;
  return { token, expiresAt, url };
}

/**
 * Change password and re-wrap the holdings DEK under the new password.
 * Requires the current password. Uses session DEK when available.
 */
export function changePassword(userId, sessionId, { currentPassword, newPassword }, sessionDek = null) {
  const user = findUserById(userId);
  if (!user) return { error: "Sign in required", status: 401 };
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return { error: "Current password is incorrect", status: 400 };
  }
  if (!newPassword || String(newPassword).length < 8) {
    return { error: "New password must be at least 8 characters", status: 400 };
  }
  if (currentPassword === newPassword) {
    return { error: "New password must be different", status: 400 };
  }

  let dek = sessionDek ? Buffer.from(sessionDek) : null;
  if (!dek) {
    const keys = getUserHoldingsKeys(userId);
    if (keys?.dekWrapped && keys?.kdfSalt) {
      try {
        const kek = deriveKek(currentPassword, Buffer.from(keys.kdfSalt, "base64"));
        dek = unwrapDek(keys.dekWrapped, kek);
      } catch {
        return { error: "Couldn’t unlock holdings with current password — sign out and back in", status: 400 };
      }
    } else {
      dek = generateDek();
    }
  }

  const salt = newSalt();
  const kek = deriveKek(newPassword, salt);
  setUserHoldingsKeys(userId, {
    dekWrapped: wrapDek(dek, kek),
    kdfSalt: salt.toString("base64"),
  });
  setUserPasswordHash(userId, hashPassword(newPassword));

  if (sessionId) {
    putSessionDek(sessionId, dek, Date.now() + SESSION_MS);
    setSessionHoldingsDekBlob(sessionId, sealDekForSession(dek));
  }

  return { ok: true, user: publicUser(findUserById(userId)) };
}

export function requireAuth(req, res, next) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return res.status(401).json({ error: "Sign in required" });
  const session = getSession(sid);
  if (!session) return res.status(401).json({ error: "Session expired — sign in again" });
  const user = findUserById(session.userId);
  if (!user) return res.status(401).json({ error: "Sign in required" });
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  touchSession(sid, expiresAt);
  let dek = getSessionDek(sid);
  if (!dek && session.holdingsDekBlob) {
    dek = openDekFromSession(session.holdingsDekBlob);
    if (dek) putSessionDek(sid, dek, Date.now() + SESSION_MS);
  } else {
    touchSessionDek(sid, Date.now() + SESSION_MS);
  }
  req.user = publicUser(user);
  req.sessionId = sid;
  req.holdingsDek = dek;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

export function meFromReq(req) {
  return req.user ?? null;
}

export { publicUser, listUsers, updateUserProfile, SESSION_MS };
