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
`utils/`. See `docs/ARCHITECTURE.md` for how they connect — not restated
here to avoid a second, driftable copy.

## How is it validated/tested?

No automated tests exist. `docs/CHANGELOG.md`'s v0.5.0 entry mentions
"re-ran the full mocked interaction suite from prior phases" as a manual
regression step — there's no evidence this is an automated, repeatable
suite as opposed to a manual pass; don't assume CI-style coverage exists.

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

## Safety boundaries

- Never commit a real Discord bot token — use `.env`/`.env.example`.
- Wren runs against a local Ollama instance; don't wire in a cloud AI
  provider without an explicit decision — "no cloud AI" is a stated,
  deliberate project property, not an oversight.
- Keep personality and mood state in their separate files/managers,
  per the documented, deliberate deviation from the standard
  `src/managers/` convention (see `AI/context/DECISIONS.md`).

## Related durable cross-project knowledge

`~/Projects/AI/` holds cross-project engineering knowledge for this
project's cluster (WhisperBot, Wren, WhisperOS, WhisperSMP) —
`AI/context/DECISIONS.md` (several decisions specific to this project:
the `playerManager`/`memoryManager` split, audit-log pub/sub design, the
`memories.source` column, the ephemeral-reply helper, the Wren/WhisperOS
Phase 4 scope resolution) and `AI/VISION.md`'s documentation-trust
principles. `AI/` indexes and cross-references; it does not replace this
project's own `docs/`.
