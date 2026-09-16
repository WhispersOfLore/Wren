#!/usr/bin/env bash
# Wren systemd service entrypoint (Phase 17, Part O).
#
# Mirrors the mise-PATH fix already proven necessary for
# WhisperCommandCenter's scheduled reports (see that repo's
# scripts/evening-report.sh): a systemd --user service's PATH may not yet
# include the mise shims directory, especially for an early-boot
# Persistent=true catch-up -- this makes the script self-sufficient
# regardless of when/how it's invoked.
#
# No secrets are read, printed, or passed here. Wren's own
# configManager.js loads DISCORD_TOKEN (and other config) from .env via
# dotenv at process startup -- this script never touches that file.
set -uo pipefail

export PATH="$HOME/.local/share/mise/shims:$PATH"

cd "$(dirname "$0")/.." || exit 1

exec node src/bot.js
