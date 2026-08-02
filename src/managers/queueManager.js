const config = require('../config/configManager');
const logger = require('../utils/logger');

class QueueManager {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  get size() {
    return this.queue.length;
  }

  get isProcessing() {
    return this.processing;
  }

  isFull() {
    return config.queue.enabled && this.queue.length >= config.queue.maxSize;
  }

  /**
   * Adds a job to the queue and kicks off processing if idle.
   * @param {() => Promise<any>} job
   * @returns {Promise<any> | null} resolves with the job's result, or null if the queue was full
   */
  enqueue(job) {
    if (this.isFull()) {
      logger.warn('Queue is full, rejecting new job', { size: this.queue.length });
      return null;
    }

    const resultPromise = new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await job());
        } catch (err) {
          reject(err);
        }
      });
    });

    this._process();
    return resultPromise;
  }

  clear() {
    const dropped = this.queue.length;
    this.queue = [];
    if (dropped > 0) {
      logger.info('Queue cleared', { dropped });
    }
  }

  async _process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      try {
        await job();
      } catch (err) {
        logger.error('Queue job failed', { error: err.message });
      }
    }

    this.processing = false;
  }
}

module.exports = new QueueManager();
