# CLAUDE.md — Wren

Added 2026-09-15. Rewritten 2026-09-16 (Phase 17, "Wren Rebirth") to
reflect Wren's new identity and domain — see "Wren Rebirth" below for
the full migration record.

## What is this project?

A local, AI-powered **community and research assistant for Whisper About
It / Unfiltered Talk Radio** — a Discord community distinct from
WhisperSMP (Wren's original, now-retired-from-default domain; WhisperSMP
remains its own separate gaming ecosystem, just no longer Wren's
default). Runs entirely on local infrastructure: message generation goes
through a local [Ollama](https://ollama.com) instance running
`llama3.1:8b` — no cloud AI APIs, no OpenAI.

**Note on git history:** as of Phase 17 this repository has 8 commits
(Phases 10 through 17 of this project's own numbering; a single-commit
history was true only up through early Phase 10). `docs/CHANGELOG.md`
is the authoritative phase-by-phase record.

## What does it currently do?

Verified by directly inspecting `src/` (not just reading docs) — the
directory contains `ai/`, `audit/`, `commands/`, `config/`, `control/`,
`events/`, `interactions/`, `lore/`, `managers/`, `memory/`, `mood/`,
`personality/` (+ `profiles/`), `services/`, `utils/`. A full read-only
project-awareness + human-approved handoff-drafting + persistence-dry-run
architecture (Phases 10-14), a transient handoff-approval layer (Phase
13), a repository-state drift guard (Phase 14), and — as of Phase 17 — a
guild-scoped memory/lore system with an explicit public/internal
visibility boundary and civic verification-status preservation. See the
phase-numbered sections below for each.

**204 automated tests** as of Phase 17 (`node --test tests/*.test.js`) —
`package.json`'s `test` script runs the real suite, not a placeholder.

## What is authoritative?

`docs/PERSONALITY.md` (who Wren is — match this register, don't default
to generic assistant-speak), `docs/ARCHITECTURE.md` (how the pieces fit
together), `docs/CHANGELOG.md` (phase-by-phase history). This file is a
thin index only.

## What major components exist?

Per direct inspection of `src/`: `ai/` (Ollama HTTP integration),
`memory/` (SQLite-backed memory + player identity linking),
`personality/` and `mood/` (kept as separate JSON-backed state
deliberately, per `AI/context/DECISIONS.md`), `lore/`, `audit/`
(publish/subscribe audit logging), `commands/`, `events/`,
`interactions/`, `control/`, `managers/`, `services/`, `config/`,
`utils/`. `services/` now also holds `projectContext.js` (deterministic,
read-only project-awareness data layer) and `projectAwareness.js` (the
one place that turns that data into a model call) — see "Read-only
project awareness" below. See `docs/ARCHITECTURE.md` for how the rest
connect — not restated here to avoid a second, driftable copy.

## How is it validated/tested?

**Updated 2026-09-15 (Phase 10): a real automated suite now exists.**
`npm test` runs `node --test tests/*.test.js` (31 tests, `tests/
projectContext.test.js` + `tests/projectAwareness.test.js`) covering the
new read-only project-awareness feature below. Confirmed passing under
both the workstation's global Node (26.5.0) and Node 22 — `sqlite3`
(this project's native dependency) uses N-API, which is ABI-stable
across Node versions, so unlike `WhisperOS`'s `better-sqlite3` issue,
Wren has no Node-version pin requirement; verified directly, not
assumed. Before Phase 10, `docs/CHANGELOG.md`'s v0.5.0 entry's "re-ran
the full mocked interaction suite from prior phases" was a manual
regression step, not automated — that's now only true of everything
*except* project awareness, which does have real coverage.

## Read-only project awareness (Phase 10, catalog-driven since Phase 11)

Wren answers `/wren project <name>` for any project **enabled in
`projectCatalog.json`** (repo root, sibling to `config.json`) — 9 today,
listed below — by reading that project's `PROJECTS.md` registry row, its
latest operational handoff (if any) from `WhisperCommandCenter/handoffs/`,
and a small catalog-defined set of entry-point documents (e.g.
`CLAUDE.md`, `README.md`), then having the local model summarize that in
character.

**This is read-only, by construction, not just by policy.**
`src/services/projectContext.js` never writes anything, never invokes an
LLM, never runs a shell command, and only ever reads a file whose path
was derived from `projectCatalog.json` plus this repo's own on-disk
location — never from a user-supplied string. **The model itself never
chooses a filesystem path** — the public API takes a project name, and
the catalog is the only thing that turns a name into a path. See that
file's own header comment for the full safety model (catalog →
canonicalized-path checks → credential-filename deny patterns → size
caps). Full detail belongs in `docs/ARCHITECTURE.md`'s "Project
awareness" section, not restated here.

**How the catalog works (`projectCatalog.json`):** a flat list of
`{ name, enabled, entryPoints, aliases? }` entries. `WhisperCommandCenter/
PROJECTS.md` remains the canonical registry of *what projects exist and
their status* — the catalog only ever answers a narrower question: "is
Wren allowed to read this project, and which specific files may she
read?" The catalog is loaded and validated at startup (bad JSON, an
unsafe entry point, or a `..`/absolute path in any entry is dropped or
fails the whole catalog closed — never falls open to "allow everything").
**To add a project:** confirm it meets the eligibility bar below, add one
entry to `projectCatalog.json` with a small, explicit `entryPoints` list,
done — no code change needed. **To remove one:** set `"enabled": false`
or delete the entry; both behave identically to "unknown project" from
the outside (no information leak about what's disabled vs. never added).

**Eligibility bar for adding a project** (all should hold): canonical
path directly under `~/Projects/`; a real, identifiable project (not a
raw utility/storage folder); has useful entry-point documentation;
orientation doesn't require reading any credential file; no need for
recursive access — a handful of named files is enough; not retired or
deleted; not a bare third-party clone without a real reason to include
it. Credential-bearing account infrastructure (`YouTubeAccounts`,
`TikTokAccounts`) was deliberately evaluated and **excluded** in Phase 11
— even a README-only read felt like the wrong default for
account-management repositories with low direct benefit to a WhisperSMP
Discord companion; revisit only with a specific, explicit reason.

**Currently enabled (9):** `WhisperOS`, `GamingUnfiltered`,
`ClayMoneyTrail`, `WhisperBot`, `WhisperSMP`, `WhisperAboutIt`,
`WhisperContent`, `BroBeHonest`, `WhatIfSeries`. `GamingUnfiltered` also
has the alias `GamezUnfiltered` (its actual in-repo branding).
`WhisperContentCommandCenter` and `LocalViewBoard` were considered and
excluded for now — `PROJECTS.md` itself flags their scope as unresolved/
overlapping, which risks Wren giving a confusing answer about two
projects that might get merged or dropped.

**No-handoff behavior:** most of the 9 enabled projects have no handoff
yet (only `WhisperOS`, `GamingUnfiltered`, `ClayMoneyTrail` do, from
Phases 6-9). That's expected and handled explicitly, not as an error —
the model is told plainly "No recorded operational handoff exists for
this project yet" and still gets the entry-point documents.

Boundaries worth remembering:
- Wren does **not** create, edit, or promote handoffs — she only reads
  the existing `WhisperCommandCenter/handoffs/index.json` and the one
  Markdown file it points to for a matched project.
- A handoff can be stale. Wren is told explicitly, in the model prompt,
  that repository reality outranks it and that she hasn't independently
  verified current `HEAD` herself. No git command is ever run to check.
- Only catalog-enabled projects are reachable this way. Asking about
  anything else — including the retired `AboutIt` — gets a safe "not
  available yet" answer, distinct by construction from the active,
  unrelated `WhisperAboutIt` (verified by a regression test after a real
  bug was found and fixed: a naive text search could have returned the
  retired-AboutIt row's own text, which mentions `WhisperAboutIt` by
  name, instead of `WhisperAboutIt`'s actual row).
- ClayMoneyTrail's evidence-status vocabulary (verified fact vs.
  allegation vs. unverified lead, etc.) must survive into Wren's answer
  unchanged — the model prompt explicitly requires this, and a test
  confirms the raw vocabulary text is never altered before reaching the
  model.
- Ordinary conversation (`/wren ask`, mentions, prefix) never loads any
  of this, even if a project name is mentioned in the message — a test
  confirms it. `/wren project <name>` remains the only trigger; natural-
  language routing was deliberately deferred, not built.
- Test with `node --test tests/*.test.js` (72 tests as of Phase 12), or
  exercise it live via `/wren project WhisperOS` in Discord.
- **`/wren project` now falls back deterministically if Ollama is down**
  (Phase 12) — see "Deterministic fallback" below. The local model is a
  wording layer, never a single point of failure for basic status.

**Known gap (found Phase 10, fixed Phase 11):** `config.json`'s
`ai.model` was `llama3.1:latest`, but only `llama3.1:8b` was pulled in
this environment — every Ollama call 404'd, including normal chat, not
just project awareness. Corrected 2026-09-15 by pointing `ai.model` (and
`configManager.js`'s fallback default) at the model actually installed,
`llama3.1:8b`, rather than pulling a redundant second model. Verified
directly: real `generateReply()` calls now succeed, for both ordinary
chat and project awareness, across all 9 enabled projects.

## Handoff drafting (Phase 12) — text only, never persisted

`/wren handoff-draft <name>` produces a **text-only draft** shaped like
the shared handoff contract (`Agent`/`Project`/`Project Path`/
`Objective`, then `## Completed` through `## Notes`) for any catalog-
enabled project. **Every response is labeled `DRAFT ONLY — NOT SAVED`
at the top and bottom, plus an explicit "Wren did not modify the project
or WhisperCommandCenter" line** — this is generated for a human to read
and, if they choose, use as a starting point for a real handoff written
through the normal tooling (`create-handoff.py`). Wren has **zero**
handoff-write authority: she never writes a file, never touches
`handoffs/index.json`, never calls `create-handoff.py`, never commits
anything.

**How it stays honest without an LLM in the trust path:** fact
extraction and wording are deliberately separate (`src/services/
projectFacts.js` → `src/services/handoffDraft.js`). The structured draft
(every field) is built **deterministically** from the same facts
`/wren project` uses — the local model is never asked to reproduce that
structure itself (an LLM can't be trusted to keep exact markers like
`DRAFT ONLY — NOT SAVED` or `UNKNOWN` verbatim across a long
generation). The model is only ever asked for a short (3-5 sentence)
narrative paragraph summarizing the same facts, which is prepended to
the deterministic draft. If a project has no handoff yet, every field
that would depend on operational history reads `UNKNOWN`, `NOT
VERIFIED`, or `NO CURRENT HANDOFF` — never a guess dressed up as recent
activity. `## Git State` never claims current `HEAD` was verified; it
only ever repeats what a handoff recorded, with an explicit "not
independently verified" line.

**Deterministic fallback (Part N, both commands):** if Ollama is
unavailable, `/wren project` returns `buildDeterministicStatus()` and
`/wren handoff-draft` returns the deterministic draft with a "local
model unavailable" note prepended — both fully accurate, neither
depends on a live model. Verified directly by monkey-patching
`ollamaService.generateReply` to throw in tests, and confirmed the
normal happy path is unaffected.

**Discord message limits:** a draft can be long. `src/utils/
chunkedReply.js` caps the overall response at ~6000 characters
(truncating with an explicit note if exceeded, never silently) and
labels multi-message responses `**(part N/M)**` in order.

Test with `node --test tests/handoffDraft.test.js tests/chunkedReply.test.js`,
or live via `/wren handoff-draft WhisperOS` in Discord.

## Human approval of drafts (Phase 13) — transient state only, still no persistence

`/wren handoff-approve <draft-id>` and `/wren handoff-reject <draft-id>`
let a human record a decision about a specific draft `/wren
handoff-draft` produced. **This does NOT implement handoff persistence.**
Approving a draft never writes a file, never touches
`handoffs/index.json`, never calls `create-handoff.py`, never commits
anything — the only effect is an in-memory status flip on a session
object that a restart erases. That is intentional: Phase 13 proves the
*workflow* (a specific human can approve a specific piece of text, and
nobody else can), not a write path. Persistence, if it is ever built, is
future work with its own review.

**Session model (`src/services/handoffApproval.js`):** every `/wren
handoff-draft` call creates a session — `crypto.randomUUID()` draftId,
a SHA-256 hash of the exact final text shown (gloss + deterministic
draft, so *any* change to either invalidates the binding), the
requester's Discord user ID, `createdAt`/`expiresAt` (15 minutes by
default, `config.projectAwareness.draftApprovalTtlMs`), and a status
(`pending` → `approved` | `rejected` | `expired` | `superseded`). It is
a plain in-memory `Map` — **no database, no file, no SQLite table, no
entry in the memory/lore system.** A bot restart clears every session;
that is acceptable and expected.

**Authorization:** only the original requester or an existing Wren
admin (`permissionManager.isAdmin`) may approve or reject a draft — an
unrelated Discord user is always denied, audited as
`handoff_draft_approval_denied`. There is no natural-language approval
route: typing "looks good" or "approved" in ordinary chat does nothing:
only the explicit slash commands call into the store (enforced by a
regression test that greps the whole `src/` tree for any other caller
of `approvalStore.approve`/`.reject`).

**Expiration and supersession:** expiry is checked lazily — on access,
not by a background timer — and a still-pending draft that is not acted
on within the TTL becomes `expired` and can never be approved. If the
same requester drafts the same project again while an older draft is
still `pending`, the old one is marked `superseded` before the new one
is created; a superseded draft can never be approved, even by its
original requester. Rejection is terminal: a rejected draft cannot
later be approved, and regenerating creates a brand-new draft ID rather
than mutating the old one.

**The SHA-256 hash is internal only** — it is never shown in a Discord
reply, never logged (audit events carry
draftId/project/requesterUserId/actorUserId/status metadata, never the
hash or the draft text itself). It exists purely so "approve draft X"
unambiguously means "approve this exact text," not "approve whatever
draft X currently contains" (draft text is immutable once a session is
created — a new draft always gets a new ID).

**The LLM has zero authority here.** Draft IDs, hashes, expiration,
requester identity, and every status transition are 100% deterministic
application code in `handoffApproval.js`. A test confirms that even if
the local model's gloss text contains language like "this is approved,"
the resulting draft still sits `pending` until a human uses the actual
slash command.

**What approval does NOT mean:** approval means only "a specific
authorized human reviewed and approved this exact piece of text" — not
"the repository's current `HEAD` is correct" in some absolute sense.
(Phase 14, below, adds a repository-state guard that catches *drift*
between draft/approval/plan-generation time; it does not make Wren an
authority on whether the repository is in a *good* state, only on
whether it *changed*.)

Test with `node --test tests/handoffApproval.test.js` (37 tests,
including a Part T–style local simulation of two Discord users acting
on the same and different drafts, with fixture TTLs instead of real
sleeps).

## Repository state guard + persistence dry-run (Phase 14) — still no write authority

Phase 13 proved a human could approve exact draft text. Phase 14 adds
the piece a real future write would need without granting it: proof
that the repository hasn't moved out from under the approval, plus a
deterministic preview of what *could* be written. **No handoff is
created, no `index.json` entry is added, no file is touched anywhere —
this phase produces a plan object and a Discord message, nothing else.**

**Repository snapshots (`src/services/repoState.js`, new):** a narrowly-
scoped, read-only Git inspection module. It exposes exactly one thing:
`captureRepositorySnapshot(project, projectPath)` returning `{isGitRepo,
headCommit, branch, workingTreeDirty, workingTreeFingerprint,
capturedAt}`. `projectPath` is always the catalog-resolved, canonical
path `getProjectContext()` already produced — never a user-supplied
string. Direct `.git`-file parsing (to avoid a subprocess entirely) was
considered and rejected: worktrees, packed-refs, and detached HEADs make
that fragile, and reimplementing git's own resolution incorrectly would
be a *correctness* bug in a safety guard. Since the working-tree check
has no non-subprocess alternative anyway (it needs the same index/diff
logic git already implements), all three facts are read through one
consistent, tightly-constrained `execFileSync('git', [...])` call —
hardcoded executable, hardcoded argv (`rev-parse --is-inside-work-tree`,
`rev-parse HEAD`, `branch --show-current`, `status --porcelain` only),
no shell, a 3s timeout, a 256KB output cap, and an environment trimmed to
`PATH` only so an ambient `GIT_DIR`/`GIT_WORK_TREE` can't redirect it.

**The working-tree fingerprint is `SHA-256(git status --porcelain
output)`** — never the porcelain text itself, which is never returned,
displayed, or logged. **Documented limitation:** this fingerprints the
*shape* of the status output, not file contents; a change that
happens to produce byte-identical porcelain output (theoretically
possible, practically rare) would not be caught. It is a guard against
common drift (commits, branch switches, files staged/modified/added/
removed), not a full content-integrity snapshot.

**Three checkpoints, two comparisons:** a snapshot is captured at draft
creation (`atDraft`), rechecked at approval (`atApproval`, compared
against `atDraft`), and rechecked again at `/wren handoff-plan`
(`atPlan`, compared against `atApproval`). Any drift at either
comparison — HEAD, branch, dirty flag, or fingerprint — fails the
session closed into a new terminal `stale` status (extending Phase 13's
`pending/approved/rejected/expired/superseded` with `stale`). A stale
draft can never later be approved or planned; the user must generate a
new draft. **Dirty→dirty is deliberately not treated as unchanged** —
`GamingUnfiltered` legitimately has an ongoing dirty tree, so only an
exact fingerprint match counts as "nothing changed."

**Non-Git projects (e.g. `BroBeHonest`) are unaffected for drafting and
approval** — snapshots simply record `isGitRepo: false` and two such
snapshots always "match" (nothing to drift). But `/wren handoff-plan`
always marks these `eligible: false` with an explicit reason: there is
no repository checkpoint to bind the approval to. Wren never invents git
state for a project that doesn't have any.

**`/wren handoff-plan <draft-id>` (new):** requires the draft to already
be `approved` (not pending/rejected/expired/superseded/stale), passes
the same requester-or-admin authorization as approve/reject, reruns the
repository recheck, and — only if that passes — builds and displays a
**persistence plan**: a deterministic object (`src/services/
handoffPersistencePlan.js`) built from `session.facts` (the same
`projectFacts.js` output the draft itself was built from) and the
repository snapshots, never from the rendered Discord text. The reply is
always headed and footed with `DRY RUN — NOTHING WAS SAVED`, states
whether the project is `eligible` and why not if it isn't, and never
prints the SHA-256 draft hash.

**Field-mapping decisions, deliberately conservative:**
- `agent` is always the literal `"Wren"` — never the model, never a
  human's name, never "Claude."
- `objective` stays Phase 12's fixed phrase ("Continuity summary based
  on approved read-only project context") — reading a project is still
  not performing work on it.
- `validation` explicitly separates `SOURCE HANDOFF REPORTED
  VALIDATION` (whatever a prior handoff said) from `WREN VERIFIED`
  (repository identity across the three checkpoints, and nothing else —
  Wren never claims to have run a test or a build).
- `gitState` reports HEAD/branch/working-tree-state truthfully once
  verified, but `Pushed:` is always `unknown` unless a source handoff
  already recorded a value (shown distinctly, still not independently
  re-verified) — Wren does not inspect remotes or push state.

**CommandCenter compatibility (read-only investigation only, nothing
changed there):** `create-handoff.py`'s own generated Markdown always
injects its *own* `## Git State` block from `--branch`/`--commit`/
`--pushed` flags — its `Working Tree:` line is hardcoded to `(fill in)`
with no CLI flag to supply it, and `--pushed` is a plain boolean with no
"unknown" state. Both are real, documented gaps a future persistence
phase would need to address (extend the tool, or post-process its
output) — noted here, not fixed, since modifying CommandCenter is out of
scope for Phase 14.

**Audit events added:** `handoff_repo_snapshot_captured` (fired at each
of the three checkpoints, with a `phase` field), `handoff_draft_stale`,
`handoff_persistence_plan_generated`, `handoff_persistence_plan_denied`
— metadata only (draftId, project, actor/requester IDs, HEAD, branch,
dirty flag, timestamps); the porcelain listing, filenames, and the
fingerprint itself are never logged.

Test with `node --test tests/repoState.test.js
tests/handoffPersistencePlan.test.js` (52 tests), including real
read-only snapshots of `WhisperOS`/`GamingUnfiltered`/`ClayMoneyTrail`
and drift scenarios run only against disposable fixture repos under
the OS temp directory — never against a real project.

## Wren Rebirth (Phase 17) — new mission, new guild, public/admin boundary

Wren was rebuilt for a new role without a rewrite: inspection confirmed
the existing architecture (project awareness, handoff drafting/approval,
audit, permissions, Ollama integration, Discord plumbing) was generic
enough to carry forward unchanged — only identity text, catalog
membership, a few command surfaces, and the memory schema needed to
change.

**New identity.** Wren is now "the AI community and research assistant
for Whisper About It / Unfiltered Talk Radio" (`src/ai/personality.js`'s
`BASE_IDENTITY`) — not a WhisperSMP character, Minecraft lore bot, or
gaming assistant. She still isn't sterile: the VOICE/personality/mood
layers are untouched, still generic, still hers. WhisperSMP remains its
own separate gaming ecosystem; it is not absorbed into the new domain,
merely no longer Wren's default.

**New guild — the actual safety boundary.** `DISCORD_GUILD_ID` is now
**required** (`configManager.js` throws at startup without it, matching
`DISCORD_TOKEN`'s existing requirement) and is the target Whisper About
It / Unfiltered Talk Radio guild: `1549772221226950686`. `src/utils/
guildGuard.js`'s `isAllowedGuild()` is checked in both
`events/messageCreate.js` (ordinary messages) and `events/
interactionCreate.js` (every slash command, button, and modal) — a
message or interaction from any other guild is silently ignored, never
answered. The previously **committed** `config.json` channel ID
(`1478108084340785358`, the old gaming channel) is gone; `discord.
channelId` is now optional and env-only (`DISCORD_CHANNEL_ID`), used
only as an *additional* restriction on admin/ops commands, never as
Wren's only safety boundary. Public conversation (mentions, `/wren ask`)
is guild-scoped, not channel-scoped — a community assistant needs to
work across more than one channel.

**Public/admin authorization boundary (the critical fix).** Before Phase
17, `/wren project` and every `/wren handoff-*` command were gated only
by the optional channel restriction — any member present in that one
channel could run them, not just an admin. `src/utils/adminGate.js`'s
`denyUnlessAdminOps()` now gates all five of `project`/`handoff-draft`/
`handoff-approve`/`handoff-reject`/`handoff-plan` on
`permissionManager.isAdmin()` first (channel restriction, if configured,
applies on top). This does **not** weaken handoff-approve/reject/plan's
own internal Phase-13/14 requester-or-admin logic — since only an admin
can ever create a draft now, every legitimate requester is already an
admin by construction. `/wren link` (Minecraft account linking, fully
public, no gating) was removed from the command surface entirely —
`playerManager.linkPlayer()` still exists in case old linked-account data
is ever needed, it's just unreferenced by any command now.

**Civic research safety model.** `BASE_IDENTITY` gained an explicit CIVIC
RESEARCH EVIDENCE RULE: never upgrade "an allegation that X happened"
into "X happened" — the model never decides something became verified.
The memory/lore schema gained two additive, nullable columns:
`visibility` (`'internal'` default, `'public'` opt-in — nothing is
public unless an admin explicitly sets it) and `verification_status`
(civic vocabulary: `verified_fact` / `allegation` / `unverified_lead` /
`hypothesis` / `rejected` / `deprecated` — optional, `NULL` for ordinary
non-civic memories where the concept doesn't apply). `memoryRetriever.js`
— Wren's **only** public conversational retrieval path — filters to
`visibility = 'public'` in SQL; nothing else reaches an ordinary
conversation. No content was bulk-published to make this true: the
boundary exists, but nothing has been marked public yet. Neither
`addMemory()` nor `addLore()` is ever called with model output for
`verificationStatus` — it's an explicit, deterministic, admin-only
parameter, structurally unreachable from `responder.js`'s conversational
path.

**Project catalog restructure.** `projectCatalog.json`'s gaming-facing
entries (`WhisperSMP`, `WhisperBot`, `GamingUnfiltered`, `BroBeHonest`,
`WhisperContent`, `WhatIfSeries`) and `WhisperOS` (not gaming, but not
evidenced to support the new role either) are now `enabled: false` —
disabled, not deleted; every one of those projects is untouched on disk
and can be re-enabled later with evidence. The new default catalog is
`ClayMoneyTrail`, `WhisperAboutIt`, `Cthrew` (new — see below), and
`WhisperCommandCenter` (new — explicitly admin/internal, reachable only
through the same admin-gated commands as everything else).

**Cthrew added.** `README.md` alone is allowlisted — narrower is safer
for a first addition, and it already documents Cthrew's own
non-negotiable verification-status rule and the fact that its v0.1
shipped dataset is entirely fictional demo content end-to-end (real
public-source ingestion hasn't started there yet).

**Guild-scoped memory (contamination prevention).** `memories` and
`lore` gained an additive, nullable `guild_id` column, stamped
automatically at write time from `config.discord.guildId` — never
caller-supplied. `memoryRetriever.js` filters `guild_id = <current
guild>` in SQL. Every row written before this migration has `guild_id
IS NULL`, which matches no guild's filter, including the one it actually
came from — **preserved, never deleted, but structurally excluded from
every live conversation.** (On this machine, `memories`/`lore` were
empty at migration time — there was no historical WhisperSMP content to
isolate from in practice, but the mechanism holds regardless.) Admin
review tools (`searchMemories`, `searchLore`, `getMemoriesForUser`) are
deliberately **not** guild-filtered, so an admin can still see/manage
everything, old and new, for cleanup or reference.

**systemd service + `wren` CLI (Parts O/P).** `deploy/wren.service` (a
tracked template) is installed at `~/.config/systemd/user/wren.service`
— `Type=simple`, `Restart=on-failure`, `RestartSec=10`, `ExecStart`
pointing at `scripts/start-wren.sh` (a thin wrapper that prepends the
mise shims directory to `PATH`, mirroring the fix already proven for
WhisperCommandCenter's report timers, then `exec node src/bot.js`). No
token or secret appears in the unit file or the wrapper — `DISCORD_TOKEN`
is loaded from `.env` by `configManager.js`'s existing `dotenv` call,
same as always. `bin/wren` (symlinked to `~/.local/bin/wren`) provides
`wren on|off|status|restart|logs [-f]` — a thin, hardcoded wrapper around
`systemctl --user`/`journalctl --user` against exactly one unit name
(`wren.service`, never an argument-supplied one), no `sudo`, no `eval`,
no shell-string construction.

**Required environment variables as of Phase 17** (`.env`, never
committed): `DISCORD_TOKEN` (required), `DISCORD_GUILD_ID` (required,
`1549772221226950686`), `DISCORD_CLIENT_ID` (optional but recommended),
`DISCORD_CHANNEL_ID` (optional, admin/ops-only restriction). **No `.env`
file exists on this development machine** — Phase 17 did not create one
and did not fabricate a token; a real Discord connectivity test cannot
run until the user populates it.

**Discord intents** — unchanged from before Phase 17, already correct
for the new role: `Guilds`, `GuildMessages`, `MessageContent`,
`GuildMembers`. No `GuildPresences` (Presence Intent) — nothing here
needs member online/status/activity data.

**Safe startup procedure:** run `node --test tests/*.test.js` (expect
204 passing) → populate `.env` → `wren on` → `wren status` to confirm
`Active: active (running)` and check `wren logs` for a clean "Wren is
online as ..." line with no crash loop → confirm in Discord that
slash commands appear only in the configured guild → `wren off` if this
was only a validation run, or leave running if intentionally deploying.

Test with `node --test tests/wrenRebirth.test.js` (41 tests) for
everything above; the broader suite's pre-existing tests were updated in
place wherever they referenced a now-disabled catalog project (WhisperOS,
WhisperBot, GamingUnfiltered, WhisperSMP, BroBeHonest), never removed.

## What should an AI read first?

1. This file, then `docs/PERSONALITY.md` — who Wren is, before writing
   any user-facing text.
2. `docs/ARCHITECTURE.md` for how memory/mood/personality/lore fit
   together before changing any of them.
3. `docs/CHANGELOG.md` for what's shipped vs. planned, phase by phase.

## What should an AI NOT assume?

- Don't assume Wren integrates with WhisperOS ("Phase 4") — that's
  resolved *scope* (API/service integration, not a merge; see
  `AI/context/DECISIONS.md`), not something scheduled or built. WhisperOS
  now has real code (v1.2), but no API surface for Wren to call has been
  confirmed to exist.
- Don't assume Wren reads WhisperSMP or Minecraft state — `data/wren.db`
  can *store* a Discord↔Minecraft username link
  (`/wren link minecraft_username:<name>`), but nothing reads it yet;
  it's write-only, real data with zero consumers. See
  `AI/context/ECOSYSTEM_MAP.md`.
- Don't assume Wren shares any database, service, or code with
  WhisperBot — they're deliberately separate, only co-located in the same
  Discord server.
- Don't assume the single-commit git history means the code is thin or
  unfinished — verify against the actual `src/` tree, which is
  substantial (13 top-level modules).
- Don't assume `/wren project` can answer about any project — it's
  hardcoded to exactly three (`WhisperOS`, `GamingUnfiltered`,
  `ClayMoneyTrail`) in `src/services/projectContext.js`'s
  `PROJECT_ALLOWLIST`. Adding a fourth means editing that constant
  deliberately, not something a user request or a config change can do.
- Don't assume a project-awareness answer reflects current reality — it
  reflects a handoff/entry-point snapshot at read time, explicitly
  labeled as such in the model prompt.

## Safety boundaries

- Never commit a real Discord bot token — use `.env`/`.env.example`.
- Wren runs against a local Ollama instance; don't wire in a cloud AI
  provider without an explicit decision — "no cloud AI" is a stated,
  deliberate project property, not an oversight.
- Keep personality and mood state in their separate files/managers,
  per the documented, deliberate deviation from the standard
  `src/managers/` convention (see `AI/context/DECISIONS.md`).
- Project awareness (`src/services/projectContext.js`) must stay
  read-only by construction: no shell execution, no arbitrary filesystem
  access, no writes, no new entry beyond the catalog without a
  deliberate, reviewed edit to `projectCatalog.json`. Don't loosen any of
  these to make a future feature request more convenient — that safety
  review was the point of Phase 10.
- Handoff drafting (`src/services/handoffDraft.js`) generates TEXT ONLY.
  It must never gain the ability to write a file, edit
  `WhisperCommandCenter/handoffs/index.json`, call `create-handoff.py`,
  or run any git command. "Wren can produce good draft text" is not by
  itself a reason to grant write access later — that remains a separate,
  explicit decision (see `docs/CHANGELOG.md`'s Phase 12 entry for what
  evidence that decision would need).

## Related durable cross-project knowledge

Cross-session operational handoffs (what substantial work happened,
current state, what's next — for any project, not just this one) live
in `~/Projects/WhisperCommandCenter/handoffs/`, read here via
`src/services/projectContext.js` for the three allowlisted projects
above. See `WhisperCommandCenter/handoffs/README.md` for the full
contract; that repository remains the owner of it, not Wren.

`~/Projects/AI/` holds cross-project engineering knowledge for this
project's cluster (WhisperBot, Wren, WhisperOS, WhisperSMP) —
`AI/context/DECISIONS.md` (several decisions specific to this project:
the `playerManager`/`memoryManager` split, audit-log pub/sub design, the
`memories.source` column, the ephemeral-reply helper, the Wren/WhisperOS
Phase 4 scope resolution) and `AI/VISION.md`'s documentation-trust
principles. `AI/` indexes and cross-references; it does not replace this
project's own `docs/`.
