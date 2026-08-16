// Encrypt any leftover plaintext holdings rows for a user (post-migrate / first login).

import { db } from "./db.js";
import { encryptNumber, isEncryptedNumber } from "./cryptoUtil.js";

export function encryptExistingHoldingsForUser(userId, dek) {
  const rows = db()
    .prepare(`SELECT id, shares, cost_basis FROM holdings WHERE user_id = ?`)
    .all(userId);
  const upd = db().prepare(
    `UPDATE holdings SET shares = ?, cost_basis = ? WHERE id = ?`,
  );
  const tx = db().transaction(() => {
    for (const r of rows) {
      const sharesEnc = isEncryptedNumber(r.shares)
        ? r.shares
        : encryptNumber(r.shares == null ? null : Number(r.shares), dek);
      const costEnc = isEncryptedNumber(r.cost_basis)
        ? r.cost_basis
        : encryptNumber(r.cost_basis == null ? null : Number(r.cost_basis), dek);
      if (sharesEnc !== r.shares || costEnc !== r.cost_basis) {
        upd.run(sharesEnc, costEnc, r.id);
      }
    }
  });
  tx();
}
