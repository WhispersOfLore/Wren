process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';

const test = require('node:test');
const assert = require('node:assert/strict');

const auditLog = require('../src/audit/auditLog');
const projectContext = require('../src/services/projectContext');
const { handleProjectAwarenessRequest, formatReferenceContext, RULES } = require('../src/services/projectAwareness');

function nextAuditEvent() {
  return new Promise((resolve) => auditLog.once('audit', resolve));
}

test('an unknown project is denied without ever reaching the model, and is audited', async () => {
  const eventPromise = nextAuditEvent();
  const result = await handleProjectAwarenessRequest({ userId: 'test-user-unknown', projectName: 'NotARealProject' });
  const event = await eventPromise;

  assert.equal(result.status, 'denied');
  assert.match(result.reply, /don't have project awareness/i);
  assert.equal(event.action, 'project_context_denied');
  assert.equal(event.target, 'NotARealProject');
});

test('denial message lists the currently allowed projects, not a fabricated list', async () => {
  const result = await handleProjectAwarenessRequest({ userId: 'test-user-unknown-2', projectName: 'Nope' });
  for (const name of projectContext.listAllowedProjects()) {
    assert.ok(result.reply.includes(name), `expected denial message to mention ${name}`);
  }
});

test('formatReferenceContext labels its output as reference context, not fact', () => {
  const ctx = projectContext.getProjectContext('WhisperOS');
  const formatted = formatReferenceContext(ctx);
  assert.match(formatted, /REFERENCE CONTEXT/);
  assert.match(formatted, /Project: WhisperOS/);
});

test('formatReferenceContext surfaces the handoff-staleness disclaimer when a handoff exists', () => {
  const ctx = projectContext.getProjectContext('WhisperOS');
  assert.ok(ctx.latestHandoff, 'expected WhisperOS to have a real handoff for this test to be meaningful');
  const formatted = formatReferenceContext(ctx);
  assert.match(formatted, /Current repository HEAD was not independently verified by Wren/);
});

test('formatReferenceContext says plainly when no handoff exists', () => {
  // Construct a context shape with no handoff without touching the real
  // registry -- this only exercises the formatter, not file access.
  const ctx = {
    project: 'FixtureProject',
    projectPath: '/fixture/path',
    registrySummary: null,
    latestHandoff: null,
    entryPoints: [],
    warnings: [],
  };
  const formatted = formatReferenceContext(ctx);
  assert.match(formatted, /No recorded operational handoff exists/);
});

test('the model-facing RULES include every required safety instruction', () => {
  assert.match(RULES, /Repository reality outranks/i);
  assert.match(RULES, /Do NOT claim you performed any action/i);
  assert.match(RULES, /Do NOT invent project state/i);
  assert.match(RULES, /never restate an allegation or unverified lead as an established fact/i);
  assert.match(RULES, /Do not offer opinions, rankings, or political conclusions/i);
});

test('a denied request never calls the Ollama service (no network attempted)', async () => {
  // If this reached generateReply(), it would try to contact
  // http://localhost:11434 and either hang or throw a connection error
  // rather than returning the fast, synchronous-shaped denial below.
  const start = Date.now();
  const result = await handleProjectAwarenessRequest({ userId: 'test-user-fast', projectName: 'NotAllowed' });
  const elapsedMs = Date.now() - start;
  assert.equal(result.status, 'denied');
  assert.ok(elapsedMs < 1000, 'denial should be near-instant, with no network call attempted');
});
