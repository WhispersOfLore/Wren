const { SlashCommandBuilder } = require('discord.js');
const permissionManager = require('../control/permissionManager');
const { buildControlPanel } = require('../control/controlPanel');
const { buildMemoryPanel } = require('../control/memoryPanel');
const { buildLorePanel } = require('../control/lorePanel');
const { handleAsk } = require('../interactions/slashHandler');
const { handleProject } = require('../interactions/projectHandler');
const { handleHandoffDraft } = require('../interactions/handoffDraftHandler');
const { handleHandoffApprove, handleHandoffReject, handleHandoffPlan } = require('../interactions/handoffApprovalHandler');
const { denyUnlessAdminOps } = require('../utils/adminGate');
const { ephemeral } = require('../utils/discordReply');
const { listAllowedProjects } = require('../services/projectContext');

/**
 * Replies with a denial and returns true if the invoking member isn't an
 * admin, so subcommand handlers can `if (await denyIfNotAdmin(interaction)) return;`
 * instead of repeating the same three lines each.
 */
async function denyIfNotAdmin(interaction) {
  if (permissionManager.isAdmin(interaction.member)) return false;
  await interaction.reply(ephemeral({ content: "This isn't for you, sugar. Admins only." }));
  return true;
}

// Discord doesn't allow a command to mix a bare option with subcommands, so
// every Wren surface lives as a subcommand of one /wren root.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('wren')
    .setDescription('Talk to Wren or manage her')
    .addSubcommand((sub) =>
      sub
        .setName('ask')
        .setDescription('Ask Wren something directly')
        .addStringOption((opt) =>
          opt.setName('message').setDescription('What do you want to say to Wren?').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('control').setDescription('Open the Wren control panel (admin only)'))
    .addSubcommand((sub) => sub.setName('memory').setDescription("Manage Wren's memories (admin only)"))
    .addSubcommand((sub) => sub.setName('lore').setDescription("Manage Wren's lore archive (admin only)"))
    .addSubcommand((sub) =>
      sub
        .setName('project')
        .setDescription("Ask Wren what's happening with a project (read-only, admin only)")
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Which project?')
            .setRequired(true)
            .addChoices(...listAllowedProjects().map((name) => ({ name, value: name }))),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('handoff-draft')
        .setDescription('Draft a text-only handoff summary for a project (never saved, admin only)')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Which project?')
            .setRequired(true)
            .addChoices(...listAllowedProjects().map((name) => ({ name, value: name }))),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('handoff-approve')
        .setDescription('Approve a handoff draft you (or an admin) reviewed -- does not save anything (admin only)')
        .addStringOption((opt) =>
          opt.setName('draft-id').setDescription('The Draft ID shown with the draft').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('handoff-reject')
        .setDescription('Reject a handoff draft -- final, does not save anything (admin only)')
        .addStringOption((opt) =>
          opt.setName('draft-id').setDescription('The Draft ID shown with the draft').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('handoff-plan')
        .setDescription('Preview what an approved draft could persist -- dry run, saves nothing (admin only)')
        .addStringOption((opt) =>
          opt.setName('draft-id').setDescription('The Draft ID of an approved draft').setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'ask') {
      await handleAsk(interaction);
      return;
    }

    if (sub === 'control') {
      if (await denyIfNotAdmin(interaction)) return;
      await interaction.reply(ephemeral(await buildControlPanel()));
      return;
    }

    if (sub === 'memory') {
      if (await denyIfNotAdmin(interaction)) return;
      await interaction.reply(ephemeral(await buildMemoryPanel()));
      return;
    }

    if (sub === 'lore') {
      if (await denyIfNotAdmin(interaction)) return;
      await interaction.reply(ephemeral(await buildLorePanel()));
      return;
    }

    // project/handoff-* expose internal project state, repository
    // information, and persistence-plan previews -- admin-only as of
    // Phase 17 (Part G). See utils/adminGate.js for why this doesn't
    // weaken handoff-approve/reject/plan's own internal authorization.
    if (sub === 'project') {
      if (await denyUnlessAdminOps(interaction)) return;
      await handleProject(interaction);
      return;
    }

    if (sub === 'handoff-draft') {
      if (await denyUnlessAdminOps(interaction)) return;
      await handleHandoffDraft(interaction);
      return;
    }

    if (sub === 'handoff-approve') {
      if (await denyUnlessAdminOps(interaction)) return;
      await handleHandoffApprove(interaction);
      return;
    }

    if (sub === 'handoff-reject') {
      if (await denyUnlessAdminOps(interaction)) return;
      await handleHandoffReject(interaction);
      return;
    }

    if (sub === 'handoff-plan') {
      if (await denyUnlessAdminOps(interaction)) return;
      await handleHandoffPlan(interaction);
    }
  },
};
