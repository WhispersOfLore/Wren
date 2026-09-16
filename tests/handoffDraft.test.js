process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auditLog = require('../src/audit/auditLog');
const ollamaService = require('../src/services/ollamaService');
const projectContext = require('../src/services/projectContext');
const { extractProjectFacts } = require('../src/services/projectFacts');
const { handleHandoffDraftRequest, buildDeterministicDraft, DRAFT_BANNER, DRAFT_DISCLAIMER } = require('../src/services/handoffDraft');

function nextAuditEvent() {
  return new Promise((resolve) => auditLog.once('audit', resolve));
}

function factsFor(projectName) {
  const ctx = projectContext.getProjectContext(projectName);
  assert.equal(ctx.allowed, true, `expected ${projectName} to be allowed for this test`);
  return extractProjectFacts(ctx);
}

// --- 5: DRAFT ONLY -- NOT SAVED always present ---

test('the deterministic draft always opens and closes with the DRAFT ONLY banner', () => {
  for (const name of ['WhisperOS', 'WhisperBot', 'ClayMoneyTrail']) {
    const draft = buildDeterministicDraft(factsFor(name), { agent: 'Wren' });
    const lines = draft.split('\n').filter((l) => l.trim());
    assert.equal(lines[0], DRAFT_BANNER);
    assert.equal(lines[lines.length - 1], DRAFT_BANNER);
    assert.ok(draft.includes(DRAFT_DISCLAIMER));
  }
});

// --- 3: draft with existing handoff ---

test('WhisperOS draft (has a real handoff) fills Completed/Outstanding/Next Action from it', () => {
  const facts = factsFor('WhisperOS');
  assert.equal(facts.hasHandoff, true, 'this test requires WhisperOS to have a real handoff');
  const draft = buildDeterministicDraft(facts, { agent: 'Wren' });
  assert.doesNotMatch(draft, /## Completed\nNO CURRENT HANDOFF/);
  assert.match(draft, new RegExp(`Latest available handoff recorded commit ${facts.recordedCommit}`));
});

// --- 4/10: draft without handoff uses UNKNOWN / NO CURRENT HANDOFF markers ---

test('WhisperBot draft (no handoff) is conservative -- no invented "completed today"', () => {
  const facts = factsFor('WhisperBot');
  assert.equal(facts.hasHandoff, false, 'this test requires WhisperBot to have no handoff yet');
  const draft = buildDeterministicDraft(facts, { agent: 'Wren' });
  assert.match(draft, /NO CURRENT HANDOFF/);
  assert.match(draft, /Current HEAD NOT VERIFIED/);
  assert.doesNotMatch(draft, /completed today/i);
  assert.doesNotMatch(draft, /I (fixed|implemented|completed)/i);
});

// --- 9: current HEAD never falsely claimed ---

test('no deterministic draft ever claims current HEAD was verified', () => {
  for (const name of ['WhisperOS', 'GamingUnfiltered', 'ClayMoneyTrail', 'WhisperBot', 'WhisperSMP']) {
    const draft = buildDeterministicDraft(factsFor(name), { agent: 'Wren' });
    assert.doesNotMatch(draft, /current head (was|is) (independently )?verified/i);
    assert.match(draft, /HEAD/); // the phrase discussing HEAD must still be present, just as "not verified"
  }
});

// --- 11: ClayMoneyTrail allegation distinction preserved ---

test('ClayMoneyTrail draft never upgrades allegation/unverified-lead language', () => {
  const facts = factsFor('ClayMoneyTrail');
  const draft = buildDeterministicDraft(facts, { agent: 'Wren' });
  // The deterministic draft only ever reproduces text already present in
  // the handoff/entry-point content verbatim (via projectFacts.js) -- it
  // never adds its own claims -- so this asserts the draft contains no
  // NEW fact-upgrading language that wasn't already in the source.
  assert.doesNotMatch(draft, /is guilty|is corrupt|committed a crime|is responsible for wrongdoing/i);
});

test('ClayMoneyTrail draft reproduces its real handoff Outstanding/Current-State text byte-for-byte, not paraphrased', () => {
  const facts = factsFor('ClayMoneyTrail');
  assert.equal(facts.hasHandoff, true, 'this test requires a real ClayMoneyTrail handoff');
  const draft = buildDeterministicDraft(facts, { agent: 'Wren' });
  if (facts.outstandingText) {
    assert.ok(draft.includes(facts.outstandingText), 'Outstanding text must appear verbatim, not summarized');
  }
  if (facts.currentStateText) {
    assert.ok(draft.includes(facts.currentStateText), 'Current State text must appear verbatim, not summarized');
  }
});

// --- 12/13/14: unknown / retired AboutIt / WhisperAboutIt for the draft command ---

test('an unknown project is denied for handoff-draft, never fabricated', async () => {
  const eventPromise = nextAuditEvent();
  const result = await handleHandoffDraftRequest({ userId: 'draft-test-unknown', projectName: 'NotARealProject' });
  const event = await eventPromise;
  assert.equal(result.status, 'denied');
  assert.equal(event.action, 'handoff_draft_denied');
});

test('retired AboutIt is denied for handoff-draft', async () => {
  const result = await handleHandoffDraftRequest({ userId: 'draft-test-aboutit', projectName: 'AboutIt' });
  assert.equal(result.status, 'denied');
});

test('WhisperAboutIt is accepted for handoff-draft as its own project', () => {
  const facts = factsFor('WhisperAboutIt');
  assert.equal(facts.project, 'WhisperAboutIt');
});

// --- 6: no filesystem write anywhere in the new draft-generation code ---

test('handoffDraft.js and projectFacts.js contain no filesystem write/delete calls', () => {
  for (const file of ['handoffDraft.js', 'projectFacts.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', file), 'utf8');
    const matches = source.match(/fs\.(write|append|unlink|rm|mkdir|rename|copy)\w*\s*\(/g) || [];
    assert.deepEqual(matches, [], `${file} must not write/delete anything`);
  }
});

// --- 15/16: Ollama unavailable -> deterministic fallback for both features ---

test('handoff-draft falls back to the deterministic draft when Ollama is unavailable', async (t) => {
  const original = ollamaService.generateReply;
  ollamaService.generateReply = async () => {
    throw new ollamaService.OllamaError('simulated Ollama outage', { friendlyReply: 'down' });
  };
  t.after(() => {
    ollamaService.generateReply = original;
  });

  const result = await handleHandoffDraftRequest({ userId: 'draft-fallback-test', projectName: 'WhisperOS' });
  assert.equal(result.status, 'ok');
  assert.equal(result.usedOllama, false);
  assert.match(result.reply, /local model unavailable/i);
  assert.match(result.reply, new RegExp(DRAFT_BANNER));
});

// --- 19: audit metadata contains no document content ---

test('handoff_draft_generated/fallback audit events never include document content', async () => {
  const eventPromise = nextAuditEvent();
  await handleHandoffDraftRequest({ userId: 'draft-audit-test', projectName: 'WhisperSMP' });
  const event = await eventPromise;
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes('## Completed')); // a raw handoff/markdown fragment would never appear
  assert.ok(serialized.length < 2000, 'audit event should be small metadata, not a document dump');
});

// --- 22: no arbitrary path support in the draft path either ---

test('a path-like string as the project name is never treated as a filesystem path for handoff-draft', async () => {
  const result = await handleHandoffDraftRequest({ userId: 'draft-path-test', projectName: '/etc/passwd' });
  assert.equal(result.status, 'denied');
});

// --- 21: no shell/process execution in the new files ---

test('no new Phase 12 file requires child_process', () => {
  for (const file of ['handoffDraft.js', 'projectFacts.js', 'projectAwareness.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', file), 'utf8');
    assert.equal(/require\(['"]node:child_process['"]\)|require\(['"]child_process['"]\)/.test(source), false);
  }
});
