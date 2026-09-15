const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/configManager');
const logger = require('../utils/logger');

/**
 * Read-only project awareness (Phase 10, catalog-driven since Phase 11).
 * This module is the ONLY place that touches another project's
 * filesystem, and it does so under a hard allowlist, not user-supplied
 * paths. It never writes anything, never invokes an LLM, and never runs a
 * shell command or another process.
 *
 * Safety model, in order:
 *   1. A project name must match an ENABLED entry in projectCatalog.json
 *      exactly (case-insensitive, alias-aware) -- there is no fuzzy
 *      matching and no way for a user-supplied string to become a
 *      filesystem path directly. WhisperCommandCenter/PROJECTS.md is
 *      never parsed to decide *whether* a project is reachable -- only
 *      this catalog decides that; PROJECTS.md is read only afterward, for
 *      one bounded summary line, once a project is already approved.
 *   2. Every path actually touched is derived from PROJECTS_ROOT (this
 *      repo's own parent directory, structurally derived from __dirname --
 *      never from config or user input) plus the catalog's relative
 *      entry-point list for that project.
 *   3. Every resolved path is canonicalized (fs.realpathSync) and checked
 *      to still fall inside its expected root before being read, so a
 *      symlink or a ".." component can't escape the intended directory.
 *   4. A credential-filename deny-list is checked on every candidate path
 *      regardless of where it came from, as defense in depth -- including
 *      against the catalog file itself at load time, so a bad catalog
 *      entry can disable itself rather than silently expose something.
 *   5. Reads are size-capped; nothing is read recursively.
 */

// ~/Projects, derived from this repo's own location on disk -- not
// configurable, so it can't be redirected by editing config.json.
const PROJECTS_ROOT = path.resolve(__dirname, '..', '..', '..');
const COMMAND_CENTER_PATH = path.join(PROJECTS_ROOT, 'WhisperCommandCenter');
const HANDOFFS_DIR = path.join(COMMAND_CENTER_PATH, 'handoffs');
const PROJECTS_MD_PATH = path.join(COMMAND_CENTER_PATH, 'PROJECTS.md');
const CATALOG_PATH = path.join(__dirname, '..', '..', 'projectCatalog.json');

// Defense in depth: never read a path matching one of these, no matter
// where the path came from or whether it's in a catalog entry-point list.
const CREDENTIAL_DENY_PATTERNS = [
  /(^|[\\/])\.env(\.|$)/i,
  /token\.json$/i,
  /client_secret/i,
  /credentials?/i,
  /\.pem$/i,
  /id_rsa/i,
  /cookie/i,
  /(^|[\\/])secrets?([\\/]|$)/i,
];

function isDenied(candidatePath) {
  return CREDENTIAL_DENY_PATTERNS.some((re) => re.test(candidatePath));
}

/**
 * Loads projectCatalog.json and validates every entry defensively. A
 * malformed catalog file fails to an EMPTY catalog (nothing reachable),
 * never to "allow everything" -- and a single bad entry is dropped and
 * logged, not allowed to crash the whole bot or to silently pass through
 * an unsafe entry point.
 */
function loadCatalog() {
  let raw;
  try {
    raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  } catch (err) {
    logger.error('projectCatalog.json could not be read -- project awareness disabled', { error: err.message });
    return [];
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    logger.error('projectCatalog.json is not valid JSON -- project awareness disabled', { error: err.message });
    return [];
  }

  if (!data || data.schema_version !== 1 || !Array.isArray(data.projects)) {
    logger.error('projectCatalog.json does not match the expected schema -- project awareness disabled');
    return [];
  }

  const catalog = [];
  const seenNames = new Set();

  for (const raw_entry of data.projects) {
    const entry = raw_entry;
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
      logger.warn('Skipping projectCatalog.json entry with a missing/invalid name');
      continue;
    }
    const name = entry.name.trim();
    if (seenNames.has(name.toLowerCase())) {
      logger.warn(`Skipping duplicate projectCatalog.json entry: ${name}`);
      continue;
    }

    const dirName = typeof entry.dirName === 'string' && entry.dirName.trim() ? entry.dirName.trim() : name;
    const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter((a) => typeof a === 'string' && a.trim()) : [];
    const enabled = entry.enabled !== false; // default true, but explicit false disables

    const rawEntryPoints = Array.isArray(entry.entryPoints) ? entry.entryPoints : [];
    const entryPoints = [];
    for (const ep of rawEntryPoints) {
      if (typeof ep !== 'string' || !ep.trim()) continue;
      if (path.isAbsolute(ep) || ep.includes('..')) {
        logger.warn(`Dropping unsafe entry point for ${name}: ${ep}`);
        continue;
      }
      if (isDenied(ep)) {
        logger.warn(`Dropping credential-shaped entry point for ${name}: ${ep}`);
        continue;
      }
      entryPoints.push(ep);
    }

    if (entryPoints.length === 0) {
      logger.warn(`Skipping projectCatalog.json entry with no safe entry points: ${name}`);
      continue;
    }

    seenNames.add(name.toLowerCase());
    catalog.push({ name, dirName, aliases, enabled, entryPoints });
  }

  return catalog;
}

const PROJECT_CATALOG = loadCatalog();

function findAllowlistEntry(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return null;
  const match = PROJECT_CATALOG.find(
    (p) => p.name.toLowerCase() === needle || p.aliases.some((a) => a.toLowerCase() === needle),
  );
  if (!match || !match.enabled) return null;
  return match;
}

/** List of project names Wren currently has awareness of. Safe to show to a user. */
function listAllowedProjects() {
  return PROJECT_CATALOG.filter((p) => p.enabled).map((p) => p.name);
}

function resolveProjectRoot(dirName) {
  const candidate = path.join(PROJECTS_ROOT, dirName);
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return null;
  }
  let projectsRootReal;
  try {
    projectsRootReal = fs.realpathSync(PROJECTS_ROOT);
  } catch {
    return null;
  }
  if (real !== projectsRootReal && !real.startsWith(projectsRootReal + path.sep)) {
    return null;
  }
  return real;
}

function readCapped(absPath, maxBytes) {
  const buf = fs.readFileSync(absPath);
  if (buf.length <= maxBytes) {
    return { content: buf.toString('utf8'), truncated: false, bytes: buf.length };
  }
  return { content: buf.subarray(0, maxBytes).toString('utf8'), truncated: true, bytes: buf.length };
}

function readEntryPointDoc(projectRoot, relPath, maxBytes) {
  if (isDenied(relPath)) {
    return { path: relPath, error: 'denied by credential filter' };
  }

  const abs = path.resolve(projectRoot, relPath);
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return { path: relPath, error: 'not found' };
  }

  if (real !== projectRoot && !real.startsWith(projectRoot + path.sep)) {
    return { path: relPath, error: 'resolved outside project root' };
  }
  if (isDenied(real)) {
    return { path: relPath, error: 'denied by credential filter' };
  }

  try {
    const { content, truncated, bytes } = readCapped(real, maxBytes);
    return { path: relPath, content, truncated, bytes };
  } catch {
    return { path: relPath, error: 'read failed' };
  }
}

function loadHandoffIndex(handoffsDir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(handoffsDir, 'index.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.handoffs)) return null;
    return data.handoffs;
  } catch {
    return null;
  }
}

/**
 * Finds the newest handoff for a project, validated against the project's
 * already-canonicalized root (not just a string match on its name), and
 * confirms the referenced Markdown file resolves to a path inside
 * handoffs/ before reading it. `handoffsDir` defaults to the real,
 * structurally-derived HANDOFFS_DIR; tests may pass a fixture directory
 * explicitly -- production code never does.
 */
function findLatestHandoff(projectName, projectRoot, maxBytes, handoffsDir = HANDOFFS_DIR) {
  const handoffs = loadHandoffIndex(handoffsDir);
  if (!handoffs) return null;

  const matches = handoffs.filter((h) => {
    if (!h || typeof h !== 'object') return false;
    if (typeof h.project !== 'string' || h.project.toLowerCase() !== projectName.toLowerCase()) return false;
    if (typeof h.project_path !== 'string' || !h.project_path) return false;
    let real;
    try {
      real = fs.realpathSync(h.project_path);
    } catch {
      return false;
    }
    return real === projectRoot;
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const newest = matches[0];

  if (typeof newest.file !== 'string' || !newest.file || newest.file.includes('/') || newest.file.includes('\\')) {
    return { error: 'malformed handoff index entry' };
  }

  let handoffsRootReal;
  try {
    handoffsRootReal = fs.realpathSync(handoffsDir);
  } catch {
    return { error: 'handoffs directory unavailable' };
  }

  const candidate = path.resolve(handoffsDir, newest.file);
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return { error: 'handoff file missing' };
  }
  if (real !== handoffsRootReal && !real.startsWith(handoffsRootReal + path.sep)) {
    return { error: 'handoff path escaped handoffs directory' };
  }

  let content;
  let truncated;
  try {
    ({ content, truncated } = readCapped(real, maxBytes));
  } catch {
    return { error: 'handoff read failed' };
  }

  return {
    id: newest.id,
    createdAt: newest.created_at,
    agent: newest.agent,
    objective: newest.objective,
    gitBranch: newest.git_branch,
    gitCommit: newest.git_commit ?? null,
    pushed: Boolean(newest.pushed),
    hasBlockers: Boolean(newest.has_blockers),
    durableKnowledgeCandidate: Boolean(newest.durable_knowledge_candidate),
    file: newest.file,
    content,
    truncated,
  };
}

/** One matching table row from PROJECTS.md, capped and bounded -- never a full-file read. */
function readRegistrySummary(name) {
  let content;
  try {
    content = fs.readFileSync(PROJECTS_MD_PATH, 'utf8');
  } catch {
    return null;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The name must be the row's FIRST cell (optionally with a trailing
  // slash, e.g. `ClayMoneyTrail/`) -- never merely a substring anywhere
  // in the row. A plain "line includes this name" check would also match
  // a *different* project's row whose own prose happens to mention this
  // name in passing -- confirmed real case: the retired AboutIt row's
  // text says "Do not confuse with `WhisperAboutIt`", which would
  // otherwise be returned as WhisperAboutIt's own registry summary.
  const rowPattern = new RegExp(`^\\|\\s*\`${escaped}/?\`\\s*\\|`);
  const row = content.split('\n').find((line) => rowPattern.test(line));
  if (!row) return null;
  return row.length > 500 ? `${row.slice(0, 500)}…` : row;
}

/**
 * @param {string} projectName
 * @returns {{allowed:boolean, project:string, projectPath?:string,
 *   registrySummary?:string|null, latestHandoff?:object|null,
 *   entryPoints?:Array, warnings:string[]}}
 */
function getProjectContext(projectName) {
  const entry = findAllowlistEntry(projectName);
  if (!entry) {
    return {
      allowed: false,
      project: String(projectName || ''),
      warnings: [`"${projectName}" is not available through project awareness yet.`],
    };
  }

  const projectRoot = resolveProjectRoot(entry.dirName);
  if (!projectRoot) {
    return { allowed: false, project: entry.name, warnings: [`${entry.name} could not be located on disk.`] };
  }

  // maxDocBytes/maxTotalBytes bound the RAW bytes read from disk (handoff +
  // entry-point document content) -- confirmed by live testing against
  // real projects. The small amount of wrapper text projectAwareness.js's
  // formatReferenceContext() adds on top (labels, section headers,
  // warnings) is not counted against this budget; it's bounded in practice
  // because it's fixed-shape prose, not user- or repository-controlled
  // content.
  const maxDocBytes = config.projectAwareness.maxDocBytes;
  const maxTotalBytes = config.projectAwareness.maxTotalBytes;
  const warnings = [];
  let totalBytes = 0;
  const entryPoints = [];

  for (const relPath of entry.entryPoints) {
    if (totalBytes >= maxTotalBytes) {
      warnings.push(`Skipped remaining entry-point documents: total context size limit (${maxTotalBytes} bytes) reached.`);
      break;
    }
    const docCap = Math.min(maxDocBytes, maxTotalBytes - totalBytes);
    const doc = readEntryPointDoc(projectRoot, relPath, docCap);
    if (doc.error) {
      warnings.push(`Could not load ${relPath}: ${doc.error}.`);
      continue;
    }
    totalBytes += Math.min(doc.bytes, docCap);
    entryPoints.push(doc);
    if (doc.truncated) warnings.push(`${relPath} was truncated to fit the size limit.`);
  }

  let latestHandoff = null;
  const handoffBudget = maxTotalBytes - totalBytes;
  if (handoffBudget <= 0) {
    warnings.push('Skipped handoff lookup: total context size limit already reached by entry-point documents.');
  } else {
    const handoffCap = Math.min(maxDocBytes, handoffBudget);
    const result = findLatestHandoff(entry.name, projectRoot, handoffCap);
    if (result && result.error) {
      warnings.push(`Handoff lookup failed: ${result.error}.`);
    } else if (result) {
      latestHandoff = result;
      if (result.truncated) warnings.push('Latest handoff document was truncated to fit the size limit.');
    }
  }

  const registrySummary = readRegistrySummary(entry.name);
  if (!registrySummary) {
    warnings.push(`No matching row found in WhisperCommandCenter/PROJECTS.md for ${entry.name}.`);
  }

  return {
    allowed: true,
    project: entry.name,
    projectPath: projectRoot,
    registrySummary,
    latestHandoff,
    entryPoints,
    warnings,
  };
}

module.exports = {
  getProjectContext,
  listAllowedProjects,
  // exported for tests only -- production code never calls these directly:
  _internal: {
    PROJECTS_ROOT,
    COMMAND_CENTER_PATH,
    HANDOFFS_DIR,
    CATALOG_PATH,
    PROJECT_CATALOG,
    loadCatalog,
    isDenied,
    readEntryPointDoc,
    findLatestHandoff,
    resolveProjectRoot,
    findAllowlistEntry,
  },
};
