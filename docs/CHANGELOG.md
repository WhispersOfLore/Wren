# Changelog

All notable changes to Wren are documented here.

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
- **Phase 4** — WhisperOS integration (Wren as WhisperOS's conversational
  interface via APIs/services — separate products, not a merged
  subsystem), multiple AI models, tool abilities.
