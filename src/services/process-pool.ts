import { logger } from './logger.js';

/**
 * Promise-based semaphore with FIFO queue for limiting concurrent CLI processes.
 */
export class ProcessPool {
  private active = 0;
  private queue: Array<{ resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

  constructor(private maxConcurrent: number, private queueTimeoutMs: number) {}

  /**
   * Acquire a process slot. Resolves immediately if a slot is available,
   * otherwise queues the request with a timeout.
   */
  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      logger.debug({ active: this.active, queued: this.queue.length }, 'pool.acquire');
      return;
    }

    logger.debug({ active: this.active, queued: this.queue.length + 1 }, 'pool.acquire.queued');

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(item => item.resolve === resolve);
        if (idx >= 0) this.queue.splice(idx, 1);
        logger.warn({ active: this.active, queued: this.queue.length, timeoutMs: this.queueTimeoutMs }, 'pool.queue.timeout');
        reject(new Error(`Queue timeout: waited ${this.queueTimeoutMs}ms for available process slot`));
      }, this.queueTimeoutMs);

      this.queue.push({ resolve, reject, timer });
    });
  }

  /**
   * Release a process slot. If requests are queued, the next one (FIFO) is
   * resolved immediately without decrementing the active count.
   */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      clearTimeout(next.timer);
      next.resolve();
      logger.debug({ active: this.active, queued: this.queue.length }, 'pool.release.dequeued');
    } else {
      this.active = Math.max(0, this.active - 1);
      logger.debug({ active: this.active, queued: this.queue.length }, 'pool.release');
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queueLength(): number {
    return this.queue.length;
  }
}
