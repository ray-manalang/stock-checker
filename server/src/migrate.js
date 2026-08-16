// One-shot multi-user migration: add user tables, attach legacy personal rows to admin.
// Called from db.js after open — uses the raw Database handle (no circular imports).

function cols(database, table) {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

function migrationDone(database, id) {
  try {
    return !!database.prepare(`SELECT 1 FROM schema_migrations WHERE id = ?`).get(id);
  } catch {
    return false;
  }
}

function markMigration(database, id) {
  database
    .prepare(`INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)`)
    .run(id, new Date().toISOString());
}

function readSetting(database, key) {
  const row = database.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

/**
 * Ensure multi-user schema + migrate legacy single-tenant rows onto adminUserId.
 * Safe to call every boot (idempotent). `database` is a better-sqlite3 Database.
 */
export function ensureMultiUserSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      alert_email TEXT,
      holdings_dek_wrapped TEXT,
      holdings_kdf_salt TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      created_by INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      used_by INTEGER,
      used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      holdings_dek_blob TEXT
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, key)
    );
  `);

  for (const ddl of [
    `ALTER TABLE users ADD COLUMN holdings_dek_wrapped TEXT`,
    `ALTER TABLE users ADD COLUMN holdings_kdf_salt TEXT`,
    `ALTER TABLE users ADD COLUMN alert_email TEXT`,
    `ALTER TABLE sessions ADD COLUMN holdings_dek_blob TEXT`,
  ]) {
    try {
      database.exec(ddl);
    } catch {
      /* exists */
    }
  }
}

export function migrateLegacyPersonalData(database, adminUserId) {
  if (!adminUserId) return { migrated: false, reason: "no admin" };
  if (migrationDone(database, "multi_user_v1")) return { migrated: false, reason: "already" };

  const uid = adminUserId;
  const has = (table, col) => cols(database, table).includes(col);

  if (!has("watchlist", "user_id")) {
    database.exec(`
      CREATE TABLE watchlist_new (
        user_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (user_id, ticker)
      );
      INSERT INTO watchlist_new (user_id, ticker, added_at)
        SELECT ${uid}, ticker, added_at FROM watchlist;
      DROP TABLE watchlist;
      ALTER TABLE watchlist_new RENAME TO watchlist;
    `);
  } else {
    database.prepare(`UPDATE watchlist SET user_id = ? WHERE user_id IS NULL`).run(uid);
  }

  if (!has("alerts", "user_id")) {
    database.exec(`ALTER TABLE alerts ADD COLUMN user_id INTEGER`);
  }
  database.prepare(`UPDATE alerts SET user_id = ? WHERE user_id IS NULL`).run(uid);

  if (!has("holdings", "user_id")) {
    database.exec(`ALTER TABLE holdings ADD COLUMN user_id INTEGER`);
  }
  database.prepare(`UPDATE holdings SET user_id = ? WHERE user_id IS NULL`).run(uid);

  if (!migrationDone(database, "holdings_text_v1")) {
    database.exec(`
      CREATE TABLE holdings_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        shares TEXT,
        cost_basis TEXT,
        source TEXT,
        imported_at TEXT NOT NULL
      );
      INSERT INTO holdings_new (id, user_id, ticker, shares, cost_basis, source, imported_at)
        SELECT id, COALESCE(user_id, ${uid}), ticker,
               CASE WHEN shares IS NULL THEN NULL ELSE CAST(shares AS TEXT) END,
               CASE WHEN cost_basis IS NULL THEN NULL ELSE CAST(cost_basis AS TEXT) END,
               source, imported_at
        FROM holdings;
      DROP TABLE holdings;
      ALTER TABLE holdings_new RENAME TO holdings;
    `);
    markMigration(database, "holdings_text_v1");
  }

  if (!has("holdings_flags", "user_id")) {
    database.exec(`
      CREATE TABLE holdings_flags_new (
        user_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        tax_advantaged INTEGER DEFAULT 0,
        updated_at TEXT,
        PRIMARY KEY (user_id, ticker)
      );
      INSERT INTO holdings_flags_new (user_id, ticker, tax_advantaged, updated_at)
        SELECT ${uid}, ticker, tax_advantaged, updated_at FROM holdings_flags;
      DROP TABLE holdings_flags;
      ALTER TABLE holdings_flags_new RENAME TO holdings_flags;
    `);
  }

  if (!has("recent_checks", "user_id")) {
    database.exec(`
      CREATE TABLE recent_checks_new (
        user_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        name TEXT,
        verdict_label TEXT,
        verdict_tone TEXT,
        price REAL,
        llm INTEGER DEFAULT 0,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (user_id, ticker)
      );
      INSERT INTO recent_checks_new
        SELECT ${uid}, ticker, name, verdict_label, verdict_tone, price, llm, checked_at
        FROM recent_checks;
      DROP TABLE recent_checks;
      ALTER TABLE recent_checks_new RENAME TO recent_checks;
    `);
  }

  if (!has("watchlist_verdict_state", "user_id")) {
    database.exec(`
      CREATE TABLE watchlist_verdict_state_new (
        user_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        last_verdict TEXT,
        last_label TEXT,
        last_checked_at TEXT,
        notified_at TEXT,
        PRIMARY KEY (user_id, ticker)
      );
      INSERT INTO watchlist_verdict_state_new
        SELECT ${uid}, ticker, last_verdict, last_label, last_checked_at, notified_at
        FROM watchlist_verdict_state;
      DROP TABLE watchlist_verdict_state;
      ALTER TABLE watchlist_verdict_state_new RENAME TO watchlist_verdict_state;
    `);
  }

  const now = new Date().toISOString();
  const upsert = database.prepare(
    `INSERT OR IGNORE INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
  );
  for (const key of ["riskTolerance", "videoSources", "holdingsMapping", "holdingsAsOf"]) {
    const v = readSetting(database, key);
    if (v != null) upsert.run(uid, key, JSON.stringify(v), now);
  }

  markMigration(database, "multi_user_v1");
  console.log(`[migrate] multi_user_v1 applied — legacy personal data attached to user_id=${uid}`);
  return { migrated: true, adminUserId: uid };
}
