const sqlite3 = require('sqlite3').verbose();
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'wren.db');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    logger.error('Failed to open Wren database', { error: err.message });
    throw err;
  }
});

/**
 * Adds a column to an existing table if it isn't already there. Lets schema
 * evolve (e.g. Phase 4's `memories.source` column, added to a database that
 * already existed from Phase 3) without a migration framework — additive,
 * idempotent, safe to run on every startup. Must be called from inside
 * db.serialize() to stay ordered relative to the CREATE TABLE statements.
 *
 * Runs `ALTER TABLE ... ADD COLUMN` directly and swallows the specific
 * "duplicate column name" error SQLite raises when it already exists,
 * rather than checking first via an async `PRAGMA table_info` query. The
 * check-first approach was tried during Phase 17 and caused a real race:
 * `db.all(PRAGMA...)`'s callback (and the ALTER it queues) fires only
 * after the synchronous portion of this db.serialize() block has already
 * finished submitting every other statement -- including later queries
 * from other modules that reference the new column -- so those could run
 * before the column existed. Queuing the ALTER directly, synchronously,
 * in this block preserves correct ordering the same way every other
 * statement here does.
 */
function ensureColumn(table, column, definitionSql) {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definitionSql}`, (err) => {
    if (!err) {
      logger.info(`Migrated schema: added ${table}.${column}`);
      return;
    }
    if (/duplicate column name/i.test(err.message)) return; // already migrated -- expected on every subsequent startup
    logger.error(`Failed to add column ${table}.${column}`, { error: err.message });
  });
}

/**
 * The single SQLite database backing both the Memory and Lore systems (one
 * file: data/wren.db). memoryManager.js, playerManager.js, and
 * lore/loreManager.js all import this module for their schema and queries
 * rather than each opening their own connection.
 */
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL UNIQUE,
    minecraft_username TEXT,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // `source` is schema prep for a future distinction between admin-authored
  // canonical knowledge and (not-yet-implemented) observations Wren might
  // one day notice herself — every memory is 'canonical' today, and nothing
  // yet writes 'observation'. See docs/ARCHITECTURE.md.
  db.run(`CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 3,
    source TEXT NOT NULL DEFAULT 'canonical',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Upgrade path for a database created before the `source` column existed
  // (CREATE TABLE IF NOT EXISTS above is a no-op against it) — additive,
  // idempotent, safe to run on every startup.
  ensureColumn('memories', 'source', `TEXT NOT NULL DEFAULT 'canonical'`);

  db.run(`CREATE TABLE IF NOT EXISTS lore (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 3,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Phase 17 (Wren Rebirth) guild isolation: `guild_id` is nullable and
  // additive, exactly like `source` above -- every row written before this
  // migration (all of it from the old WhisperSMP guild) gets `guild_id =
  // NULL`, never retroactively guessed or backfilled. memoryRetriever.js
  // only ever returns rows matching the CURRENT configured guild, so NULL
  // rows structurally cannot surface in the new community guild's
  // conversations -- without deleting a single row. See
  // docs/ARCHITECTURE.md's memory-isolation section for the full
  // migration-implications writeup.
  // No index on guild_id: ensureColumn()'s ALTER TABLE runs inside an
  // async PRAGMA callback, so a CREATE INDEX statement queued directly in
  // this synchronous serialize() block could run before the column
  // exists (confirmed as a real failure during Phase 17 development).
  // Not worth restructuring ensureColumn for an index a local, single-user
  // SQLite database doesn't meaningfully need yet.
  ensureColumn('memories', 'guild_id', 'TEXT');
  ensureColumn('lore', 'guild_id', 'TEXT');

  // Phase 17 civic-safety / public-knowledge boundary (Part H/M/N).
  // `visibility` ('internal' default, 'public' opt-in) gates what
  // memoryRetriever.js's public conversational path (mentions, /wren ask)
  // may surface -- everything defaults to internal, so nothing becomes
  // public as a side effect of this migration; an admin must explicitly
  // mark something public later. `verification_status` is optional and
  // civic-specific (verified_fact / allegation / unverified_lead /
  // hypothesis / etc., matching ClayMoneyTrail/Cthrew's own vocabulary) --
  // left NULL for ordinary, non-civic memories where the concept doesn't
  // apply. Neither column is populated by this migration; no content is
  // bulk-published or reclassified.
  ensureColumn('memories', 'visibility', `TEXT NOT NULL DEFAULT 'internal'`);
  ensureColumn('memories', 'verification_status', 'TEXT');
  ensureColumn('lore', 'visibility', `TEXT NOT NULL DEFAULT 'internal'`);
  ensureColumn('lore', 'verification_status', 'TEXT');

  db.run('CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)');
  db.run('CREATE INDEX IF NOT EXISTS idx_lore_importance ON lore(importance)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id)');
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function callback(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = { db, run, get, all, DB_PATH };
