const { PermissionFlagsBits } = require('discord.js');
const config = require('../config/configManager');

/**
 * A guild member may access Wren's control panel if either:
 *  - their user ID is explicitly listed in config.control.admins, or
 *  - they hold the Discord "Administrator" permission (unless that
 *    fallback has been turned off via control.requireAdministratorPermission).
 */
function isAdmin(member) {
  if (!member) return false;

  const admins = config.control.admins || [];
  if (admins.includes(member.id)) return true;

  if (!config.control.requireAdministratorPermission) return false;

  return member.permissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

module.exports = { isAdmin };
