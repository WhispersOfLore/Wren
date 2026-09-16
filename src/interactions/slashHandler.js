const { handleWrenRequest } = require('./responder');
const { replyToInteraction } = require('../utils/discordReply');

// Guild-scoped, not channel-scoped, as of Phase 17: /wren ask is Wren's
// core public community path and works anywhere in the one configured
// guild (already enforced centrally in events/interactionCreate.js).
async function handleAsk(interaction) {
  await interaction.deferReply();

  const text = interaction.options.getString('message', true);
  const { reply } = await handleWrenRequest({
    userId: interaction.user.id,
    channelId: interaction.channelId,
    text,
  });

  await replyToInteraction(interaction, reply);
}

module.exports = { handleAsk };
