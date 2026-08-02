const DISCORD_MESSAGE_LIMIT = 2000;

/**
 * Splits a long reply into Discord-safe chunks, preferring to break on
 * paragraph/sentence/word boundaries before falling back to a hard cut.
 */
function splitMessage(text, limit = DISCORD_MESSAGE_LIMIT) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

module.exports = { splitMessage, DISCORD_MESSAGE_LIMIT };
