const config = require('../config/configManager');
const { handleProjectAwarenessRequest } = require('../services/projectAwareness');
const { replyToInteraction, ephemeral } = require('../utils/discordReply');

/** Mirrors slashHandler.js's handleAsk: same channel restriction, same defer/reply shape. */
async function handleProject(interaction) {
  if (interaction.channelId !== config.discord.channelId) {
    await interaction.reply(ephemeral({ content: `I only hold court in <#${config.discord.channelId}>, sugar.` }));
    return;
  }

  if (!config.projectAwareness.enabled) {
    await interaction.reply(ephemeral({ content: "Project awareness is turned off right now, sugar." }));
    return;
  }

  await interaction.deferReply();

  const projectName = interaction.options.getString('name', true);
  const { reply } = await handleProjectAwarenessRequest({
    userId: interaction.user.id,
    projectName,
  });

  await replyToInteraction(interaction, reply);
}

module.exports = { handleProject };
