const config = require('../config/configManager');
const { handleWrenRequest } = require('./responder');
const { replyToMessage } = require('../utils/discordReply');

function matchesPrefix(content) {
  const prefix = config.interaction.prefix.toLowerCase();
  return content.trim().toLowerCase().startsWith(prefix);
}

function stripPrefix(content) {
  return content.trim().slice(config.interaction.prefix.length).trim();
}

async function handlePrefix(message) {
  const text = stripPrefix(message.content);

  if (config.discord.typingIndicator) {
    await message.channel.sendTyping().catch(() => {});
  }

  const { reply } = await handleWrenRequest({
    userId: message.author.id,
    channelId: message.channelId,
    text,
  });

  await replyToMessage(message, reply);
}

module.exports = { handlePrefix, matchesPrefix };
