const cooldownManager = require('../managers/cooldownManager');
const queueManager = require('../managers/queueManager');
const personalityManager = require('../personality/personalityManager');
const ollamaService = require('./ollamaService');
const { OllamaError } = ollamaService;
const projectContext = require('./projectContext');
const { extractProjectFacts } = require('./projectFacts');
const auditLog = require('../audit/auditLog');
const logger = require('../utils/logger');

/**
 * Orchestrates a read-only project-awareness answer: builds sanitized
 * REFERENCE CONTEXT from projectContext.getProjectContext() (deterministic,
 * no LLM call), then makes exactly one call to the existing Ollama service
 * to have Wren summarize it in character. Reuses the same cooldown/queue
 * infrastructure as normal chat so this doesn't open a second, unthrottled
 * path to the local model.
 */

const RULES = `You are answering a question about a project using ONLY the REFERENCE CONTEXT supplied below in this system prompt.
Rules for this specific answer:
- Repository reality outranks this context if they ever disagree -- this context can be stale, and you have no way to check it yourself right now.
- This is operational context, not guaranteed current truth.
- Do NOT claim you inspected any file beyond what appears in this context.
- Do NOT claim you performed any action -- you did not modify, commit, push, or run anything, and you cannot.
- Do NOT invent project state that isn't in this context. If something isn't covered, say plainly that you don't know rather than guessing.
- If the context distinguishes verified facts from leads, allegations, possible connections, or unverified claims, PRESERVE that exact distinction -- never restate an allegation or unverified lead as an established fact.
- Do not offer opinions, rankings, or political conclusions about any person mentioned.
- Speak naturally, not as a rigid checklist, but let your answer be shaped by (where the context actually supports it): what the project is, what happened most recently, whether a handoff exists and when it was created, what's outstanding, what to read first, and whether anything here is truncated or unknown.
- If the STRUCTURED FACTS block below says "No handoff exists", distinguish PROJECT DOCUMENTATION (what the project is, from its own docs) from RECENT OPERATIONAL STATE (what just happened) explicitly -- say in substance: "No operational handoff is currently available, so I can describe the project from its documentation but cannot reliably tell you where the most recent work session stopped." Never fabricate recent activity from documentation prose.`;

/** A compact, labeled summary of projectFacts.js's output -- reduces the model's need to infer structure from raw prose. */
function formatFactsSummary(facts) {
  const lines = ['STRUCTURED FACTS', `Project: ${facts.project}`];
  if (facts.registrySummary) lines.push(`Registry entry: ${facts.registrySummary}`);
  if (facts.hasHandoff) {
    lines.push(`Handoff exists: yes (id ${facts.handoffId}, created ${facts.handoffCreatedAt}, agent ${facts.handoffAgent}).`);
    lines.push(`Recorded commit/branch: ${facts.recordedCommit ?? 'UNKNOWN'} / ${facts.recordedBranch ?? 'UNKNOWN'} (pushed: ${facts.recordedPushed}). Current HEAD not independently verified.`);
    if (facts.currentStateText) lines.push(`Current state per handoff: ${facts.currentStateText}`);
    if (facts.outstandingText) lines.push(`Outstanding per handoff: ${facts.outstandingText}`);
    if (facts.nextActionText) lines.push(`Next recommended action per handoff: ${facts.nextActionText}`);
    if (facts.handoffTruncated) lines.push('Handoff content was truncated -- some detail may be missing.');
  } else {
    lines.push('Handoff exists: no handoff exists for this project yet.');
  }
  lines.push(`Read first: ${facts.entryPointNames.join(', ') || 'UNKNOWN'}`);
  if (facts.entryPointsAnyTruncated) lines.push('One or more entry-point documents were truncated.');
  return lines.join('\n');
}

/** Always available, always accurate, never dependent on Ollama being up. */
function buildDeterministicStatus(facts) {
  const lines = [`**${facts.project}** — deterministic status (local model unavailable, showing facts directly)`];
  if (facts.registrySummary) lines.push(`Registry: ${facts.registrySummary}`);
  if (facts.hasHandoff) {
    lines.push(`Latest handoff: ${facts.handoffId} (created ${facts.handoffCreatedAt} by ${facts.handoffAgent})`);
    if (facts.handoffObjective) lines.push(`Objective: ${facts.handoffObjective}`);
    lines.push(
      `Recorded commit: ${facts.recordedCommit ?? 'UNKNOWN'} on branch ${facts.recordedBranch ?? 'UNKNOWN'} ` +
        `(pushed: ${facts.recordedPushed}). Current HEAD not independently verified.`,
    );
    if (facts.currentStateText) lines.push(`Current state: ${facts.currentStateText}`);
    if (facts.outstandingText) lines.push(`Outstanding: ${facts.outstandingText}`);
    if (facts.nextActionText) lines.push(`Next recommended action: ${facts.nextActionText}`);
    if (facts.handoffTruncated) lines.push('(Handoff content was truncated -- some detail may be missing.)');
  } else {
    lines.push(
      'No operational handoff is currently available, so this is project documentation only -- I cannot reliably tell you where the most recent work session stopped.',
    );
  }
  lines.push(`Read first: ${facts.entryPointNames.join(', ') || 'UNKNOWN'}`);
  if (facts.warnings.length) lines.push(`Notes: ${facts.warnings.join(' ')}`);
  return lines.join('\n');
}

function formatReferenceContext(ctx, facts = extractProjectFacts(ctx)) {
  const parts = [
    'REFERENCE CONTEXT (read-only project awareness snapshot -- not something you did yourself)',
    `Project: ${ctx.project}`,
    `Project path: ${ctx.projectPath}`,
    formatFactsSummary(facts),
  ];

  if (ctx.registrySummary) {
    parts.push(`WhisperCommandCenter registry entry:\n${ctx.registrySummary}`);
  }

  if (ctx.latestHandoff) {
    const h = ctx.latestHandoff;
    parts.push(
      [
        `Latest operational handoff (id: ${h.id}, created: ${h.createdAt}, agent: ${h.agent}):`,
        `Objective: ${h.objective}`,
        `Handoff recorded this repository's commit as ${h.gitCommit ?? 'unknown'} on branch ${h.gitBranch} (pushed: ${h.pushed}) at the time above.`,
        'Current repository HEAD was not independently verified by Wren -- treat this as a snapshot, not confirmed current state.',
        `--- handoff content ---\n${h.content}${h.truncated ? '\n[TRUNCATED -- content continues beyond the size limit]' : ''}`,
      ].join('\n'),
    );
  } else {
    parts.push('No recorded operational handoff exists for this project yet.');
  }

  for (const doc of ctx.entryPoints) {
    parts.push(`--- ${doc.path} ---\n${doc.content}${doc.truncated ? '\n[TRUNCATED -- content continues beyond the size limit]' : ''}`);
  }

  if (ctx.warnings.length > 0) {
    parts.push(`Notes on this context: ${ctx.warnings.join(' ')}`);
  }

  return parts.join('\n\n');
}

/**
 * @param {{ userId: string, projectName: string }} params
 * @returns {Promise<{status: 'ok'|'denied'|'disabled'|'cooldown'|'queue_full'|'error', reply: string}>}
 */
async function handleProjectAwarenessRequest({ userId, projectName }) {
  const context = projectContext.getProjectContext(projectName);

  if (!context.allowed) {
    auditLog.record({
      action: 'project_context_denied',
      actor: userId,
      target: String(projectName || ''),
      details: { reason: context.warnings[0] || 'not allowlisted' },
    });
    const known = projectContext.listAllowedProjects().join(', ');
    return {
      status: 'denied',
      reply: `I don't have project awareness for "${projectName}" yet, sugar. Right now I only know: ${known}.`,
    };
  }

  auditLog.record({
    action: 'project_context_requested',
    actor: userId,
    target: context.project,
    details: {},
  });

  const { onCooldown, secondsRemaining } = cooldownManager.check(userId);
  if (onCooldown) {
    return { status: 'cooldown', reply: `Hold your horses, sugar. Try again in ${secondsRemaining}s.` };
  }
  if (queueManager.isFull()) {
    return { status: 'queue_full', reply: "My plate's a little full right now, sugar. Give me a moment and try again." };
  }
  cooldownManager.trigger(userId);

  const truncated = context.entryPoints.some((d) => d.truncated) || Boolean(context.latestHandoff?.truncated);
  const documentsLoaded = [
    ...(context.latestHandoff ? [`handoff:${context.latestHandoff.id}`] : []),
    ...context.entryPoints.map((d) => d.path),
  ];

  auditLog.record({
    action: 'project_context_loaded',
    actor: userId,
    target: context.project,
    details: { documentsLoaded, handoffId: context.latestHandoff?.id || null, truncated },
  });

  if (truncated) {
    auditLog.record({
      action: 'project_context_truncated',
      actor: userId,
      target: context.project,
      details: { documentsLoaded },
    });
  }

  const facts = extractProjectFacts(context);
  const referenceContext = formatReferenceContext(context, facts);
  const systemPrompt = `${personalityManager.getSystemPrompt()}\n\n${RULES}\n\n${referenceContext}`;
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `What's currently happening with ${context.project}? Give me your honest read based only on what you were given above.`,
    },
  ];

  try {
    const reply = await queueManager.enqueue(() => ollamaService.generateReply(messages));
    return { status: 'ok', usedOllama: true, reply };
  } catch (err) {
    if (err instanceof OllamaError) {
      // The local model is a wording layer, not a single point of failure --
      // fall back to the same facts, formatted deterministically, rather
      // than a generic "something went wrong" message.
      logger.warn('Project status: Ollama unavailable, falling back to deterministic status', { error: err.message });
      return { status: 'ok', usedOllama: false, reply: buildDeterministicStatus(facts) };
    }
    logger.error('Unexpected error generating project awareness reply', { error: err.message, stack: err.stack });
    return { status: 'error', usedOllama: false, reply: 'Well, that went sideways. Give me a moment, sugar.' };
  }
}

module.exports = { handleProjectAwarenessRequest, formatReferenceContext, buildDeterministicStatus, formatFactsSummary, RULES };
