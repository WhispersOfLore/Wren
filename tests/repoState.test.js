const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { captureRepositorySnapshot, snapshotsMatch, GIT_TIMEOUT_MS, GIT_MAX_BUFFER_BYTES } = require('../src/services/repoState');

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function makeFixtureRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-repostate-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

// ===========================================================================
// Fixture-repo mechanics (Part U items 1-6)
// ===========================================================================

test('a git project snapshot captures HEAD', (t) => {
  const dir = makeFixtureRepo(t);
  const snap = captureRepositorySnapshot('Fixture', dir);
  assert.equal(snap.isGitRepo, true);
  assert.match(snap.headCommit, /^[0-9a-f]{40}$/);
});

test('a git project snapshot captures the current branch', (t) => {
  const dir = makeFixtureRepo(t);
  execFileSync('git', ['checkout', '-q', '-b', 'feature-x'], { cwd: dir });
  const snap = captureRepositorySnapshot('Fixture', dir);
  assert.equal(snap.branch, 'feature-x');
});

test('a clean working tree is reported as not dirty', (t) => {
  const dir = makeFixtureRepo(t);
  const snap = captureRepositorySnapshot('Fixture', dir);
  assert.equal(snap.workingTreeDirty, false);
});

test('a dirty working tree is reported as dirty', (t) => {
  const dir = makeFixtureRepo(t);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const snap = captureRepositorySnapshot('Fixture', dir);
  assert.equal(snap.workingTreeDirty, true);
});

test('the working-tree fingerprint is a deterministic SHA-256 hex digest', (t) => {
  const dir = makeFixtureRepo(t);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const snap1 = captureRepositorySnapshot('Fixture', dir);
  const snap2 = captureRepositorySnapshot('Fixture', dir);
  assert.match(snap1.workingTreeFingerprint, SHA256_HEX_RE);
  assert.equal(snap1.workingTreeFingerprint, snap2.workingTreeFingerprint, 'same state must fingerprint identically');
});

test('a porcelain-status change (new untracked file) changes the fingerprint even though both states are "dirty"', (t) => {
  const dir = makeFixtureRepo(t);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const snap1 = captureRepositorySnapshot('Fixture', dir);

  fs.writeFileSync(path.join(dir, 'b.txt'), 'new file\n');
  const snap2 = captureRepositorySnapshot('Fixture', dir);

  assert.equal(snap1.workingTreeDirty, true);
  assert.equal(snap2.workingTreeDirty, true);
  assert.notEqual(snap1.workingTreeFingerprint, snap2.workingTreeFingerprint, 'dirty->dirty is not sufficient; the exact shape must match');
});

test('snapshotsMatch is true only when HEAD, branch, dirty flag, and fingerprint all agree', (t) => {
  const dir = makeFixtureRepo(t);
  const clean = captureRepositorySnapshot('Fixture', dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const dirty = captureRepositorySnapshot('Fixture', dir);

  assert.equal(snapshotsMatch(clean, clean), true);
  assert.equal(snapshotsMatch(clean, dirty), false);
});

test('snapshotsMatch treats two non-git snapshots as matching (nothing to drift)', () => {
  const a = { isGitRepo: false };
  const b = { isGitRepo: false };
  assert.equal(snapshotsMatch(a, b), true);
});

test('snapshotsMatch fails closed when either snapshot recorded a capture error', () => {
  const good = { isGitRepo: true, headCommit: 'abc', branch: 'main', workingTreeDirty: false, workingTreeFingerprint: 'x' };
  const errored = { isGitRepo: true, error: 'repository state unavailable' };
  assert.equal(snapshotsMatch(good, errored), false);
  assert.equal(snapshotsMatch(errored, errored), false);
});

// ===========================================================================
// Non-git projects (Part I) -- real project, read-only
// ===========================================================================

test('a real non-Git project (BroBeHonest) is reported as isGitRepo: false, never fabricated', () => {
  const brobehonest = path.resolve(__dirname, '..', '..', 'BroBeHonest');
  const snap = captureRepositorySnapshot('BroBeHonest', brobehonest);
  assert.equal(snap.isGitRepo, false);
  assert.equal(snap.headCommit, null);
  assert.equal(snap.branch, null);
  assert.equal(snap.workingTreeDirty, null);
});

// ===========================================================================
// Part V -- real, read-only snapshots of real projects (never mutated)
// ===========================================================================

test('real repository snapshots: WhisperOS, GamingUnfiltered, ClayMoneyTrail are read without modification', () => {
  const projects = ['WhisperOS', 'GamingUnfiltered', 'ClayMoneyTrail'];
  for (const name of projects) {
    const dir = path.resolve(__dirname, '..', '..', name);
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    const snap = captureRepositorySnapshot(name, dir);
    const after = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    assert.equal(snap.isGitRepo, true, `${name} is expected to be a real git repo`);
    assert.equal(before, after, `capturing a snapshot of ${name} must not change its working tree`);
  }
});

// ===========================================================================
// Part W -- performance
// ===========================================================================

test('repository snapshot capture is fast for real projects (reported, not asserted against a hard budget beyond a generous ceiling)', () => {
  const projects = ['WhisperOS', 'GamingUnfiltered', 'ClayMoneyTrail'];
  for (const name of projects) {
    const dir = path.resolve(__dirname, '..', '..', name);
    const t0 = Date.now();
    captureRepositorySnapshot(name, dir);
    const ms = Date.now() - t0;
    console.log(`  [timing] ${name} repository snapshot: ${ms}ms`);
    assert.ok(ms < 2000, `${name} snapshot took ${ms}ms, expected well under 2000ms`);
  }
});

// ===========================================================================
// Part Y / Part U items 38-41 -- subprocess security review
// ===========================================================================

test('repoState.js hardcodes the git executable literally, never builds it from a variable', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'repoState.js'), 'utf8');
  const calls = [...source.matchAll(/execFileSync\(\s*(['"`])(.*?)\1/g)];
  assert.ok(calls.length > 0, 'expected at least one execFileSync call');
  for (const call of calls) {
    assert.equal(call[2], 'git', 'the executable argument must be the literal string "git"');
  }
});

test('repoState.js never uses exec/spawn with a shell, and never sets shell: true', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'repoState.js'), 'utf8');
  assert.equal(/\bexec\(|\bspawn\(|\bexecSync\(/.test(source), false, 'only execFileSync may be used');
  assert.equal(/shell\s*:\s*true/.test(source), false);
  assert.match(source, /shell\s*:\s*false/, 'shell: false should be explicit');
});

test('repoState.js only ever invokes a small fixed set of read-only git subcommands', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'repoState.js'), 'utf8');
  const argvArrays = [...source.matchAll(/runGit\(\[(.*?)\]/g)].map((m) => m[1]);
  const isInsideCall = /execFileSync\(\s*['"`]git['"`]\s*,\s*\[(.*?)\]/g;
  const allArgvSource = [...source.matchAll(isInsideCall)].map((m) => m[1]).concat(argvArrays);
  const allowedSubcommands = ['rev-parse', 'branch', 'status'];
  for (const argvSrc of allArgvSource) {
    const hasAllowed = allowedSubcommands.some((cmd) => argvSrc.includes(`'${cmd}'`));
    assert.ok(hasAllowed, `unexpected git invocation shape: [${argvSrc}]`);
  }
  // No string concatenation or template interpolation feeding into any argv array.
  assert.equal(/\[\s*['"`][a-z-]+['"`]\s*,\s*[a-zA-Z]+\s*\]/.test(source.replace(/args, cwd/g, '')), false);
});

test('repoState.js enforces both a timeout and a bounded maxBuffer on every git call', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'repoState.js'), 'utf8');
  assert.match(source, /timeout:\s*GIT_TIMEOUT_MS/);
  assert.match(source, /maxBuffer:\s*GIT_MAX_BUFFER_BYTES/);
  assert.equal(typeof GIT_TIMEOUT_MS, 'number');
  assert.equal(typeof GIT_MAX_BUFFER_BYTES, 'number');
  assert.ok(GIT_TIMEOUT_MS > 0 && GIT_TIMEOUT_MS <= 10000, 'timeout should be a short, sane bound');
  assert.ok(GIT_MAX_BUFFER_BYTES > 0 && GIT_MAX_BUFFER_BYTES <= 10 * 1024 * 1024, 'maxBuffer should be bounded');
});

test('repoState.js restricts the git subprocess environment to PATH only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'repoState.js'), 'utf8');
  assert.match(source, /function gitEnv/);
  assert.doesNotMatch(source, /\.\.\.process\.env/, 'the full ambient environment must never be forwarded to git');
});

test('repoState.js does not require child_process anywhere except the one intended import', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'repoState.js'), 'utf8');
  const matches = source.match(/require\(['"]node:child_process['"]\)/g) || [];
  assert.equal(matches.length, 1);
});
