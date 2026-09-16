/**
 * Deterministic persistence-plan construction (Phase 14). Turns an
 * approved, repository-state-verified draft session into a plain object
 * describing what a FUTURE, separately-authorized persistence step could
 * write -- never executed here, never written anywhere. No LLM call, no
 * filesystem access, no network, no randomness: pure transformation of
 * `session.facts` (the same deterministic facts projectFacts.js already
 * produced for the draft) and `session.repositorySnapshot`.
 *
 * Part L is deliberately honored here: this module never reads
 * `session.draftText` (the rendered, human-facing Markdown) to derive
 * plan fields. The plan and the rendered draft both originate from the
 * same underlying `facts` object, but are built independently -- the
 * plan is never "scraped back" out of Discord-formatted text.
 */

const DRY_RUN_BANNER = 'DRY RUN — NOTHING WAS SAVED';

function na(value, fallback) {
  return value || fallback;
}

/** Part P: never blur "the source handoff reported X" with "Wren verified Y." */
function buildValidationField(facts, repositorySnapshot) {
  const sourceLine = facts.hasHandoff
    ? `SOURCE HANDOFF REPORTED VALIDATION: ${na(facts.validationText, 'UNKNOWN')}`
    : 'SOURCE HANDOFF REPORTED VALIDATION: NO CURRENT HANDOFF.';

  const { atDraft, atApproval, atPlan } = repositorySnapshot;
  const wrenLine =
    `WREN VERIFIED: repository identity (HEAD/branch/working-tree fingerprint) was ` +
    `confirmed unchanged across draft (${atDraft.capturedAt}), approval (${atApproval.capturedAt}), ` +
    `and plan generation (${atPlan.capturedAt}). Wren did not run, and cannot claim to have run, ` +
    'any project tests or builds.';

  return `${sourceLine}\n${wrenLine}`;
}

/** Part Q: truthful HEAD/branch/working-tree state; pushed stays "unknown" unless a source handoff already recorded it. */
function buildGitStateField(snapshot, repositorySnapshot, facts) {
  if (!snapshot || !snapshot.isGitRepo) {
    return 'NO GIT REPOSITORY — repository state cannot be recorded for this project.';
  }

  const pushedLine =
    facts.hasHandoff && facts.recordedPushed !== null
      ? `Pushed: unknown (last known handoff reported pushed=${facts.recordedPushed} as of ${facts.handoffCreatedAt}; not independently re-verified by Wren)`
      : 'Pushed: unknown (Wren does not inspect remotes or push state)';

  const { atDraft, atApproval, atPlan } = repositorySnapshot;

  return [
    `HEAD: ${snapshot.headCommit}`,
    `Branch: ${snapshot.branch ?? '(detached HEAD)'}`,
    `Working Tree: ${snapshot.workingTreeDirty ? 'dirty' : 'clean'}`,
    `Repository snapshot verified consistent at draft, approval, and plan generation ` +
      `(captured ${atDraft.capturedAt} / ${atApproval.capturedAt} / ${atPlan.capturedAt}).`,
    pushedLine,
  ].join('\n');
}

function buildNotesField(facts) {
  const notes = [];
  if (facts.handoffTruncated) notes.push('Source handoff content was truncated; some detail may be missing.');
  if (facts.entryPointsAnyTruncated) notes.push('One or more entry-point documents were truncated.');
  if (facts.warnings.length) notes.push(facts.warnings.join(' '));
  return notes.length ? notes.join(' ') : 'None.';
}

/**
 * @param {object} session - an approved session that has just passed
 *   `HandoffApprovalStore.beginPersistencePlan()` (so `repositorySnapshot.atPlan` is populated)
 * @returns {object} the persistence plan (Part K)
 */
function buildPersistencePlan(session) {
  const facts = session.facts;
  const { atPlan, atApproval } = session.repositorySnapshot;
  const snapshot = atPlan || atApproval;

  // Part I: a project with no Git repository can never be marked
  // eligible for automatic persistence, no matter how clean everything
  // else about the draft/approval was -- there is no repository
  // checkpoint to bind the approval to.
  const eligible = Boolean(snapshot && snapshot.isGitRepo && !snapshot.error);
  const ineligibleReason = eligible
    ? null
    : !snapshot || !snapshot.isGitRepo
      ? 'No Git repository was found for this project -- there is no reliable repository checkpoint to bind approval to.'
      : 'Repository state could not be reliably captured.';

  return {
    eligible,
    ineligibleReason,
    draftId: session.draftId,
    project: session.project,
    projectPath: session.projectPath,
    approvedBy: session.approvedBy,
    approvedAt: session.approvedAt ? new Date(session.approvedAt).toISOString() : null,
    // draftHash is carried for completeness/future provenance use but is
    // internal-only, exactly like everywhere else in Phase 13/14 --
    // formatPersistencePlanForDisplay() below never prints it.
    draftHash: session.draftHash,
    repositorySnapshot: {
      atDraft: session.repositorySnapshot.atDraft,
      atApproval: session.repositorySnapshot.atApproval,
      atPlan: session.repositorySnapshot.atPlan,
    },
    proposedHandoff: {
      // Part N: deterministic, application-owned -- never the model, never "Claude"/"ChatGPT"/a user's name.
      agent: 'Wren',
      project: facts.project,
      projectPath: facts.projectPath,
      // Part O: unchanged from Phase 12's rule -- reading a project is not performing work on it.
      objective: 'Continuity summary based on approved read-only project context.',
      completed: facts.hasHandoff
        ? na(facts.completedText, 'UNKNOWN')
        : 'NO CURRENT HANDOFF — nothing to report as completed.',
      validation: buildValidationField(facts, session.repositorySnapshot),
      gitState: buildGitStateField(snapshot, session.repositorySnapshot, facts),
      currentState: facts.hasHandoff
        ? na(facts.currentStateText, 'UNKNOWN')
        : `PROJECT DOCUMENTATION ONLY (no operational handoff): see ${facts.entryPointNames.join(', ') || 'UNKNOWN'}.`,
      outstanding: facts.hasHandoff ? na(facts.outstandingText, 'UNKNOWN') : 'UNKNOWN — NO CURRENT HANDOFF.',
      nextRecommendedAction: facts.hasHandoff
        ? na(facts.nextActionText, 'NOT VERIFIED')
        : 'NOT VERIFIED — no operational handoff to draw from.',
      readFirst: facts.entryPointNames.length ? facts.entryPointNames.join(', ') : 'UNKNOWN',
      durableKnowledgeCandidate: facts.hasHandoff
        ? `Candidate: ${na(facts.durableKnowledgeText, 'NOT VERIFIED')}`
        : 'Candidate: NOT VERIFIED (no operational handoff).',
      notes: buildNotesField(facts),
    },
  };
}

/** Renders the plan for a Discord reply. Never prints draftHash or a raw porcelain listing. */
function formatPersistencePlanForDisplay(plan) {
  const h = plan.proposedHandoff;
  const lines = [];

  lines.push(DRY_RUN_BANNER);
  lines.push(`Draft ID: ${plan.draftId}`);
  lines.push(`Project: ${plan.project}`);
  lines.push(`Approved by: <@${plan.approvedBy}> at ${plan.approvedAt}`);
  lines.push('');
  lines.push(
    plan.eligible
      ? 'Eligible for future persistence: YES'
      : `Eligible for future persistence: NO — ${plan.ineligibleReason}`,
  );
  lines.push('');
  lines.push(
    'This is a PREVIEW of what a future, separately-authorized persistence step could write. ' +
      'Nothing was created, changed, or saved anywhere -- no handoff file, no index.json entry, ' +
      'no WhisperCommandCenter change, no project change, no git action.',
  );
  lines.push('');
  lines.push(`Agent: ${h.agent}`);
  lines.push(`Project: ${h.project}`);
  lines.push(`Project Path: ${h.projectPath}`);
  lines.push(`Objective: ${h.objective}`);
  lines.push('');
  lines.push('## Completed');
  lines.push(h.completed);
  lines.push('');
  lines.push('## Validation');
  lines.push(h.validation);
  lines.push('');
  lines.push('## Git State');
  lines.push(h.gitState);
  lines.push('');
  lines.push('## Current State');
  lines.push(h.currentState);
  lines.push('');
  lines.push('## Outstanding / Blockers');
  lines.push(h.outstanding);
  lines.push('');
  lines.push('## Next Recommended Action');
  lines.push(h.nextRecommendedAction);
  lines.push('');
  lines.push('## Read First');
  lines.push(h.readFirst);
  lines.push('');
  lines.push('## Durable Knowledge Candidate');
  lines.push(h.durableKnowledgeCandidate);
  lines.push('');
  lines.push('## Notes');
  lines.push(h.notes);
  lines.push('');
  lines.push(DRY_RUN_BANNER);

  return lines.join('\n');
}

module.exports = { buildPersistencePlan, formatPersistencePlanForDisplay, DRY_RUN_BANNER };
