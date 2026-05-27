import type { SyncResult } from '../bookmark-service.js';
import { createLogger, type StructuredLogger } from '../logger.js';

export interface SyncNextRun {
  nextRunAt: string | null;
  intervalMinutes: number;
  updatedAt: string;
}

interface AutoSyncSchedulerOptions {
  intervalMinutes: number;
  syncNow: () => Promise<SyncResult | void>;
  onNextRun?: (state: SyncNextRun) => void;
  logger?: StructuredLogger;
  now?: () => Date;
}

const logger = createLogger('auto-sync');
const MIN_INTERVAL_MINUTES = 1;

export class AutoSyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private intervalMinutes: number;
  private readonly syncNow: () => Promise<SyncResult | void>;
  private readonly onNextRun?: (state: SyncNextRun) => void;
  private readonly logger: StructuredLogger;
  private readonly now: () => Date;

  constructor(options: AutoSyncSchedulerOptions) {
    this.intervalMinutes = normalizeInterval(options.intervalMinutes);
    this.syncNow = options.syncNow;
    this.onNextRun = options.onNextRun;
    this.logger = options.logger ?? logger;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    this.stop(false);

    if (this.intervalMinutes < MIN_INTERVAL_MINUTES) {
      this.emitNextRun(null);
      return;
    }

    const intervalMs = this.intervalMinutes * 60 * 1000;
    this.emitNextRun(new Date(this.now().getTime() + intervalMs));
    this.timer = setInterval(() => {
      this.emitNextRun(new Date(this.now().getTime() + intervalMs));
      void this.runSync();
    }, intervalMs);
  }

  updateInterval(intervalMinutes: number): void {
    this.intervalMinutes = normalizeInterval(intervalMinutes);
    this.start();
  }

  stop(emitStopped = true): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (emitStopped) {
      this.emitNextRun(null);
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  private async runSync(): Promise<void> {
    try {
      const result = await this.syncNow();
      this.logger.info('Automatic sync completed', { result });
    } catch (error) {
      this.logger.error('Automatic sync failed', { error });
    }
  }

  private emitNextRun(nextRunAt: Date | null): void {
    this.onNextRun?.({
      nextRunAt: nextRunAt?.toISOString() ?? null,
      intervalMinutes: this.intervalMinutes,
      updatedAt: this.now().toISOString(),
    });
  }
}

function normalizeInterval(intervalMinutes: number): number {
  if (!Number.isFinite(intervalMinutes)) {
    return MIN_INTERVAL_MINUTES;
  }

  return Math.max(MIN_INTERVAL_MINUTES, Math.trunc(intervalMinutes));
}
