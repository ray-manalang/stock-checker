import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  generateDek,
  deriveKek,
  wrapDek,
  unwrapDek,
  encryptNumber,
  decryptNumber,
  newSalt,
  isEncryptedNumber,
} from "./cryptoUtil.js";

test("password hash round-trip", () => {
  const h = hashPassword("correct horse");
  assert.equal(verifyPassword("correct horse", h), true);
  assert.equal(verifyPassword("wrong", h), false);
});

test("DEK wrap/unwrap + number encrypt", () => {
  const dek = generateDek();
  const salt = newSalt();
  const kek = deriveKek("pw-12345678", salt);
  const wrapped = wrapDek(dek, kek);
  assert.ok(dek.equals(unwrapDek(wrapped, kek)));
  const enc = encryptNumber(42.5, dek);
  assert.ok(isEncryptedNumber(enc));
  assert.equal(decryptNumber(enc, dek), 42.5);
  assert.equal(decryptNumber("12.5", dek), 12.5); // legacy plaintext
});
