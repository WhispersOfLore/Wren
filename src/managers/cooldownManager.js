const config = require('../config/configManager');

class CooldownManager {
  constructor() {
    this.lastUsed = new Map();
  }

  /**
   * Checks whether a user is on cooldown.
   * @param {string} userId
   * @returns {{ onCooldown: boolean, secondsRemaining: number }}
   */
  check(userId) {
    if (!config.cooldown.enabled) {
      return { onCooldown: false, secondsRemaining: 0 };
    }

    const last = this.lastUsed.get(userId);
    if (!last) {
      return { onCooldown: false, secondsRemaining: 0 };
    }

    const elapsedMs = Date.now() - last;
    const cooldownMs = config.cooldown.seconds * 1000;

    if (elapsedMs >= cooldownMs) {
      return { onCooldown: false, secondsRemaining: 0 };
    }

    return {
      onCooldown: true,
      secondsRemaining: Math.ceil((cooldownMs - elapsedMs) / 1000),
    };
  }

  trigger(userId) {
    this.lastUsed.set(userId, Date.now());
  }

  clear(userId) {
    this.lastUsed.delete(userId);
  }
}

module.exports = new CooldownManager();
