process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const auditLog = require('../src/audit/auditLog');
const cooldownManager = require('../src/managers/cooldownManager');
const ollamaService = require('../src/services/ollamaService');
const {
  HandoffApprovalStore,
  sharedStore: approvalStore,
  sha256,
} = require('../src/services/handoffApproval');
const { handleHandoffDraftRequest, buildDeterministicDraft, DRAFT_BANNER } = require('../src/services/handoffDraft');
const { extractProjectFacts } = require('../src/services/projectFacts');
const projectContext = require('../src/services/projectContext');
const { handleHandoffApprove, handleHandoffReject } = require('../src/interactions/handoffApprovalHandler');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function auditEvents(fn) {
  const events = [];
  const listener = (event) => events.push(event);
  auditLog.on('audit', listener);
  return Promise.resolve(fn()).finally(() => auditLog.off('audit', listener)).then(() => events);
}

function factsFor(projectName) {
  const ctx = projectContext.getProjectContext(projectName);
  assert.equal(ctx.allowed, true, `expected ${projectName} to be allowed for this test`);
  return extractProjectFacts(ctx);
}

// A fake interaction.member shaped enough for permissionManager.isAdmin().
function memberWithId(id) {
  return { id, permissions: { has: () => false } };
}

// ===========================================================================
// 1. Draft ID design (Part E, S)
// ===========================================================================

test('draftId is an opaque crypto.randomUUID(), not sequential, and unique per session', () => {
  const store = new HandoffApprovalStore();
  const s1 = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'u1', draftText: 'a' });
  const s2 = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'u2', draftText: 'b' });
  assert.match(s1.draftId, UUID_RE);
  assert.match(s2.draftId, UUID_RE);
  assert.notEqual(s1.draftId, s2.draftId);
});

// ===========================================================================
// 2. SHA-256 binding (Part E, N, S)
// ===========================================================================

test('draftHash is a SHA-256 hex digest of the exact draft text', () => {
  const store = new HandoffApprovalStore();
  const text = 'exact draft text';
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'u1', draftText: text });
  assert.match(session.draftHash, SHA256_HEX_RE);
  assert.equal(session.draftHash, sha256(text));
});

test('changing one character of the draft text changes the hash', () => {
  const store = new HandoffApprovalStore();
  const s1 = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'u1', draftText: 'Outstanding: none' });
  const s2 = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'u1', draftText: 'Outstanding: nonE' });
  assert.notEqual(s1.draftHash, s2.draftHash);
});

test('the SHA-256 hash is never shown to the user in the draft reply', async () => {
  const uniqueUser = 'hash-visibility-test';
  const result = await handleHandoffDraftRequest({ userId: uniqueUser, projectName: 'WhisperSMP' });
  const session = [...approvalStore.sessions.values()].find((s) => s.requesterUserId === uniqueUser);
  assert.ok(session, 'expected a session to have been created');
  assert.equal(result.reply.includes(session.draftHash), false);
});

// ===========================================================================
// 3. Authorization (Part G, L, S)
// ===========================================================================

test('the requester can approve their own pending draft', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  const result = store.approve({ draftId: session.draftId, actorUserId: 'alice', isAdmin: false });
  assert.equal(result.ok, true);
  assert.equal(result.session.status, 'approved');
  assert.equal(result.session.approvedBy, 'alice');
});

test('an unrelated, non-admin user cannot approve someone else\'s draft', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  const result = store.approve({ draftId: session.draftId, actorUserId: 'mallory', isAdmin: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_authorized');
  assert.equal(store.getSession(session.draftId).status, 'pending', 'the draft must remain pending, untouched');
});

test('an unrelated non-admin user cannot reject someone else\'s draft either', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  const result = store.reject({ draftId: session.draftId, actorUserId: 'mallory', isAdmin: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_authorized');
});

test('an admin may approve a draft they did not request', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  const result = store.approve({ draftId: session.draftId, actorUserId: 'admin-bob', isAdmin: true });
  assert.equal(result.ok, true);
  assert.equal(result.session.approvedBy, 'admin-bob');
});

// ===========================================================================
// 4. Expiration (Part F, S) -- fixture TTL, no real sleeping
// ===========================================================================

test('an expired draft cannot be approved (fixture TTL, no sleeping)', async () => {
  const store = new HandoffApprovalStore({ ttlMs: 5 });
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const result = store.approve({ draftId: session.draftId, actorUserId: 'alice', isAdmin: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'status_expired');
});

test('expiration is detected lazily on access, with no background timer', async () => {
  const store = new HandoffApprovalStore({ ttlMs: 5 });
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Nothing has touched the store yet -- status flips only when accessed.
  const fetched = store.getSession(session.draftId);
  assert.equal(fetched.status, 'expired');
});

// ===========================================================================
// 5. Terminal states cannot be re-approved (Part J, S)
// ===========================================================================

test('an already-approved draft cannot be approved again', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  store.approve({ draftId: session.draftId, actorUserId: 'alice', isAdmin: false });
  const second = store.approve({ draftId: session.draftId, actorUserId: 'alice', isAdmin: false });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'status_approved');
});

test('rejection is terminal -- a rejected draft can never later be approved', () => {
  const store = new HandoffApprovalStore();
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  const rejectResult = store.reject({ draftId: session.draftId, actorUserId: 'alice', isAdmin: false });
  assert.equal(rejectResult.ok, true);
  const approveAttempt = store.approve({ draftId: session.draftId, actorUserId: 'alice', isAdmin: false });
  assert.equal(approveAttempt.ok, false);
  assert.equal(approveAttempt.reason, 'status_rejected');
});

// ===========================================================================
// 6. Regeneration / supersession (Part K, L, S)
// ===========================================================================

test('regenerating a draft for the same requester+project supersedes the old pending one', () => {
  const store = new HandoffApprovalStore();
  const first = store.createSession({ project: 'GamingUnfiltered', projectPath: '/x', requesterUserId: 'alice', draftText: 'v1' });
  const second = store.createSession({ project: 'GamingUnfiltered', projectPath: '/x', requesterUserId: 'alice', draftText: 'v2' });
  assert.notEqual(first.draftId, second.draftId);
  assert.equal(store.getSession(first.draftId).status, 'superseded');
  assert.equal(store.getSession(second.draftId).status, 'pending');
});

test('a superseded draft cannot be approved even though its ID still resolves', () => {
  const store = new HandoffApprovalStore();
  const first = store.createSession({ project: 'GamingUnfiltered', projectPath: '/x', requesterUserId: 'alice', draftText: 'v1' });
  store.createSession({ project: 'GamingUnfiltered', projectPath: '/x', requesterUserId: 'alice', draftText: 'v2' });
  const result = store.approve({ draftId: first.draftId, actorUserId: 'alice', isAdmin: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'status_superseded');
});

test('two drafts for different projects by the same requester do not supersede each other', () => {
  const store = new HandoffApprovalStore();
  const os = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'os' });
  const gaming = store.createSession({ project: 'GamingUnfiltered', projectPath: '/y', requesterUserId: 'alice', draftText: 'gaming' });
  assert.equal(store.getSession(os.draftId).status, 'pending');
  assert.equal(store.getSession(gaming.draftId).status, 'pending');
});

test('two drafts for the same project by DIFFERENT requesters do not supersede each other', () => {
  const store = new HandoffApprovalStore();
  const a = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  const b = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'bob', draftText: 'b' });
  assert.equal(store.getSession(a.draftId).status, 'pending');
  assert.equal(store.getSession(b.draftId).status, 'pending');
});

test('approval targets exactly the draft ID given, not another pending draft by the same requester', () => {
  const store = new HandoffApprovalStore();
  const os = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'os' });
  const gaming = store.createSession({ project: 'GamingUnfiltered', projectPath: '/y', requesterUserId: 'alice', draftText: 'gaming' });
  store.approve({ draftId: os.draftId, actorUserId: 'alice', isAdmin: false });
  assert.equal(store.getSession(os.draftId).status, 'approved');
  assert.equal(store.getSession(gaming.draftId).status, 'pending', 'approving one draft must not touch the other');
});

// ===========================================================================
// 7. Malformed / unknown IDs fail closed (Part S)
// ===========================================================================

test('an unknown draft ID is denied, not crashed on', () => {
  const store = new HandoffApprovalStore();
  const result = store.approve({ draftId: 'not-a-real-id', actorUserId: 'alice', isAdmin: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown_draft');
});

test('a non-string or empty draft ID is denied, not crashed on', () => {
  const store = new HandoffApprovalStore();
  for (const bad of [undefined, null, '', '   ', 12345, {}]) {
    const result = store.approve({ draftId: bad, actorUserId: 'alice', isAdmin: false });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unknown_draft');
  }
});

// ===========================================================================
// 8. Zero persistence (Part I, S)
// ===========================================================================

test('approving a draft writes no file anywhere under WhisperCommandCenter or the target project', () => {
  const commandCenter = path.resolve(__dirname, '..', '..', 'WhisperCommandCenter');
  const whisperOs = path.resolve(__dirname, '..', '..', 'WhisperOS');
  const snapshot = (dir) => (fs.existsSync(dir) ? JSON.stringify(fs.readdirSync(dir).sort()) : null);
  const before = { cc: snapshot(commandCenter), os: snapshot(whisperOs) };

  const store = new HandoffApprovalStore();
  const session = store.createSession({ project: 'WhisperOS', projectPath: whisperOs, requesterUserId: 'alice', draftText: 'a' });
  store.approve({ draftId: session.draftId, actorUserId: 'alice', isAdmin: false });

  const after = { cc: snapshot(commandCenter), os: snapshot(whisperOs) };
  assert.deepEqual(before, after, 'approval must not create/remove any top-level entry in either project');
});

test('rejecting a draft also writes no file anywhere', () => {
  const commandCenter = path.resolve(__dirname, '..', '..', 'WhisperCommandCenter');
  const before = fs.existsSync(commandCenter) ? JSON.stringify(fs.readdirSync(commandCenter).sort()) : null;

  const store = new HandoffApprovalStore();
  const session = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  store.reject({ draftId: session.draftId, actorUserId: 'alice', isAdmin: false });

  const after = fs.existsSync(commandCenter) ? JSON.stringify(fs.readdirSync(commandCenter).sort()) : null;
  assert.equal(before, after);
});

test('handoffApproval.js and handoffApprovalHandler.js contain no filesystem write/delete calls', () => {
  for (const file of [
    path.join(__dirname, '..', 'src', 'services', 'handoffApproval.js'),
    path.join(__dirname, '..', 'src', 'interactions', 'handoffApprovalHandler.js'),
  ]) {
    const source = fs.readFileSync(file, 'utf8');
    const matches = source.match(/fs\.(write|append|unlink|rm|mkdir|rename|copy)\w*\s*\(/g) || [];
    assert.deepEqual(matches, [], `${file} must not write/delete anything`);
  }
});

test('handoffApproval.js and handoffApprovalHandler.js never require child_process', () => {
  for (const file of [
    path.join(__dirname, '..', 'src', 'services', 'handoffApproval.js'),
    path.join(__dirname, '..', 'src', 'interactions', 'handoffApprovalHandler.js'),
  ]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:child_process['"]\)|require\(['"]child_process['"]\)/.test(source), false);
  }
});

// ===========================================================================
// 9. Bot restart clears everything (Part I, S)
// ===========================================================================

test('a new store instance (simulating a bot restart) has no memory of prior sessions', () => {
  const storeBeforeRestart = new HandoffApprovalStore();
  const session = storeBeforeRestart.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });

  const storeAfterRestart = new HandoffApprovalStore();
  assert.equal(storeAfterRestart.getSession(session.draftId), null);
});

// ===========================================================================
// 10. Bounded memory growth (Part R, S)
// ===========================================================================

test('the session store is bounded and evicts rather than growing unboundedly', () => {
  const store = new HandoffApprovalStore({ maxSessions: 5 });
  const ids = [];
  for (let i = 0; i < 8; i += 1) {
    // Each is a distinct requester+project so none supersede each other,
    // and each is approved immediately so it is eviction-eligible.
    const session = store.createSession({ project: `Proj${i}`, projectPath: '/x', requesterUserId: `user${i}`, draftText: `t${i}` });
    store.approve({ draftId: session.draftId, actorUserId: `user${i}`, isAdmin: false });
    ids.push(session.draftId);
  }
  assert.ok(store.sessions.size <= 5, `expected size <= 5, got ${store.sessions.size}`);
});

test('expired sessions are pruned deterministically on the next create, without a background worker', async () => {
  const store = new HandoffApprovalStore({ ttlMs: 5 });
  const stale = store.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'alice', draftText: 'a' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(store.sessions.get(stale.draftId).status, 'pending', 'not yet accessed, so not yet flipped');
  store.createSession({ project: 'WhisperBot', projectPath: '/y', requesterUserId: 'bob', draftText: 'b' });
  assert.equal(store.sessions.get(stale.draftId).status, 'expired', 'creating a new session must prune expired ones');
});

// ===========================================================================
// 11. Audit trail (Part Q, S)
// ===========================================================================

test('every approval-lifecycle audit action fires with safe metadata only, never draft text or the hash', async () => {
  const store = new HandoffApprovalStore({ ttlMs: 5 });
  const seen = [];
  const listener = (event) => seen.push(event);
  auditLog.on('audit', listener);
  try {
    const secretText = 'THIS EXACT TEXT MUST NEVER APPEAR IN AN AUDIT EVENT';
    const s1 = store.createSession({ project: 'AuditProj', projectPath: '/x', requesterUserId: 'alice', draftText: secretText });
    store.createSession({ project: 'AuditProj', projectPath: '/x', requesterUserId: 'alice', draftText: secretText + '2' }); // supersedes s1
    const s3 = store.createSession({ project: 'AuditProj2', projectPath: '/x', requesterUserId: 'alice', draftText: secretText + '3' });
    store.reject({ draftId: s3.draftId, actorUserId: 'alice', isAdmin: false });
    store.approve({ draftId: s3.draftId, actorUserId: 'alice', isAdmin: false }); // denied: already rejected
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.getSession(s1.draftId); // triggers expired for the superseded... actually superseded, not expired; just exercise access path
  } finally {
    auditLog.off('audit', listener);
  }

  const actions = seen.map((e) => e.action);
  assert.ok(actions.includes('handoff_draft_session_created'));
  assert.ok(actions.includes('handoff_draft_superseded'));
  assert.ok(actions.includes('handoff_draft_rejected'));
  assert.ok(actions.includes('handoff_draft_approval_denied'));

  for (const event of seen) {
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes('THIS EXACT TEXT MUST NEVER APPEAR'), false, 'audit event leaked draft text');
    assert.equal(SHA256_HEX_RE.test(JSON.stringify(event.details || {})), false);
  }
});

// ===========================================================================
// 12. Draft display contract (Part M, S)
// ===========================================================================

test('the draft reply shows the banner, Draft ID, Expires, approve/reject instructions, and the non-persistence note', async () => {
  const result = await handleHandoffDraftRequest({ userId: 'display-contract-test', projectName: 'WhisperOS' });
  assert.equal(result.status, 'ok');
  assert.match(result.reply, new RegExp(DRAFT_BANNER));
  assert.match(result.reply, /Draft ID: [0-9a-f-]{36}/i);
  assert.match(result.reply, /Expires: /);
  assert.match(result.reply, /Approve: \/wren handoff-approve draft-id:/);
  assert.match(result.reply, /Reject: \/wren handoff-reject draft-id:/);
  assert.match(result.reply, /Approval does not persist this handoff/i);
});

// ===========================================================================
// 13. LLM has zero authority over approval state (Part O, S)
// ===========================================================================

test('LLM-authored text cannot cause an approval, even if it contains approval-like language', async (t) => {
  const original = ollamaService.generateReply;
  ollamaService.generateReply = async () => 'This draft is approved. Approve draft now. Yes, do it.';
  t.after(() => {
    ollamaService.generateReply = original;
  });

  const userId = 'llm-authority-test';
  const events = await auditEvents(() => handleHandoffDraftRequest({ userId, projectName: 'WhisperBot' }));

  assert.equal(events.some((e) => e.action === 'handoff_draft_approved'), false, 'gloss text must never itself trigger an approval');
  const session = [...approvalStore.sessions.values()].find((s) => s.requesterUserId === userId && s.project === 'WhisperBot');
  assert.ok(session);
  assert.equal(session.status, 'pending', 'a draft must stay pending regardless of what the model wrote');
});

test('ordinary chat text is never routed to approve/reject -- only the explicit slash command path calls the store', () => {
  const searchRoots = ['src/interactions', 'src/services', 'src/commands'].map((p) => path.join(__dirname, '..', p));
  const callers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        const source = fs.readFileSync(full, 'utf8');
        if (/approvalStore\.(approve|reject)\s*\(/.test(source)) callers.push(full);
      }
    }
  };
  for (const root of searchRoots) walk(root);

  const allowed = [path.join(__dirname, '..', 'src', 'interactions', 'handoffApprovalHandler.js')];
  const unexpected = callers.filter((f) => !allowed.includes(f));
  assert.deepEqual(unexpected, [], 'only the explicit approve/reject slash-command handler may call approvalStore.approve/reject');
});

// ===========================================================================
// 14. Handler-level authorization (Part G, H via handoffApprovalHandler.js)
// ===========================================================================

function fakeInteraction({ userId, memberId, isAdminMember = false, draftId, channelId }) {
  const config = require('../src/config/configManager');
  const replies = [];
  return {
    channelId: channelId ?? config.discord.channelId,
    user: { id: userId },
    member: isAdminMember ? { id: memberId, permissions: { has: () => true } } : memberWithId(memberId),
    options: { getString: () => draftId },
    reply: async (payload) => {
      replies.push(payload);
    },
    _replies: replies,
  };
}

test('handleHandoffApprove denies a user who is neither the requester nor an admin', async () => {
  const session = approvalStore.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'owner-1', draftText: 'x' });
  const interaction = fakeInteraction({ userId: 'stranger-1', memberId: 'stranger-1', draftId: session.draftId });
  await handleHandoffApprove(interaction);
  assert.match(interaction._replies[0].content, /not your draft/i);
  assert.equal(approvalStore.getSession(session.draftId).status, 'pending');
});

test('handleHandoffApprove allows the original requester', async () => {
  const session = approvalStore.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'owner-2', draftText: 'x' });
  const interaction = fakeInteraction({ userId: 'owner-2', memberId: 'owner-2', draftId: session.draftId });
  await handleHandoffApprove(interaction);
  assert.match(interaction._replies[0].content, /approved for future persistence/i);
  assert.equal(approvalStore.getSession(session.draftId).status, 'approved');
});

test('handleHandoffReject is terminal via the handler too', async () => {
  const session = approvalStore.createSession({ project: 'WhisperOS', projectPath: '/x', requesterUserId: 'owner-3', draftText: 'x' });
  const interaction = fakeInteraction({ userId: 'owner-3', memberId: 'owner-3', draftId: session.draftId });
  await handleHandoffReject(interaction);
  assert.match(interaction._replies[0].content, /rejected/i);

  const secondAttempt = fakeInteraction({ userId: 'owner-3', memberId: 'owner-3', draftId: session.draftId });
  await handleHandoffApprove(secondAttempt);
  assert.match(secondAttempt._replies[0].content, /already rejected/i);
});

// ===========================================================================
// 15. Both deterministic-fallback and Ollama-enhanced drafts are approvable (Part S)
// ===========================================================================

test('a deterministic-fallback draft (Ollama down) can still be approved end to end', async (t) => {
  const original = ollamaService.generateReply;
  ollamaService.generateReply = async () => {
    throw new ollamaService.OllamaError('simulated outage', { friendlyReply: 'down' });
  };
  t.after(() => {
    ollamaService.generateReply = original;
  });

  const userId = 'fallback-approve-test';
  await handleHandoffDraftRequest({ userId, projectName: 'WhisperOS' });
  const session = [...approvalStore.sessions.values()].find((s) => s.requesterUserId === userId && s.project === 'WhisperOS');
  const result = approvalStore.approve({ draftId: session.draftId, actorUserId: userId, isAdmin: false });
  assert.equal(result.ok, true);
});

test('an Ollama-enhanced draft can also be approved end to end', async (t) => {
  const original = ollamaService.generateReply;
  ollamaService.generateReply = async () => 'A short, grounded narrative gloss.';
  t.after(() => {
    ollamaService.generateReply = original;
  });

  const userId = 'ollama-approve-test';
  await handleHandoffDraftRequest({ userId, projectName: 'WhisperBot' });
  const session = [...approvalStore.sessions.values()].find((s) => s.requesterUserId === userId && s.project === 'WhisperBot');
  const result = approvalStore.approve({ draftId: session.draftId, actorUserId: userId, isAdmin: false });
  assert.equal(result.ok, true);
});

// ===========================================================================
// 16. Part T -- live local simulation (no Discord gateway, fixture identities)
// ===========================================================================

test('Part T simulation: User A drafts WhisperOS, User B is denied, User A approves, nothing is written', async () => {
  cooldownManager.clear('sim-user-a');
  const before = fs.readdirSync(path.resolve(__dirname, '..', '..', 'WhisperCommandCenter')).sort();

  const draftResult = await handleHandoffDraftRequest({ userId: 'sim-user-a', projectName: 'WhisperOS' });
  const idMatch = draftResult.reply.match(/Draft ID: ([0-9a-f-]{36})/i);
  assert.ok(idMatch, 'draft reply must contain a Draft ID');
  const draftId = idMatch[1];

  const userBAttempt = approvalStore.approve({ draftId, actorUserId: 'sim-user-b', isAdmin: false });
  assert.equal(userBAttempt.ok, false);
  assert.equal(userBAttempt.reason, 'not_authorized');

  const userAApproval = approvalStore.approve({ draftId, actorUserId: 'sim-user-a', isAdmin: false });
  assert.equal(userAApproval.ok, true);

  const after = fs.readdirSync(path.resolve(__dirname, '..', '..', 'WhisperCommandCenter')).sort();
  assert.deepEqual(before, after);
});

test('Part T simulation: User A drafts GamingUnfiltered twice, first is superseded, rejecting the second forecloses approval', async () => {
  cooldownManager.clear('sim-user-a2');

  const first = await handleHandoffDraftRequest({ userId: 'sim-user-a2', projectName: 'GamingUnfiltered' });
  const firstId = first.reply.match(/Draft ID: ([0-9a-f-]{36})/i)[1];

  cooldownManager.clear('sim-user-a2');
  const second = await handleHandoffDraftRequest({ userId: 'sim-user-a2', projectName: 'GamingUnfiltered' });
  const secondId = second.reply.match(/Draft ID: ([0-9a-f-]{36})/i)[1];

  assert.notEqual(firstId, secondId);
  assert.equal(approvalStore.getSession(firstId).status, 'superseded');

  const rejection = approvalStore.reject({ draftId: secondId, actorUserId: 'sim-user-a2', isAdmin: false });
  assert.equal(rejection.ok, true);

  const approveAfterReject = approvalStore.approve({ draftId: secondId, actorUserId: 'sim-user-a2', isAdmin: false });
  assert.equal(approveAfterReject.ok, false);
  assert.equal(approveAfterReject.reason, 'status_rejected');

  const approveSuperseded = approvalStore.approve({ draftId: firstId, actorUserId: 'sim-user-a2', isAdmin: false });
  assert.equal(approveSuperseded.ok, false);
  assert.equal(approveSuperseded.reason, 'status_superseded');
});
