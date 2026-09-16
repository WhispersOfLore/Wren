const { Events, ActivityType } = require('discord.js');
const logger = require('../utils/logger');
const statusManager = require('../managers/statusManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    const enabled = statusManager.isEnabled();
    logger.info(`Wren is online as ${client.user.tag}`, { enabled });
    client.user.setActivity(enabled ? 'the community' : 'in sleep mode', { type: ActivityType.Watching });
  },
};
