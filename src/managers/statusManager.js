const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const auditLog = require('../audit/auditLog');

const STATE_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_PATH = path.join(STATE_DIR, 'state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (err) {
    return { enabled: true };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    logger.error('Failed to persist Wren runtime state', { error: err.message });
  }
}

/**
 * Runtime on/off state, kept separate from config.json (static settings).
 * Persisted to data/state.json so an admin's Enable/Disable choice survives
 * a restart.
 */
class StatusManager {
  constructor() {
    this.state = loadState();
  }

  isEnabled() {
    return this.state.enabled !== false;
  }

  enable(actorId) {
    this.state.enabled = true;
    saveState(this.state);
    auditLog.record({ action: 'wren.enable', actor: actorId });
  }

  disable(actorId) {
    this.state.enabled = false;
    saveState(this.state);
    auditLog.record({ action: 'wren.disable', actor: actorId });
  }

  getInteractionMode() {
    return 'Direct Calls Only';
  }
}

module.exports = new StatusManager();
