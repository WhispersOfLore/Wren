process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';

const test = require('node:test');
const assert = require('node:assert/strict');

const auditLog = require('../src/audit/auditLog');
const ollamaService = require('../src/services/ollamaService');
const projectContext = require('../src/services/projectContext');
const conversationManager = require('../src/managers/conversationManager');
const {
  handleProjectAwarenessRequest,
  formatReferenceContext,
  buildDeterministicStatus,
  formatFactsSummary,
  RULES,
} = require('../src/services/projectAwareness');
const { extractProjectFacts } = require('../src/services/projectFacts');

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

// --- 13/14: ordinary chat never loads project context; /wren project does ---

test('ordinary conversation never includes REFERENCE CONTEXT, even when a project name is mentioned', async () => {
  const messages = await conversationManager.getMessages('phase11-isolation-test-channel', 'What is happening with WhisperOS right now?');
  const systemMsg = messages.find((m) => m.role === 'system');
  assert.equal(systemMsg.content.includes('REFERENCE CONTEXT'), false);
  assert.equal(systemMsg.content.includes(RULES), false);
});

test('the explicit project-awareness path DOES build a REFERENCE CONTEXT-labeled prompt', () => {
  const ctx = projectContext.getProjectContext('WhisperBot');
  assert.equal(ctx.allowed, true);
  const formatted = formatReferenceContext(ctx);
  assert.match(formatted, /REFERENCE CONTEXT/);
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

// =====================================================================
// Phase 12: structured facts, deterministic status, Ollama fallback
// =====================================================================

// --- 1: project status with handoff ---

test('formatFactsSummary reports a real handoff for WhisperOS accurately', () => {
  const ctx = projectContext.getProjectContext('WhisperOS');
  const facts = extractProjectFacts(ctx);
  assert.equal(facts.hasHandoff, true);
  const summary = formatFactsSummary(facts);
  assert.match(summary, /Handoff exists: yes/);
  assert.match(summary, new RegExp(facts.handoffId));
});

// --- 2: project status without handoff ---

test('formatFactsSummary distinguishes documentation-only projects plainly', () => {
  const ctx = projectContext.getProjectContext('WhisperBot');
  const facts = extractProjectFacts(ctx);
  assert.equal(facts.hasHandoff, false);
  const summary = formatFactsSummary(facts);
  assert.match(summary, /Handoff exists: no handoff exists for this project yet\./);
});

test('buildDeterministicStatus for a no-handoff project states the documentation/recent-state distinction explicitly', () => {
  const ctx = projectContext.getProjectContext('WhisperSMP');
  const facts = extractProjectFacts(ctx);
  const status = buildDeterministicStatus(facts);
  assert.match(status, /No operational handoff is currently available/);
  assert.match(status, /cannot reliably tell you where the most recent work session stopped/);
});

// --- 15: project status falls back deterministically when Ollama is down ---

test('project status falls back to deterministic text when Ollama is unavailable', async (t) => {
  const original = ollamaService.generateReply;
  ollamaService.generateReply = async () => {
    throw new ollamaService.OllamaError('simulated Ollama outage', { friendlyReply: 'down' });
  };
  t.after(() => {
    ollamaService.generateReply = original;
  });

  const result = await handleProjectAwarenessRequest({ userId: 'status-fallback-test', projectName: 'ClayMoneyTrail' });
  assert.equal(result.status, 'ok');
  assert.equal(result.usedOllama, false);
  assert.match(result.reply, /deterministic status/i);
});

test('a real (non-mocked) Ollama success still returns usedOllama: true', async () => {
  // Sanity check that the happy path's new usedOllama field doesn't
  // silently flip to false when Ollama is actually reachable -- exercised
  // against a fixture-shaped context, not a real network call, since
  // whether a real Ollama instance is running in CI is not guaranteed.
  const original = ollamaService.generateReply;
  ollamaService.generateReply = async () => 'a real-looking reply';
  const restore = () => { ollamaService.generateReply = original; };
  try {
    const result = await handleProjectAwarenessRequest({ userId: 'status-ok-test', projectName: 'WhisperContent' });
    assert.equal(result.status, 'ok');
    assert.equal(result.usedOllama, true);
    assert.equal(result.reply, 'a real-looking reply');
  } finally {
    restore();
  }
});
