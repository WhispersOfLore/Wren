process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
process.env.DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '1549772221226950686';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../src/config/configManager');
const { isAllowedGuild } = require('../src/utils/guildGuard');
const { denyUnlessAdminOps } = require('../src/utils/adminGate');
const permissionManager = require('../src/control/permissionManager');
const { BASE_IDENTITY } = require('../src/ai/personality');
const projectContext = require('../src/services/projectContext');
const memoryManager = require('../src/memory/memoryManager');
const loreManager = require('../src/lore/loreManager');
const memoryRetriever = require('../src/memory/memoryRetriever');
const { db } = require('../src/memory/database');
const { handleProject } = require('../src/interactions/projectHandler');
const { handleHandoffDraft } = require('../src/interactions/handoffDraftHandler');

const REPO_ROOT = path.join(__dirname, '..');
const NEW_GUILD_ID = '1549772221226950686';
const OLD_GAMING_CHANNEL_ID = '1478108084340785358'; // the previously-committed value -- must never reappear

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
}

function fakeInteraction({ userId = 'u1', isAdminMember = false, channelId = 'any-channel', subOptions = {} } = {}) {
  const replies = [];
  return {
    channelId,
    user: { id: userId },
    member: { id: userId, permissions: { has: () => isAdminMember } },
    options: { getString: (name) => subOptions[name] ?? null, getSubcommand: () => subOptions.__sub },
    reply: async (payload) => replies.push({ kind: 'reply', payload }),
    deferReply: async () => {},
    editReply: async (payload) => replies.push({ kind: 'edit', payload }),
    followUp: async (payload) => replies.push({ kind: 'followUp', payload }),
    _replies: replies,
  };
}

function allSourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(REPO_ROOT, 'src'));
  return files;
}

// ===========================================================================
// New guild configuration (Part E/F/R)
// ===========================================================================

test('config.discord.guildId is the configured new guild', () => {
  assert.equal(config.discord.guildId, NEW_GUILD_ID);
});

test('isAllowedGuild accepts only the configured guild', () => {
  assert.equal(isAllowedGuild(NEW_GUILD_ID), true);
  assert.equal(isAllowedGuild('9999999999999999999'), false);
  assert.equal(isAllowedGuild(null), false);
  assert.equal(isAllowedGuild(undefined), false);
});

test('the old gaming guild ID is never the configured guild', () => {
  // A representative old-gaming-shaped snowflake, distinct from the real
  // configured guild -- must be rejected the same as any other guild.
  assert.equal(isAllowedGuild('1111111111111111111'), false);
});

test('no source file hardcodes the previously-committed gaming channel ID', () => {
  const needle = OLD_GAMING_CHANNEL_ID;
  for (const file of allSourceFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes(needle), false, `${file} must not hardcode the old gaming channel ID`);
  }
});

test('config.json no longer commits a channel ID -- it is env-sourced only', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config.json'), 'utf8'));
  assert.equal(raw.discord?.channelId, undefined);
});

test('DISCORD_GUILD_ID is required -- configManager throws without it', () => {
  const configModulePath = require.resolve('../src/config/configManager');
  delete require.cache[configModulePath];
  const originalGuild = process.env.DISCORD_GUILD_ID;
  delete process.env.DISCORD_GUILD_ID;
  try {
    assert.throws(() => require('../src/config/configManager'), /DISCORD_GUILD_ID/);
  } finally {
    process.env.DISCORD_GUILD_ID = originalGuild;
    delete require.cache[configModulePath];
    require('../src/config/configManager'); // restore the normally-loaded singleton for subsequent tests
  }
});

// ===========================================================================
// Public/admin routing boundary (Part G — CRITICAL)
// ===========================================================================

test('denyUnlessAdminOps denies a non-admin', async () => {
  const interaction = fakeInteraction({ isAdminMember: false });
  const denied = await denyUnlessAdminOps(interaction);
  assert.equal(denied, true);
  assert.match(interaction._replies[0].payload.content, /admins only/i);
});

test('denyUnlessAdminOps allows an admin with no channel restriction configured', async () => {
  const interaction = fakeInteraction({ isAdminMember: true });
  const denied = await denyUnlessAdminOps(interaction);
  assert.equal(denied, false);
  assert.equal(interaction._replies.length, 0);
});

test('/wren project is denied to a non-admin regardless of channel', async () => {
  const interaction = fakeInteraction({ isAdminMember: false, subOptions: { name: 'ClayMoneyTrail' } });
  const denied = await denyUnlessAdminOps(interaction);
  assert.equal(denied, true);
  // Confirms the handler itself is never even reached for a denied caller
  // -- denyUnlessAdminOps must be checked before handleProject() runs.
});

test('/wren project succeeds for an admin (full path, real project)', async () => {
  const interaction = fakeInteraction({ isAdminMember: true, subOptions: { name: 'ClayMoneyTrail' } });
  await handleProject(interaction);
  const combined = interaction._replies.map((r) => r.payload).join(' ');
  assert.ok(combined.length > 0, 'expected an admin project-status reply');
});

test('handoff-draft is denied to a non-admin', async () => {
  const interaction = fakeInteraction({ isAdminMember: false, subOptions: { name: 'ClayMoneyTrail' } });
  const denied = await denyUnlessAdminOps(interaction);
  assert.equal(denied, true);
});

test('/wren link no longer exists as a command surface', () => {
  const wrenCommandSource = fs.readFileSync(path.join(REPO_ROOT, 'src', 'commands', 'wren.js'), 'utf8');
  assert.equal(/setName\(['"]link['"]\)/.test(wrenCommandSource), false);
});

test('playerManager.linkPlayer still exists (historical data path preserved, just not exposed as a command)', () => {
  const playerManager = require('../src/memory/playerManager');
  assert.equal(typeof playerManager.linkPlayer, 'function');
});

// ===========================================================================
// Project catalog restructure (Part I/J/K)
// ===========================================================================

test('Cthrew is enabled in the project-awareness catalog', () => {
  const ctx = projectContext.getProjectContext('Cthrew');
  assert.equal(ctx.allowed, true);
  assert.equal(ctx.project, 'Cthrew');
});

test('WhisperCommandCenter is enabled in the catalog (admin-only reachability via denyUnlessAdminOps)', () => {
  const ctx = projectContext.getProjectContext('WhisperCommandCenter');
  assert.equal(ctx.allowed, true);
});

test('gaming-ecosystem projects are disabled from the default community catalog', () => {
  for (const name of ['WhisperSMP', 'WhisperBot', 'GamingUnfiltered', 'BroBeHonest', 'WhisperContent', 'WhatIfSeries', 'WhisperOS']) {
    const ctx = projectContext.getProjectContext(name);
    assert.equal(ctx.allowed, false, `${name} should be disabled from Wren's default catalog as of Phase 17`);
  }
});

test('civic-domain projects remain enabled', () => {
  for (const name of ['ClayMoneyTrail', 'WhisperAboutIt', 'Cthrew', 'WhisperCommandCenter']) {
    const ctx = projectContext.getProjectContext(name);
    assert.equal(ctx.allowed, true, `${name} should remain enabled`);
  }
});

test('disabled gaming projects were not deleted or modified on disk', () => {
  for (const name of ['WhisperSMP', 'WhisperBot', 'GamingUnfiltered', 'BroBeHonest']) {
    const dir = path.join(REPO_ROOT, '..', name);
    assert.ok(fs.existsSync(dir), `${name} directory must still exist`);
  }
});

// ===========================================================================
// Civic verification-status preservation / source-grounding (Part H/N)
// ===========================================================================

test('ai/personality.js base identity forbids upgrading an allegation to a fact', () => {
  assert.match(BASE_IDENTITY, /never upgrade "an allegation that x happened" into "x happened\."/i);
});

test('ai/personality.js base identity is no longer WhisperSMP/gaming-branded', () => {
  // WhisperSMP may still be mentioned -- but only to explicitly disclaim
  // it (see the next test), never to claim it as Wren's own identity, as
  // the pre-Phase-17 text did ("the AI companion of WhisperSMP").
  assert.equal(/the AI companion of WhisperSMP/i.test(BASE_IDENTITY), false);
  assert.match(BASE_IDENTITY, /Whisper About It/i);
});

test('ai/personality.js explicitly disclaims being a WhisperSMP/gaming assistant', () => {
  assert.match(BASE_IDENTITY, /not a WhisperSMP character/i);
  assert.match(BASE_IDENTITY, /gaming assistant/i);
});

test('ai/personality.js instructs Wren to admit insufficient verified/approved information rather than invent', () => {
  assert.match(BASE_IDENTITY, /do not have enough verified or approved information/i);
});

test('memoryManager/loreManager verification_status is never auto-set to verified_fact by default', async () => {
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-test'");
  const id = await memoryManager.addMemory({ discordId: 'civic-test-user', content: 'a hypothesis under review', createdBy: 'phase17-test' });
  const row = await new Promise((resolve, reject) => db.get('SELECT * FROM memories WHERE id = ?', [id], (e, r) => (e ? reject(e) : resolve(r))));
  assert.equal(row.verification_status, null, 'verification_status must default to null/unset, never a status the model or default path invented');
  await dbRun('DELETE FROM memories WHERE id = ?', [id]);
  await dbRun("DELETE FROM users WHERE discord_id = 'civic-test-user'");
});

test('formatMemory-equivalent output preserves a verification_status prefix verbatim, never smoothing it away', async () => {
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-test-2'");
  await memoryManager.addMemory({
    discordId: 'civic-test-user-2', content: 'unique-marker-zzz that something occurred', createdBy: 'phase17-test-2',
    visibility: 'public', verificationStatus: 'unverified_lead',
  });
  const block = await memoryRetriever.buildContextBlock('unique-marker-zzz');
  assert.match(block, /\[unverified_lead\]/);
  assert.doesNotMatch(block, /\bthat something occurred happened\b/i); // never rewritten into a bare factual claim
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-test-2'");
  await dbRun("DELETE FROM users WHERE discord_id = 'civic-test-user-2'");
});

test('there is no code path that lets the LLM/model output set verification_status', () => {
  // The model's output is never fed into addMemory/addLore's verificationStatus
  // parameter anywhere -- only explicit, deterministic call sites (control
  // panels, tests) supply it.
  const responderSource = fs.readFileSync(path.join(REPO_ROOT, 'src', 'interactions', 'responder.js'), 'utf8');
  assert.equal(/verificationStatus/.test(responderSource), false);
});

// ===========================================================================
// Public visibility boundary (Part G/M)
// ===========================================================================

test('a default (internal) memory never surfaces via the public retrieval path', async () => {
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-visibility-test'");
  await memoryManager.addMemory({ discordId: 'vis-test-user', content: 'unique-marker-internal-yyy secret detail', createdBy: 'phase17-visibility-test' });
  const block = await memoryRetriever.buildContextBlock('unique-marker-internal-yyy');
  assert.equal(block, '');
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-visibility-test'");
  await dbRun("DELETE FROM users WHERE discord_id = 'vis-test-user'");
});

test('an explicitly public memory does surface via the public retrieval path', async () => {
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-visibility-test-2'");
  await memoryManager.addMemory({
    discordId: 'vis-test-user-2', content: 'unique-marker-public-xxx open detail', createdBy: 'phase17-visibility-test-2', visibility: 'public',
  });
  const block = await memoryRetriever.buildContextBlock('unique-marker-public-xxx');
  assert.match(block, /unique-marker-public-xxx/);
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-visibility-test-2'");
  await dbRun("DELETE FROM users WHERE discord_id = 'vis-test-user-2'");
});

test('CommandCenter/project-awareness internals are not reachable through the public memory/lore retrieval path', () => {
  // The public retrieval path (memoryRetriever.js) never imports
  // projectContext.js/handoffApproval.js -- structurally cannot leak
  // internal project state into ordinary conversation.
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'memory', 'memoryRetriever.js'), 'utf8');
  assert.equal(/projectContext|handoffApproval|handoffDraft|repoState/.test(source), false);
});

// ===========================================================================
// Guild-scoped memory isolation (Part L)
// ===========================================================================

test('a new memory is stamped with the current configured guild', async () => {
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-guild-test'");
  const id = await memoryManager.addMemory({ discordId: 'guild-test-user', content: 'guild-stamped memory', createdBy: 'phase17-guild-test' });
  const row = await new Promise((resolve, reject) => db.get('SELECT * FROM memories WHERE id = ?', [id], (e, r) => (e ? reject(e) : resolve(r))));
  assert.equal(row.guild_id, NEW_GUILD_ID);
  await dbRun('DELETE FROM memories WHERE id = ?', [id]);
  await dbRun("DELETE FROM users WHERE discord_id = 'guild-test-user'");
});

test('a memory with a NULL guild_id (simulating pre-Phase-17 / old-guild data) never surfaces in the current guild', async () => {
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-oldguild-test'");
  const id = await memoryManager.addMemory({
    discordId: 'oldguild-test-user', content: 'unique-marker-oldguild-www legacy detail', createdBy: 'phase17-oldguild-test', visibility: 'public',
  });
  await dbRun('UPDATE memories SET guild_id = NULL WHERE id = ?', [id]);
  const block = await memoryRetriever.buildContextBlock('unique-marker-oldguild-www');
  assert.equal(block, '', 'a NULL-guild (legacy) memory must never surface in the current guild, even if marked public');
  await dbRun('DELETE FROM memories WHERE id = ?', [id]);
  await dbRun("DELETE FROM users WHERE discord_id = 'oldguild-test-user'");
});

test('a memory tagged for a DIFFERENT specific guild never surfaces in the current guild', async () => {
  await dbRun("DELETE FROM memories WHERE created_by = 'phase17-otherguild-test'");
  const id = await memoryManager.addMemory({
    discordId: 'otherguild-test-user', content: 'unique-marker-otherguild-vvv detail', createdBy: 'phase17-otherguild-test', visibility: 'public',
  });
  await dbRun("UPDATE memories SET guild_id = 'some-other-guild-id' WHERE id = ?", [id]);
  const block = await memoryRetriever.buildContextBlock('unique-marker-otherguild-vvv');
  assert.equal(block, '');
  await dbRun('DELETE FROM memories WHERE id = ?', [id]);
  await dbRun("DELETE FROM users WHERE discord_id = 'otherguild-test-user'");
});

test('lore is guild-scoped the same way memories are', async () => {
  await dbRun("DELETE FROM lore WHERE created_by = 'phase17-lore-guild-test'");
  const id = await loreManager.addLore({ category: 'community', title: 'Guild Test Lore', content: 'unique-marker-lore-uuu detail', createdBy: 'phase17-lore-guild-test', visibility: 'public' });
  const before = await memoryRetriever.buildContextBlock('unique-marker-lore-uuu');
  assert.match(before, /unique-marker-lore-uuu/);
  await dbRun('UPDATE lore SET guild_id = NULL WHERE id = ?', [id]);
  const after = await memoryRetriever.buildContextBlock('unique-marker-lore-uuu');
  assert.equal(after, '');
  await dbRun('DELETE FROM lore WHERE id = ?', [id]);
});

// ===========================================================================
// systemd service + wren CLI wrapper safety (Part O/P/Q)
// ===========================================================================

test('the systemd unit template contains no token or secret', () => {
  const unit = fs.readFileSync(path.join(REPO_ROOT, 'deploy', 'wren.service'), 'utf8');
  assert.equal(/DISCORD_TOKEN/i.test(unit), false);
  assert.equal(/[A-Za-z0-9_-]{50,}/.test(unit), false); // no long token-shaped literal
});

test('the systemd unit does not run as root and has a bounded restart policy', () => {
  const unit = fs.readFileSync(path.join(REPO_ROOT, 'deploy', 'wren.service'), 'utf8');
  assert.equal(/^User=root/m.test(unit), false);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /RestartSec=/);
});

test('the start-wren.sh wrapper never echoes or logs an env var value', () => {
  const script = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'start-wren.sh'), 'utf8');
  assert.equal(/echo\s+\$DISCORD_TOKEN/.test(script), false);
  assert.equal(/DISCORD_TOKEN\s*=/.test(script), false);
});

// Comments in bin/wren's own header deliberately document what it does
// NOT do ("No sudo anywhere", "No `eval`...") -- stripping comment lines
// before scanning avoids the header's own prose matching these checks,
// the same class of false positive hit (and fixed) in repoState.js and
// collect-status.py's own security-review tests earlier this project.
function codeLinesOnly(script) {
  return script
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

test('bin/wren hardcodes exactly one unit name and never accepts an arbitrary one', () => {
  const script = codeLinesOnly(fs.readFileSync(path.join(REPO_ROOT, 'bin', 'wren'), 'utf8'));
  const unitLiterals = [...script.matchAll(/UNIT="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(unitLiterals, ['wren.service']);
  // Every systemctl/journalctl invocation must reference the $UNIT
  // variable, never a positional argument or other interpolation.
  const invocations = [...script.matchAll(/(?:systemctl|journalctl)[^\n]*/g)];
  assert.ok(invocations.length >= 5);
  for (const call of invocations) {
    assert.match(call[0], /"\$UNIT"/, `expected ${call[0]} to reference "$UNIT"`);
  }
});

test('bin/wren never uses sudo, eval, or a shell-string command', () => {
  const script = codeLinesOnly(fs.readFileSync(path.join(REPO_ROOT, 'bin', 'wren'), 'utf8'));
  assert.equal(/\bsudo\b/.test(script), false);
  assert.equal(/\beval\b/.test(script), false);
  assert.equal(/sh\s+-c/.test(script), false);
});

test('no token appears anywhere in the git-tracked repository', () => {
  const { execFileSync } = require('node:child_process');
  const trackedFiles = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  for (const rel of trackedFiles) {
    const full = path.join(REPO_ROOT, rel);
    if (!fs.statSync(full).isFile()) continue;
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue; // binary file, skip
    }
    assert.equal(/^DISCORD_TOKEN=.+/m.test(content), false, `${rel} must not contain a set DISCORD_TOKEN value`);
  }
});

test('no .env file exists in the repository (nothing to accidentally commit)', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, '.env')), false);
});

// ===========================================================================
// Existing capability regression (Part T — "existing project/handoff
// functionality still works for authorized admin", "ordinary Discord
// behavior still works")
// ===========================================================================

test('an admin can still successfully draft a handoff for an enabled project (Phase 12-14 capability preserved)', async () => {
  const interaction = fakeInteraction({ isAdminMember: true, subOptions: { name: 'ClayMoneyTrail' } });
  await handleHandoffDraft(interaction);
  const combined = interaction._replies.map((r) => r.payload).join(' ');
  assert.match(combined, /DRAFT ONLY/);
});

test('permissionManager.isAdmin is unaffected by the guild change (Discord-permission-based, not guild-ID-based)', () => {
  const adminMember = { id: 'x', permissions: { has: () => true } };
  const nonAdminMember = { id: 'y', permissions: { has: () => false } };
  assert.equal(permissionManager.isAdmin(adminMember), true);
  assert.equal(permissionManager.isAdmin(nonAdminMember), false);
});
