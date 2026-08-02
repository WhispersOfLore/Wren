const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'about', 'as', 'by',
  'and', 'or', 'but', 'if', 'so', 'do', 'does', 'did', 'has', 'have',
  'had', 'this', 'that', 'these', 'those', 'what', 'who', 'whom',
  'which', 'when', 'where', 'why', 'how', 'you', 'your', 'i', 'me',
  'my', 'we', 'our', 'it', 'its', 'can', 'could', 'will', 'would',
  'should', 'tell', 'me', 'please',
]);

/**
 * Breaks free text into meaningful search keywords: lowercased, punctuation
 * stripped, short/common words dropped. Shared by memoryRetriever (AI
 * context ranking) and the admin search tools in memoryManager/loreManager,
 * so both use the same notion of "what counts as a keyword."
 */
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

module.exports = { tokenize };
