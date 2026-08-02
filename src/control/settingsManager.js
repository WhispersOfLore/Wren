const config = require('../config/configManager');
const auditLog = require('../audit/auditLog');

const MIN_COOLDOWN_SECONDS = 0;
const MAX_COOLDOWN_SECONDS = 3600;

function getSettings() {
  return {
    cooldownSeconds: config.cooldown.seconds,
    prefix: config.interaction.prefix,
    model: config.ai.model,
  };
}

/**
 * Validates and applies control-panel setting changes, persisting them via
 * configManager. Returns { ok: true } on success or { ok: false, errors }
 * on validation failure — nothing is written unless everything is valid.
 */
function updateSettings({ cooldownSeconds, prefix }, actorId) {
  const errors = [];
  const updates = {};
  const previous = getSettings();

  if (cooldownSeconds !== undefined) {
    if (
      Number.isNaN(cooldownSeconds) ||
      cooldownSeconds < MIN_COOLDOWN_SECONDS ||
      cooldownSeconds > MAX_COOLDOWN_SECONDS
    ) {
      errors.push(`Cooldown must be between ${MIN_COOLDOWN_SECONDS} and ${MAX_COOLDOWN_SECONDS} seconds.`);
    } else {
      updates.cooldownSeconds = cooldownSeconds;
    }
  }

  if (prefix !== undefined) {
    const trimmed = prefix.trim();
    if (!trimmed) {
      errors.push('Prefix cannot be empty.');
    } else {
      updates.prefix = trimmed;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  config.updateSettings(updates);
  auditLog.record({
    action: 'settings.update',
    actor: actorId,
    details: { from: previous, to: { ...previous, ...updates } },
  });
  return { ok: true };
}

module.exports = { getSettings, updateSettings };
