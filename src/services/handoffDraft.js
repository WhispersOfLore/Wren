const cooldownManager = require('../managers/cooldownManager');
const queueManager = require('../managers/queueManager');
const ollamaService = require('./ollamaService');
const { OllamaError } = ollamaService;
const projectContext = require('./projectContext');
const { extractProjectFacts } = require('./projectFacts');
const { sharedStore: approvalStore } = require('./handoffApproval');
const auditLog = require('../audit/auditLog');
const logger = require('../utils/logger');

/**
 * Handoff drafting (Phase 12). Produces TEXT ONLY -- never writes a file,
 * never touches WhisperCommandCenter/handoffs/index.json, never calls
 * create-handoff.py, never commits anything. This module's only output is
 * a string handed back to a Discord interaction handler.
 *
 * Design: the structured draft (every field from the shared handoff
 * contract) is always built deterministically from projectFacts.js's
 * output -- the local model is never asked to reproduce or preserve that
 * structure itself, because an LLM cannot be trusted to faithfully keep
 * exact markers (UNKNOWN, DRAFT ONLY -- NOT SAVED, etc.) verbatim across a
 * long generation. Instead, the model is optionally asked for a short,
 * tightly-scoped narrative paragraph that summarizes the SAME facts in
 * Wren's voice, which is prepended to the deterministic draft. If Ollama
 * is unavailable, the deterministic draft is still returned in full --
 * the model only ever improves wording, never gates whether a draft
 * exists at all.
 */

const DRAFT_BANNER = 'DRAFT ONLY — NOT SAVED';
const DRAFT_DISCLAIMER = 'Wren did not modify the project or WhisperCommandCenter. This text was generated for review and was not written to any file, handoff, or index.';

const GLOSS_RULES = `You are writing ONE short paragraph (3-5 sentences max) introducing a handoff draft, using ONLY the facts listed below.
Rules:
- Do not add any fact not listed below.
- Do not claim you performed any action, wrote any file, or verified current repository state.
- Do not use the words "I completed", "I fixed", or "I implemented" -- you did not do the work, you are summarizing a snapshot.
- If a fact says "no handoff" or "UNKNOWN", say so plainly -- do not soften it into something that sounds resolved.
- If evidence-status language (verified fact, allegation, unverified lead, possible connection, etc.) appears in the facts, preserve it exactly -- never upgrade an allegation or lead to a fact.
- Do not rank, judge, or offer opinions about any named person.
- Output ONLY the paragraph. No heading, no signature, no "Draft:" prefix.`;

function factsForGloss(facts) {
  const lines = [`Project: ${facts.project}`];
  lines.push(facts.hasHandoff ? `A handoff exists (id ${facts.handoffId}, created ${facts.handoffCreatedAt}).` : 'No handoff exists for this project yet.');
  if (facts.hasHandoff) {
    if (facts.currentStateText) lines.push(`Current state (from that handoff): ${facts.currentStateText}`);
    if (facts.outstandingText) lines.push(`Outstanding: ${facts.outstandingText}`);
    if (facts.nextActionText) lines.push(`Next recommended action: ${facts.nextActionText}`);
    if (facts.handoffTruncated) lines.push('That handoff content was truncated -- some detail may be missing.');
  } else {
    lines.push(`Available project documentation: ${facts.entryPointNames.join(', ')}.`);
  }
  if (facts.registrySummary) lines.push(`Registry entry: ${facts.registrySummary}`);
  return lines.join('\n');
}

/** Always available, always accurate to the facts, never dependent on Ollama. */
function buildDeterministicDraft(facts, { agent }) {
  const NA = (value, fallback) => value || fallback;
  const lines = [];

  lines.push(DRAFT_BANNER);
  lines.push(DRAFT_DISCLAIMER);
  lines.push('');
  lines.push(`Agent: ${agent} (drafted by Wren -- not a work session she performed)`);
  lines.push(`Project: ${facts.project}`);
  lines.push(`Project Path: ${facts.projectPath}`);
  lines.push('Objective: Draft continuity summary based on available read-only project context.');
  lines.push('');

  lines.push('## Completed');
  lines.push(facts.hasHandoff ? NA(facts.completedText, 'UNKNOWN') : 'NO CURRENT HANDOFF — nothing to report as completed.');
  lines.push('');

  lines.push('## Validation');
  lines.push(facts.hasHandoff ? NA(facts.validationText, 'UNKNOWN') : 'NO CURRENT HANDOFF.');
  lines.push('');

  lines.push('## Git State');
  if (facts.hasHandoff) {
    lines.push(
      `Latest available handoff recorded commit ${NA(facts.recordedCommit, 'UNKNOWN')} on branch ` +
        `${NA(facts.recordedBranch, 'UNKNOWN')} at ${facts.handoffCreatedAt}; current HEAD not independently verified.`,
    );
  } else {
    lines.push('NO CURRENT HANDOFF — no recorded commit/branch available. Current HEAD NOT VERIFIED.');
  }
  lines.push('');

  lines.push('## Current State');
  lines.push(
    facts.hasHandoff
      ? NA(facts.currentStateText, 'UNKNOWN')
      : `PROJECT DOCUMENTATION ONLY (no operational handoff): see ${facts.entryPointNames.join(', ') || 'UNKNOWN'}. Recent operational state UNKNOWN.`,
  );
  lines.push('');

  lines.push('## Outstanding / Blockers');
  lines.push(facts.hasHandoff ? NA(facts.outstandingText, 'UNKNOWN') : 'UNKNOWN — NO CURRENT HANDOFF.');
  lines.push('');

  lines.push('## Next Recommended Action');
  lines.push(facts.hasHandoff ? NA(facts.nextActionText, 'NOT VERIFIED') : 'NOT VERIFIED — no operational handoff to draw from.');
  lines.push('');

  lines.push('## Read First');
  lines.push(facts.entryPointNames.length ? facts.entryPointNames.join(', ') : 'UNKNOWN');
  lines.push('');

  lines.push('## Durable Knowledge Candidate');
  lines.push(facts.hasHandoff ? `Candidate: ${NA(facts.durableKnowledgeText, 'NOT VERIFIED')}` : 'Candidate: NOT VERIFIED (no operational handoff).');
  lines.push('');

  lines.push('## Notes');
  const notes = [];
  if (facts.handoffTruncated) notes.push('Source handoff content was truncated; some detail may be missing.');
  if (facts.entryPointsAnyTruncated) notes.push('One or more entry-point documents were truncated.');
  if (facts.warnings.length) notes.push(facts.warnings.join(' '));
  lines.push(notes.length ? notes.join(' ') : 'None.');
  lines.push('');

  lines.push(DRAFT_BANNER);

  return lines.join('\n');
}

/**
 * @param {{ userId: string, projectName: string, agent?: string }} params
 * @returns {Promise<{status: 'ok'|'denied'|'cooldown'|'queue_full'|'error', reply: string, usedOllama: boolean}>}
 */
async function handleHandoffDraftRequest({ userId, projectName, agent = 'Wren' }) {
  const context = projectContext.getProjectContext(projectName);

  if (!context.allowed) {
    auditLog.record({
      action: 'handoff_draft_denied',
      actor: userId,
      target: String(projectName || ''),
      details: { reason: context.warnings[0] || 'not allowlisted' },
    });
    const known = projectContext.listAllowedProjects().join(', ');
    return {
      status: 'denied',
      usedOllama: false,
      reply: `I don't have project awareness for "${projectName}" yet, sugar. Right now I only know: ${known}.`,
    };
  }

  auditLog.record({
    action: 'handoff_draft_requested',
    actor: userId,
    target: context.project,
    details: { hasHandoff: Boolean(context.latestHandoff) },
  });

  const { onCooldown, secondsRemaining } = cooldownManager.check(userId);
  if (onCooldown) {
    return { status: 'cooldown', usedOllama: false, reply: `Hold your horses, sugar. Try again in ${secondsRemaining}s.` };
  }
  if (queueManager.isFull()) {
    return { status: 'queue_full', usedOllama: false, reply: "My plate's a little full right now, sugar. Give me a moment and try again." };
  }
  cooldownManager.trigger(userId);

  const facts = extractProjectFacts(context);
  const deterministicDraft = buildDeterministicDraft(facts, { agent });

  let gloss = null;
  let usedOllama = false;
  try {
    const messages = [
      { role: 'system', content: GLOSS_RULES },
      { role: 'user', content: factsForGloss(facts) },
    ];
    gloss = await queueManager.enqueue(() => ollamaService.generateReply(messages));
    usedOllama = true;
  } catch (err) {
    if (err instanceof OllamaError) {
      logger.warn('Handoff draft: Ollama unavailable, falling back to deterministic draft only', { error: err.message });
    } else {
      logger.error('Unexpected error generating handoff-draft gloss', { error: err.message, stack: err.stack });
    }
  }

  const bodyText = gloss
    ? `${gloss.trim()}\n\n${deterministicDraft}`
    : `_(local model unavailable — showing the deterministic draft only)_\n\n${deterministicDraft}`;

  // Session creation is deterministic application logic -- it runs on the
  // FINAL text (gloss + deterministic draft) so that the SHA-256 binding
  // covers exactly what the human is about to review, regardless of
  // whether Ollama contributed wording this time. The LLM has no input
  // into the draftId, the hash, expiration, or anything below this line.
  const session = approvalStore.createSession({
    project: context.project,
    projectPath: context.projectPath,
    requesterUserId: userId,
    draftText: bodyText,
    facts,
  });

  const finalText = `${bodyText}\n\n${buildApprovalBanner(session)}`;

  auditLog.record({
    action: usedOllama ? 'handoff_draft_generated' : 'handoff_draft_fallback',
    actor: userId,
    target: context.project,
    details: {
      hasHandoff: Boolean(context.latestHandoff),
      usedOllama,
      truncated: facts.handoffTruncated || facts.entryPointsAnyTruncated,
      draftId: session.draftId,
    },
  });

  return { status: 'ok', usedOllama, reply: finalText, draftId: session.draftId };
}

/** Text shown alongside every draft -- never includes the SHA-256 hash (Part N). */
function buildApprovalBanner(session) {
  return [
    DRAFT_BANNER,
    `Draft ID: ${session.draftId}`,
    `Expires: ${new Date(session.expiresAt).toISOString()}`,
    '',
    `Approve: /wren handoff-approve draft-id:${session.draftId}`,
    `Reject: /wren handoff-reject draft-id:${session.draftId}`,
    '',
    'Approval does not persist this handoff. It only records that a human reviewed and approved this exact draft text.',
  ].join('\n');
}

module.exports = { handleHandoffDraftRequest, buildDeterministicDraft, buildApprovalBanner, DRAFT_BANNER, DRAFT_DISCLAIMER };
