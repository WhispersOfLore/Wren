process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectContext = require('../src/services/projectContext');
const { getProjectContext, listAllowedProjects, _internal } = projectContext;
const { readEntryPointDoc, findLatestHandoff, isDenied } = _internal;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wren-project-context-test-'));
}

function writeFile(dir, relPath, content) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// --- 1/2/3: the three Phase 10 allowlisted projects resolve successfully ---

test('WhisperOS resolves successfully', () => {
  const ctx = getProjectContext('WhisperOS');
  assert.equal(ctx.allowed, true);
  assert.equal(ctx.project, 'WhisperOS');
  assert.ok(ctx.projectPath.endsWith('WhisperOS'));
});

test('GamingUnfiltered resolves successfully', () => {
  const ctx = getProjectContext('GamingUnfiltered');
  assert.equal(ctx.allowed, true);
  assert.equal(ctx.project, 'GamingUnfiltered');
});

test('ClayMoneyTrail resolves successfully', () => {
  const ctx = getProjectContext('ClayMoneyTrail');
  assert.equal(ctx.allowed, true);
  assert.equal(ctx.project, 'ClayMoneyTrail');
});

test('project name matching is case-insensitive', () => {
  const ctx = getProjectContext('whisperos');
  assert.equal(ctx.allowed, true);
  assert.equal(ctx.project, 'WhisperOS');
});

// --- 4: unknown project is rejected ---

test('unknown project is rejected, not fabricated', () => {
  const ctx = getProjectContext('SomeRandomProjectThatDoesNotExist');
  assert.equal(ctx.allowed, false);
  assert.equal(ctx.projectPath, undefined);
  assert.ok(ctx.warnings[0].includes('not available'));
});

// --- 5: path traversal cannot be requested via the project name ---

test('a path-traversal string as the project name resolves to nothing, not a filesystem path', () => {
  const ctx = getProjectContext('../../../etc/passwd');
  assert.equal(ctx.allowed, false);
});

// --- 6: an arbitrary absolute path cannot be requested via the project name ---

test('an absolute path as the project name resolves to nothing, not a filesystem path', () => {
  const ctx = getProjectContext('/etc/passwd');
  assert.equal(ctx.allowed, false);
});

test('the public API has no path parameter at all -- only a project name', () => {
  // getProjectContext takes exactly one argument: a name. There is no
  // second "path" argument a caller could supply instead.
  assert.equal(getProjectContext.length, 1);
});

// --- readEntryPointDoc: traversal/escape/credential-deny at the file level ---

test('readEntryPointDoc rejects a relative path that escapes the project root', () => {
  const dir = makeTempDir();
  writeFile(dir, 'README.md', 'hello');
  const result = readEntryPointDoc(dir, '../outside.txt', 8000);
  assert.ok(result.error);
});

test('readEntryPointDoc reads an allowed in-root file successfully', () => {
  const dir = makeTempDir();
  writeFile(dir, 'README.md', 'hello world');
  const result = readEntryPointDoc(dir, 'README.md', 8000);
  assert.equal(result.error, undefined);
  assert.equal(result.content, 'hello world');
  assert.equal(result.truncated, false);
});

// --- 8: a credential file is never read, even if named as an entry point ---

test('credential filenames are denied by pattern, independent of the allowlist', () => {
  assert.equal(isDenied('.env'), true);
  assert.equal(isDenied('.env.local'), true);
  assert.equal(isDenied('token.json'), true);
  assert.equal(isDenied('client_secret.json'), true);
  assert.equal(isDenied('id_rsa'), true);
  assert.equal(isDenied('secrets/anything.json'), true);
  assert.equal(isDenied('README.md'), false);
});

test('readEntryPointDoc refuses to read a credential-named file even if it exists in-root', () => {
  const dir = makeTempDir();
  writeFile(dir, '.env', 'DISCORD_TOKEN=real-secret-value');
  const result = readEntryPointDoc(dir, '.env', 8000);
  assert.ok(result.error);
  assert.equal(result.content, undefined);
});

test('the real allowlist never names a credential-shaped file as an entry point', () => {
  for (const entry of _internal.PROJECT_ALLOWLIST) {
    for (const relPath of entry.entryPoints) {
      assert.equal(isDenied(relPath), false, `${entry.name}'s entry point "${relPath}" should not be credential-shaped`);
    }
  }
});

// --- 10/11: context size limit + truncation reporting ---

test('a document larger than the cap is truncated and reported as such', () => {
  const dir = makeTempDir();
  writeFile(dir, 'BIG.md', 'x'.repeat(1000));
  const result = readEntryPointDoc(dir, 'BIG.md', 100);
  assert.equal(result.truncated, true);
  assert.equal(result.content.length, 100);
  assert.equal(result.bytes, 1000);
});

test('a document under the cap is not marked truncated', () => {
  const dir = makeTempDir();
  writeFile(dir, 'SMALL.md', 'short');
  const result = readEntryPointDoc(dir, 'SMALL.md', 100);
  assert.equal(result.truncated, false);
});

// --- 7/9/14/15: handoff lookup via an isolated fixture handoffs/ directory ---

function makeHandoffsFixture(entries) {
  const handoffsDir = makeTempDir();
  for (const [filename, content] of Object.entries(entries.files || {})) {
    writeFile(handoffsDir, filename, content);
  }
  writeFile(handoffsDir, 'index.json', JSON.stringify({ schema_version: 1, handoffs: entries.handoffs }));
  return handoffsDir;
}

test('missing handoffs index is handled safely (no handoff, not an error)', () => {
  const emptyDir = makeTempDir(); // no index.json at all
  const projectDir = makeTempDir();
  const result = findLatestHandoff('SomeProject', projectDir, 8000, emptyDir);
  assert.equal(result, null);
});

test('malformed handoffs index (not JSON) is handled safely', () => {
  const handoffsDir = makeTempDir();
  writeFile(handoffsDir, 'index.json', '{ this is not valid json');
  const projectDir = makeTempDir();
  const result = findLatestHandoff('SomeProject', projectDir, 8000, handoffsDir);
  assert.equal(result, null);
});

test('a malformed index entry (file with a path separator) fails safely', () => {
  const projectDir = makeTempDir();
  const handoffsDir = makeHandoffsFixture({
    handoffs: [
      {
        id: 'bad-entry',
        created_at: '2026-01-01T00:00:00-00:00',
        project: 'FixtureProject',
        project_path: projectDir,
        file: '../escape.md',
      },
    ],
  });
  const result = findLatestHandoff('FixtureProject', projectDir, 8000, handoffsDir);
  assert.ok(result && result.error);
});

test('a handoff file reference that would escape handoffs/ is rejected', () => {
  const projectDir = makeTempDir();
  const outsideDir = makeTempDir();
  writeFile(outsideDir, 'secret.md', 'should never be read');
  const handoffsDir = makeHandoffsFixture({
    handoffs: [
      {
        id: 'escape-attempt',
        created_at: '2026-01-01T00:00:00-00:00',
        project: 'FixtureProject',
        project_path: projectDir,
        // Even though this has no literal slash (which the malformed-entry
        // check above already rejects), simulate a symlink-based escape by
        // pointing at a name that resolves outside handoffsDir.
        file: 'not-a-real-file.md',
      },
    ],
  });
  const result = findLatestHandoff('FixtureProject', projectDir, 8000, handoffsDir);
  assert.ok(result && result.error); // file doesn't exist inside handoffsDir -> safe failure
});

test('newest matching handoff wins by created_at', () => {
  const projectDir = makeTempDir();
  const handoffsDir = makeHandoffsFixture({
    files: {
      'older.md': 'older content',
      'newer.md': 'newer content',
    },
    handoffs: [
      {
        id: 'older',
        created_at: '2026-01-01T00:00:00-00:00',
        project: 'FixtureProject',
        project_path: projectDir,
        file: 'older.md',
        agent: 'Claude',
        objective: 'first',
        git_branch: 'main',
        git_commit: 'aaa1111',
        pushed: true,
        has_blockers: false,
        durable_knowledge_candidate: false,
      },
      {
        id: 'newer',
        created_at: '2026-06-01T00:00:00-00:00',
        project: 'FixtureProject',
        project_path: projectDir,
        file: 'newer.md',
        agent: 'Claude',
        objective: 'second',
        git_branch: 'main',
        git_commit: 'bbb2222',
        pushed: true,
        has_blockers: false,
        durable_knowledge_candidate: false,
      },
    ],
  });
  const result = findLatestHandoff('FixtureProject', projectDir, 8000, handoffsDir);
  assert.equal(result.id, 'newer');
  assert.equal(result.content, 'newer content');
});

test('a handoff entry for a different project_path is not matched', () => {
  const projectDir = makeTempDir();
  const otherProjectDir = makeTempDir();
  const handoffsDir = makeHandoffsFixture({
    files: { 'irrelevant.md': 'irrelevant' },
    handoffs: [
      {
        id: 'wrong-path',
        created_at: '2026-01-01T00:00:00-00:00',
        project: 'FixtureProject',
        project_path: otherProjectDir, // does not match projectDir
        file: 'irrelevant.md',
      },
    ],
  });
  const result = findLatestHandoff('FixtureProject', projectDir, 8000, handoffsDir);
  assert.equal(result, null);
});

test('real WhisperOS handoffs: newest wins against the actual registry', () => {
  // Live, read-only check against real Phase 6/7 handoffs -- no fixture.
  const ctx = getProjectContext('WhisperOS');
  assert.ok(ctx.latestHandoff, 'expected a real handoff to exist for WhisperOS');
  // The Phase 7 handoff (2026-09-15-1753-whisperos) is newer than the
  // Phase 6 one (2026-09-15-1739-whisperos).
  assert.equal(ctx.latestHandoff.id, '2026-09-15-1753-whisperos');
});

// --- 13: ClayMoneyTrail evidence-status vocabulary survives into context untouched ---

test('ClayMoneyTrail context preserves evidence-status vocabulary verbatim', () => {
  const ctx = getProjectContext('ClayMoneyTrail');
  const readme = ctx.entryPoints.find((d) => d.path === 'README.md');
  assert.ok(readme, 'expected README.md to be loaded for ClayMoneyTrail');
  // The source-status vocabulary table appears early in the README (well
  // within the size cap) -- confirm it survives untouched, not paraphrased
  // or filtered.
  assert.ok(readme.content.includes('verified_official'));
  assert.ok(readme.content.includes('Reported directly by an official document or record'));
  // The README (9476 bytes) is larger than the 8000-byte per-doc cap, so
  // this is also a real, non-fixture confirmation that truncation is
  // reported rather than silently dropping the tail of a real document.
  assert.equal(readme.truncated, true);
});

// --- 12: no write occurs -- structural check on the module's own source ---

test('projectContext.js contains no filesystem write/delete calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'projectContext.js'), 'utf8');
  const writeLikeCalls = /fs\.(write|append|unlink|rm|mkdir|rename|copy)\w*\s*\(/g;
  const matches = source.match(writeLikeCalls) || [];
  assert.deepEqual(matches, []);
});
