# CLAUDE.md — Wren

Added 2026-09-15. `~/Projects/AI/CLAUDE.md` and `AI/context/PROJECTS.md`
have cited `Wren/CLAUDE.md` as this project's agent entry point since
2026-08-02, but the file did not actually exist at this root until now —
a documentation gap, closed by this file.

## What is this project?

A local, AI-powered Discord companion for WhisperSMP: "conversation,
companionship, and entertainment," explicitly not utility, automation, or
economy — that's `WhisperBot`'s job (per `README.md`). Runs entirely on
local infrastructure: message generation goes through a local
[Ollama](https://ollama.com) instance running `llama3.1:8b` (corrected
2026-09-15, Phase 11 — see "Known gap" below) — no cloud AI APIs, no
OpenAI.

**Note on git history:** this repository's entire history is a single
commit (`Initial Wren bot setup`). Everything below was verified by
reading the actual `src/` tree and `docs/CHANGELOG.md`, not inferred from
commit-by-commit history — there isn't one to inspect.

## What does it currently do?

Verified by directly inspecting `src/` (not just reading docs) — the
directory contains `ai/`, `audit/`, `commands/`, `config/`, `control/`,
`events/`, `interactions/`, `lore/`, `managers/`, `memory/`, `mood/`,
`personality/` (+ `profiles/`), `services/`, `utils/`. Specific files
confirmed present: `memory/memoryManager.js`, `memory/memoryRetriever.js`,
`memory/playerManager.js`, `audit/auditLog.js`, `personality/
personalityManager.js` — these match `docs/CHANGELOG.md`'s own
"[0.4.0] Phase 3: Memory & Knowledge System" and "[0.5.0] Stabilization
Sprint" (single-instance protection, structured audit logging,
`playerManager`/`memoryManager` split) entries. The code substance is
real; treat the sequential "Phase 1/2/3" framing and its embedded dates
as this project's own narrative record, not something independently
git-verified (see `AI/VISION.md`'s documentation-trustworthiness note —
the same caveat applies here as to WhisperBot's dated docs).

**No automated test suite** — `package.json`'s `test` script is a
placeholder.

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
