const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

/**
 * Narrowly-scoped, read-only Git repository state inspection (Phase 14).
 *
 * INVESTIGATION (Part C): resolving HEAD/branch by parsing `.git/HEAD` and
 * `.git/refs/...` directly was considered first, to avoid any process
 * execution at all. It was rejected: worktrees redirect `.git` via a
 * `gitdir:` pointer file, branches can live only in `packed-refs`, and a
 * detached HEAD has no ref at all -- correctly handling all of that is
 * exactly what `git` itself already does, and silently mis-resolving HEAD
 * would be a *correctness* bug in a safety guard, which is worse than the
 * process-execution surface we're trying to avoid. Working-tree
 * cleanliness has no realistic non-git-shelling alternative at all (it
 * requires the same index/worktree diff logic git already implements).
 * Since a controlled subprocess is unavoidable for the working-tree
 * check, using it consistently for all three facts (rather than a mixed
 * fs-parsing + subprocess approach) keeps one code path to review instead
 * of two, and guarantees HEAD/branch and the working-tree read all agree
 * with the same git binary at the same instant.
 *
 * Every constraint from Part C is enforced here:
 *  - the executable is the hardcoded literal 'git' -- never a path built
 *    from input, never resolved via a user-supplied string.
 *  - every argv array below is a fixed literal in this file -- nothing
 *    from a draft, a project name, or a Discord user ever reaches argv.
 *  - `cwd` is always the caller-supplied canonical project path, which in
 *    every real call site is `projectContext.getProjectContext(...).projectPath`
 *    -- already realpath-canonicalized and root-checked by that module.
 *    This file does not resolve or accept any other kind of path.
 *  - `execFileSync` is used, never `exec`/`spawn` with a shell enabled --
 *    there is no shell involved, so no argument can be reinterpreted.
 *  - a hard timeout and a bounded `maxBuffer` are set on every call.
 *  - only read-only git subcommands are ever invoked: `rev-parse
 *    --is-inside-work-tree`, `rev-parse HEAD`, `branch --show-current`,
 *    `status --porcelain`.
 *  - the environment passed to git is trimmed to PATH only, so an
 *    ambient GIT_DIR/GIT_WORK_TREE/GIT_CEILING_DIRECTORIES cannot cause
 *    git to look anywhere other than the given `cwd`.
 */

const GIT_TIMEOUT_MS = 3000;
const GIT_MAX_BUFFER_BYTES = 256 * 1024;

function gitEnv() {
  return { PATH: process.env.PATH || '/usr/bin:/bin' };
}

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    env: gitEnv(),
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  }).trim();
}

function isGitRepo(cwd) {
  try {
    return runGit(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
  } catch {
    return false;
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {string} project - catalog project name, for labeling only
 * @param {string} projectPath - MUST already be a canonical, catalog-resolved path
 * @returns {{project, canonicalProjectPath, isGitRepo, headCommit, branch,
 *   workingTreeDirty, workingTreeFingerprint, capturedAt, error?}}
 */
function captureRepositorySnapshot(project, projectPath) {
  const capturedAt = new Date().toISOString();

  if (!isGitRepo(projectPath)) {
    return {
      project,
      canonicalProjectPath: projectPath,
      isGitRepo: false,
      headCommit: null,
      branch: null,
      workingTreeDirty: null,
      workingTreeFingerprint: null,
      capturedAt,
    };
  }

  try {
    const headCommit = runGit(['rev-parse', 'HEAD'], projectPath);
    const branchOutput = runGit(['branch', '--show-current'], projectPath);
    const branch = branchOutput || null; // empty string on a detached HEAD -- never fabricate a branch name

    // The raw porcelain listing is deliberately never returned or logged --
    // only its boolean dirtiness and a SHA-256 fingerprint of it. See Part
    // H's documented limitation below.
    const statusPorcelain = runGit(['status', '--porcelain'], projectPath);

    return {
      project,
      canonicalProjectPath: projectPath,
      isGitRepo: true,
      headCommit,
      branch,
      workingTreeDirty: statusPorcelain.length > 0,
      workingTreeFingerprint: sha256(statusPorcelain),
      capturedAt,
    };
  } catch (err) {
    // git exists and recognizes the repo, but a command failed (timeout,
    // buffer overflow, transient lock, corrupted repo, etc.) -- fail
    // closed to "state unavailable," never fabricate a HEAD or branch.
    return {
      project,
      canonicalProjectPath: projectPath,
      isGitRepo: true,
      headCommit: null,
      branch: null,
      workingTreeDirty: null,
      workingTreeFingerprint: null,
      capturedAt,
      error: 'repository state unavailable',
    };
  }
}

/**
 * Compares two snapshots on exactly the fields Part F/H designate as the
 * drift signal: HEAD, branch, dirty flag, and the working-tree
 * fingerprint. Two non-git snapshots are considered equal (nothing to
 * drift); a snapshot with a capture error never matches anything,
 * including another error (fail closed rather than treat "unavailable"
 * as "unchanged").
 *
 * LIMITATION (Part H, documented): the fingerprint covers the exact shape
 * of `git status --porcelain` output, not file contents. A tracked file
 * that is modified and then reverted back to producing the identical
 * porcelain line (or, in the pathological case, a tracked file whose
 * content changes without changing its tracked/modified status relative
 * to HEAD in a way porcelain would show differently) would not be caught
 * by this guard alone. This is a guard against common state drift
 * (commits, branch switches, files staged/modified/added/removed since
 * the draft), not a full content-integrity snapshot of the repository.
 */
function snapshotsMatch(a, b) {
  if (!a || !b) return false;
  if (a.error || b.error) return false;
  if (a.isGitRepo !== b.isGitRepo) return false;
  if (!a.isGitRepo) return true;
  return (
    a.headCommit === b.headCommit &&
    a.branch === b.branch &&
    a.workingTreeDirty === b.workingTreeDirty &&
    a.workingTreeFingerprint === b.workingTreeFingerprint
  );
}

module.exports = {
  captureRepositorySnapshot,
  snapshotsMatch,
  isGitRepo,
  GIT_TIMEOUT_MS,
  GIT_MAX_BUFFER_BYTES,
};
