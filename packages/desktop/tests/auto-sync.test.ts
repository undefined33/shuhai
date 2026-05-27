import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoSyncScheduler, type SyncNextRun } from '../src/main/sync/index.js';

describe('AutoSyncScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits the next run time and triggers sync on the configured interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T12:00:00.000Z'));
    const syncNow = vi.fn().mockResolvedValue({ added: 1, updated: 0, removed: 0, total: 1 });
    const states: SyncNextRun[] = [];

    const scheduler = new AutoSyncScheduler({
      intervalMinutes: 15,
      syncNow,
      onNextRun: (state) => states.push(state),
      logger: makeLogger(),
    });

    scheduler.start();
    expect(states[0]).toMatchObject({
      nextRunAt: '2024-02-01T12:15:00.000Z',
      intervalMinutes: 15,
    });

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({
      nextRunAt: '2024-02-01T12:30:00.000Z',
      intervalMinutes: 15,
    });

    scheduler.stop();
    expect(states.at(-1)).toMatchObject({ nextRunAt: null });
  });

  it('restarts when the interval changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T12:00:00.000Z'));
    const states: SyncNextRun[] = [];
    const scheduler = new AutoSyncScheduler({
      intervalMinutes: 60,
      syncNow: vi.fn(),
      onNextRun: (state) => states.push(state),
      logger: makeLogger(),
    });

    scheduler.start();
    scheduler.updateInterval(30);

    expect(scheduler.isRunning()).toBe(true);
    expect(states.at(-1)).toMatchObject({
      nextRunAt: '2024-02-01T12:30:00.000Z',
      intervalMinutes: 30,
    });
  });
});

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
