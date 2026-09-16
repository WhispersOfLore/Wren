const { run, get, all } = require('./database');
const { tokenize } = require('./searchUtils');
const playerManager = require('./playerManager');
const auditLog = require('../audit/auditLog');
const config = require('../config/configManager');

const CATEGORIES = ['personal', 'achievement', 'relationship', 'event', 'server'];
const DEFAULT_CATEGORY = 'personal';

const IMPORTANCE_LABELS = {
  1: 'minor',
  2: 'normal',
  3: 'important',
  4: 'major',
  5: 'legendary',
};

// Canonical: trusted, admin-authored fact. Observation: something Wren might
// one day notice herself — not yet created by anything (see
// docs/ARCHITECTURE.md). Every memory is 'canonical' until that future work
// lands; this constant exists so validation is ready ahead of time.
const SOURCES = ['canonical', 'observation'];
const DEFAULT_SOURCE = 'canonical';

// Phase 17 (Part H): 'internal' is the safe default for every memory --
// nothing is public unless an admin explicitly opts it in later. Not
// exposed in the current /wren memory modal (out of scope for this
// phase); the field and its enforcement exist so that work can land
// later without another schema change.
const VISIBILITIES = ['internal', 'public'];
const DEFAULT_VISIBILITY = 'internal';

// Civic-specific vocabulary matching ClayMoneyTrail/Cthrew's own
// verification-status model -- optional, left null for ordinary
// non-civic memories where the concept doesn't apply. Never set to
// 'verified_fact' by anything other than an explicit admin action; the
// LLM has no path to writing this field at all (see ai/personality.js's
// CIVIC RESEARCH EVIDENCE RULE).
const VERIFICATION_STATUSES = ['verified_fact', 'allegation', 'unverified_lead', 'hypothesis', 'rejected', 'deprecated'];

function isValidImportance(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function isValidCategory(value) {
  return CATEGORIES.includes(value);
}

function isValidSource(value) {
  return SOURCES.includes(value);
}

function isValidVisibility(value) {
  return VISIBILITIES.includes(value);
}

function isValidVerificationStatus(value) {
  return value == null || VERIFICATION_STATUSES.includes(value);
}

/**
 * @param {{ discordId: string, category?: string, content: string, importance?: number, source?: string, visibility?: string, verificationStatus?: string|null, createdBy: string }} params
 */
async function addMemory({ discordId, category, content, importance, source, visibility, verificationStatus, createdBy }) {
  const resolvedCategory = isValidCategory(category) ? category : DEFAULT_CATEGORY;
  const resolvedImportance = isValidImportance(importance) ? importance : 3;
  const resolvedSource = isValidSource(source) ? source : DEFAULT_SOURCE;
  const resolvedVisibility = isValidVisibility(visibility) ? visibility : DEFAULT_VISIBILITY;
  const resolvedVerificationStatus = isValidVerificationStatus(verificationStatus) ? verificationStatus : null;

  // Phase 17 guild isolation: every NEW memory is stamped with the current
  // configured guild automatically -- never caller-supplied, so there is
  // no code path that can write a memory tagged for a different guild.
  const userId = await playerManager.ensureUser(discordId);
  const result = await run(
    `INSERT INTO memories (user_id, category, content, importance, source, created_by, guild_id, visibility, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, resolvedCategory, content, resolvedImportance, resolvedSource, createdBy, config.discord.guildId, resolvedVisibility, resolvedVerificationStatus],
  );

  auditLog.record({
    action: 'memory.add',
    actor: createdBy,
    target: discordId,
    details: { memoryId: result.lastID, category: resolvedCategory, importance: resolvedImportance },
  });

  return result.lastID;
}

async function getMemoryById(id) {
  return get(
    `SELECT memories.*, users.discord_id, users.minecraft_username, users.display_name
     FROM memories JOIN users ON users.id = memories.user_id
     WHERE memories.id = ?`,
    [id],
  );
}

/**
 * Partial update — only fields present in `changes` are touched. Returns
 * false if no memory exists with that ID (nothing to audit in that case).
 * @param {number} id
 * @param {{ content?: string, category?: string, importance?: number }} changes
 * @param {string} actorId
 */
async function updateMemory(id, changes, actorId) {
  const existing = await getMemoryById(id);
  if (!existing) return false;

  const next = {
    content: changes.content !== undefined ? changes.content : existing.content,
    category: isValidCategory(changes.category) ? changes.category : existing.category,
    importance: isValidImportance(changes.importance) ? changes.importance : existing.importance,
  };

  await run('UPDATE memories SET content = ?, category = ?, importance = ? WHERE id = ?', [
    next.content,
    next.category,
    next.importance,
    id,
  ]);

  auditLog.record({
    action: 'memory.edit',
    actor: actorId,
    target: existing.discord_id,
    details: {
      memoryId: id,
      from: { content: existing.content, category: existing.category, importance: existing.importance },
      to: next,
    },
  });

  return true;
}

async function getMemoriesForUser(discordId, limit = 25) {
  return all(
    `SELECT memories.* FROM memories
     JOIN users ON users.id = memories.user_id
     WHERE users.discord_id = ?
     ORDER BY importance DESC, memories.created_at DESC
     LIMIT ?`,
    [discordId, limit],
  );
}

async function removeMemory(id, actorId) {
  const existing = await getMemoryById(id);
  if (!existing) return false;

  const result = await run('DELETE FROM memories WHERE id = ?', [id]);
  if (result.changes > 0) {
    auditLog.record({
      action: 'memory.remove',
      actor: actorId,
      target: existing.discord_id,
      details: { memoryId: id, content: existing.content },
    });
  }
  return result.changes > 0;
}

/**
 * Admin-facing keyword search across all memories (not the AI-context
 * retrieval ranking — see memoryRetriever.js for that). Returns full rows
 * with player display info for review.
 */
async function searchMemories(query, limit = 10) {
  const keywords = tokenize(query);
  if (keywords.length === 0) return [];

  const clause = keywords.map(() => 'memories.content LIKE ?').join(' OR ');
  const params = keywords.map((k) => `%${k}%`);

  return all(
    `SELECT memories.*, users.discord_id, users.minecraft_username, users.display_name
     FROM memories
     JOIN users ON users.id = memories.user_id
     WHERE ${clause}
     ORDER BY memories.importance DESC, memories.created_at DESC
     LIMIT ?`,
    [...params, limit],
  );
}

async function getMemoryCount() {
  const row = await get('SELECT COUNT(*) AS count FROM memories');
  return row.count;
}

module.exports = {
  CATEGORIES,
  IMPORTANCE_LABELS,
  SOURCES,
  VISIBILITIES,
  VERIFICATION_STATUSES,
  isValidCategory,
  isValidImportance,
  isValidSource,
  isValidVisibility,
  isValidVerificationStatus,
  addMemory,
  getMemoryById,
  updateMemory,
  getMemoriesForUser,
  removeMemory,
  searchMemories,
  getMemoryCount,
};
