const { run, get, all } = require('../memory/database');
const { tokenize } = require('../memory/searchUtils');
const auditLog = require('../audit/auditLog');

const CATEGORIES = ['kingdom', 'location', 'npc', 'history', 'event', 'rules'];
const DEFAULT_IMPORTANCE = 3;

function isValidCategory(value) {
  return CATEGORIES.includes(value);
}

function isValidImportance(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * @param {{ category: string, title: string, content: string, importance?: number, createdBy: string }} params
 */
async function addLore({ category, title, content, importance, createdBy }) {
  const resolvedCategory = isValidCategory(category) ? category : 'history';
  const resolvedImportance = isValidImportance(importance) ? importance : DEFAULT_IMPORTANCE;

  const result = await run(
    'INSERT INTO lore (category, title, content, importance, created_by) VALUES (?, ?, ?, ?, ?)',
    [resolvedCategory, title, content, resolvedImportance, createdBy],
  );

  auditLog.record({
    action: 'lore.add',
    actor: createdBy,
    target: title,
    details: { loreId: result.lastID, category: resolvedCategory },
  });

  return result.lastID;
}

async function getLoreById(id) {
  return get('SELECT * FROM lore WHERE id = ?', [id]);
}

/**
 * Partial update — only fields present in `changes` are touched. Returns
 * false if no lore exists with that ID.
 * @param {number} id
 * @param {{ title?: string, content?: string, category?: string }} changes
 * @param {string} actorId
 */
async function updateLore(id, changes, actorId) {
  const existing = await getLoreById(id);
  if (!existing) return false;

  const next = {
    title: changes.title !== undefined ? changes.title : existing.title,
    content: changes.content !== undefined ? changes.content : existing.content,
    category: isValidCategory(changes.category) ? changes.category : existing.category,
  };

  await run('UPDATE lore SET title = ?, content = ?, category = ? WHERE id = ?', [
    next.title,
    next.content,
    next.category,
    id,
  ]);

  auditLog.record({
    action: 'lore.edit',
    actor: actorId,
    target: next.title,
    details: {
      loreId: id,
      from: { title: existing.title, content: existing.content, category: existing.category },
      to: next,
    },
  });

  return true;
}

async function removeLore(id, actorId) {
  const existing = await getLoreById(id);
  if (!existing) return false;

  const result = await run('DELETE FROM lore WHERE id = ?', [id]);
  if (result.changes > 0) {
    auditLog.record({
      action: 'lore.remove',
      actor: actorId,
      target: existing.title,
      details: { loreId: id },
    });
  }
  return result.changes > 0;
}

/**
 * Admin-facing keyword search across all lore (not the AI-context retrieval
 * ranking — see memoryRetriever.js for that).
 */
async function searchLore(query, limit = 10) {
  const keywords = tokenize(query);
  if (keywords.length === 0) return [];

  const clause = keywords.map(() => '(title LIKE ? OR content LIKE ?)').join(' OR ');
  const params = keywords.flatMap((k) => [`%${k}%`, `%${k}%`]);

  return all(
    `SELECT * FROM lore WHERE ${clause} ORDER BY importance DESC, created_at DESC LIMIT ?`,
    [...params, limit],
  );
}

async function getLoreCount() {
  const row = await get('SELECT COUNT(*) AS count FROM lore');
  return row.count;
}

module.exports = {
  CATEGORIES,
  isValidCategory,
  isValidImportance,
  addLore,
  getLoreById,
  updateLore,
  removeLore,
  searchLore,
  getLoreCount,
};
