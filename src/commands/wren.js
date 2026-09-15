const { SlashCommandBuilder } = require('discord.js');
const permissionManager = require('../control/permissionManager');
const { buildControlPanel } = require('../control/controlPanel');
const { buildMemoryPanel } = require('../control/memoryPanel');
const { buildLorePanel } = require('../control/lorePanel');
const { handleAsk } = require('../interactions/slashHandler');
const { handleProject } = require('../interactions/projectHandler');
const playerManager = require('../memory/playerManager');
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
    .addSubcommand((sub) =>
      sub
        .setName('link')
        .setDescription('Link your Discord account to your Minecraft username')
        .addStringOption((opt) =>
          opt.setName('minecraft_username').setDescription('Your Minecraft username').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('memory').setDescription("Manage Wren's memories (admin only)"))
    .addSubcommand((sub) => sub.setName('lore').setDescription("Manage Wren's lore archive (admin only)"))
    .addSubcommand((sub) =>
      sub
        .setName('project')
        .setDescription("Ask Wren what's happening with a project (read-only)")
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Which project?')
            .setRequired(true)
            .addChoices(...listAllowedProjects().map((name) => ({ name, value: name }))),
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

    if (sub === 'link') {
      const minecraftUsername = interaction.options.getString('minecraft_username', true).trim();
      if (!minecraftUsername) {
        await interaction.reply(ephemeral({ content: "That username's empty, sugar. Try again." }));
        return;
      }

      await playerManager.linkPlayer(interaction.user.id, minecraftUsername, interaction.user.username);

      await interaction.reply(
        ephemeral({ content: `Got it — you're linked as **${minecraftUsername}**. I'll remember that, sugar.` }),
      );
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

    if (sub === 'project') {
      await handleProject(interaction);
    }
  },
};
