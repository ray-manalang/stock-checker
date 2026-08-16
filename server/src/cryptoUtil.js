// Password hashing + holdings DEK wrap/encrypt (AES-256-GCM).

import crypto from "crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts[0] !== "scrypt" || parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = crypto.scryptSync(password, salt, expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

export function newSalt(bytes = 16) {
  return crypto.randomBytes(bytes);
}

export function deriveKek(password, saltBuf) {
  return crypto.scryptSync(password, saltBuf, 32, SCRYPT);
}

export function generateDek() {
  return crypto.randomBytes(32);
}

/** Wrap a DEK under a KEK → base64(iv || tag || ciphertext). */
export function wrapDek(dek, kek) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
  const enc = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function unwrapDek(wrappedB64, kek) {
  const buf = Buffer.from(wrappedB64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Encrypt a number → `enc:v1:<base64(iv||tag||ct)>`. null stays null. */
export function encryptNumber(n, dek) {
  if (n == null || n === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  const enc = Buffer.concat([cipher.update(String(n), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${Buffer.concat([iv, tag, enc]).toString("base64")}`;
}

/** Decrypt enc:v1… or accept legacy plaintext numbers / numeric strings. */
export function decryptNumber(stored, dek) {
  if (stored == null || stored === "") return null;
  if (typeof stored === "number") return Number.isFinite(stored) ? stored : null;
  const s = String(stored);
  if (!s.startsWith("enc:v1:")) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (!dek) throw new Error("holdings key not unlocked — sign in again");
  const buf = Buffer.from(s.slice("enc:v1:".length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

export function isEncryptedNumber(stored) {
  return typeof stored === "string" && stored.startsWith("enc:v1:");
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}
