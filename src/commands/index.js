const fs = require('node:fs');
const path = require('node:path');
const { Collection, REST, Routes } = require('discord.js');
const config = require('../config/configManager');
const logger = require('../utils/logger');

/**
 * Loads every command module in this directory into a Collection keyed by
 * command name. Future commands just need to export { data, execute } and
 * drop a file here — no other wiring required.
 */
function loadCommands() {
  const commands = new Collection();
  const files = fs.readdirSync(__dirname).filter((file) => file.endsWith('.js') && file !== 'index.js');

  for (const file of files) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const command = require(path.join(__dirname, file));
    if (!command?.data?.name || typeof command.execute !== 'function') {
      logger.warn(`Skipping invalid command file: ${file}`);
      continue;
    }
    commands.set(command.data.name, command);
  }

  return commands;
}

/**
 * Registers loaded commands with Discord. Uses guild-scoped registration
 * (instant) when DISCORD_GUILD_ID is set, otherwise falls back to global
 * registration (can take up to an hour to propagate).
 */
async function registerCommands(commands, clientId) {
  const rest = new REST().setToken(config.discord.token); // defaults to API v10
  const body = [...commands.values()].map((command) => command.data.toJSON());

  try {
    if (config.discord.guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, config.discord.guildId), { body });
      logger.info(`Registered ${body.length} guild slash command(s)`, { guildId: config.discord.guildId });
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      logger.info(`Registered ${body.length} global slash command(s) — may take up to 1 hour to propagate`);
    }
  } catch (err) {
    logger.error('Failed to register slash commands', { error: err.message });
  }
}

module.exports = { loadCommands, registerCommands };
