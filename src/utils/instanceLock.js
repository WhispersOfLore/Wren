const fs = require('node:fs');
const path = require('node:path');

const LOCK_DIR = path.join(__dirname, '..', '..', 'data');
const LOCK_PATH = path.join(LOCK_DIR, 'wren.lock');

let held = false;

/**
 * Returns true if a process with this PID is actually alive. Signal 0 sends
 * no real signal — it's the standard POSIX idiom for a liveness check — and
 * throws ESRCH if the process doesn't exist, EPERM if it exists but is
 * owned by another user (still "alive" for our purposes).
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Enforces that only one Wren process runs at a time. Two instances
 * connecting to the same Discord token both receive every gateway event,
 * race to acknowledge interactions, and double-reply to messages — this is
 * what a PID lock in data/wren.lock exists to prevent.
 *
 * Recovers automatically from unclean shutdowns: a lock file left behind by
 * a crashed/killed process points at a PID that is no longer running, which
 * this detects and treats as stale rather than a real conflict.
 *
 * Exits the process with a clear message if another instance is genuinely
 * still running. Call release() on graceful shutdown.
 */
function acquire() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });

  if (fs.existsSync(LOCK_PATH)) {
    const existingPid = Number.parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10);

    if (Number.isInteger(existingPid) && isProcessAlive(existingPid)) {
      // eslint-disable-next-line no-console
      console.error(
        `Wren is already running (PID ${existingPid}). Refusing to start a second instance — ` +
          'running two copies against the same Discord token causes duplicate replies and ' +
          `interaction errors. If that process is actually gone, remove ${LOCK_PATH} and try again.`,
      );
      process.exit(1);
    }
    // Stale lock — the recorded PID is no longer alive. Fall through and overwrite it.
  }

  fs.writeFileSync(LOCK_PATH, String(process.pid));
  held = true;
}

function release() {
  if (!held) return;
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch (err) {
    // Already gone or unwritable — nothing more we can do.
  }
  held = false;
}

module.exports = { acquire, release, LOCK_PATH };
