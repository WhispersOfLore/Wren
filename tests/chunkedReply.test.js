const test = require('node:test');
const assert = require('node:assert/strict');

const { prepareChunks, MAX_TOTAL_CHARS } = require('../src/utils/chunkedReply');

test('short text is not chunked or labeled', () => {
  const { chunks, truncated } = prepareChunks('a short draft');
  assert.deepEqual(chunks, ['a short draft']);
  assert.equal(truncated, false);
});

// --- 17: Discord response chunking ---

test('long text is split into multiple ordered, labeled chunks', () => {
  const longText = Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1}. `.repeat(100)).join('\n\n');
  const { chunks, truncated } = prepareChunks(longText, { maxTotalChars: 100000 });
  assert.ok(chunks.length > 1, 'expected multiple chunks');
  for (let i = 0; i < chunks.length; i += 1) {
    assert.match(chunks[i], new RegExp(`\\*\\*\\(part ${i + 1}/${chunks.length}\\)\\*\\*`));
  }
  // Ordering preserved: paragraph 1 appears before paragraph 20 across chunks.
  const joined = chunks.join('');
  assert.ok(joined.indexOf('Paragraph 1.') < joined.indexOf('Paragraph 20.'));
  assert.equal(truncated, false);
});

// --- 18: maximum response-size enforcement ---

test('a response larger than the max total is truncated with an explicit note', () => {
  const huge = 'x'.repeat(MAX_TOTAL_CHARS + 5000);
  const { chunks, truncated } = prepareChunks(huge);
  assert.equal(truncated, true);
  const joined = chunks.join('');
  assert.match(joined, /\[response truncated to stay within the maximum size limit\]/);
});

test('chunking never produces an empty chunk', () => {
  const { chunks } = prepareChunks('x'.repeat(10000), { maxTotalChars: 10000 });
  for (const chunk of chunks) {
    assert.ok(chunk.length > 0);
  }
});
