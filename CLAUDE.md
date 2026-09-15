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
[Ollama](https://ollama.com) instance running `llama3.1:latest` — no
cloud AI APIs, no OpenAI.

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

## Read-only project awareness (Phase 10)

Wren can now answer `/wren project <name>` for exactly three allowlisted
projects — `WhisperOS`, `GamingUnfiltered`, `ClayMoneyTrail` — by reading
each project's `PROJECTS.md` registry row, its latest operational
handoff (if any) from `WhisperCommandCenter/handoffs/`, and a small,
hardcoded set of entry-point documents (e.g. `CLAUDE.md`, `README.md`),
then having the local model summarize that in character.

**This is read-only, by construction, not just by policy.** The new
`src/services/projectContext.js` module never writes anything, never
invokes an LLM, never runs a shell command, and only ever reads a file
whose path was derived from a hardcoded allowlist plus this repo's own
on-disk location — never from a user-supplied string. See that file's
own header comment for the full safety model (allowlist → canonicalized-
path checks → credential-filename deny patterns → size caps). Full
detail, including the security review this was built against, belongs
in `docs/ARCHITECTURE.md`'s "Project awareness" section, not restated
here.

Boundaries worth remembering:
- Wren does **not** create, edit, or promote handoffs — she only reads
  the existing `WhisperCommandCenter/handoffs/index.json` and the one
  Markdown file it points to for a matched project.
- A handoff can be stale. Wren is told explicitly, in the model prompt,
  that repository reality outranks it and that she hasn't independently
  verified current `HEAD` herself.
- Only the three allowlisted projects are reachable this way. Asking
  about anything else gets a safe "not available yet" answer — never a
  guess, never a different file read instead.
- ClayMoneyTrail's evidence-status vocabulary (verified fact vs.
  allegation vs. unverified lead, etc.) must survive into Wren's answer
  unchanged — the model prompt explicitly requires this, and a test
  confirms the raw vocabulary text is never altered before reaching the
  model.
- Test with `node --test tests/projectContext.test.js
  tests/projectAwareness.test.js`, or exercise it live via
  `/wren project WhisperOS` in Discord (requires a running Ollama
  instance with the configured model actually pulled — see Known gaps
  below).

**Known gap, found during Phase 10 live testing, not fixed (out of
scope for a read-only-awareness feature):** `config.json`'s
`ai.model` is `llama3.1:latest`, but only `llama3.1:8b` is pulled in
this environment — every Ollama call currently 404s here, including
pre-existing normal chat, not just project awareness. This is a
pre-existing Wren configuration/environment gap, confirmed via a direct
Ollama API call, and is unrelated to the new feature; project awareness
itself handles the resulting `OllamaError` exactly the same safe way
normal chat does (a friendly in-character error, not a crash).

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
  access, no writes, no new entry beyond the hardcoded allowlist without
  a deliberate code change. Don't loosen any of these to make a future
  feature request more convenient — that safety review was the point of
  Phase 10.

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
