const logger = require('../utils/logger');
const statusManager = require('../managers/statusManager');
const cooldownManager = require('../managers/cooldownManager');
const queueManager = require('../managers/queueManager');
const conversationManager = require('../managers/conversationManager');
const { generateReply, OllamaError } = require('../services/ollamaService');
const { SLEEP_MODE_REPLY } = require('../ai/personality');

/**
 * The single business-logic path for every way a player can talk to Wren
 * (mention, prefix command, slash command). Discord-specific mechanics
 * (typing indicators, deferring, chunked sends) stay in the callers —
 * this function only ever returns { status, reply }.
 *
 * @param {{ userId: string, channelId: string, text: string }} params
 * @returns {Promise<{ status: 'ok'|'disabled'|'empty'|'cooldown'|'queue_full'|'error', reply: string }>}
 */
async function handleWrenRequest({ userId, channelId, text }) {
  if (!statusManager.isEnabled()) {
    return { status: 'disabled', reply: SLEEP_MODE_REPLY };
  }

  const trimmed = (text || '').trim();
  if (!trimmed) {
    return { status: 'empty', reply: "Yes, sugar? I'm listening — ask me something." };
  }

  const { onCooldown, secondsRemaining } = cooldownManager.check(userId);
  if (onCooldown) {
    return {
      status: 'cooldown',
      reply: `Hold your horses, sugar. I'm still thinking — try again in ${secondsRemaining}s.`,
    };
  }

  if (queueManager.isFull()) {
    return {
      status: 'queue_full',
      reply: "My plate's a little full right now, sugar. Give me a moment and try again.",
    };
  }

  cooldownManager.trigger(userId);

  try {
    const reply = await queueManager.enqueue(async () => {
      conversationManager.addMessage(channelId, 'user', trimmed);
      const messages = await conversationManager.getMessages(channelId, trimmed);
      const aiReply = await generateReply(messages);
      conversationManager.addMessage(channelId, 'assistant', aiReply);
      return aiReply;
    });

    return { status: 'ok', reply };
  } catch (err) {
    if (err instanceof OllamaError) {
      logger.error('AI generation failed', { error: err.message });
      return { status: 'error', reply: err.friendlyReply };
    }

    logger.error('Unexpected error generating reply', { error: err.message, stack: err.stack });
    return { status: 'error', reply: 'Well, that went sideways. Give me a moment, sugar.' };
  }
}

module.exports = { handleWrenRequest };
