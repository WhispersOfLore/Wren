const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const auditLog = require('../audit/auditLog');

const STATE_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_PATH = path.join(STATE_DIR, 'mood.json');
const DEFAULT_MOOD = 'curious';

const MOODS = [
  { key: 'happy', label: 'Happy', emoji: '😊' },
  { key: 'curious', label: 'Curious', emoji: '🧐' },
  { key: 'focused', label: 'Focused', emoji: '🎯' },
  { key: 'protective', label: 'Protective', emoji: '🛡️' },
  { key: 'playful', label: 'Playful', emoji: '😄' },
  { key: 'tired', label: 'Tired', emoji: '😴' },
];

const MOOD_KEYS = new Set(MOODS.map((mood) => mood.key));

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (err) {
    return { current: DEFAULT_MOOD };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    logger.error('Failed to persist Wren mood state', { error: err.message });
  }
}

/**
 * Wren's current emotional state. Foundation-only for Phase 2: mood is set
 * manually (via the control panel) and persisted; nothing here decides
 * *when* her mood should change on its own — that's a later phase.
 */
class MoodManager {
  constructor() {
    this.state = loadState();
    if (!MOOD_KEYS.has(this.state.current)) {
      this.state.current = DEFAULT_MOOD;
    }
  }

  list() {
    return MOODS;
  }

  getCurrentKey() {
    return this.state.current;
  }

  getCurrent() {
    return MOODS.find((mood) => mood.key === this.state.current);
  }

  getCurrentLabel() {
    return this.getCurrent().label;
  }

  setMood(key, actorId) {
    if (!MOOD_KEYS.has(key)) {
      throw new Error(`Unknown mood: ${key}`);
    }
    const previous = this.state.current;
    this.state.current = key;
    saveState(this.state);
    auditLog.record({ action: 'mood.change', actor: actorId, details: { from: previous, to: key } });
  }
}

module.exports = new MoodManager();
