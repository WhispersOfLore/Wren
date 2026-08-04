# CLAUDE.md — Wren

This is a thin index, not a duplicate of this project's own documentation.
This project's `docs/` folder already covers architecture, personality,
and change history in depth — read it, don't re-derive it from this file.

Workspace-wide context (cross-project patterns, shared conventions) lives
in `~/Projects/AI/` — see `AI/CLAUDE.md` first if you haven't already.

## Purpose

A local, AI-powered Discord companion for WhisperSMP. Not WhisperBot —
WhisperBot handles utility, automation, Minecraft systems, economy, and
casino; Wren exists purely for conversation, companionship, and
entertainment. Runs entirely on local infrastructure (Ollama,
`llama3.1:latest`) — no cloud AI APIs, no paid services. See
`docs/PERSONALITY.md` for who she is; match that voice in anything
user-facing.

## Current Status

Active, shipping, git-tracked. Currently at Phase 3 of its roadmap
(permanent memory + lore) plus an unnumbered stabilization sprint
(single-instance protection, structured audit logging). See
`docs/CHANGELOG.md` for the full shipped history and phase renumbering
trail.

## Technology Stack

Node.js (CommonJS), discord.js v14, axios → Ollama's local HTTP API
(`llama3.1:latest`), sqlite3, Winston (structured logging + separate audit
log). No automated test suite.

## Architecture

Full layer breakdown and diagram: **`docs/ARCHITECTURE.md`**. Short
version: Discord layer → `interactions/responder.js` (the single business-
logic path to Ollama, no Discord-specific code) → personality/mood
composition → memory/lore retrieval → `services/ollamaService.js`.

## Important Files

- `docs/ARCHITECTURE.md` — layers, reliability mechanisms (single-instance
  lock, audit system), memory/lore schema and retrieval logic.
- `docs/PERSONALITY.md` — who Wren is, her unchanging core identity vs.
  her configurable personality/mood layers.
- `docs/CHANGELOG.md` — phase-by-phase shipped history.
- `README.md` — setup, configuration reference, admin controls,
  troubleshooting.
- `config.json` / `.env` — behavior vs. secrets, loaded by
  `config/configManager.js`. Never put secrets in `config.json`.

## Development Rules

- `interactions/responder.js` is the *only* path to Ollama — all three
  summon methods (mention/prefix/slash) funnel through it so rules
  (enabled? cooldown? queue full?) are enforced exactly once. Don't add a
  second path.
- Personality/mood/memory are three independent, swappable layers
  composed fresh per request (see `docs/ARCHITECTURE.md`) — don't hardcode
  behavior that belongs in one of these into another.
- Any administrative mutation (personality, mood, settings, memory, lore)
  should go through `auditLog.record()` with an actor ID, following the
  existing pattern — not a direct log call.
- Schema changes: additive only, via the `ensureColumn()` idempotent
  migration helper pattern already established in `src/memory/database.js`.

## Known Issues

None currently documented in `docs/`. If you find one, add it there (this
project doesn't yet have a `KNOWN_ISSUES.md` — consider creating one
following WhisperBot's format if issues start accumulating).

## Future Roadmap

See `docs/CHANGELOG.md`'s "Future expansion" notes and this project's
`README.md` Roadmap section — Phase 4 is WhisperOS integration, multiple
model backends, and tool-calling abilities. Resolved scope (2026-08-02,
see `AI/context/DECISIONS.md`): Wren would become WhisperOS's
conversational interface via APIs/services — helping users interact with
WhisperOS features, summarizing business information, assisting
administrators — not a merge; both stay separate products. Still blocked:
`WhisperOS` is currently an empty, unstarted project (see
`AI/context/PROJECTS.md`), so there's no API yet for Wren to integrate
with.
