const { splitMessage, DISCORD_MESSAGE_LIMIT } = require('./splitMessage');

// Roughly 3 Discord messages worth -- long enough for a real draft, short
// enough that a single request can never turn into a message-spam incident.
const MAX_TOTAL_CHARS = 6000;

/**
 * Splits text into Discord-safe chunks, capping the OVERALL response size
 * first (never silently -- a truncation note is appended), then labeling
 * each chunk when there's more than one so continuation is unambiguous to
 * the reader. Pure function: no Discord API calls, easy to unit test.
 */
function prepareChunks(text, { maxTotalChars = MAX_TOTAL_CHARS } = {}) {
  let content = text;
  let truncated = false;

  if (content.length > maxTotalChars) {
    content = `${content.slice(0, maxTotalChars)}\n\n[response truncated to stay within the maximum size limit]`;
    truncated = true;
  }

  const rawChunks = splitMessage(content, DISCORD_MESSAGE_LIMIT - 24); // leave room for the part label line
  if (rawChunks.length <= 1) {
    return { chunks: rawChunks, truncated };
  }

  const chunks = rawChunks.map((chunk, i) => `**(part ${i + 1}/${rawChunks.length})**\n${chunk}`);
  return { chunks, truncated };
}

/** Sends chunks in order: first via editReply (the interaction must already be deferred), rest via followUp. */
async function sendChunkedReply(interaction, text, options) {
  const { chunks, truncated } = prepareChunks(text, options);
  for (let i = 0; i < chunks.length; i += 1) {
    if (i === 0) {
      // eslint-disable-next-line no-await-in-loop
      await interaction.editReply(chunks[i]);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await interaction.followUp(chunks[i]);
    }
  }
  return { chunkCount: chunks.length, truncated };
}

module.exports = { prepareChunks, sendChunkedReply, MAX_TOTAL_CHARS };
