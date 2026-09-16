const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { isAllowedGuild } = require('../utils/guildGuard');
const { handleMention } = require('../interactions/mentionHandler');
const { handlePrefix, matchesPrefix } = require('../interactions/prefixHandler');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;
    // Guild-scoped, not channel-scoped, as of Phase 17: public
    // conversation works anywhere in the one configured community guild.
    // A message with no guildId (a DM) or from any other guild is ignored
    // -- Wren has no DM features and must never respond outside her one
    // configured guild.
    if (!isAllowedGuild(message.guildId)) return;
    if (!message.content?.trim()) return;

    try {
      if (message.mentions.has(client.user)) {
        await handleMention(message, client);
      } else if (matchesPrefix(message.content)) {
        await handlePrefix(message);
      }
      // No mention, no prefix — Wren stays quiet. This is intentional:
      // Phase 1 makes her a summoned companion, not an ambient chatbot.
    } catch (err) {
      logger.error('Unexpected error handling message', { error: err.message, stack: err.stack });
      await message.channel.send('Well, that went sideways. Give me a moment, sugar.').catch(() => {});
    }
  },
};
