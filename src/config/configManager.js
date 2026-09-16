const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ quiet: true });

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

function loadConfigFile() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    throw new Error(`Unable to read config.json at ${CONFIG_PATH}: ${err.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json is not valid JSON: ${err.message}`);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

class ConfigManager {
  constructor() {
    this._raw = loadConfigFile();
    const fileConfig = this._raw;

    this.discord = {
      token: requireEnv('DISCORD_TOKEN'),
      clientId: process.env.DISCORD_CLIENT_ID || null,
      guildId: process.env.DISCORD_GUILD_ID || null,
      channelId: fileConfig.discord?.channelId || '',
      typingIndicator: fileConfig.discord?.typingIndicator ?? true,
    };

    this.ai = {
      provider: fileConfig.ai?.provider || 'ollama',
      baseUrl: fileConfig.ai?.baseUrl || 'http://localhost:11434',
      model: fileConfig.ai?.model || 'llama3.1:8b',
      temperature: fileConfig.ai?.temperature ?? 0.9,
      topP: fileConfig.ai?.topP ?? 0.9,
      maxTokens: fileConfig.ai?.maxTokens ?? 400,
      timeoutMs: fileConfig.ai?.timeoutMs ?? 60000,
    };

    this.cooldown = {
      enabled: fileConfig.cooldown?.enabled ?? true,
      seconds: fileConfig.cooldown?.seconds ?? 8,
    };

    this.queue = {
      enabled: fileConfig.queue?.enabled ?? true,
      maxSize: fileConfig.queue?.maxSize ?? 20,
    };

    this.memory = {
      maxMessages: fileConfig.memory?.maxMessages ?? 20,
    };

    this.memoryRetrieval = {
      maxMemories: fileConfig.memoryRetrieval?.maxMemories ?? 5,
      maxLore: fileConfig.memoryRetrieval?.maxLore ?? 3,
    };

    this.interaction = {
      prefix: fileConfig.interaction?.prefix || '!wren',
    };

    this.control = {
      admins: fileConfig.control?.admins || [],
      requireAdministratorPermission: fileConfig.control?.requireAdministratorPermission ?? true,
    };

    this.logging = {
      level: process.env.LOG_LEVEL || fileConfig.logging?.level || 'info',
    };

    this.projectAwareness = {
      enabled: fileConfig.projectAwareness?.enabled ?? true,
      maxDocBytes: fileConfig.projectAwareness?.maxDocBytes ?? 8000,
      maxTotalBytes: fileConfig.projectAwareness?.maxTotalBytes ?? 24000,
      draftApprovalTtlMs: fileConfig.projectAwareness?.draftApprovalTtlMs ?? 15 * 60 * 1000,
      maxPendingDrafts: fileConfig.projectAwareness?.maxPendingDrafts ?? 200,
    };

    this.env = process.env.NODE_ENV || 'development';

    if (!this.discord.channelId) {
      throw new Error('config.json: discord.channelId must be set to the channel Wren should listen in.');
    }
  }

  /**
   * Persists control-panel-editable settings back to config.json so they
   * survive a restart. Only touches the fields provided.
   * @param {{ cooldownSeconds?: number, prefix?: string }} updates
   */
  updateSettings({ cooldownSeconds, prefix } = {}) {
    if (typeof cooldownSeconds === 'number') {
      this.cooldown.seconds = cooldownSeconds;
      this._raw.cooldown = { ...(this._raw.cooldown || {}), seconds: cooldownSeconds };
    }

    if (typeof prefix === 'string' && prefix.length > 0) {
      this.interaction.prefix = prefix;
      this._raw.interaction = { ...(this._raw.interaction || {}), prefix };
    }

    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(this._raw, null, 2)}\n`);
  }
}

module.exports = new ConfigManager();
