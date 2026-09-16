const config = require('../config/configManager');
const { handleHandoffDraftRequest } = require('../services/handoffDraft');
const { sendChunkedReply } = require('../utils/chunkedReply');
const { ephemeral } = require('../utils/discordReply');

/** Admin-only gating already happened in commands/wren.js; uses chunked replies since a draft can be long. */
async function handleHandoffDraft(interaction) {
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
