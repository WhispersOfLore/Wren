const config = require('../config/configManager');
const { handleWrenRequest } = require('./responder');
const { replyToInteraction, ephemeral } = require('../utils/discordReply');

async function handleAsk(interaction) {
  if (interaction.channelId !== config.discord.channelId) {
    await interaction.reply(ephemeral({ content: `I only hold court in <#${config.discord.channelId}>, sugar.` }));
    return;
  }

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
