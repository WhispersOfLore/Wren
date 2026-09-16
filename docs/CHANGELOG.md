# Changelog

All notable changes to Wren are documented here.

## [1.0.0] - 2026-09-16 — Wren Rebirth: Whisper About It Community AI (Phase 17)

Wren's default domain changed from a WhisperSMP gaming companion to the
community and research assistant for Whisper About It / Unfiltered Talk
Radio -- without a rewrite. Existing generic infrastructure (project
awareness, handoff drafting/approval, audit, permissions, Ollama
integration, Discord plumbing) carried forward unchanged.

- **New identity** (`src/ai/personality.js`): `BASE_IDENTITY` rewritten --
  no longer "the AI companion of WhisperSMP." Explicitly disclaims being
  a WhisperSMP character, Minecraft lore bot, or gaming assistant. Added
  a CIVIC RESEARCH EVIDENCE RULE (never upgrade an allegation to a fact)
  and an explicit insufficient-evidence fallback instruction.
- **New guild is the real safety boundary:** `DISCORD_GUILD_ID` is now
  **required** (`1549772221226950686`), checked via the new `src/utils/
  guildGuard.js` in both `messageCreate.js` and `interactionCreate.js`.
  The previously **committed** gaming channel ID in `config.json` is
  gone; channel restriction is now optional, env-only
  (`DISCORD_CHANNEL_ID`), and additive on top of admin gating, never the
  only gate.
- **CRITICAL authorization fix:** `/wren project` and every
  `/wren handoff-*` command were previously gated only by an optional
  channel restriction -- any member in that channel could use them. New
  `src/utils/adminGate.js` requires `permissionManager.isAdmin()` first.
  Does not weaken handoff-approve/reject/plan's own requester-or-admin
  logic (every legitimate requester is now an admin by construction).
- **`/wren link` removed** (Minecraft account linking) -- was fully
  public with no gating. `playerManager.linkPlayer()` code and any
  historical linked-account data are untouched, just unreferenced.
- **Project catalog restructured:** `WhisperSMP`, `WhisperBot`,
  `GamingUnfiltered`, `BroBeHonest`, `WhisperContent`, `WhatIfSeries`,
  `WhisperOS` disabled (`enabled: false`, not deleted -- every project
  untouched on disk). New default catalog: `ClayMoneyTrail`,
  `WhisperAboutIt`, `Cthrew` (added, `README.md`-only entry point),
  `WhisperCommandCenter` (added, explicitly admin/internal).
- **Guild-scoped memory:** additive nullable `guild_id` column on
  `memories`/`lore`, stamped automatically from the current configured
  guild at write time -- never caller-supplied. `memoryRetriever.js`
  filters by it in SQL. Pre-migration rows (`guild_id IS NULL`) match no
  guild's filter and are structurally excluded from every live
  conversation, without deleting a single row. Admin review tools are
  deliberately not guild-filtered.
- **Public/internal knowledge boundary:** additive `visibility` column
  (`'internal'` default, `'public'` opt-in) and civic `verification_status`
  column (`verified_fact`/`allegation`/`unverified_lead`/`hypothesis`/
  `rejected`/`deprecated`, optional/`NULL` for non-civic memories).
  `memoryRetriever.js` -- Wren's only public conversational retrieval
  path -- filters to `visibility = 'public'`. No content was
  bulk-published to make this true.
- **systemd service + `wren` CLI:** `deploy/wren.service` installed to
  `~/.config/systemd/user/wren.service` (`Restart=on-failure`, no
  secrets in the unit), `scripts/start-wren.sh` wrapper (mise-PATH fix,
  same pattern as WhisperCommandCenter's report timers), `bin/wren`
  (`on|off|status|restart|logs [-f]`) hardcoded to exactly one unit name,
  no `sudo`, no `eval`, no shell-string construction.
- 41 new tests (`tests/wrenRebirth.test.js`), 204 total (up from 163) --
  every pre-existing test referencing a now-disabled catalog project was
  updated in place, none removed.
- **No live Discord connectivity test performed:** no `.env` file exists
  on this machine; `DISCORD_TOKEN`/`DISCORD_GUILD_ID` were not fabricated
  or requested in chat, per this phase's explicit instruction. The user
  must populate `.env` before `wren on` can succeed.

## [0.9.0] - 2026-09-16 — Repository State Guard + Persistence Dry-Run (Phase 14)

Adds a read-only Git-drift guard on top of Phase 13's approval workflow,
plus a deterministic "persistence plan" preview. **No handoff is
written, no `index.json` entry is added, and no CommandCenter or project
file is touched.** This phase proves the last piece a real write would
need to check -- "did the repository move since this was
approved?" -- without granting write authority.

- **`src/services/repoState.js` (new):** the only file in the codebase
  authorized to execute a subprocess. Captures `{isGitRepo, headCommit,
  branch, workingTreeDirty, workingTreeFingerprint, capturedAt}` via a
  strictly-constrained `execFileSync('git', [...])` -- hardcoded
  executable, four fixed read-only argv shapes only (`rev-parse
  --is-inside-work-tree`, `rev-parse HEAD`, `branch --show-current`,
  `status --porcelain`), no shell, 3s timeout, 256KB output cap, `cwd`
  always the catalog-resolved canonical project path, environment
  trimmed to `PATH` only. Direct `.git`-file parsing was investigated
  and rejected as fragile against worktrees/packed-refs/detached HEAD.
- **Working-tree fingerprint:** `SHA-256(git status --porcelain
  output)` -- the raw porcelain text is never returned, logged, or shown
  to a user or the model. Documented limitation: this catches drift in
  the *shape* of git's status output, not byte-for-byte file contents.
  `dirty -> dirty` is deliberately not treated as unchanged; only a
  matching fingerprint counts.
- **Three-checkpoint drift guard:** a snapshot is captured at draft
  creation, rechecked at approval (vs. draft), and rechecked again at
  plan-generation (vs. approval). Any drift on HEAD, branch, dirty flag,
  or fingerprint fails the session closed into a new terminal `stale`
  status -- never silently regenerated or approved. A stale draft can
  never later be approved or planned.
- **Non-Git projects** (e.g. `BroBeHonest`) draft and approve normally
  (nothing to drift), but a persistence plan for one is always marked
  `eligible: false` with an explicit reason -- there's no repository
  checkpoint to bind the approval to.
- **`/wren handoff-plan <draft-id>` (new):** requires an already-`approved`
  draft, requester/admin authorization, and a passing repository
  recheck. Builds a deterministic persistence-plan object
  (`src/services/handoffPersistencePlan.js`) from the same structured
  facts the draft itself was built from (never by re-parsing the
  rendered Discord text), and displays it headed/footed with `DRY RUN —
  NOTHING WAS SAVED`. `agent` is always the literal `"Wren"`; `objective`
  stays Phase 12's fixed conservative phrase; `validation` explicitly
  separates what a source handoff reported from what Wren itself
  verified (repository identity only -- never a claim that tests were
  run); `gitState` reports `Pushed: unknown` unless a source handoff
  already recorded a value.
- **CommandCenter compatibility investigated, nothing modified there:**
  read `create-handoff.py`/`TEMPLATE.md`/`README.md`/`validate-handoffs.py`
  to map plan fields onto the real schema. Found two real
  incompatibilities worth flagging for a future phase: the tool's
  auto-generated `## Git State` block hardcodes `Working Tree: (fill
  in)` with no CLI flag to supply a real value, and `--pushed` is a
  plain boolean with no way to express "unknown."
- New audit events: `handoff_repo_snapshot_captured` (all three
  checkpoints), `handoff_draft_stale`, `handoff_persistence_plan_generated`,
  `handoff_persistence_plan_denied` -- metadata only, never the porcelain
  listing, a filename, or the fingerprint itself.
- 52 new tests (161 total, up from 109): fixture-repo snapshot mechanics,
  fingerprint determinism and sensitivity to porcelain shape (not just
  the dirty flag), HEAD/branch/dirty/fingerprint drift each independently
  blocking approval, drift after approval blocking plan generation,
  non-Git ineligibility, all approve/plan authorization and status-gating
  paths, zero-file-write and zero-index-change verification, audit
  metadata never containing filenames or raw porcelain output, a
  subprocess security review (hardcoded executable/argv, no shell,
  timeout/maxBuffer enforced, trimmed environment), and regression checks
  that ordinary chat, `/wren project`, and plain handoff drafting are
  unaffected. Real, read-only snapshots verified against `WhisperOS`,
  `GamingUnfiltered` (dirty), and `ClayMoneyTrail`; all drift scenarios
  run only against disposable fixture repos under the OS temp directory.

**Still zero write authority.** No file is written, no
`handoffs/index.json` entry is added or changed, `create-handoff.py` is
never called, and no git command beyond the four fixed read-only
subcommands above is ever run.

## [0.8.0] - 2026-09-16 — Human Approval Workflow for Handoff Drafts (Phase 13)

Adds a transient, in-memory human-approval layer on top of Phase 12's
drafts. **This does NOT add handoff persistence.** It proves that a
specific authorized human can approve or reject a specific draft, bound
to the exact text reviewed, time-limited, and correctly denied to
unrelated users -- with the approval itself producing nothing more
durable than a status flip in process memory that a restart erases.

- **`src/services/handoffApproval.js` (new):** `HandoffApprovalStore`
  class (+ a `sharedStore` singleton) holding sessions in a plain `Map`
  -- no database, no file, no SQLite, no memory/lore-system entry.
  `crypto.randomUUID()` draft IDs; approval bound to a SHA-256 hash of
  the exact final draft text (gloss + deterministic draft combined), so
  any change to either invalidates the binding. Lazy expiration (15
  minutes by default, `config.projectAwareness.draftApprovalTtlMs`) --
  checked on access, no background timer. Bounded store size (`config.
  projectAwareness.maxPendingDrafts`, default 200) with oldest-non-pending
  eviction.
- **Authorization:** the original requester, or an existing Wren admin
  (`permissionManager.isAdmin`), may approve/reject; anyone else is
  denied and audited. No new identity system, no natural-language
  approval route -- only the explicit slash commands below can change a
  draft's status.
- **`/wren handoff-approve <draft-id>` / `/wren handoff-reject
  <draft-id>` (new):** wired via `src/interactions/
  handoffApprovalHandler.js`. Approval replies "approved for future
  persistence" and explicitly restates that nothing was written.
  Rejection is terminal -- a rejected draft can never later be approved.
- **Supersession:** generating a new draft for the same requester+project
  while an older one is still `pending` marks the old one `superseded`
  before the new one is created; superseded drafts can never be
  approved. Different projects, or the same project by different
  requesters, never collide.
- **`/wren handoff-draft` reply extended:** now includes `Draft ID:`,
  `Expires:`, the exact approve/reject command syntax, and an explicit
  "Approval does not persist this handoff" line. The SHA-256 hash is
  never shown to users and never logged.
- New audit events: `handoff_draft_session_created`,
  `handoff_draft_approved`, `handoff_draft_rejected`,
  `handoff_draft_expired`, `handoff_draft_superseded`,
  `handoff_draft_approval_denied` -- metadata only, never draft text or
  the hash.
- 37 new tests (109 total, up from 72): draft-ID uniqueness/format,
  hash binding and one-character sensitivity, requester/admin/unrelated-
  user authorization, expiration via fixture TTLs (no real sleeping),
  terminal-state enforcement (approved/rejected/expired/superseded all
  reject further action), supersession scoped correctly across users
  and projects, malformed/unknown draft IDs failing closed, zero-file-
  write verification against real `WhisperCommandCenter`/`WhisperOS`
  directories, bounded-store eviction, restart-clears-sessions
  simulation, audit-metadata content safety, an LLM-authored reply
  containing approval-sounding language failing to change any status, a
  regression test confirming no code path other than the new handler
  calls the store's approve/reject, and a Part T–style local simulation
  of two independent Discord user IDs acting on the same and different
  drafts.

**Still zero persistence authority.** No file is written, no
`handoffs/index.json` entry is added or changed, `create-handoff.py` is
never called, and no git command is ever run. A bot restart clears
every approval -- that is intentional, not a bug, for this phase.

## [0.7.0] - 2026-09-15 — Project Intelligence + Handoff Drafting (Phase 12)

Two new read-only capabilities on top of Phase 10/11's project awareness.
No handoff-write authority was granted -- this phase evaluates whether
Wren can produce useful draft text, nothing more.

- **`src/services/projectFacts.js` (new):** deterministic fact
  extraction, separate from LLM wording as required. Parses a handoff's
  `## Heading` Markdown sections into a flat facts object
  (`hasHandoff`, `completedText`, `outstandingText`, `recordedCommit`,
  etc.) -- pure string processing, no filesystem access, no LLM call.
  This is now the single source both `/wren project` and the new
  `/wren handoff-draft` draw from.
- **`/wren project` enriched:** now includes a labeled STRUCTURED FACTS
  summary in the model prompt, and explicit rules requiring the model to
  distinguish PROJECT DOCUMENTATION from RECENT OPERATIONAL STATE when
  no handoff exists ("No operational handoff is currently available, so
  I can describe the project from its documentation but cannot reliably
  tell you where the most recent work session stopped").
- **`/wren handoff-draft <name>` (new):** produces a TEXT-ONLY draft
  shaped like the shared handoff contract. Every response is labeled
  `DRAFT ONLY — NOT SAVED` at both the top and bottom, plus an explicit
  "Wren did not modify the project or WhisperCommandCenter" line. The
  full structured draft is built **deterministically** in
  `src/services/handoffDraft.js`'s `buildDeterministicDraft()` --
  `UNKNOWN`/`NOT VERIFIED`/`NO CURRENT HANDOFF` markers are used
  wherever a fact isn't available, and `## Git State` never claims
  current HEAD was verified. The local model is only ever asked for one
  short narrative paragraph prepended to that deterministic text, under
  rules forbidding new facts, action claims, or evidence-status
  upgrades.
- **Deterministic fallback (both commands):** if Ollama is unavailable,
  `/wren project` returns `buildDeterministicStatus()` and
  `/wren handoff-draft` returns the deterministic draft with a "local
  model unavailable" note -- neither depends on a live model for basic
  usefulness. Verified by monkey-patching `ollamaService.generateReply`
  to throw (both services now call it through the `ollamaService`
  namespace specifically so this is possible without stopping the real
  local Ollama instance).
- **`src/utils/chunkedReply.js` (new):** caps a response at ~6000
  characters (explicit truncation note if exceeded) and labels
  multi-message responses `**(part N/M)**`, applied to the new
  handoff-draft handler.
- New audit events: `handoff_draft_requested/generated/fallback/denied`
  -- metadata only, never document content.
- 23 new tests (72 total, up from 49): project status with/without a
  handoff, draft with/without a handoff, the `DRAFT ONLY` banner always
  present, HEAD never falsely claimed verified, `UNKNOWN` markers used
  correctly, ClayMoneyTrail's real handoff text reproduced verbatim (not
  paraphrased) with no evidence-status upgrades, unknown/retired-AboutIt
  denial for the new command, both deterministic fallbacks, Discord
  chunking and max-size enforcement, audit metadata contains no document
  content, ordinary chat still unaffected.
- Live-tested against the real local Ollama instance for `WhisperOS`,
  `GamingUnfiltered`, `ClayMoneyTrail`, and `WhisperBot` -- both
  `/wren project` and `/wren handoff-draft` -- see this phase's report
  for results.

**Still zero handoff-write authority.** Wren cannot write a file, edit
`handoffs/index.json`, call `create-handoff.py`, or run any git command.
Generating good draft text is not, by itself, authorization to persist
it -- that remains a separate, later decision.

## [0.6.1] - 2026-09-15 — Live Project Awareness + Safe Expansion (Phase 11)

- **Fixed the Ollama model mismatch** flagged at the end of Phase 10:
  `config.json`'s `ai.model` (and `configManager.js`'s fallback default)
  now points at `llama3.1:8b`, the model actually pulled in this
  environment, instead of the never-pulled `llama3.1:latest`. Verified
  directly with a real `generateReply()` call, then with full normal-chat
  and project-awareness regression passes. Preferred over pulling a
  second, redundant model.
- **Refactored the Phase 10 hardcoded allowlist into `projectCatalog.json`**
  (repo root) — a small, auditable, Wren-owned data file separate from
  the enforcement logic in `projectContext.js`. Adding a project is now
  one catalog entry (`name`, `entryPoints`, optional `aliases`/`enabled`),
  not a code change. The catalog is validated at load time and fails
  closed (a bad entry or a malformed file loses that entry, or the whole
  catalog, never falls open).
- **Expanded enabled projects from 3 to 9**: added `WhisperBot`,
  `WhisperSMP`, `WhisperAboutIt`, `WhisperContent`, `BroBeHonest`,
  `WhatIfSeries` alongside the original `WhisperOS`, `GamingUnfiltered`
  (now aliased `GamezUnfiltered`), `ClayMoneyTrail`. Each was individually
  checked against an explicit eligibility bar (real project, safe
  orientation, no credential access needed, not retired). Deliberately
  excluded: `YouTubeAccounts`/`TikTokAccounts` (credential-adjacent
  infrastructure, low direct benefit here), `WhisperContentCommandCenter`/
  `LocalViewBoard` (their own registry entries flag an unresolved
  overlap), and `AboutIt` (retired — cannot be added; the directory
  doesn't exist).
- **Found and fixed a real bug** in the `PROJECTS.md` registry-summary
  matcher: a plain substring search for `` `WhisperAboutIt` `` matched
  the *retired* `AboutIt` row instead, because that row's own text
  mentions `WhisperAboutIt` by name while explaining they're different
  projects. Fixed to match only the row's first table cell; locked in
  with a regression test.
- Added 18 new automated tests (49 total) covering the expanded catalog:
  every enabled project resolves under `~/Projects/`; symlink-based
  escapes (file and directory) are rejected; catalog-level `..`/absolute/
  credential-shaped entries are rejected at load time; disabled projects
  behave identically to unknown ones; retired `AboutIt` is unreachable
  while `WhisperAboutIt` resolves correctly to its own row; ordinary
  chat never loads project context even when a project name is
  mentioned in the message.
- Verified command registration directly (`wren.data.toJSON()`) without
  a live Discord connection: correct subcommand/option/choices shape for
  all 9 enabled projects.
- **Live Discord gateway test not possible in this environment** — no
  real `DISCORD_TOKEN`/`.env` is configured here, so the bot cannot log
  in at all. Everything reachable without a live gateway connection was
  verified instead: full business logic against a real local Ollama
  instance (all 9 projects deterministically resolved; 5 representative
  ones — `WhisperOS`, `GamingUnfiltered`, `ClayMoneyTrail`, `WhisperSMP`,
  `WhisperContent` — got real, grounded, non-fabricated model replies),
  the exact command-registration payload, and audit-log output.
- Still no handoff-write capability of any kind — explicitly deferred
  again this phase.

## [0.6.0] - 2026-09-15 — Read-Only Project Awareness (Phase 10)

Wren's first capability outside conversation/memory/lore: `/wren project
<name>` answers what's currently happening with one of three allowlisted
projects (`WhisperOS`, `GamingUnfiltered`, `ClayMoneyTrail`), using the
shared handoff/registry system in `~/Projects/WhisperCommandCenter/`.

- Added `src/services/projectContext.js` — deterministic, read-only data
  layer. No LLM calls, no shell execution, no writes. Hardcoded project
  allowlist; every path canonicalized and root-checked before reading;
  credential-filename deny-list as defense in depth; per-document and
  total size caps with explicit truncation reporting.
- Added `src/services/projectAwareness.js` — the one place that turns
  that data into a single `generateReply()` call, reusing the existing
  cooldown/queue infrastructure. The model prompt explicitly requires:
  repository reality outranks this context; never claim an action was
  performed; never restate an allegation/unverified lead as fact; no
  opinions on named people.
- Added `/wren project` subcommand (`src/commands/wren.js` +
  `src/interactions/projectHandler.js`), same channel restriction as
  `/wren ask`.
- Added `project_context_requested/loaded/denied/truncated` audit
  events through the existing `auditLog` pub/sub.
- **First real automated test suite for this project**: `npm test` now
  runs `node --test tests/*.test.js` (31 tests) instead of the previous
  placeholder. Confirmed passing under both the workstation's global
  Node and Node 22; unlike WhisperOS, no Node-version pin was needed —
  `sqlite3`'s N-API binding is ABI-stable, verified directly.
- **Known gap, not fixed (out of scope for this feature):**
  `config.json`'s `ai.model` (`llama3.1:latest`) isn't actually pulled
  in this environment (only `llama3.1:8b` is) — every Ollama call
  currently 404s, a pre-existing issue affecting normal chat too, found
  during live testing of this feature.

## [0.5.0] - 2026-08-02 — Stabilization Sprint

Not a feature phase — an engineering-quality sprint to make Wren
production-grade before further intelligence work begins. No new player-
facing capabilities; reliability, maintainability, and architectural
clarity only. Deliberately unnumbered (see the Phase note in
`docs/ARCHITECTURE.md`'s Future Expansion section).

### Root causes addressed

- **Duplicate bot instances.** Two Wren processes could connect to the same
  Discord token simultaneously (confirmed via log analysis in an earlier
  phase — both received every gateway event, raced to acknowledge
  interactions, and produced the "Unknown interaction" errors and duplicate
  replies observed in live testing). Root cause: nothing prevented it.
- **Deprecated Discord API usage producing console noise.** The `ephemeral:
  true` interaction-reply option is deprecated in the installed discord.js
  version — confirmed by reading `InteractionResponses.js` directly, not
  assumed: it calls `process.emitWarning()` the first time the option is
  used. All ~30 call sites used it.
- **Scattered administrative logging.** Enable/disable, personality/mood
  changes, and memory/lore mutations each logged via ad-hoc `logger.info()`
  calls with no consistent shape, no way to filter administrative actions
  from general app logs, and no way for a future consumer (a Discord audit
  channel) to observe them without editing every emitting subsystem.
- **`memoryManager.js` mixed two responsibilities** — player identity
  (Discord↔Minecraft linking) and memory content (add/search/remove) — in
  one file, making both harder to reason about and test in isolation.
- **No way to correct a mistake.** Memories and lore could be added or
  removed, but not edited — a typo or an importance miscall meant delete
  and re-add, losing the original creation metadata in the process.

### Added

- `src/utils/instanceLock.js` — PID-file lock at `data/wren.lock`, acquired
  as the first thing `bot.js` does (before config validation). Detects a
  genuinely running duplicate via `process.kill(pid, 0)` and exits(1) with a
  clear message naming the conflicting PID; detects a stale lock from an
  unclean shutdown (PID no longer alive) and recovers automatically.
  Released on `SIGINT`/`SIGTERM` and as a `process.on('exit')` best-effort
  backup.
- `src/audit/auditLog.js` — `EventEmitter`-based structured audit trail.
  `record({ action, actor, target, details })` appends JSON to
  `logs/audit.log` (a dedicated Winston instance, separate from
  `logs/combined.log`) and emits an `'audit'` event for future subscribers.
  Wired into `statusManager` (enable/disable), `personalityManager`
  (personality changes), `moodManager` (mood changes), `settingsManager`
  (cooldown/prefix changes), `memoryManager` (add/edit/remove), and
  `loreManager` (add/edit/remove) — replacing their previous direct
  `logger.info()` calls.
- `src/memory/playerManager.js` — split out of `memoryManager.js`: owns
  `parseDiscordId`, `linkPlayer`, `getUserByDiscordId`, `ensureUser`,
  `getLinkedPlayerCount`. `memoryManager.js` now depends on it for identity
  resolution and owns only memory content.
- `memoryManager.updateMemory(id, changes, actorId)` /
  `loreManager.updateLore(id, changes, actorId)` — partial updates (only
  provided fields change), plus `getMemoryById`/`getLoreById`. New ✏️ Edit
  Memory / ✏️ Edit Lore buttons and modals in `memoryPanel.js`/`lorePanel.js`
  (ID + optional new field values, since Discord can't show a pre-filled
  modal in response to a modal submit).
- `memories.source` column (`'canonical'` | `'observation'`, default
  `'canonical'`) — architecture prep for a future distinction between
  admin-authored canonical knowledge and (not yet implemented) autonomous
  observations. No behavior change: everything is canonical today.
- `database.js`'s `ensureColumn()` — a small idempotent schema-migration
  helper (`PRAGMA table_info` → `ALTER TABLE ADD COLUMN` if missing),
  verified directly against the real pre-sprint database before shipping.
- `utils/discordReply.js`'s `ephemeral()` helper — merges
  `flags: MessageFlags.Ephemeral` into a payload, replacing the deprecated
  `ephemeral: true` option everywhere it was used.

### Changed

- `src/bot.js` — acquires the instance lock first; removed the unused
  `partials` client option (no DM/reaction features exist to need it).
- `events/ready.js` — `{ type: 3 }` → `ActivityType.Watching` (magic number
  → enum).
- `commands/index.js` — `new REST({ version: '10' })` → `new REST()`
  (already the default; one less thing to fall out of sync with).
- `commands/wren.js` — extracted a `denyIfNotAdmin()` helper, removing three
  duplicated permission-check blocks; `/wren link` now calls
  `playerManager.linkPlayer()` (and dropped a log line that duplicated one
  `playerManager` already emits).
- `statusManager.enable/disable`, `personalityManager.setActive`,
  `moodManager.setMood`, `settingsManager.updateSettings` — all gained an
  `actorId` parameter, threaded from `interaction.user.id` at every call
  site, so audit events record who made each change. No other behavior
  change.
- All ~30 `{ ephemeral: true }` call sites → `ephemeral({ ... })`.

### Testing performed

- **Single instance:** fresh acquire/release; stale-lock recovery (dead PID
  in the lock file); a real second `npm start` against a live instance,
  confirming exit code 1 and the conflicting PID in the message; graceful
  shutdown confirmed the lock file is actually removed.
- **Audit trail:** every wired action (enable, disable, personality change,
  mood change, settings update, memory add/edit/remove, lore add/edit/remove)
  exercised directly and via mocked Discord interactions, confirming
  correct `action`/`actor`/`target`/`details` in both the emitted event and
  `logs/audit.log`.
- **Migration safety:** verified the real pre-sprint `data/wren.db` (which
  predated the `source` column) migrates cleanly and idempotently — schema
  inspected before and after, second run confirmed as a no-op. Verified a
  fresh database gets the column natively via `CREATE TABLE` with no
  migration log line.
- **Edit flows:** successful edit, edit of a nonexistent ID, edit with no
  fields provided — for both memory and lore, via mocked Discord modal
  submissions, plus direct manager-level tests.
- **Clean console:** captured raw stdout/stderr (not just Winston logs) from
  a full boot cycle — zero deprecation warnings, zero stray output.
- **Regression:** re-ran the full mocked interaction suite from prior phases
  (control panel buttons, personality/mood selection, `/wren ask` live
  Ollama round trip) to confirm nothing broke.

### Design notes

- Player identity and memory content are separate modules now
  (`playerManager` / `memoryManager`) with a one-directional dependency —
  matches "every subsystem should have one clear responsibility."
- The audit log is a *separate* Winston instance from the general app
  logger, not a tagged subset of it — different question, different
  retention/rotation needs later, cleaner to keep apart from day one than
  to split out later.
- Edit modals ask for an ID rather than presenting current values
  pre-filled — not a design preference, a hard Discord API constraint
  (modals can't be shown in response to a modal submit). Matches the
  existing Remove flow's pattern rather than inventing a new one.
- `source` is schema-only this sprint, deliberately. Adding retrieval
  weighting for a memory class with zero real rows yet would be guessing at
  behavior before there's data to base it on.

## [0.4.0] - 2026-08-02 — Phase 3: Memory & Knowledge System

Wren has permanent memory. A SQLite database now backs two independent
systems — memories about players and lore about the Whisper universe — both
admin-managed via Discord, both retrieved intelligently (never dumped
wholesale) into her AI context.

### Changed
- `managers/conversationManager.js` — `getMessages()` is now `async` and
  takes an optional `latestQuestion` param; after composing the
  personality+mood system prompt (via the untouched `personalityManager`,
  per this phase's explicit restriction), it appends a memory/lore context
  block from `memoryRetriever.buildContextBlock()` when relevant. Its one
  caller, `interactions/responder.js`, was updated to `await` it.
- `control/controlPanel.js` — `buildControlPanel()` is now `async` (three
  new SQLite count queries for the main panel's Memories/Lore
  Entries/Linked Players fields); every internal caller updated to `await`
  it.
- `events/interactionCreate.js` — rewritten from two hardcoded
  `wren_control_`-prefixed checks into a small prefix-routing table, so
  `memoryPanel`/`lorePanel` plug in alongside `controlPanel` without
  duplicating the dispatch logic.
- `commands/wren.js` — gained `link`, `memory`, `lore` subcommands.
- `docs/ARCHITECTURE.md`, `docs/PERSONALITY.md`, `README.md` updated;
  **roadmap renumbered again** — Phase 3 absorbed what were separately
  planned "memory" and "lore" phases, so WhisperOS integration (previously
  Phase 5) is now Phase 4.

### Added
- `src/memory/database.js` — the single shared SQLite connection
  (`data/wren.db`) and schema (`users`, `memories`, `lore` tables). Lore has
  no database module of its own by design — `loreManager.js` imports this
  same connection rather than opening a second one, per the spec's "one
  database file" requirement.
- `src/memory/searchUtils.js` — shared keyword tokenizer (lowercase,
  strip punctuation, drop stopwords/short words) used by both admin search
  and AI-context retrieval.
- `src/memory/memoryManager.js` — player linking (`linkPlayer`, upserts by
  `discord_id`), memory CRUD (`addMemory` lazily creates a user row if the
  player hasn't linked yet, `getMemoriesForUser`, `removeMemory`,
  `searchMemories`), counts.
- `src/lore/loreManager.js` — lore CRUD (`addLore`, `removeLore`,
  `searchLore`), counts.
- `src/memory/memoryRetriever.js` — the AI-context retrieval engine: SQL
  `LIKE` pre-filter on extracted keywords, then JS-side scoring
  (`matchCount * 10 + importance`) so importance alone never surfaces an
  unrelated entry — a row needs at least one real keyword match to be
  considered at all. Capped to `config.memoryRetrieval.maxMemories`/`maxLore`
  (default 5/3), returns `''` when nothing's relevant so callers skip the
  section instead of injecting an empty header.
- `/wren link minecraft_username:<name>` — self-service Discord↔Minecraft
  linking, no admin gate.
- `/wren memory` (admin only) — `src/control/memoryPanel.js`: 🧠 Add Memory,
  🔎 Search Memory, 📋 View Player Memories, 🗑 Remove Memory. Player identity
  in modals is captured as `@mention`-or-raw-ID text (Discord modals only
  support text inputs, not user pickers) and parsed by
  `memoryManager.parseDiscordId()`.
- `/wren lore` (admin only) — `src/control/lorePanel.js`: 📖 Add Lore, 🔎
  Search Lore, 🗑 Remove Lore.
- `config.memoryRetrieval.maxMemories`/`maxLore` — retrieval result caps.

### Fixed (caught in testing, before it ever reached production)
- `TextInputBuilder.setLabel()` has a hard 45-character limit; the initial
  Category field labels (`"Category (personal/achievement/relationship/event/server)"`,
  similarly for lore) blew past it and threw `Invalid string length` the
  first time the Add Memory / Add Lore modal was opened. Fixed by shortening
  the label to `"Category"` and moving the allowed values into the
  placeholder instead (100-char limit, and better UX besides — it's now a
  visible hint rather than a wall of text in the label).

### Design notes
- **Retrieval is keyword-based, not semantic/embeddings-based.** SQL `LIKE`
  pre-filter + JS scoring was a deliberate scope call for a "foundation"
  phase — it's transparent, debuggable, and dependency-free, versus standing
  up an embedding pipeline (Ollama does support embeddings, but that's a
  meaningfully bigger addition than this phase asked for). Flagged as a
  strong Phase 4+ candidate if keyword matching proves too literal in
  practice (e.g., synonyms not matching).
- **Retrieval is purely content-driven, not speaker-aware.** The Mission's
  "Welcome back Brandon, last time we spoke..." example implies Wren
  recognizing *who's asking* and proactively surfacing their memories; the
  spec's own retrieval flow (section 5) is keyword-search-only
  (question → matching content → context), and the test requirements (#7,
  #8) test exactly that, not speaker recognition. Scoped to match the
  literal, testable spec; speaker-aware personalization recommended for a
  later phase.
- **One shared database connection, not one per system.** `src/lore/` has
  no `database.js` — `loreManager.js` imports `memory/database.js`'s
  `run`/`get`/`all` helpers. The target architecture lists "Database" under
  both Memory and Lore, but the spec is explicit about one `data/wren.db`
  file; duplicating a connection module for the same file would just be
  duplicated code, not a real second system.
- **Lore importance isn't admin-editable yet.** The schema has it (matching
  the spec's schema section) and retrieval ranks by it, but the Add Lore
  modal only asks for category/title/content — matching the spec's own
  3-field example exactly. Defaults to 3 ("important").

## [0.3.0] - 2026-08-02 — Phase 2: Identity System

Wren went from one hardcoded personality to a configurable identity: a
personality profile system and a mood system, both admin-controlled and
persisted, composed together into the system prompt sent to Ollama.

### Changed
- `ai/personality.js` — `SYSTEM_PROMPT` split into `BASE_IDENTITY` (the
  invariant core: name, origin, never-do rules, uncertainty handling) with
  the swappable trait/voice/humor descriptions moved to personality
  profiles.
- `managers/conversationManager.js` — `getMessages()` now calls
  `personalityManager.getSystemPrompt()` fresh on every request instead of
  using a static constant, so personality/mood changes apply on the very
  next message with no restart or cache to invalidate.
- `control/controlPanel.js` — main panel now shows Personality and Mood
  fields and a 🎭 Personality button; gained a second view (the personality
  sub-panel) and a Back button. Split into two button rows (was one) to stay
  under Discord's 5-per-row limit.
- `events/interactionCreate.js` — now also routes `StringSelectMenu`
  interactions (for the mood picker), alongside the existing button/modal
  routing.
- `docs/ARCHITECTURE.md`, `docs/PERSONALITY.md`, `README.md` updated for the
  new identity system; **roadmap renumbered** — persistent memory (originally
  "Phase 2") is now Phase 3, lore is now Phase 4, WhisperOS is now Phase 5.

### Added
- `personality/profiles/*.json` — data-only personality definitions:
  `sweet` (default), `sarcastic`, `guardian`, `lorekeeper`. Each has `name`,
  `emoji`, `traits`, `communicationStyle`, `humor`. New profiles are just new
  files — no code changes required.
- `personality/personalityManager.js` — loads all profiles, owns the active
  one, persists it to `data/personality.json`, and composes the final system
  prompt (`BASE_IDENTITY` + active profile + current mood).
- `mood/moodManager.js` — six moods (happy, curious, focused, protective,
  playful, tired), each with a label and emoji; owns the current one,
  persists to `data/mood.json`. Manual/admin-set only in this phase — no
  automatic mood shifts yet, by design.
- Personality sub-panel in `/wren control`: one button per loaded profile
  (built dynamically from `personalityManager.list()`, not hardcoded) plus a
  `StringSelectMenu` for mood, both re-rendering the panel on change.

### Fixed / discovered
- No code fix, but worth recording: log analysis during this phase's testing
  surfaced a burst of "Unknown interaction" (Discord error 10062) errors
  from **two bot instances running concurrently** with the same token during
  ad-hoc testing between phases (both received every gateway event; whichever
  lost the race to respond failed). Not a bug in `controlPanel.js` — the
  existing error handling in `interactionCreate.js` already contained it
  without crashing. Documented in the README troubleshooting section so it's
  recognizable if it recurs.

### Design notes
- Personality and mood state live in **separate** files
  (`data/personality.json`, `data/mood.json`), not merged into
  `data/state.json` — they're independent axes that shouldn't share storage,
  matching the pattern `statusManager` established in Phase 1.
- `personalityManager` and `moodManager` live in their own top-level
  directories (`src/personality/`, `src/mood/`), *not* folded into
  `src/managers/` alongside `statusManager`/`cooldownManager`/etc. This is a
  deliberate divergence from the Phase 1 "`*Manager` singletons all live in
  `managers/`" convention — the Phase 2 spec explicitly calls out Personality
  System and Mood System as standalone architectural pillars (with room to
  grow: profiles, moods, and probably more), not one-off pieces of shared
  runtime state like `statusManager` was.
- `personalityManager.getSystemPrompt()` is the single integration point
  between the personality/mood systems and the AI layer — `ollamaService.js`
  and `commands/`/`bot.js` have zero personality-aware code, matching the
  spec's explicit restriction.

## [0.2.0] - 2026-08-02 — Phase 1: Control System

Wren is no longer an ambient chatbot. She now waits to be summoned, and
admins have a live control panel to manage her.

### Changed
- **Removed automatic replies.** `events/messageCreate.js` no longer
  responds to every message in the configured channel.
- `managers/queueManager.js` — `enqueue()` now returns a `Promise` that
  resolves with the job's result (previously fire-and-forget), so callers
  can await a generated reply directly.
- `docs/ARCHITECTURE.md`, `docs/PERSONALITY.md`, `README.md` updated to
  reflect the new interaction and control model.

### Added
- Three ways to talk to Wren directly, all sharing one conversation history,
  cooldown, and queue:
  - **Mention** (`@Wren ...`) — `interactions/mentionHandler.js`
  - **Prefix command** (`!wren ...`, configurable) —
    `interactions/prefixHandler.js`
  - **Slash command** (`/wren ask message:<text>`) —
    `interactions/slashHandler.js`, dispatched from `commands/wren.js`
- `interactions/responder.js` — single shared business-logic path
  (enabled/cooldown/queue/generation) used by all three entry points.
- `utils/splitMessage.js` and `utils/discordReply.js` — extracted, reusable
  message-splitting and chunked-send helpers for both messages and
  interactions.
- **`/wren control`** — an admin-only interactive control panel (embed +
  buttons + settings modal) showing status, AI model, interaction mode,
  prefix, and cooldown, with:
  - `managers/statusManager.js` — enable/disable state, persisted to
    `data/state.json` (separate from static `config.json`, survives
    restarts).
  - `control/permissionManager.js` — admin gate via `config.control.admins`
    and/or Discord's `Administrator` permission.
  - `control/settingsManager.js` — validates and persists live setting
    changes (cooldown, prefix) back to `config.json`.
  - `control/controlPanel.js` — builds and handles the panel's UI.
- `commands/index.js` — command loader + registrar (guild-scoped instant
  registration via `DISCORD_GUILD_ID`, or global as a fallback).
- `events/interactionCreate.js` — routes slash commands, button clicks, and
  modal submissions.
- Sleep-mode reply (`ai/personality.js`) — when disabled, every interaction
  method returns the same in-character line instead of generating a reply.
- New config: `interaction.prefix`, `control.admins`,
  `control.requireAdministratorPermission`; new env: `DISCORD_GUILD_ID`.

### Design notes
- Discord's API forbids mixing a bare command option with subcommands, so
  the literal spec text `/wren message: <text>` became `/wren ask
  message:<text>`, keeping both "talk" and "control" as subcommands of one
  `/wren` root rather than splitting into two top-level commands.
- `statusManager` lives in `src/managers/` (not `src/control/`) to stay
  consistent with the existing convention that all `*Manager` singletons
  live together, even though conceptually it's part of the control system.

## [0.1.0] - 2026-08-01 — Phase 1: First Working Wren

Initial build. A Discord user can message Wren in the configured channel and
receive an AI-generated, in-character reply from a local Llama 3.1 model via
Ollama.

### Added
- Discord bot (`discord.js` v14) with `Guilds`, `GuildMessages`,
  `MessageContent`, `GuildMembers` intents.
- Single-channel listening, bot-message filtering, typing indicator, and
  2000-character message splitting.
- `services/ollamaService.js` — Ollama `/api/chat` integration with
  connection/timeout/HTTP error handling and friendly, in-character fallback
  replies.
- `ai/personality.js` — Wren's system prompt defining her voice and rules.
- `managers/cooldownManager.js` — per-user cooldown gate.
- `managers/queueManager.js` — FIFO generation queue with overflow handling.
- `managers/conversationManager.js` — in-RAM, per-channel conversation
  memory with auto-trimming, built with a storage-agnostic API to ease a
  future move to SQLite.
- `config/configManager.js` — single source of truth for config.json + .env,
  validated at startup.
- `utils/logger.js` — Winston logging to console, `logs/error.log`, and
  `logs/combined.log`.
- Documentation: README, ARCHITECTURE, PERSONALITY, this changelog.

### Roadmap
- **Phase 2** — Persistent memory via SQLite, player recognition,
  conversation history.
- **Phase 3** — WhisperSMP knowledge: lore, NPCs, server rules.
- **Phase 4** — WhisperOS integration, multiple AI models, tool abilities.
