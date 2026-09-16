const config = require('../config/configManager');
const { handleHandoffDraftRequest } = require('../services/handoffDraft');
const { sendChunkedReply } = require('../utils/chunkedReply');
const { ephemeral } = require('../utils/discordReply');

/** Mirrors projectHandler.js's channel/enabled checks; uses chunked replies since a draft can be long. */
async function handleHandoffDraft(interaction) {
  if (interaction.channelId !== config.discord.channelId) {
    await interaction.reply(ephemeral({ content: `I only hold court in <#${config.discord.channelId}>, sugar.` }));
    return;
  }

  if (!config.projectAwareness.enabled) {
    await interaction.reply(ephemeral({ content: 'Project awareness is turned off right now, sugar.' }));
    return;
  }

  await interaction.deferReply();

  const projectName = interaction.options.getString('name', true);
  const { reply } = await handleHandoffDraftRequest({
    userId: interaction.user.id,
    projectName,
    agent: 'Wren',
  });

  await sendChunkedReply(interaction, reply);
}

module.exports = { handleHandoffDraft };
