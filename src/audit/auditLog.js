const EventEmitter = require('node:events');
const path = require('node:path');
const winston = require('winston');

const AUDIT_LOG_PATH = path.join(__dirname, '..', '..', 'logs', 'audit.log');

const fileLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: AUDIT_LOG_PATH })],
});

/**
 * Publish/subscribe audit trail for administrative actions — enable/disable,
 * personality/mood changes, memory/lore add/edit/remove, settings changes.
 *
 * Administrative subsystems call `record()` instead of logging directly.
 * This is the one place that decides how an audit event is persisted
 * (currently: structured JSON appended to logs/audit.log) and the one place
 * future consumers subscribe from — e.g. a Discord audit channel poster can
 * later do `auditLog.on('audit', postToChannel)` at startup, with zero
 * changes required to any of the systems that call record().
 */
class AuditLog extends EventEmitter {
  /**
   * @param {{ action: string, actor: string, target?: string|null, details?: object }} event
   * @returns {{ timestamp: string, action: string, actor: string, target: string|null, details: object }}
   */
  record({ action, actor, target = null, details = {} }) {
    const event = {
      timestamp: new Date().toISOString(),
      action,
      actor,
      target,
      details,
    };

    fileLogger.info(event);
    this.emit('audit', event);

    return event;
  }
}

module.exports = new AuditLog();
