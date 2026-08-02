const axios = require('axios');
const config = require('../config/configManager');
const logger = require('../utils/logger');

class OllamaError extends Error {
  constructor(message, { friendlyReply, cause } = {}) {
    super(message);
    this.name = 'OllamaError';
    this.friendlyReply = friendlyReply || "My thoughts are tangled up somewhere, sugar. Try me again in a bit.";
    this.cause = cause;
  }
}

const client = axios.create({
  baseURL: config.ai.baseUrl,
  timeout: config.ai.timeoutMs,
});

/**
 * Sends a chat completion request to a local Ollama instance.
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
 * @returns {Promise<string>} the assistant's reply text
 */
async function generateReply(messages) {
  let response;

  try {
    response = await client.post('/api/chat', {
      model: config.ai.model,
      messages,
      stream: false,
      options: {
        temperature: config.ai.temperature,
        top_p: config.ai.topP,
        num_predict: config.ai.maxTokens,
      },
    });
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      logger.error('Ollama connection refused — is Ollama running?', { error: err.message });
      throw new OllamaError('Ollama offline', {
        friendlyReply: "Seems my mind wandered off somewhere — Ollama isn't answering. Give it a nudge and try me again.",
        cause: err,
      });
    }

    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      logger.error('Ollama request timed out', { error: err.message });
      throw new OllamaError('Ollama timeout', {
        friendlyReply: "That thought took longer than a siege, sugar. Ask me again?",
        cause: err,
      });
    }

    if (err.response) {
      logger.error('Ollama returned an error response', {
        status: err.response.status,
        data: err.response.data,
      });
      throw new OllamaError(`Ollama HTTP ${err.response.status}`, {
        friendlyReply: "Something's gone sideways in my head. Give me a moment and try again.",
        cause: err,
      });
    }

    logger.error('Unexpected error contacting Ollama', { error: err.message });
    throw new OllamaError('Unexpected Ollama error', { cause: err });
  }

  const content = response.data?.message?.content;

  if (!content || typeof content !== 'string') {
    logger.error('Ollama returned an invalid response shape', { data: response.data });
    throw new OllamaError('Invalid Ollama response', {
      friendlyReply: "I opened my mouth and nothing came out. Let's try that again.",
    });
  }

  return content.trim();
}

module.exports = { generateReply, OllamaError };
