# Wren

Wren is a local, AI-powered Discord companion for WhisperSMP. She is not
WhisperBot — WhisperBot handles utility, automation, Minecraft systems,
economy, and casino. Wren exists purely for conversation, companionship, and
entertainment, with sweet tea in one hand and sharp wit in the other.

She runs entirely on local infrastructure: no paid APIs, no OpenAI, no cloud
AI. Message generation happens through [Ollama](https://ollama.com) running
`llama3.1:8b` on your own machine. See [`docs/PERSONALITY.md`](docs/PERSONALITY.md)
for who she is, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how
the pieces fit together.

## Requirements

- Node.js 18+
- [Ollama](https://ollama.com) installed and running locally
- The `llama3.1:8b` model pulled (`ollama pull llama3.1:8b`)
- A Discord bot application and token

## Installation

```bash
npm install
```

## Discord setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and create a new application, then add a Bot user to it.
2. Under **Bot**, enable the **Message Content Intent** and **Server Members
   Intent** (Privileged Gateway Intents).
3. Copy the bot token.
4. Invite the bot to your server with at least `Send Messages`,
   `Read Message History`, and `View Channel` permissions:
   `https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=68608&scope=bot`
5. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and
   `DISCORD_CLIENT_ID`. Also set `DISCORD_GUILD_ID` (your server's ID) —
   without it, slash commands register globally and can take up to an hour
   to appear; with it, they register instantly to your server.
6. Copy the ID of the channel Wren should listen in (enable Developer Mode
   in Discord, right-click the channel → Copy Channel ID) and set it as
   `discord.channelId` in `config.json`.

## Ollama setup

```bash
# Install Ollama: https://ollama.com/download
ollama pull llama3.1:8b

# Ollama should be reachable at http://localhost:11434 (the default).
# Verify it's up:
ollama list
```

If your Ollama instance runs elsewhere, update `ai.baseUrl` in `config.json`.

## Configuration

All behavior lives in `config.json` — nothing is hardcoded:

| Key | Description |
|---|---|
| `discord.channelId` | The only channel Wren listens in |
| `discord.typingIndicator` | Show a typing indicator while generating |
| `ai.model` | Ollama model to use |
| `ai.temperature`, `ai.topP`, `ai.maxTokens` | Generation parameters |
| `ai.timeoutMs` | Request timeout to Ollama |
| `cooldown.enabled`, `cooldown.seconds` | Per-user cooldown between replies |
| `queue.enabled`, `queue.maxSize` | Generation queue and overflow limit |
| `memory.maxMessages` | How many recent messages Wren remembers per channel |
| `interaction.prefix` | The prefix command that summons her (default `!wren`) |
| `control.admins` | Discord user IDs allowed to open `/wren control` regardless of role |
| `control.requireAdministratorPermission` | Whether server Administrators can also open the control panel (default `true`) |
| `memoryRetrieval.maxMemories`, `memoryRetrieval.maxLore` | Max memory/lore entries injected into a single AI request (default 5 and 3) |

`interaction.prefix` and `cooldown.seconds` can also be changed live from the
`/wren control` panel's Settings button — changes there are written back to
`config.json` automatically.

Secrets and deployment details (Discord token, client ID, guild ID) live in
`.env`, never in `config.json`.

## Running

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

On startup, Wren logs in to Discord and registers her slash commands — you
should see her come online in your server within a few seconds.

## Talking to Wren

Wren doesn't reply to every message — she waits to be summoned, in the
configured channel, one of three ways:

- **Mention:** `@Wren how do I start playing?`
- **Prefix command:** `!wren tell me about the server` (prefix is
  configurable, see `interaction.prefix` above)
- **Slash command:** `/wren ask message: How do I claim land?`

All three share the same conversation memory, cooldown, and generation
queue — switching between them mid-conversation doesn't lose context.

## Admin controls

Server admins (or anyone listed in `control.admins`) can open Wren's control
panel with `/wren control`. It shows her current status, personality, mood,
AI model, interaction mode, prefix, and cooldown, with buttons to:

- **Enable Wren** / **Disable Wren** — while disabled, she stays connected
  but responds to every summon with an in-character "sleeping" message
  instead of generating a reply. This state persists across restarts.
- **🎭 Personality** — opens a sub-panel to change her active personality
  profile (one button per profile, current one highlighted and disabled) and
  her current mood (a select menu). Both persist across restarts and take
  effect on her very next reply — no restart needed. See
  [`docs/PERSONALITY.md`](docs/PERSONALITY.md) for what each profile sounds
  like.
- **Settings** — opens a modal to change her cooldown and prefix without
  editing `config.json` by hand.
- **Close** — dismisses the panel.

### Personality profiles

Wren ships with four personalities (`src/personality/profiles/*.json`):
Sweet (default), Sassy, Guardian, and Lorekeeper. Adding a new one is just
dropping a new JSON file in that folder — no code changes needed, and it
shows up as a button in the control panel automatically (up to 5 profiles;
Discord caps a button row at 5).

Discord's API doesn't allow a command to mix a plain option with
subcommands, so the control panel lives at `/wren control` while talking to
her directly is `/wren ask` rather than a bare `/wren message:...` — a small,
deliberate deviation from a literal reading of the spec, made for API
correctness.

## Memory & lore

Wren has permanent memory, backed by SQLite (`data/wren.db`) — not chat
history, but the kind of thing worth actually remembering: who someone is,
what they've done, what's true about the Whisper universe. When a player
asks something that touches on a memory or a piece of lore, it's woven
naturally into her answer; unrelated conversations never see it.

**Linking your account** — any player can run `/wren link
minecraft_username:<name>` to connect their Discord account to their
Minecraft username. Self-service, no admin needed. Future systems (a
Minecraft-side integration, player recognition) will build on this — nothing
reads it yet.

**`/wren memory`** (admin only) manages what Wren remembers about players:

- **🧠 Add Memory** — a modal asking for the player (`@mention` or Discord
  ID — Discord's client autocompletes `@name` into a mention even inside a
  modal, so you don't need to know anyone's raw ID), the memory itself,
  importance (1–5, 5 = legendary), and category.
- **🔎 Search Memory** — keyword search across all memories.
- **📋 View Player Memories** — every memory recorded about one player.
- **✏️ Edit Memory** — update a memory by ID (found via Search or View).
  Leave a field blank to keep its current value — Discord can't show a
  pre-filled modal, so this isn't "click to edit" so much as "ID plus
  whatever's changing."
- **🗑 Remove Memory** — delete by ID.

**`/wren lore`** (admin only) manages Wren's knowledge of the Whisper
universe the same way — **📖 Add Lore** (category, title, information),
**🔎 Search Lore**, **✏️ Edit Lore** (by ID, same partial-update pattern as
memory), **🗑 Remove Lore**.

Normal players can't add, edit, or remove memories or lore — only benefit
from what admins have taught her. Every add/edit/remove is recorded in
`logs/audit.log` with who did it and when — see Administration below.

## Administration & reliability

**Audit log** — every administrative action (enable/disable, personality
change, mood change, cooldown/prefix change, memory/lore add/edit/remove)
is recorded as structured JSON in `logs/audit.log`, separate from the
general `logs/combined.log`. Each entry has `action`, `actor` (Discord user
ID), `target`, and `details`. This is the one place to check "who changed
X and when."

**Single-instance protection** — Wren refuses to run two copies against the
same Discord token at once (running both causes duplicate replies and
interaction errors). This is enforced automatically via a PID lock at
`data/wren.lock` — you don't need to do anything differently, but if you
ever see her refuse to start, see Troubleshooting below.

## Troubleshooting

**Bot doesn't come online**
Check `DISCORD_TOKEN` in `.env` is correct and that the bot was invited to
your server.

**"Missing required environment variable: DISCORD_TOKEN"**
`.env` is missing or the token wasn't set. Copy `.env.example` to `.env` and
fill it in.

**"config.json: discord.channelId must be set..."**
Set `discord.channelId` in `config.json` to the channel ID Wren should
listen in.

**Wren doesn't respond**
She only listens in the channel configured as `discord.channelId`, and only
when summoned — a plain message with no mention, prefix, or slash command
gets no reply, by design. Confirm the channel ID matches, that
`MessageContent` intent is enabled in the Developer Portal, and that she
isn't disabled (`/wren control` shows her status).

**Wren replies with the "sleep mode" message**
An admin disabled her via `/wren control`. Reopen the panel and click
**Enable Wren**.

**Slash commands (`/wren`) don't show up**
If `DISCORD_GUILD_ID` isn't set in `.env`, commands register globally and can
take up to an hour to appear. Set it to your server's ID for instant
registration (see Discord setup above), then restart.

**"This isn't for you, sugar. Admins only."**
You tried `/wren control`, `/wren memory`, or `/wren lore` without
permission. Either have server Administrator permission, or ask an admin to
add your Discord user ID to `control.admins` in `config.json`.

**"I couldn't tell who that player is, sugar."**
The Player field in an Add/View Memory modal didn't parse. Use an `@mention`
(let Discord's autocomplete suggest the user as you type) or paste their raw
numeric Discord ID.

**Wren doesn't seem to know something an admin added**
Retrieval only surfaces memories/lore that share keywords with the question
— it won't inject something just because it's important. Try asking with
words that actually appear in the memory/lore content, or check
`memoryRetrieval.maxMemories`/`maxLore` in `config.json` haven't been set to
0.

**"Ollama isn't answering" / connection refused**
Ollama isn't running, or isn't reachable at `ai.baseUrl` in `config.json`.
Run `ollama serve` (or check it's already running) and `ollama list` to
confirm `llama3.1:8b` is present (or whatever `config.json`'s `ai.model` is set to).

**"Wren is already running (PID ...). Refusing to start a second instance."**
Working as intended — Wren refuses to run two copies against the same
Discord token (running both causes duplicate replies and "Unknown
interaction" errors, since Discord delivers every event to both and only
one can win the race to respond). If that PID really isn't Wren anymore
(e.g. the machine lost power mid-run), delete `data/wren.lock` and start
again — though this should self-heal automatically on the next start even
without deleting it, since the lock checks whether that PID is actually
alive.

**Responses are slow**
Local generation speed depends on your hardware. On a GTX 1660 Super,
expect noticeable latency versus cloud APIs — this is expected for local
inference.

**Logs**
Check `logs/combined.log` for everything and `logs/error.log` for errors
only.

## Roadmap

- **Phase 4** — WhisperOS integration, multiple AI models, tool abilities.

See [`docs/CHANGELOG.md`](docs/CHANGELOG.md) for what's shipped so far, and
`docs/ARCHITECTURE.md`'s Future Expansion section for the full renumbering
history and everything Phase 3 explicitly deferred (automatic memory
creation, Minecraft integration, player reputation, and more).
