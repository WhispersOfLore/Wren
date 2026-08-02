const { Events } = require('discord.js');
const config = require('../config/configManager');
const logger = require('../utils/logger');
const { handleMention } = require('../interactions/mentionHandler');
const { handlePrefix, matchesPrefix } = require('../interactions/prefixHandler');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;
    if (message.channelId !== config.discord.channelId) return;
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
