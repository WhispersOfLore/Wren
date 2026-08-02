const instanceLock = require('./utils/instanceLock');

instanceLock.acquire();

const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config/configManager');
const logger = require('./utils/logger');
const ready = require('./events/ready');
const messageCreate = require('./events/messageCreate');
const interactionCreate = require('./events/interactionCreate');
const { loadCommands, registerCommands } = require('./commands');

// No DM or reaction-based features exist, so message/channel objects are
// always fully cached — partials aren't needed and are omitted deliberately
// (an unused partials config is a latent source of "accessed a partial
// without checking .partial" bugs if a feature is added carelessly later).
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = loadCommands();

client.once(ready.name, async (readyClient) => {
  ready.execute(readyClient);
  await registerCommands(client.commands, readyClient.user.id);
});

client.on(messageCreate.name, (message) => {
  messageCreate.execute(message, client).catch((err) => {
    logger.error('Unhandled error in messageCreate handler', { error: err.message, stack: err.stack });
  });
});

client.on(interactionCreate.name, (interaction) => {
  interactionCreate.execute(interaction, client).catch((err) => {
    logger.error('Unhandled error in interactionCreate handler', { error: err.message, stack: err.stack });
  });
});

client.on('error', (err) => {
  logger.error('Discord client error', { error: err.message });
});

client.on('shardDisconnect', () => {
  logger.warn('Discord shard disconnected');
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', { error: err?.message, stack: err?.stack });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down Wren gracefully.`);
  await client.destroy();
  instanceLock.release();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Best-effort safety net for exit paths that don't go through shutdown()
// (e.g. an uncaught exception's implicit exit) — release() is a no-op if
// the lock was already released, and only ever does a synchronous unlink.
process.on('exit', () => instanceLock.release());

logger.info('Starting Wren...', { env: config.env, model: config.ai.model });

client.login(config.discord.token).catch((err) => {
  logger.error('Failed to log in to Discord', { error: err.message });
  process.exit(1);
});
