const config = require('../config/configManager');
const personalityManager = require('../personality/personalityManager');
const memoryRetriever = require('../memory/memoryRetriever');

/**
 * In-RAM conversation memory, keyed by channel. Trims to
 * config.memory.maxMessages. This is short-term chat context only — it is
 * not the same thing as the long-term memory/lore system in src/memory/ and
 * src/lore/, which persists to SQLite. A future phase may swap this backing
 * store for SQLite too, without changing the API surface.
 */
class ConversationManager {
  constructor() {
    this.histories = new Map();
  }

  _getHistory(channelId) {
    if (!this.histories.has(channelId)) {
      this.histories.set(channelId, []);
    }
    return this.histories.get(channelId);
  }

  addMessage(channelId, role, content) {
    const history = this._getHistory(channelId);
    history.push({ role, content });

    const overflow = history.length - config.memory.maxMessages;
    if (overflow > 0) {
      history.splice(0, overflow);
    }
  }

  /**
   * Returns the full message array for an AI request: Wren's current
   * personality/mood system prompt (recomposed fresh every call, so a
   * mid-chat personality or mood change takes effect on the very next
   * message), followed by any relevant memory/lore for the current
   * question, followed by conversation history. Personality composition
   * itself is untouched — personalityManager owns BASE IDENTITY + traits +
   * mood; this just appends retrieval context after it, matching the
   * pipeline order: identity → personality → mood → memories → lore → chat.
   *
   * @param {string} channelId
   * @param {string} [latestQuestion] the player's current message, used to
   *   search for relevant memories/lore. Omit to skip retrieval entirely.
   */
  async getMessages(channelId, latestQuestion) {
    const personalityPrompt = personalityManager.getSystemPrompt();
    const memoryContext = latestQuestion ? await memoryRetriever.buildContextBlock(latestQuestion) : '';
    const systemPrompt = memoryContext ? `${personalityPrompt}\n\n${memoryContext}` : personalityPrompt;

    return [{ role: 'system', content: systemPrompt }, ...this._getHistory(channelId)];
  }

  clear(channelId) {
    this.histories.delete(channelId);
  }
}

module.exports = new ConversationManager();
