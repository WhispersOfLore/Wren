const crypto = require('node:crypto');
const config = require('../config/configManager');
const auditLog = require('../audit/auditLog');

/**
 * Transient, in-memory human-approval layer for handoff drafts (Phase 13).
 *
 * THIS MODULE NEVER WRITES ANYTHING. It holds a Map in process memory and
 * nothing else -- no database, no file, no SQLite table, no entry in the
 * existing memory/lore system. A bot restart clears every session. That is
 * intentional: Phase 13 proves the approval WORKFLOW, not persistence.
 *
 * Threat model (see docs/ARCHITECTURE.md for the full writeup):
 *  - Another user approving someone else's draft -> requesterUserId is
 *    checked against the acting user on every approve/reject; only an
 *    existing Wren admin (permissionManager.isAdmin) may act on someone
 *    else's draft.
 *  - Stale/expired approval -> expiresAt is checked lazily on every
 *    lookup; an expired pending session flips to 'expired' before any
 *    other logic runs, and 'expired' is a terminal, non-approvable state.
 *  - Approving a *different* draft than the one displayed -> approval is
 *    keyed by an opaque, unguessable crypto.randomUUID() draftId, and
 *    internally bound to a SHA-256 hash of the exact text shown; the
 *    hash is never exposed to a user and never influences anything an
 *    LLM produces -- it exists purely so "this session's text" is
 *    provably fixed once created (this class never mutates draftText or
 *    draftHash after creation).
 *  - Regeneration/staleness -> generating a new draft for the same
 *    (requester, project) pair immediately marks any still-PENDING
 *    older draft 'superseded' -- a superseded draft can never be
 *    approved, even if its ID is reused later by an attacker or a bug.
 *  - Replaying an old approval -> there is nothing downstream to replay
 *    against (Phase 13 persists nothing), and approve()/reject() are
 *    idempotent-safe: acting on a non-'pending' session always fails
 *    closed with the current status as the reason, never silently
 *    succeeds twice.
 *  - Malformed/unknown draft IDs -> looked up in a plain Map; anything
 *    not present (or not a string) fails closed as 'unknown_draft', no
 *    crash, no information leak about which IDs *do* exist.
 *  - Concurrent access -> every operation here is synchronous (no
 *    `await` inside a check-then-set sequence), so Node's single-
 *    threaded execution model rules out a TOCTOU race between "check
 *    status" and "set status."
 *  - Unbounded memory growth -> capped at `maxSessions`; creating a new
 *    session first prunes lazily-expired ones, then evicts the oldest
 *    non-pending session (preferring to keep pending work) if still at
 *    the cap.
 *  - Audit-log leakage -> every audit event here carries only
 *    draftId/project/requesterUserId/actorUserId/status-shaped metadata.
 *    Draft text and the SHA-256 hash are never logged.
 *
 * What approval explicitly does NOT mean: it does not mean "the
 * repository state is currently verified" (Wren still cannot check git
 * HEAD) -- only "a specific human approved this exact piece of text."
 */

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_SESSIONS = 200;

const TERMINAL_STATUSES = new Set(['approved', 'rejected', 'expired', 'superseded']);

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

class HandoffApprovalStore {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxSessions = DEFAULT_MAX_SESSIONS } = {}) {
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.sessions = new Map(); // draftId -> session
    this.pendingByKey = new Map(); // `${requesterUserId}::${project}` -> draftId of the current pending draft
  }

  _now() {
    return Date.now();
  }

  _keyFor(requesterUserId, project) {
    return `${requesterUserId}::${project}`;
  }

  /** Lazily flips any pending-but-past-expiry session to 'expired'. No timer, called on every access. */
  _expireIfDue(session) {
    if (session.status === 'pending' && this._now() > session.expiresAt) {
      session.status = 'expired';
      auditLog.record({
        action: 'handoff_draft_expired',
        actor: 'system',
        target: session.project,
        details: { draftId: session.draftId, requesterUserId: session.requesterUserId },
      });
    }
    return session;
  }

  _pruneExpired() {
    for (const session of this.sessions.values()) {
      this._expireIfDue(session);
    }
  }

  _evictIfAtCapacity() {
    if (this.sessions.size < this.maxSessions) return;

    let victim = null;
    for (const session of this.sessions.values()) {
      if (session.status !== 'pending' && (!victim || session.createdAt < victim.createdAt)) victim = session;
    }
    if (!victim) {
      // Every session is somehow still pending -- fall back to evicting
      // the oldest one overall rather than growing unbounded.
      for (const session of this.sessions.values()) {
        if (!victim || session.createdAt < victim.createdAt) victim = session;
      }
    }
    if (victim) this.sessions.delete(victim.draftId);
  }

  /**
   * @param {{project:string, projectPath:string, requesterUserId:string, draftText:string}} params
   * @returns {object} the new session
   */
  createSession({ project, projectPath, requesterUserId, draftText }) {
    this._pruneExpired();

    const key = this._keyFor(requesterUserId, project);
    const previousId = this.pendingByKey.get(key);
    if (previousId) {
      const previous = this.sessions.get(previousId);
      if (previous && previous.status === 'pending') {
        previous.status = 'superseded';
        auditLog.record({
          action: 'handoff_draft_superseded',
          actor: requesterUserId,
          target: project,
          details: { draftId: previous.draftId },
        });
      }
    }

    this._evictIfAtCapacity();

    const now = this._now();
    const session = {
      draftId: crypto.randomUUID(),
      project,
      projectPath,
      requesterUserId,
      draftText,
      draftHash: sha256(draftText),
      status: 'pending',
      createdAt: now,
      expiresAt: now + this.ttlMs,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
    };

    this.sessions.set(session.draftId, session);
    this.pendingByKey.set(key, session.draftId);

    auditLog.record({
      action: 'handoff_draft_session_created',
      actor: requesterUserId,
      target: project,
      details: { draftId: session.draftId, createdAt: new Date(now).toISOString(), expiresAt: new Date(session.expiresAt).toISOString() },
    });

    return session;
  }

  /** @returns {object|null} the session, with lazy expiration applied, or null if the ID is unknown/malformed. */
  getSession(draftId) {
    if (typeof draftId !== 'string' || !draftId.trim()) return null;
    const session = this.sessions.get(draftId.trim());
    if (!session) return null;
    return this._expireIfDue(session);
  }

  /**
   * @param {{draftId:string, actorUserId:string, isAdmin:boolean}} params
   * @returns {{ok:boolean, reason?:string, session?:object}}
   */
  approve({ draftId, actorUserId, isAdmin }) {
    return this._act({ draftId, actorUserId, isAdmin, verb: 'approve' });
  }

  /**
   * @param {{draftId:string, actorUserId:string, isAdmin:boolean}} params
   * @returns {{ok:boolean, reason?:string, session?:object}}
   */
  reject({ draftId, actorUserId, isAdmin }) {
    return this._act({ draftId, actorUserId, isAdmin, verb: 'reject' });
  }

  _act({ draftId, actorUserId, isAdmin, verb }) {
    const session = this.getSession(draftId);

    if (!session) {
      auditLog.record({
        action: 'handoff_draft_approval_denied',
        actor: actorUserId,
        target: null,
        details: { draftId: String(draftId || ''), reason: 'unknown_draft', verb },
      });
      return { ok: false, reason: 'unknown_draft' };
    }

    if (session.requesterUserId !== actorUserId && !isAdmin) {
      auditLog.record({
        action: 'handoff_draft_approval_denied',
        actor: actorUserId,
        target: session.project,
        details: { draftId, reason: 'not_authorized', verb },
      });
      return { ok: false, reason: 'not_authorized', session };
    }

    if (session.status !== 'pending') {
      auditLog.record({
        action: 'handoff_draft_approval_denied',
        actor: actorUserId,
        target: session.project,
        details: { draftId, reason: `status_${session.status}`, verb },
      });
      return { ok: false, reason: `status_${session.status}`, session };
    }

    const now = this._now();
    if (verb === 'approve') {
      session.status = 'approved';
      session.approvedBy = actorUserId;
      session.approvedAt = now;
      auditLog.record({
        action: 'handoff_draft_approved',
        actor: actorUserId,
        target: session.project,
        details: { draftId, requesterUserId: session.requesterUserId },
      });
    } else {
      session.status = 'rejected';
      session.rejectedBy = actorUserId;
      session.rejectedAt = now;
      auditLog.record({
        action: 'handoff_draft_rejected',
        actor: actorUserId,
        target: session.project,
        details: { draftId, requesterUserId: session.requesterUserId },
      });
    }

    return { ok: true, session };
  }
}

const sharedStore = new HandoffApprovalStore({
  ttlMs: config.projectAwareness.draftApprovalTtlMs,
  maxSessions: config.projectAwareness.maxPendingDrafts,
});

module.exports = { HandoffApprovalStore, sharedStore, sha256, DEFAULT_TTL_MS, DEFAULT_MAX_SESSIONS, TERMINAL_STATUSES };
