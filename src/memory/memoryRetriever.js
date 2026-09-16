const { all } = require('./database');
const { tokenize } = require('./searchUtils');
const config = require('../config/configManager');

/**
 * Phase 17 guild isolation: every retrieval query below is filtered to
 * `guild_id = <the current configured guild>` in SQL, not filtered after
 * the fact in JS -- a row can never even be fetched from the wrong guild,
 * let alone accidentally slip through. Rows written before this migration
 * (all pre-Phase-17 WhisperSMP-era content) have `guild_id IS NULL` and
 * therefore never match this equality filter in ANY guild, including the
 * one they actually came from -- they are preserved (never deleted) but
 * structurally excluded from every live conversation. See
 * docs/ARCHITECTURE.md for the full migration-implications writeup.
 */
function currentGuildId() {
  return config.discord.guildId;
}

/**
 * Scores pre-filtered candidate rows by how many query keywords they match
 * (weighted heaviest) plus their importance (a light tiebreaker/boost).
 * Rows with zero keyword matches are dropped entirely — importance alone
 * never surfaces an unrelated memory or lore entry into context.
 */
function scoreMatches(rows, keywords, fields) {
  return rows
    .map((row) => {
      const haystack = fields.map((field) => (row[field] || '').toLowerCase()).join(' ');
      const matchCount = keywords.filter((keyword) => haystack.includes(keyword)).length;
      return { row, matchCount, score: matchCount * 10 + row.importance };
    })
    .filter((entry) => entry.matchCount > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row);
}

// Phase 17 (Part G/H/M): this whole module is Wren's PUBLIC conversational
// retrieval path -- its only caller is conversationManager.js, which only
// ever backs mentions and /wren ask, never the admin-gated project-
// awareness/handoff commands (those build their own REFERENCE CONTEXT
// directly from project files, never from this database). Filtering to
// `visibility = 'public'` here is therefore the actual public/internal
// knowledge boundary: everything defaults to 'internal' at write time
// (see memoryManager.js/loreManager.js), so nothing surfaces here unless
// an admin explicitly opted it in.
async function findRelevantMemories(keywords, limit) {
  if (keywords.length === 0 || limit <= 0) return [];

  const clause = keywords.map(() => 'memories.content LIKE ?').join(' OR ');
  const params = keywords.map((keyword) => `%${keyword}%`);

  const candidates = await all(
    `SELECT memories.*, users.discord_id, users.minecraft_username, users.display_name
     FROM memories
     JOIN users ON users.id = memories.user_id
     WHERE memories.guild_id = ? AND memories.visibility = 'public' AND (${clause})`,
    [currentGuildId(), ...params],
  );

  return scoreMatches(candidates, keywords, ['content']).slice(0, limit);
}

async function findRelevantLore(keywords, limit) {
  if (keywords.length === 0 || limit <= 0) return [];

  const clause = keywords.map(() => '(title LIKE ? OR content LIKE ?)').join(' OR ');
  const params = keywords.flatMap((keyword) => [`%${keyword}%`, `%${keyword}%`]);

  const candidates = await all(
    `SELECT * FROM lore WHERE guild_id = ? AND visibility = 'public' AND (${clause})`,
    [currentGuildId(), ...params],
  );

  return scoreMatches(candidates, keywords, ['title', 'content']).slice(0, limit);
}

// Source-grounded formatting (Part N): when a row carries a civic
// verification_status, it is shown explicitly and verbatim, never
// smoothed over -- the model receives "allegation: ..." as literally
// that, never upgraded to a bare statement of fact. Ordinary memories/
// lore with no verification_status print unchanged, exactly as before.
function statusPrefix(row) {
  return row.verification_status ? `[${row.verification_status}] ` : '';
}

function formatMemory(row) {
  const who = row.display_name || row.minecraft_username || `Discord user ${row.discord_id}`;
  return `- ${who}: ${statusPrefix(row)}${row.content}`;
}

function formatLore(row) {
  return `- ${row.title}: ${statusPrefix(row)}${row.content}`;
}

/**
 * The core "never dump the database" retrieval step: given free text (the
 * player's current message), returns only the memories/lore that share
 * keywords with it, ranked by match strength then importance, capped to
 * config.memoryRetrieval limits.
 */
async function retrieve(query) {
  const keywords = tokenize(query);
  if (keywords.length === 0) return { memories: [], lore: [] };

  const [memories, lore] = await Promise.all([
    findRelevantMemories(keywords, config.memoryRetrieval.maxMemories),
    findRelevantLore(keywords, config.memoryRetrieval.maxLore),
  ]);

  return { memories, lore };
}

/**
 * Returns a ready-to-inject system-prompt fragment, or '' if nothing in the
 * database is relevant to this query — callers should skip adding it
 * entirely rather than inject an empty "RELEVANT MEMORIES:" header.
 */
async function buildContextBlock(query) {
  const { memories, lore } = await retrieve(query);
  if (memories.length === 0 && lore.length === 0) return '';

  const sections = [];
  if (memories.length > 0) {
    sections.push(`RELEVANT MEMORIES:\n${memories.map(formatMemory).join('\n')}`);
  }
  if (lore.length > 0) {
    sections.push(`RELEVANT LORE:\n${lore.map(formatLore).join('\n')}`);
  }

  return sections.join('\n\n');
}

module.exports = { retrieve, buildContextBlock };
