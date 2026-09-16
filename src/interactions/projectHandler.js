const config = require('../config/configManager');
const { handleProjectAwarenessRequest } = require('../services/projectAwareness');
const { replyToInteraction, ephemeral } = require('../utils/discordReply');

/** Admin-only gating (identity + optional channel) already happened in commands/wren.js before this is called. */
async function handleProject(interaction) {
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
