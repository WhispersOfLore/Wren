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
 */
function ensureColumn(table, column, definitionSql) {
  db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
    if (err) {
      logger.error(`Failed to inspect schema for ${table}`, { error: err.message });
      return;
    }

    if (rows.some((row) => row.name === column)) return;

    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definitionSql}`, (alterErr) => {
      if (alterErr) {
        logger.error(`Failed to add column ${table}.${column}`, { error: alterErr.message });
      } else {
        logger.info(`Migrated schema: added ${table}.${column}`);
      }
    });
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
