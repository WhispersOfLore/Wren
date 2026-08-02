const { run, get } = require('./database');
const logger = require('../utils/logger');

/**
 * Owns player identity: the users table (Discord ↔ Minecraft linking) only.
 * Split out from memoryManager.js so identity and memory-content concerns
 * each have one clear responsibility — memoryManager depends on this module
 * to resolve/create a user row, never the other way around.
 */

/**
 * Parses a Discord user out of free text typed into a modal field — modals
 * only support text inputs, but Discord's client still autocompletes
 * @mentions into literal <@id> text, so this accepts either that or a raw
 * numeric ID. Returns null if neither pattern matches.
 */
function parseDiscordId(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

async function getUserByDiscordId(discordId) {
  return get('SELECT * FROM users WHERE discord_id = ?', [discordId]);
}

/**
 * Finds (or lazily creates) the internal user row for a discord_id. Memories
 * can be recorded about a player before they've ever run /wren link — the
 * user row just won't have a minecraft_username yet.
 */
async function ensureUser(discordId) {
  const existing = await getUserByDiscordId(discordId);
  if (existing) return existing.id;

  const result = await run('INSERT INTO users (discord_id) VALUES (?)', [discordId]);
  return result.lastID;
}

/**
 * Links (or updates) a Discord identity to a Minecraft username. Self-service
 * — any player can link their own account via /wren link. Idempotent: an
 * existing link for this discord_id gets its minecraft_username/display_name
 * refreshed rather than creating a duplicate row.
 */
async function linkPlayer(discordId, minecraftUsername, displayName) {
  const existing = await getUserByDiscordId(discordId);

  if (existing) {
    await run(
      `UPDATE users SET minecraft_username = ?, display_name = ?, updated_at = datetime('now') WHERE discord_id = ?`,
      [minecraftUsername, displayName, discordId],
    );
    logger.info('Player link updated', { discordId, minecraftUsername });
    return { id: existing.id, updated: true };
  }

  const result = await run(
    'INSERT INTO users (discord_id, minecraft_username, display_name) VALUES (?, ?, ?)',
    [discordId, minecraftUsername, displayName],
  );
  logger.info('Player linked', { discordId, minecraftUsername });
  return { id: result.lastID, updated: false };
}

async function getLinkedPlayerCount() {
  const row = await get('SELECT COUNT(*) AS count FROM users WHERE minecraft_username IS NOT NULL');
  return row.count;
}

module.exports = {
  parseDiscordId,
  getUserByDiscordId,
  ensureUser,
  linkPlayer,
  getLinkedPlayerCount,
};
