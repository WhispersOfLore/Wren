const cooldownManager = require('../managers/cooldownManager');
const queueManager = require('../managers/queueManager');
const personalityManager = require('../personality/personalityManager');
const { generateReply, OllamaError } = require('./ollamaService');
const projectContext = require('./projectContext');
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
- Do not offer opinions, rankings, or political conclusions about any person mentioned.`;

function formatReferenceContext(ctx) {
  const parts = [
    'REFERENCE CONTEXT (read-only project awareness snapshot -- not something you did yourself)',
    `Project: ${ctx.project}`,
    `Project path: ${ctx.projectPath}`,
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

  const referenceContext = formatReferenceContext(context);
  const systemPrompt = `${personalityManager.getSystemPrompt()}\n\n${RULES}\n\n${referenceContext}`;
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `What's currently happening with ${context.project}? Give me your honest read based only on what you were given above.`,
    },
  ];

  try {
    const reply = await queueManager.enqueue(() => generateReply(messages));
    return { status: 'ok', reply };
  } catch (err) {
    if (err instanceof OllamaError) {
      logger.error('Project awareness AI generation failed', { error: err.message });
      return { status: 'error', reply: err.friendlyReply };
    }
    logger.error('Unexpected error generating project awareness reply', { error: err.message, stack: err.stack });
    return { status: 'error', reply: 'Well, that went sideways. Give me a moment, sugar.' };
  }
}

module.exports = { handleProjectAwarenessRequest, formatReferenceContext, RULES };
