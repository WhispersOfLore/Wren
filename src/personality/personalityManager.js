const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const auditLog = require('../audit/auditLog');
const moodManager = require('../mood/moodManager');
const { BASE_IDENTITY } = require('../ai/personality');

const PROFILES_DIR = path.join(__dirname, 'profiles');
const STATE_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_PATH = path.join(STATE_DIR, 'personality.json');
const DEFAULT_PROFILE_KEY = 'sweet';

function loadProfiles() {
  const files = fs.readdirSync(PROFILES_DIR).filter((file) => file.endsWith('.json'));
  const profiles = new Map();

  for (const file of files) {
    const key = path.basename(file, '.json');
    const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf8'));
    profiles.set(key, data);
  }

  return profiles;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (err) {
    return { active: DEFAULT_PROFILE_KEY };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    logger.error('Failed to persist Wren personality state', { error: err.message });
  }
}

/**
 * Owns Wren's active personality profile and composes the final system
 * prompt sent to Ollama: her invariant BASE_IDENTITY, layered with the
 * currently active profile's traits and the current mood from moodManager.
 */
class PersonalityManager {
  constructor() {
    this.profiles = loadProfiles();
    if (this.profiles.size === 0) {
      throw new Error('No personality profiles found in src/personality/profiles/');
    }

    this.state = loadState();
    if (!this.profiles.has(this.state.active)) {
      const fallback = this.profiles.has(DEFAULT_PROFILE_KEY)
        ? DEFAULT_PROFILE_KEY
        : [...this.profiles.keys()][0];
      logger.warn(`Unknown active personality "${this.state.active}", falling back to "${fallback}"`);
      this.state.active = fallback;
    }
  }

  list() {
    return [...this.profiles.entries()].map(([key, profile]) => ({ key, ...profile }));
  }

  getCurrentKey() {
    return this.state.active;
  }

  getCurrent() {
    return { key: this.state.active, ...this.profiles.get(this.state.active) };
  }

  setActive(key, actorId) {
    if (!this.profiles.has(key)) {
      throw new Error(`Unknown personality profile: ${key}`);
    }
    const previous = this.state.active;
    this.state.active = key;
    saveState(this.state);
    auditLog.record({ action: 'personality.change', actor: actorId, details: { from: previous, to: key } });
  }

  getSystemPrompt() {
    const profile = this.getCurrent();
    const moodLabel = moodManager.getCurrentLabel();

    return `${BASE_IDENTITY}

CURRENT PERSONALITY: ${profile.name}
Traits: ${profile.traits.join(', ')}
Communication style: ${profile.communicationStyle}
Humor: ${profile.humor}

CURRENT MOOD: ${moodLabel}

Speak naturally as this character right now — let your current personality and mood shape HOW you say things, while staying true to who you are underneath.`;
  }
}

module.exports = new PersonalityManager();
