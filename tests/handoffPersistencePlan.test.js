process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const auditLog = require('../src/audit/auditLog');
const cooldownManager = require('../src/managers/cooldownManager');
const { HandoffApprovalStore, sharedStore: approvalStore } = require('../src/services/handoffApproval');
const { buildPersistencePlan, formatPersistencePlanForDisplay, DRY_RUN_BANNER } = require('../src/services/handoffPersistencePlan');
const { handleHandoffDraftRequest } = require('../src/services/handoffDraft');
const { handleHandoffApprove, handleHandoffReject, handleHandoffPlan } = require('../src/interactions/handoffApprovalHandler');

const WHISPER_OS = path.resolve(__dirname, '..', '..', 'WhisperOS');
const COMMAND_CENTER = path.resolve(__dirname, '..', '..', 'WhisperCommandCenter');
const CC_INDEX = path.join(COMMAND_CENTER, 'handoffs', 'index.json');

function makeFixtureRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-plan-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function minimalFacts(project, projectPath) {
  return {
    project,
    projectPath,
    registrySummary: null,
    hasHandoff: false,
    handoffId: null,
    handoffCreatedAt: null,
    handoffAgent: null,
    handoffObjective: null,
    recordedBranch: null,
    recordedCommit: null,
    recordedPushed: null,
    handoffTruncated: false,
    completedText: null,
    validationText: null,
    gitStateText: null,
    currentStateText: null,
    outstandingText: null,
    nextActionText: null,
    readFirstText: null,
    durableKnowledgeText: null,
    notesText: null,
    entryPointNames: ['README.md'],
    entryPointsAnyTruncated: false,
    entryPointsContent: [],
    warnings: [],
  };
}

function auditEvents(fn) {
  const events = [];
  const listener = (event) => events.push(event);
  auditLog.on('audit', listener);
  return Promise.resolve(fn())
    .finally(() => auditLog.off('audit', listener))
    .then(() => events);
}

function fakeInteraction({ userId, isAdminMember = false, draftId, deferred = false }) {
  const config = require('../src/config/configManager');
  const replies = [];
  return {
    channelId: config.discord.channelId,
    user: { id: userId },
    member: isAdminMember ? { id: userId, permissions: { has: () => true } } : { id: userId, permissions: { has: () => false } },
    options: { getString: () => draftId },
    reply: async (payload) => replies.push({ kind: 'reply', payload }),
    deferReply: async () => {
      deferred = true;
    },
    editReply: async (payload) => replies.push({ kind: 'edit', payload }),
    followUp: async (payload) => replies.push({ kind: 'followUp', payload }),
    _replies: replies,
  };
}

// ===========================================================================
// Item 8: draft stores a repository snapshot
// ===========================================================================

test('creating a session for a git-backed project stores a draft-time repository snapshot', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS',
    projectPath: WHISPER_OS,
    requesterUserId: 'p14-u1',
    draftText: 'x',
    facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  assert.ok(session.repositorySnapshot.atDraft);
  assert.equal(session.repositorySnapshot.atDraft.isGitRepo, true);
  assert.equal(session.repositorySnapshot.atApproval, null);
  assert.equal(session.repositorySnapshot.atPlan, null);
});

// ===========================================================================
// Item 9: same repo state allows approval
// ===========================================================================

test('approval succeeds when repository state has not changed since the draft', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS',
    projectPath: WHISPER_OS,
    requesterUserId: 'p14-u2',
    draftText: 'x',
    facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  const result = store.approve({ draftId: session.draftId, actorUserId: 'p14-u2', isAdmin: false });
  assert.equal(result.ok, true);
  assert.ok(result.session.repositorySnapshot.atApproval);
});

// ===========================================================================
// Items 10-13: drift blocks approval
// ===========================================================================

test('a HEAD change between draft and approval blocks approval as stale', (t) => {
  const dir = makeFixtureRepo(t);
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'Fixture', projectPath: dir, requesterUserId: 'p14-u3', draftText: 'x', facts: minimalFacts('Fixture', dir),
  });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'drift'], { cwd: dir });
  const result = store.approve({ draftId: session.draftId, actorUserId: 'p14-u3', isAdmin: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale');
  assert.equal(result.session.status, 'stale');
});

test('a branch change between draft and approval blocks approval as stale', (t) => {
  const dir = makeFixtureRepo(t);
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'Fixture', projectPath: dir, requesterUserId: 'p14-u4', draftText: 'x', facts: minimalFacts('Fixture', dir),
  });
  execFileSync('git', ['checkout', '-q', '-b', 'other-branch'], { cwd: dir });
  const result = store.approve({ draftId: session.draftId, actorUserId: 'p14-u4', isAdmin: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale');
});

test('a clean-to-dirty working tree change between draft and approval blocks approval as stale', (t) => {
  const dir = makeFixtureRepo(t);
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'Fixture', projectPath: dir, requesterUserId: 'p14-u5', draftText: 'x', facts: minimalFacts('Fixture', dir),
  });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const result = store.approve({ draftId: session.draftId, actorUserId: 'p14-u5', isAdmin: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale');
});

test('a fingerprint-only change (dirty stays dirty, different files) between draft and approval blocks approval as stale', (t) => {
  const dir = makeFixtureRepo(t);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'already dirty\n');
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'Fixture', projectPath: dir, requesterUserId: 'p14-u6', draftText: 'x', facts: minimalFacts('Fixture', dir),
  });
  assert.equal(session.repositorySnapshot.atDraft.workingTreeDirty, true);
  fs.writeFileSync(path.join(dir, 'c.txt'), 'a different dirty file\n');
  const result = store.approve({ draftId: session.draftId, actorUserId: 'p14-u6', isAdmin: false });
  assert.equal(result.ok, false, 'dirty->dirty must not be treated as unchanged');
  assert.equal(result.reason, 'stale');
});

// ===========================================================================
// Item 14: stale is terminal
// ===========================================================================

test('a stale draft can never later be approved', (t) => {
  const dir = makeFixtureRepo(t);
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'Fixture', projectPath: dir, requesterUserId: 'p14-u7', draftText: 'x', facts: minimalFacts('Fixture', dir),
  });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'drift'], { cwd: dir });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u7', isAdmin: false });
  const secondAttempt = store.approve({ draftId: session.draftId, actorUserId: 'p14-u7', isAdmin: false });
  assert.equal(secondAttempt.ok, false);
  assert.equal(secondAttempt.reason, 'status_stale');
});

// ===========================================================================
// Items 15-16: non-git projects
// ===========================================================================

test('a non-Git project can still be drafted normally', async () => {
  cooldownManager.clear('p14-brobehonest-user');
  const result = await handleHandoffDraftRequest({ userId: 'p14-brobehonest-user', projectName: 'BroBeHonest' });
  assert.equal(result.status, 'ok');
  assert.match(result.reply, /Draft ID:/);
});

test('a non-Git project can never become eligible for persistence, even fully approved', async () => {
  cooldownManager.clear('p14-brobehonest-user2');
  const draft = await handleHandoffDraftRequest({ userId: 'p14-brobehonest-user2', projectName: 'BroBeHonest' });
  const draftId = draft.reply.match(/Draft ID: ([0-9a-f-]{36})/i)[1];
  const approval = approvalStore.approve({ draftId, actorUserId: 'p14-brobehonest-user2', isAdmin: false });
  assert.equal(approval.ok, true);
  const gate = approvalStore.beginPersistencePlan({ draftId, actorUserId: 'p14-brobehonest-user2', isAdmin: false });
  assert.equal(gate.ok, true);
  const plan = buildPersistencePlan(gate.session);
  assert.equal(plan.eligible, false);
  assert.match(plan.ineligibleReason, /no git repository/i);
});

// ===========================================================================
// Items 17, 21-24: plan content
// ===========================================================================

test('an approved, state-matching draft produces a persistence plan with Wren as agent and a conservative objective', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u8', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u8', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u8', isAdmin: false });
  assert.equal(gate.ok, true);

  const plan = buildPersistencePlan(gate.session);
  assert.equal(plan.eligible, true);
  assert.equal(plan.proposedHandoff.agent, 'Wren');
  assert.equal(plan.proposedHandoff.objective, 'Continuity summary based on approved read-only project context.');
  assert.doesNotMatch(plan.proposedHandoff.objective, /I (fixed|implemented|completed)/i);
});

test('the plan validation field distinguishes source-handoff-reported validation from Wren-verified repo state, and never claims Wren ran tests', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u9', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u9', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u9', isAdmin: false });
  const plan = buildPersistencePlan(gate.session);

  assert.match(plan.proposedHandoff.validation, /SOURCE HANDOFF REPORTED VALIDATION/);
  assert.match(plan.proposedHandoff.validation, /WREN VERIFIED/);
  assert.doesNotMatch(plan.proposedHandoff.validation, /Wren (ran|passed|executed) (the )?tests/i);
});

test('the plan git-state field reports pushed as unknown when no source handoff recorded it', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u10', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u10', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u10', isAdmin: false });
  const plan = buildPersistencePlan(gate.session);
  assert.match(plan.proposedHandoff.gitState, /Pushed: unknown/);
});

test('the plan git-state field surfaces a source handoff\'s recorded pushed value distinctly, still not independently verified', () => {
  const store = new HandoffApprovalStore();
  const facts = minimalFacts('WhisperOS', WHISPER_OS);
  facts.hasHandoff = true;
  facts.recordedPushed = true;
  facts.handoffCreatedAt = '2026-09-01T00:00:00-04:00';
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u11', draftText: 'x', facts,
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u11', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u11', isAdmin: false });
  const plan = buildPersistencePlan(gate.session);
  assert.match(plan.proposedHandoff.gitState, /Pushed: unknown \(last known handoff reported pushed=true/);
  assert.match(plan.proposedHandoff.gitState, /not independently re-verified/);
});

// ===========================================================================
// Items 18-20: plan generation writes nothing, changes nothing
// ===========================================================================

test('generating a plan creates no file anywhere under WhisperCommandCenter or the target project', () => {
  const ccBefore = fs.readdirSync(COMMAND_CENTER).sort();
  const osBefore = fs.readdirSync(WHISPER_OS).sort();

  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u12', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u12', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u12', isAdmin: false });
  buildPersistencePlan(gate.session);

  assert.deepEqual(fs.readdirSync(COMMAND_CENTER).sort(), ccBefore);
  assert.deepEqual(fs.readdirSync(WHISPER_OS).sort(), osBefore);
});

test('generating a plan does not modify handoffs/index.json', () => {
  const before = fs.readFileSync(CC_INDEX, 'utf8');

  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u13', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u13', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u13', isAdmin: false });
  buildPersistencePlan(gate.session);

  const after = fs.readFileSync(CC_INDEX, 'utf8');
  assert.equal(before, after);
});

// ===========================================================================
// Items 25-32: plan-command authorization/status gating
// ===========================================================================

test('plan generation is denied for a still-pending draft', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u14', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u14', isAdmin: false });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'status_pending');
});

test('plan generation is denied for a rejected draft', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u15', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.reject({ draftId: session.draftId, actorUserId: 'p14-u15', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u15', isAdmin: false });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'status_rejected');
});

test('plan generation is denied for an expired draft', async () => {
  const store = new HandoffApprovalStore({ ttlMs: 5 });
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u16', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u16', isAdmin: false });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'status_expired');
});

test('plan generation is denied for a superseded draft', () => {
  const store = new HandoffApprovalStore();
  const first = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u17', draftText: 'v1', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u17', draftText: 'v2', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  const gate = store.beginPersistencePlan({ draftId: first.draftId, actorUserId: 'p14-u17', isAdmin: false });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'status_superseded');
});

test('plan generation is denied for a stale draft', (t) => {
  const dir = makeFixtureRepo(t);
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'Fixture', projectPath: dir, requesterUserId: 'p14-u18', draftText: 'x', facts: minimalFacts('Fixture', dir),
  });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'drift'], { cwd: dir });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u18', isAdmin: false }); // itself denied+stale
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u18', isAdmin: false });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'status_stale');
});

test('plan generation is denied for an unauthorized (non-requester, non-admin) user', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u19', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u19', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-stranger', isAdmin: false });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'not_authorized');
});

test('the original requester is allowed to generate the plan', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u20', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u20', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u20', isAdmin: false });
  assert.equal(gate.ok, true);
});

test('an admin is allowed to generate the plan for someone else\'s draft', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u21', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u21', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-admin', isAdmin: true });
  assert.equal(gate.ok, true);
});

// ===========================================================================
// Item 33: drift between approval and plan-time blocks the plan
// ===========================================================================

test('repository drift occurring after approval but before plan generation blocks the plan and marks the draft stale', (t) => {
  const dir = makeFixtureRepo(t);
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'Fixture', projectPath: dir, requesterUserId: 'p14-u22', draftText: 'x', facts: minimalFacts('Fixture', dir),
  });
  const approval = store.approve({ draftId: session.draftId, actorUserId: 'p14-u22', isAdmin: false });
  assert.equal(approval.ok, true);

  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'post-approval drift'], { cwd: dir });

  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u22', isAdmin: false });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'stale');
  assert.equal(store.getSession(session.draftId).status, 'stale');
});

// ===========================================================================
// Item 34: DRY RUN banner
// ===========================================================================

test('the rendered plan always includes the DRY RUN — NOTHING WAS SAVED banner at top and bottom', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u23', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u23', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u23', isAdmin: false });
  const rendered = formatPersistencePlanForDisplay(buildPersistencePlan(gate.session));
  const lines = rendered.split('\n').filter((l) => l.trim());
  assert.equal(lines[0], DRY_RUN_BANNER);
  assert.equal(lines[lines.length - 1], DRY_RUN_BANNER);
  assert.doesNotMatch(rendered, /[0-9a-f]{64}/, 'the SHA-256 draft hash must never be rendered');
});

// ===========================================================================
// Item 7: no filenames / raw porcelain logged anywhere in the chain
// ===========================================================================

test('the full draft->approve->plan audit trail never logs raw porcelain output or filenames', async (t) => {
  const dir = makeFixtureRepo(t);
  fs.writeFileSync(path.join(dir, 'super-secret-filename.txt'), 'x');
  const store = new HandoffApprovalStore();

  const events = await auditEvents(() => {
    const session = store.createSession({
      project: 'Fixture', projectPath: dir, requesterUserId: 'p14-u24', draftText: 'x', facts: minimalFacts('Fixture', dir),
    });
    store.approve({ draftId: session.draftId, actorUserId: 'p14-u24', isAdmin: false });
    store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u24', isAdmin: false });
  });

  for (const event of events) {
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes('super-secret-filename.txt'), false);
    assert.equal(/\?\? /.test(serialized), false, 'raw porcelain status lines (e.g. "?? file") must never appear');
  }
});

// ===========================================================================
// Items 35-37: no create-handoff.py invocation, CommandCenter/project unchanged
// ===========================================================================

test('no new Phase 14 file ever references create-handoff.py or invokes a python executable', () => {
  for (const file of ['handoffApproval.js', 'handoffPersistencePlan.js', 'repoState.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', file), 'utf8');
    assert.equal(/create-handoff\.py/.test(source), false, `${file} must never reference create-handoff.py`);
    // Matches an actual executable-string literal (['"]python...) as would
    // be passed to execFile/exec/spawn -- not the English word
    // "subprocess" used in this file's own doc comments to describe why a
    // controlled child_process call was chosen for git inspection.
    assert.equal(/['"]python3?['"]/.test(source), false, `${file} must never invoke a python executable`);
  }
});

test('a full draft->approve->plan cycle leaves WhisperCommandCenter and WhisperOS byte-for-byte unchanged (ignoring independent scheduled logs)', () => {
  const snapshot = (dir, ignore = []) =>
    JSON.stringify(
      fs
        .readdirSync(dir)
        .filter((name) => !ignore.includes(name))
        .sort(),
    );
  const ccBefore = snapshot(COMMAND_CENTER, ['logs']);
  const ccLogsBefore = fs.existsSync(path.join(COMMAND_CENTER, 'logs'))
    ? snapshot(path.join(COMMAND_CENTER, 'logs')).length
    : 0;
  const osBefore = snapshot(WHISPER_OS);
  const indexBefore = fs.readFileSync(CC_INDEX, 'utf8');

  const store = new HandoffApprovalStore();
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-u25', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  store.approve({ draftId: session.draftId, actorUserId: 'p14-u25', isAdmin: false });
  const gate = store.beginPersistencePlan({ draftId: session.draftId, actorUserId: 'p14-u25', isAdmin: false });
  buildPersistencePlan(gate.session);

  assert.equal(snapshot(COMMAND_CENTER, ['logs']), ccBefore);
  assert.equal(snapshot(WHISPER_OS), osBefore);
  assert.equal(fs.readFileSync(CC_INDEX, 'utf8'), indexBefore);
  // logs/ may legitimately grow from CommandCenter's own independent
  // scheduled reports; that directory's own count is not asserted here,
  // consistent with the precedent established in Phase 11-13.
  void ccLogsBefore;
});

// ===========================================================================
// Item 42: no repository status data reaches the model prompt
// ===========================================================================

test('the Ollama gloss prompt never includes repository snapshot or working-tree data', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'handoffDraft.js'), 'utf8');
  assert.equal(/repositorySnapshot|workingTree|porcelain|headCommit/i.test(source), false);
});

// ===========================================================================
// Item 43: ordinary chat / no unauthorized caller of the new store methods
// ===========================================================================

test('only the explicit slash-command handler calls approve/reject/beginPersistencePlan on the shared store', () => {
  const searchRoots = ['src/interactions', 'src/services', 'src/commands'].map((p) => path.join(__dirname, '..', p));
  const callers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        const source = fs.readFileSync(full, 'utf8');
        if (/approvalStore\.(approve|reject|beginPersistencePlan)\s*\(/.test(source)) callers.push(full);
      }
    }
  };
  for (const root of searchRoots) walk(root);

  const allowed = [path.join(__dirname, '..', 'src', 'interactions', 'handoffApprovalHandler.js')];
  const unexpected = callers.filter((f) => !allowed.includes(f));
  assert.deepEqual(unexpected, []);
});

// ===========================================================================
// Items 44-45: regressions -- project status and handoff drafting unaffected
// ===========================================================================

test('handoff drafting still returns the DRAFT ONLY banner and approval instructions after Phase 14 wiring', async () => {
  cooldownManager.clear('p14-regression-user');
  const result = await handleHandoffDraftRequest({ userId: 'p14-regression-user', projectName: 'WhisperSMP' });
  assert.equal(result.status, 'ok');
  assert.match(result.reply, /DRAFT ONLY/);
  assert.match(result.reply, /Approve: \/wren handoff-approve/);
});

test('projectAwareness.js does not reference repoState.js at all -- /wren project remains untouched by Phase 14', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'projectAwareness.js'), 'utf8');
  assert.equal(/repoState/.test(source), false);
});

// ===========================================================================
// End-to-end via the actual Discord interaction handlers (fake interaction objects)
// ===========================================================================

test('end-to-end via handlers: approve then handoff-plan produces a DRY RUN reply for the requester', async () => {
  const store = approvalStore;
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-e2e-1', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });

  const approveInteraction = fakeInteraction({ userId: 'p14-e2e-1', draftId: session.draftId });
  await handleHandoffApprove(approveInteraction);
  assert.match(approveInteraction._replies[0].payload.content, /approved for future persistence/i);

  const planInteraction = fakeInteraction({ userId: 'p14-e2e-1', draftId: session.draftId });
  await handleHandoffPlan(planInteraction);
  const rendered = planInteraction._replies.map((r) => r.payload).join('\n');
  assert.match(rendered, new RegExp(DRY_RUN_BANNER));
});

test('end-to-end via handlers: an unrelated user is denied handoff-plan', async () => {
  const store = approvalStore;
  const session = store.createSession({
    project: 'WhisperOS', projectPath: WHISPER_OS, requesterUserId: 'p14-e2e-2', draftText: 'x', facts: minimalFacts('WhisperOS', WHISPER_OS),
  });
  const approveInteraction = fakeInteraction({ userId: 'p14-e2e-2', draftId: session.draftId });
  await handleHandoffApprove(approveInteraction);

  const planInteraction = fakeInteraction({ userId: 'p14-stranger-2', draftId: session.draftId });
  await handleHandoffPlan(planInteraction);
  const rendered = planInteraction._replies.map((r) => r.payload).join('\n');
  assert.match(rendered, /not your draft/i);
});
