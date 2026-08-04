const { Events } = require('discord.js');
const logger = require('../utils/logger');
const controlPanel = require('../control/controlPanel');
const memoryPanel = require('../control/memoryPanel');
const lorePanel = require('../control/lorePanel');
const { ephemeral } = require('../utils/discordReply');

// Each admin UI surface owns a customId prefix; interactionCreate just
// routes by prefix rather than knowing anything about buttons/modals itself.
const COMPONENT_ROUTES = [
  { prefix: 'wren_control_', handle: controlPanel.handleComponent },
  { prefix: 'wren_memory_', handle: memoryPanel.handleComponent },
  { prefix: 'wren_lore_', handle: lorePanel.handleComponent },
];

const MODAL_ROUTES = [
  { prefix: 'wren_control_', handle: controlPanel.handleModalSubmit },
  { prefix: 'wren_memory_', handle: memoryPanel.handleModalSubmit },
  { prefix: 'wren_lore_', handle: lorePanel.handleModalSubmit },
];

// Select menus (string or user select) route the same way as buttons —
// currently the control panel's mood picker and the memory panel's Add
// Memory flow (member/category/importance pickers).
const SELECT_ROUTES = [
  { prefix: 'wren_control_', handle: controlPanel.handleSelectMenu },
  { prefix: 'wren_memory_', handle: memoryPanel.handleSelectMenu },
];

function findHandler(routes, customId) {
  const route = routes.find((r) => customId.startsWith(r.prefix));
  return route?.handle;
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) {
          logger.warn('Received unknown slash command', { name: interaction.commandName });
          return;
        }
        await command.execute(interaction, client);
        return;
      }

      if (interaction.isButton()) {
        const handle = findHandler(COMPONENT_ROUTES, interaction.customId);
        if (handle) await handle(interaction);
        return;
      }

      if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
        const handle = findHandler(SELECT_ROUTES, interaction.customId);
        if (handle) await handle(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        const handle = findHandler(MODAL_ROUTES, interaction.customId);
        if (handle) await handle(interaction);
      }
    } catch (err) {
      logger.error('Unhandled error in interactionCreate', { error: err.message, stack: err.stack });
      const payload = ephemeral({ content: 'Something went sideways, sugar. Try again in a moment.' });
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (_) {
        // Interaction token likely expired; nothing more we can do.
      }
    }
  },
};
