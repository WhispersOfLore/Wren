const config = require('../config/configManager');

/**
 * Wren's primary safety boundary (Phase 17 / Wren Rebirth): she only
 * operates in the one configured guild (Whisper About It / Unfiltered
 * Talk Radio), never the old WhisperSMP/gaming guild or any other server
 * she might incidentally be added to. `config.discord.guildId` is the
 * single source of truth for this -- nothing else in the codebase should
 * hardcode a guild ID to compare against (verified by a regression test
 * that greps for a literal Discord-snowflake-shaped guild ID anywhere
 * outside this file and configManager.js).
 */
function isAllowedGuild(guildId) {
  return typeof guildId === 'string' && guildId === config.discord.guildId;
}

module.exports = { isAllowedGuild };
