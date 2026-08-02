const { MessageFlags } = require('discord.js');
const { splitMessage } = require('./splitMessage');

/**
 * Merges the ephemeral flag into a reply/interaction response payload.
 * Centralizes the one place that knows how to mark a response ephemeral —
 * discord.js deprecated the `ephemeral: true` option in favor of `flags`
 * (confirmed: it emits a runtime deprecation warning), so every call site
 * routes through here instead of repeating the raw MessageFlags detail.
 */
function ephemeral(payload = {}) {
  return { ...payload, flags: MessageFlags.Ephemeral };
}

/**
 * Sends a (possibly long) reply to a regular Discord message, chunked to
 * stay under the 2000-character limit. First chunk uses reply() so it stays
 * threaded to the triggering message; remaining chunks are plain sends.
 */
async function replyToMessage(message, text) {
  const chunks = splitMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      // eslint-disable-next-line no-await-in-loop
      await message.reply(chunks[i]);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await message.channel.send(chunks[i]);
    }
  }
}

/**
 * Sends a (possibly long) reply to a slash command interaction. The
 * interaction must already be deferred or replied. First chunk edits the
 * deferred reply; remaining chunks are follow-ups.
 */
async function replyToInteraction(interaction, text) {
  const chunks = splitMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      // eslint-disable-next-line no-await-in-loop
      await interaction.editReply(chunks[i]);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await interaction.followUp(chunks[i]);
    }
  }
}

module.exports = { replyToMessage, replyToInteraction, ephemeral };
