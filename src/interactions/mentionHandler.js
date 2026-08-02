const config = require('../config/configManager');
const { handleWrenRequest } = require('./responder');
const { replyToMessage } = require('../utils/discordReply');

function stripMention(content, botUserId) {
  return content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').trim();
}

async function handleMention(message, client) {
  const text = stripMention(message.content, client.user.id);

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

module.exports = { handleMention };
