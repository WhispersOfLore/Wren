const { run, get, all } = require('./database');
const { tokenize } = require('./searchUtils');
const playerManager = require('./playerManager');
const auditLog = require('../audit/auditLog');

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

function isValidImportance(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function isValidCategory(value) {
  return CATEGORIES.includes(value);
}

function isValidSource(value) {
  return SOURCES.includes(value);
}

/**
 * @param {{ discordId: string, category?: string, content: string, importance?: number, source?: string, createdBy: string }} params
 */
async function addMemory({ discordId, category, content, importance, source, createdBy }) {
  const resolvedCategory = isValidCategory(category) ? category : DEFAULT_CATEGORY;
  const resolvedImportance = isValidImportance(importance) ? importance : 3;
  const resolvedSource = isValidSource(source) ? source : DEFAULT_SOURCE;

  const userId = await playerManager.ensureUser(discordId);
  const result = await run(
    'INSERT INTO memories (user_id, category, content, importance, source, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, resolvedCategory, content, resolvedImportance, resolvedSource, createdBy],
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
  isValidCategory,
  isValidImportance,
  isValidSource,
  addMemory,
  getMemoryById,
  updateMemory,
  getMemoriesForUser,
  removeMemory,
  searchMemories,
  getMemoryCount,
};
