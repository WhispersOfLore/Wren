# Wren — Architecture

Wren is built as a set of small, single-responsibility modules wired together
in `src/bot.js`. Nothing is hardcoded into logic — behavior is driven by
`config.json`, `.env`, and everything under `data/`: small JSON state files
admins can flip live via the control panel (on/off since Phase 1; personality
and mood since Phase 2), `data/wren.db` — the permanent SQLite database
behind the memory and lore systems — and `data/wren.lock`, the single-instance
guard described below. Administrative actions additionally produce a
structured trail in `logs/audit.log`, decoupled from the general app log via
a publish/subscribe audit system (see Audit system below).

The diagram below predates the stabilization sprint's additions
(single-instance protection, the audit system) — it shows the request/data
flow those additions don't change; each has its own section with full detail
further down.

## Layers

```
                              ┌─────────────────────┐
                              │   Discord Gateway    │
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼───────────┐
                              │      src/bot.js       │  client, intents,
                              │  (entrypoint/wiring)  │  command loading, shutdown
                              └──────────┬───────────┘
                                         │
              ┌────────────────┬─────────┴─────────┬────────────────┐
              │                │                    │                │
     ┌────────▼───────┐ ┌──────▼──────────┐ ┌───────▼─────────┐     │
     │ events/ready.js │ │ messageCreate.js │ │interactionCreate│     │
     └─────────────────┘ └────────┬─────────┘ └───────┬─────────┘     │
                                   │                   │               │
                    ┌──────────────┴───────┐   ┌───────┴────────────┐ │
                    │                       │   │                    │ │
           ┌────────▼────────┐   ┌──────────▼───┐         ┌──────────▼─▼──────┐
           │  mentionHandler   │   │ prefixHandler │         │  commands/wren.js  │
           │  (@Wren ...)      │   │  (!wren ...)  │         │ /wren ask | control │
           └────────┬──────────┘   └───────┬───────┘         └─────────┬──────────┘
                     │                      │                          │
                     │      ┌───────────────┘                ┌─────────┴─────────┐
                     │      │                                │                    │
                     ▼      ▼                        ┌───────▼───────┐   ┌────────▼────────┐
           ┌───────────────────────┐                 │ slashHandler   │   │  control/         │
           │ interactions/responder │◄────────────────┤  (ask)         │   │  controlPanel.js  │
           │  (shared business      │                 └────────────────┘   │  permissionManager │
           │   logic — the ONLY      │                                     │  settingsManager   │
           │   path to Ollama)       │                                     └─────────┬──────────┘
           └───────────┬────────────┘                                               │
                        │                                                            │
        ┌───────────────┼────────────────┬─────────────────┐              ┌─────────▼─────────┐
        │               │                │                 │              │  managers/          │
┌───────▼──────┐┌───────▼───────┐┌───────▼────────┐┌───────▼────────┐    │  statusManager       │
│statusManager  ││cooldownManager││ queueManager    ││conversationMgr  │◄───┤  (enable/disable,    │
│(is she awake?)││(per-user gate)││(FIFO generation)││(RAM chat memory)│    │   data/state.json)   │
└───────────────┘└───────────────┘└───────┬─────────┘└─────────────────┘    └─────────────────────┘
                                            │
                                  ┌─────────▼─────────────────────┐
                                  │   services/ollamaService.js     │
                                  │   axios → POST /api/chat        │
                                  └─────────┬───────────────────────┘
                                            │
                                  ┌─────────▼─────────┐
                                  │  Ollama (local)     │
                                  │  llama3.1:latest    │
                                  └─────────────────────┘

        ┌─────────────────────┐        ┌─────────────────────┐
        │ config/configManager │        │   utils/logger.js    │
        │  (config.json + .env)│        │  (Winston: console +  │
        │  used by every layer │        │   logs/*.log)         │
        └─────────────────────┘        └─────────────────────┘
```

## Discord layer

`src/bot.js` creates a single `discord.js` `Client` with the intents:
`Guilds`, `GuildMessages`, `MessageContent`, `GuildMembers`. Events live in
`src/events/` as `{ name, execute() }` modules, registered once in `bot.js`.
`bot.js` also loads every command in `src/commands/` and registers them with
Discord on startup (guild-scoped and instant if `DISCORD_GUILD_ID` is set,
otherwise global and slow to propagate — see README). No DM or reaction
features exist, so the client deliberately omits `partials` — an unused
partials config is a latent source of bugs (accessing partial data without
a `.partial` guard) waiting for a future feature that doesn't need it yet.

Every ephemeral response goes through `utils/discordReply.js`'s `ephemeral()`
helper rather than the `{ ephemeral: true }` option — that option is
deprecated in the installed discord.js version (confirmed: it emits a real
runtime warning) in favor of `{ flags: MessageFlags.Ephemeral }`, and
centralizing it in one helper means the next such deprecation only needs
fixing in one place, not thirty call sites.

## Reliability: single-instance protection

`src/utils/instanceLock.js` is the very first thing `bot.js` runs — before
even `configManager` loads. Two Wren processes connected to the same
Discord token both receive every gateway event and race to acknowledge
interactions; this happened during earlier testing and produced duplicate
replies and "Unknown interaction" errors that looked (at first) like a
Discord API bug rather than what it actually was.

The mechanism is a PID file at `data/wren.lock`, checked with the standard
POSIX liveness idiom (`process.kill(pid, 0)` — sends no signal, just checks
whether the process exists):

- No lock file, or the recorded PID isn't alive → acquire it, write the
  current PID, continue starting.
- Lock file present and that PID **is** alive → print a clear message
  naming the conflicting PID and `process.exit(1)` immediately, before
  touching Discord or Ollama at all.
- Released on graceful shutdown (`SIGINT`/`SIGTERM`) and, as a best-effort
  backup for other exit paths, on the `process.on('exit', ...)` handler.

This is why a crashed/killed process recovers cleanly on the next start
without manual intervention: the stale lock's PID is simply no longer
alive, so the liveness check treats it as free rather than blocking forever
on a lock nothing will ever release. A genuinely-running second instance,
by contrast, is refused outright — verified directly (see Testing in the
handoff report) by starting a real second `npm start` against a live
instance and confirming exit code 1 with a clear message, not a guess based
on reading the code.

## Interaction layer (Phase 1 control system)

As of Phase 1's control system, Wren is no longer an ambient chatbot —
`events/messageCreate.js` does **not** reply to arbitrary messages. It only
routes to a handler when a player deliberately summons her, in one of three
ways:

- **Mention** (`@Wren ...`) → `interactions/mentionHandler.js` strips the
  `<@id>` mention token from the message content and hands the rest off.
- **Prefix** (`!wren ...`, configurable via `interaction.prefix`) →
  `interactions/prefixHandler.js` strips the prefix and hands the rest off.
- **Slash command** (`/wren ask message:<text>`) →
  `commands/wren.js` dispatches to `interactions/slashHandler.js`.

All three funnel into `interactions/responder.js` — the single business-logic
path to Ollama. It has no Discord-specific code at all; it takes
`{ userId, channelId, text }` and returns `{ status, reply }`. This is
deliberate: whether Wren was summoned by mention, prefix, or slash command,
the rules (is she enabled? on cooldown? queue full? empty message?) are
enforced exactly once, in exactly one place. Each handler owns only the
Discord mechanics for *its* entry point — typing indicators for messages,
`deferReply`/`editReply` for interactions, chunked sending via
`utils/discordReply.js` for both.

Replies longer than Discord's 2000-character limit are split on
paragraph/sentence/word boundaries by `utils/splitMessage.js` before sending.

## Control system

`/wren control` (admin-gated) opens an interactive panel built with Discord's
component framework (embed + buttons + a modal), implemented in
`src/control/`:

- **`permissionManager.js`** — decides who may open the panel: either an
  explicit user ID in `config.control.admins`, or anyone holding Discord's
  `Administrator` permission (the fallback can be turned off via
  `control.requireAdministratorPermission: false` to restrict access to the
  explicit list only).
- **`settingsManager.js`** — validates and applies control-panel setting
  changes (cooldown seconds, prefix), delegating persistence to
  `configManager.updateSettings()`, which rewrites `config.json` in place.
- **`controlPanel.js`** — builds the embed/buttons/modal and handles their
  interactions (Enable, Disable, Personality, Settings, Close), routed here
  from `events/interactionCreate.js` by `customId` prefix. As of Phase 2, it
  has two views: the main panel (status/personality/mood/model at a glance),
  and a personality sub-panel (opened via the 🎭 Personality button) with one
  button per loaded profile — built dynamically from
  `personalityManager.list()`, not hardcoded — plus a select menu for mood,
  and a Back button to return to the main view. `controlPanel.js` itself
  contains no personality or mood *logic*, only UI: it calls
  `personalityManager.setActive()` / `moodManager.setMood()` and re-renders,
  same pattern as it already used for `statusManager.enable()/disable()`.

Wren's on/off state itself lives in **`managers/statusManager.js`**, kept
alongside the app's other `*Manager` singletons for consistency with the
existing codebase convention — everything with "Manager" in its name lives in
`src/managers/`, regardless of which feature area it serves. Conceptually it
belongs to the control system (see the diagram above); physically it sits
next to `cooldownManager` and `queueManager` because it's the same kind of
thing: a small piece of shared runtime state.

Enabled/disabled state is intentionally **not** stored in `config.json`.
`config.json` holds static settings meant to be hand-edited or changed via
the control panel's Settings modal; `data/state.json` holds runtime state
that toggles frequently and should never require a restart or a config
review to change back. `responder.js` checks `statusManager.isEnabled()`
before anything else — when disabled, every interaction method (mention,
prefix, slash) returns the same in-character sleep-mode line from
`ai/personality.js`, without touching the cooldown, queue, or Ollama at all.

## Audit system

`src/audit/auditLog.js` is a small `EventEmitter` singleton with one method,
`record({ action, actor, target, details })`. Every administrative action —
enable/disable, personality/mood changes, settings changes, memory/lore
add/edit/remove — calls it instead of logging directly. `record()` does two
things: appends a structured JSON line to `logs/audit.log` (via a dedicated
Winston instance, kept separate from the general `logs/combined.log` so
"who changed what" stays a distinct, higher-signal stream from general
app/error logging), and emits an `'audit'` event with the same payload.

The emit is the deliberate extension point: a future Discord audit channel
poster is just `auditLog.on('audit', event => postToChannel(event))` at
startup — zero changes to `statusManager`, `personalityManager`,
`moodManager`, `settingsManager`, `memoryManager`, or `loreManager`, all of
which stay unaware any subscriber exists. This is the concrete meaning of
"administrative systems publish audit events rather than writing logs
directly": the emitting code doesn't decide what happens with the event
beyond "it's on the record," and consumers (currently just the file writer)
attach themselves rather than being called directly.

Every audit-emitting function takes an `actorId` parameter (the acting
Discord user's ID) — e.g. `statusManager.enable(actorId)`,
`personalityManager.setActive(key, actorId)`,
`memoryManager.removeMemory(id, actorId)`. Callers (almost always a
`control/*Panel.js` button/modal handler) pass `interaction.user.id`. This
is the one structural change these functions needed to support auditing —
none of their actual behavior changed.

## AI layer

`services/ollamaService.js` is the only module that talks to Ollama. It posts
to `POST /api/chat` with the configured model, `temperature`, `top_p`, and
`num_predict` (max tokens), and translates connection/timeout/HTTP errors into
`OllamaError`s carrying a friendly, in-character message so the rest of the
app never has to know what Ollama's raw errors look like. It has no idea
personality profiles or moods exist — it just sends whatever message array
it's given.

`ai/personality.js` holds `BASE_IDENTITY` — the unbreakable core of who Wren
is (name, origin, the never-do rules, how she handles not knowing something)
— and the sleep-mode line. This is the one thing that never changes no
matter which personality profile or mood is active.

## Personality & Mood layer (Phase 2)

Phase 1 gave Wren one hardcoded personality baked into her system prompt.
Phase 2 splits that into three composable pieces:

```
BASE_IDENTITY (ai/personality.js, invariant)
        +
Active Personality Profile (personality/profiles/*.json, swappable)
        +
Current Mood (mood/moodManager.js, swappable)
        =
personalityManager.getSystemPrompt()  ──▶  conversationManager.getMessages()
```

- **`personality/profiles/*.json`** — data-only personality definitions
  (`sweet`, `sarcastic`, `guardian`, `lorekeeper` out of the box). Each has a
  `name`, `emoji`, `traits`, `communicationStyle`, and `humor`. Dropping a
  new `*.json` file in this folder is enough to make a new personality
  available — nothing else needs to change (up to Discord's 5-buttons-per-row
  limit in the control panel; see below).
- **`personality/personalityManager.js`** — loads every profile at startup,
  owns which one is active, persists that choice to `data/personality.json`,
  and is the *only* place that composes the final system prompt: it takes
  `BASE_IDENTITY`, layers in the active profile's traits, asks
  `moodManager` for the current mood, and returns one string.
- **`mood/moodManager.js`** — a fixed list of six moods (happy, curious,
  focused, protective, playful, tired), each with a label and emoji. Owns
  the current mood and persists it to `data/mood.json`. Phase 2 is
  foundation-only: mood changes are manual (via the control panel), not
  automatic — nothing here decides *when* Wren's mood should shift on its
  own. That's a later phase, by design (see restrictions below).

`conversationManager.getMessages()` calls `personalityManager.getSystemPrompt()`
fresh on every request rather than caching it, so a personality or mood
change takes effect on the very next message — no restart, no cache
invalidation to think about.

Both `data/personality.json` and `data/mood.json` follow the same pattern
`statusManager` established in Phase 1: small, gitignored, hand-independent
JSON files under `data/`, loaded once at startup and rewritten on every
change. They're deliberately three separate files rather than one shared
"runtime state" blob — personality, mood, and enabled/disabled are
independent axes that should be able to change without touching each
other's storage.

The stabilization sprint added an `actorId` parameter to `setActive()` and
`setMood()` (for audit logging — see Audit system below) and nothing else;
prompt composition itself is exactly as it was.

## Short-term conversation memory

This is deliberately still separate from the long-term Memory system below —
different problem, different lifetime. `managers/conversationManager.js`
keeps an in-RAM `Map<channelId, Message[]>` of the last few back-and-forth
messages, trimmed to `memory.maxMessages` from `config.json`, and gone on
restart. It's what lets Wren follow a conversation's immediate thread ("what
did I just say"), not what lets her recall that Brandon built a castle three
weeks ago — that's `src/memory/`. All three interaction methods share the
same short-term history per channel, so switching between mention, prefix,
and slash mid-conversation doesn't reset context. Personality/mood changes
don't clear it either — Wren's sense of the current conversation persists
independently of who she's currently "being."

## Memory & Lore layer (long-term knowledge)

Wren has a second, permanent kind of memory alongside short-term
conversation context — not chat history, but the same kind of thing humans
remember: names, relationships, accomplishments, events, places. It's backed
by a single SQLite database, `data/wren.db`, shared by three independent
modules:

```
src/memory/
  database.js       — the ONE shared SQLite connection + schema (users, memories, lore) + migrations
  searchUtils.js     — shared keyword tokenizer used by both search and retrieval
  playerManager.js   — identity only: the users table (Discord ↔ Minecraft linking)
  memoryManager.js   — memory content only: add/edit/remove/search/view, depends on playerManager
  memoryRetriever.js — AI-context retrieval: keyword-scored, importance-ranked, capped

src/lore/
  loreManager.js     — lore CRUD (add/edit/remove/search), imports memory/database.js
```

`playerManager.js` and `memoryManager.js` were originally one file
(`memoryManager.js` did both identity and memory content). They were split
during the stabilization sprint so each has exactly one responsibility:
`playerManager` owns "who is this person" (linking, lookup, lazy user
creation via `ensureUser`), `memoryManager` owns "what do we remember about
them" and depends on `playerManager` to resolve an identity — never the
reverse. Every caller that used to reach into `memoryManager` for linking
(`commands/wren.js`'s `/wren link`, `controlPanel.js`'s linked-player count,
`memoryPanel.js`'s player-lookup) now calls `playerManager` instead.

`src/lore/` still has no `database.js` of its own — deliberate, not an
oversight. There is *one* database file; rather than open a second SQLite
connection and duplicate schema-bootstrap code, `loreManager.js` imports the
same `run`/`get`/`all` helpers from `memory/database.js`. All three modules
stay logic-independent of each other's internals, they just share one
physical connection.

### Schema

```sql
users     (id, discord_id UNIQUE, minecraft_username, display_name, created_at, updated_at)
memories  (id, user_id → users.id, category, content, importance 1-5, source, created_by, created_at)
lore      (id, category, title, content, importance 1-5, created_by, created_at)
```

`memories.category` ∈ {personal, achievement, relationship, event, server}.
`lore.category` ∈ {kingdom, location, npc, history, event, rules}.
`importance` 1–5 (minor → legendary) exists on both tables; lore's importance
isn't admin-editable via the Add/Edit Lore modals (matching the spec's exact
3-field Add Lore example — category/title/content) and defaults to 3.

`memories.source` ∈ {canonical, observation}, defaulting to `'canonical'`.
This column is architecture prep, not a feature — see "Canonical vs.
observation memories" below. `database.js` adds it via `ensureColumn()`, a
small idempotent migration helper (`PRAGMA table_info` → `ALTER TABLE ADD
COLUMN` if missing) that runs on every startup; it's also in the inline
`CREATE TABLE` so a fresh install gets it natively and the migration path is
a same-column no-op. This is the pattern to follow for any future schema
addition — additive, safe to run repeatedly, no separate migration tooling
needed at this project's scale. Verified directly against the real
pre-sprint database (which predated this column) before this shipped, not
assumed to be safe.

### Canonical vs. observation memories (architecture prep only)

Engineering principle: *canonical knowledge is always more trustworthy than
observations or future opinions.* Canonical knowledge is what an admin has
explicitly recorded via `/wren memory` or `/wren lore` — trusted by
construction. Observations are a **future** concept: things Wren might one
day notice herself from conversation, which should never silently become
canonical fact just because they were said.

This sprint deliberately does not implement observations — no autonomous
noticing, no admin UI to mark something an observation, no retrieval
weighting difference between the two (weighting logic for a category with
zero real-world data yet would be speculative and likely wrong). All that
exists today is the `source` column, `memoryManager.SOURCES`, and
`isValidSource()` — validated, always `'canonical'` in practice, ready for
a future phase to write `'observation'` rows and decide how retrieval should
treat them differently, without a schema migration at that point.

### Editing (added this sprint)

Both `memoryManager.updateMemory(id, changes, actorId)` and
`loreManager.updateLore(id, changes, actorId)` are partial updates — only
fields present in `changes` are touched, matching the same shape as
`configManager.updateSettings()`. The Discord-facing constraint that shaped
the UI: **Discord cannot show a modal in response to a modal submit**, so a
"look up the current values, then edit them pre-filled" two-step flow isn't
possible in one interaction chain. Instead, ✏️ Edit Memory / ✏️ Edit Lore ask
for the ID (found via 🔎 Search or 📋 View first) plus whichever fields
should change, leaving the rest blank to keep their current value. This
mirrors how 🗑 Remove already worked (ID first, found via search), so it's
not a new interaction pattern for admins to learn.

### Retrieval — never dump the database

`memoryRetriever.js` is the answer to "never send the entire database to
Ollama." Given the player's current message, it:

1. Tokenizes the message into keywords (`searchUtils.tokenize` — lowercased,
   punctuation stripped, stopwords and short words dropped).
2. Pre-filters memories/lore via SQL `LIKE` across those keywords (coarse
   filter, keeps the candidate set small even as the table grows).
3. Scores each candidate in JS: `matchCount * 10 + importance`. Rows with
   **zero** keyword matches are dropped entirely — importance alone never
   surfaces an unrelated memory into context, so a high-importance fact
   about someone else's build doesn't leak into an unrelated conversation.
4. Sorts by score, caps to `config.memoryRetrieval.maxMemories` /
   `maxLore` (default 5 and 3), and formats a ready-to-inject text block —
   or returns `''` if nothing matched, so callers skip the section entirely
   rather than injecting an empty header.

### Prompt integration

`conversationManager.getMessages(channelId, latestQuestion)` is the one
integration point (same role it played for personality in Phase 2): it asks
`personalityManager` for the identity+personality+mood prompt (**untouched**
by Phase 3, per the spec's explicit restriction), then appends
`memoryRetriever.buildContextBlock(latestQuestion)` if there's anything
relevant, producing the requested pipeline order:

```
BASE IDENTITY → PERSONALITY → MOOD → RELEVANT MEMORIES → RELEVANT LORE → conversation history → USER MESSAGE
```

`getMessages()` is now `async` (retrieval hits SQLite); its one caller,
`interactions/responder.js`, already runs inside an async job, so this only
required adding `await`.

### Player identity linking

`/wren link minecraft_username:<name>` is self-service — any player can link
their own Discord account, no admin gate (Security only restricts
*adding/editing/removing* memories and lore, not linking). It upserts the
`users` table by `discord_id` via `playerManager.linkPlayer()`. Memories can
also be added about a player who hasn't linked yet —
`memoryManager.addMemory()` calls `playerManager.ensureUser()`, which lazily
creates a bare user row, so admin memory-keeping is never blocked on a
player having run `/wren link` first.

### Admin UI

`/wren memory` and `/wren lore` (both admin-gated via `permissionManager`,
same as `/wren control`) open panels in `src/control/memoryPanel.js` and
`src/control/lorePanel.js` — deliberately *not* under `src/memory/` or
`src/lore/`, which stay UI-free per the target architecture (Memory/Lore =
Database+Manager+Retriever/Search; Control = where all Discord UI lives).
Each panel is buttons that open modals: 🧠 Add, 🔎 Search, 📋 View Player
Memories, ✏️ Edit, 🗑 Remove for memory (5 buttons — exactly Discord's
per-row limit); 📖 Add, 🔎 Search, ✏️ Edit, 🗑 Remove for lore. Discord modals
only support text-input fields — no select menus, no user pickers — so
"which player" is captured as free text (`@mention` or a raw Discord ID) and
parsed by `playerManager.parseDiscordId()`; Discord's client still
autocompletes `@name` into a literal `<@id>` mention even inside a modal
text field, so admins don't need to memorize IDs in practice.

`/wren control`'s main panel also shows live Memories/Lore Entries/Linked
Players counts, which made `buildControlPanel()` `async` (three SQLite count
queries) — every internal caller was updated to `await` it.

## Supporting managers

- **cooldownManager** — per-user timestamp map; gates how often one person can
  trigger a generation. Shared across all three interaction methods.
- **queueManager** — FIFO queue with a single in-flight worker, so concurrent
  requests don't trigger overlapping Ollama calls. `enqueue()` now returns a
  `Promise` that resolves with the job's result (previously fire-and-forget),
  so `responder.js` can await the generated reply and hand it back to
  whichever handler is waiting, uniformly.

## Configuration

`config/configManager.js` loads `config.json` (behavior: channel, AI
parameters, cooldown, queue, memory limits, interaction prefix, admin list)
and `.env` (secrets/deployment: Discord token, client ID, optional guild ID)
once at startup, validates required fields, and exposes a single typed object
the rest of the app imports. It also exposes `updateSettings()`, the only
sanctioned way to mutate and persist config at runtime — used exclusively by
`settingsManager.js` so all writes go through one validated path.

## Logging

`utils/logger.js` is a Winston logger with three transports: console
(colorized, human-readable), `logs/error.log` (errors only), and
`logs/combined.log` (everything). Every layer logs through this one
instance — **except** administrative actions, which go through
`src/audit/auditLog.js` to `logs/audit.log` instead (see Audit system
above). The split is deliberate: `logs/combined.log` answers "what did the
app do," `logs/audit.log` answers "who changed Wren's configuration or
knowledge, and when" — different questions, different audiences, different
retention needs.

## Future expansion

> Note: the roadmap has been renumbered twice — Phase 2 became the Identity
> System (pushing memory/lore/WhisperOS to 3/4/5), then Phase 3 ("Memory &
> Knowledge System") absorbed what were separately planned memory and lore
> phases, moving WhisperOS to Phase 4. Between Phase 3 and Phase 4 came an
> unnumbered **stabilization sprint** (single-instance protection, the audit
> system, memory/lore refinement, Discord API cleanup) — deliberately not
> given a phase number, since it strengthened the existing foundation rather
> than adding a new capability. Check `docs/CHANGELOG.md` for the full trail.

- **Phase 4** — WhisperOS integration: Wren acting as WhisperOS's
  conversational interface via APIs/services (separate products, not a
  merged subsystem — see `AI/context/DECISIONS.md`), multiple model
  backends behind `ollamaService`'s interface, and tool-calling abilities.
- **Observations** (explicitly deferred by this sprint, architecture only
  prepared — see "Canonical vs. observation memories" above) — Wren
  autonomously noticing things from conversation and recording them as
  low-trust observations, distinct from admin-authored canonical knowledge;
  retrieval weighting canonical above observation once both exist.
- **Beyond the memory & lore system generally** — Minecraft API integration
  (linked usernames are stored and ready, but nothing reads them yet);
  player reputation / relationship levels; retrieval upgrading from keyword
  matching to embeddings/semantic search if keyword matching proves too
  literal at scale; Wren greeting a returning player using their own
  memories unprompted ("Welcome back Brandon...") rather than only
  responding to explicit keyword matches.
- **Beyond the identity system** — mood that shifts on its own based on
  context rather than only by admin hand; per-personality response-length or
  temperature tuning; an awareness system (Wren choosing when to speak
  without being summoned).
- **Beyond this stabilization sprint** — the audit system currently has one
  subscriber (the file writer); a Discord audit-log channel poster is the
  natural next consumer, and needs zero changes to any emitting subsystem to
  add. `data/wren.lock`'s PID-liveness approach is appropriate at
  single-server scale; a multi-host deployment would need a different
  mechanism (e.g. a database advisory lock) — not a concern at Wren's
  current scale, but worth knowing the assumption if that ever changes.
