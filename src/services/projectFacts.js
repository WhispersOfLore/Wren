/**
 * Deterministic fact extraction (Phase 12). Turns the output of
 * projectContext.getProjectContext() into a flat, structured object of
 * plain facts -- no LLM call, no filesystem access, no network, no
 * randomness. This is the ONLY thing that decides what data exists;
 * everything downstream (the local model, a deterministic formatter) may
 * only reword/summarize what's already in this object, never add to it.
 *
 * This module never touches the filesystem itself -- it only transforms
 * the ctx object it's given.
 */

const MAX_FIELD_CHARS = 2000; // bound any single extracted section before it reaches a prompt

function boundText(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_FIELD_CHARS ? `${trimmed.slice(0, MAX_FIELD_CHARS)}\n[section truncated]` : trimmed;
}

/**
 * Splits handoff Markdown into a lowercase-heading -> body map, using the
 * same `## Heading` convention as WhisperCommandCenter/handoffs/TEMPLATE.md.
 * Purely a string operation -- no assumptions beyond "the previous heading
 * owns everything up to the next one."
 */
function parseMarkdownSections(markdown) {
  const sections = {};
  if (typeof markdown !== 'string' || !markdown) return sections;

  const headingRe = /^##\s+(.+?)\s*$/gm;
  const matches = [...markdown.matchAll(headingRe)];

  for (let i = 0; i < matches.length; i += 1) {
    const heading = matches[i][1].trim().toLowerCase();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    sections[heading] = markdown.slice(start, end).trim();
  }

  return sections;
}

/**
 * @param {ReturnType<import('./projectContext').getProjectContext>} ctx
 *   Must be a context where ctx.allowed === true.
 */
function extractProjectFacts(ctx) {
  const h = ctx.latestHandoff || null;
  const hasHandoff = Boolean(h);
  const sections = hasHandoff ? parseMarkdownSections(h.content) : {};

  return {
    project: ctx.project,
    projectPath: ctx.projectPath,
    registrySummary: ctx.registrySummary || null,

    hasHandoff,
    handoffId: hasHandoff ? h.id : null,
    handoffCreatedAt: hasHandoff ? h.createdAt : null,
    handoffAgent: hasHandoff ? h.agent : null,
    handoffObjective: hasHandoff ? boundText(h.objective) : null,
    recordedBranch: hasHandoff ? h.gitBranch : null,
    recordedCommit: hasHandoff ? h.gitCommit : null,
    recordedPushed: hasHandoff ? h.pushed : null,
    handoffTruncated: hasHandoff ? Boolean(h.truncated) : false,

    completedText: hasHandoff ? boundText(sections.completed) : null,
    validationText: hasHandoff ? boundText(sections.validation) : null,
    gitStateText: hasHandoff ? boundText(sections['git state']) : null,
    currentStateText: hasHandoff ? boundText(sections['current state']) : null,
    outstandingText: hasHandoff ? boundText(sections['outstanding / blockers']) : null,
    nextActionText: hasHandoff ? boundText(sections['next recommended action']) : null,
    readFirstText: hasHandoff ? boundText(sections['read first']) : null,
    durableKnowledgeText: hasHandoff ? boundText(sections['durable knowledge candidate']) : null,
    notesText: hasHandoff ? boundText(sections.notes) : null,

    entryPointNames: ctx.entryPoints.map((d) => d.path),
    entryPointsAnyTruncated: ctx.entryPoints.some((d) => d.truncated),
    entryPointsContent: ctx.entryPoints.map((d) => ({ path: d.path, content: d.content, truncated: d.truncated })),

    warnings: [...ctx.warnings],
  };
}

module.exports = { extractProjectFacts, parseMarkdownSections, MAX_FIELD_CHARS };
