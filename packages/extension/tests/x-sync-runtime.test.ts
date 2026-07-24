import { describe, expect, it, vi } from 'vitest';

import {
  X_SYNC_MIN_SCROLL_INTERVAL_MS,
  X_SYNC_PROBE_MAX_SCROLL_ACTIONS,
  XSyncRuntime,
  type XSyncInvocationLease,
  type XSyncRuntimeOptions,
} from '../src/social/x-sync-runtime.js';

function tokenFactory(): () => string {
  let value = 0;
  return () => `${'a'.repeat(60)}${String(value++).padStart(4, '0')}`;
}

function start(
  runtime: XSyncRuntime,
  overrides: Partial<Parameters<XSyncRuntime['beginInvocation']>[0]> = {},
): XSyncInvocationLease {
  const result = runtime.beginInvocation({
    jobId: 'x-job-1',
    scanRevision: 1,
    tabId: 41,
    windowId: 7,
    documentId: 'document-1',
    mode: 'incremental',
    ...overrides,
  });
  if (result.kind !== 'started') {
    throw new Error(`Expected a started invocation, got ${result.kind}`);
  }
  return result.lease;
}

function runtime(options: XSyncRuntimeOptions = {}): XSyncRuntime {
  return new XSyncRuntime({ randomToken: tokenFactory(), ...options });
}

describe('X sync runtime guard', () => {
  it('allows only one active X job, tab, document, and invocation globally', () => {
    const guard = runtime({ now: () => 1_000 });
    const first = start(guard);
    const second = guard.beginInvocation({
      jobId: 'x-job-2',
      scanRevision: 1,
      tabId: 99,
      windowId: 8,
      documentId: 'document-2',
      mode: 'backfill',
    });

    expect(second).toEqual({
      kind: 'conflict',
      conflict: {
        code: 'source_busy',
        activeJobId: 'x-job-1',
        activeScanRevision: 1,
      },
    });
    expect(guard.snapshot()).toMatchObject({
      status: 'active',
      jobId: 'x-job-1',
      outstandingRequest: false,
    });
    expect(guard.finishInvocation(first)).toMatchObject({ kind: 'finished', scrollActions: 0 });
    expect(
      guard.beginInvocation({
        jobId: 'x-job-2',
        scanRevision: 1,
        tabId: 99,
        windowId: 8,
        documentId: 'document-2',
        mode: 'backfill',
      }).kind,
    ).toBe('started');
  });

  it('permits at most one outstanding content request and rejects a cloned lease', async () => {
    const guard = runtime({ now: () => 1_000 });
    const lease = start(guard);
    let resolveFirst: ((value: { kind: 'response'; value: string }) => void) | undefined;
    const first = guard.executeContentRequest(
      lease,
      { kind: 'batch', performsScroll: false },
      () =>
        new Promise<{ kind: 'response'; value: string }>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await Promise.resolve();

    expect(guard.snapshot().outstandingRequest).toBe(true);
    expect(
      await guard.executeContentRequest(
        lease,
        { kind: 'ping', performsScroll: false },
        async () => ({ kind: 'response', value: 'second' }),
      ),
    ).toMatchObject({ kind: 'conflict', conflict: { code: 'request_in_flight' } });
    expect(
      await guard.executeContentRequest(
        { ...lease },
        { kind: 'ping', performsScroll: false },
        async () => ({ kind: 'response', value: 'forged' }),
      ),
    ).toEqual({ kind: 'conflict', conflict: { code: 'stale_invocation' } });

    resolveFirst?.({ kind: 'response', value: 'first' });
    await expect(first).resolves.toEqual({ kind: 'completed', value: 'first' });
    expect(guard.snapshot().outstandingRequest).toBe(false);
  });

  it('waits at least 2 seconds after a scroll completes before the next batch request', async () => {
    let now = 10_000;
    const waits: number[] = [];
    const operationTimes: number[] = [];
    const guard = runtime({
      now: () => now,
      sleep: async (milliseconds, signal) => {
        expect(signal.aborted).toBe(false);
        waits.push(milliseconds);
        now += milliseconds;
      },
    });
    const lease = start(guard);

    await guard.executeContentRequest(lease, { kind: 'batch', performsScroll: true }, async () => {
      operationTimes.push(now);
      return { kind: 'response', value: 'batch-1' };
    });
    await guard.executeContentRequest(lease, { kind: 'batch', performsScroll: true }, async () => {
      operationTimes.push(now);
      return { kind: 'response', value: 'batch-2' };
    });

    expect(waits).toEqual([X_SYNC_MIN_SCROLL_INTERVAL_MS]);
    expect(operationTimes[1]! - operationTimes[0]!).toBeGreaterThanOrEqual(
      X_SYNC_MIN_SCROLL_INTERVAL_MS,
    );
  });

  it('hard-caps a bounded probe at five scroll actions', async () => {
    let now = 0;
    let calls = 0;
    const guard = runtime({
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });
    const lease = start(guard, { profile: 'bounded_probe', maxScrollActions: 50 });
    expect(lease.maxScrollActions).toBe(X_SYNC_PROBE_MAX_SCROLL_ACTIONS);

    for (let index = 0; index < X_SYNC_PROBE_MAX_SCROLL_ACTIONS; index += 1) {
      const result = await guard.executeContentRequest(
        lease,
        { kind: 'batch', performsScroll: true },
        async () => {
          calls += 1;
          return { kind: 'response', value: index };
        },
      );
      expect(result.kind).toBe('completed');
    }
    const sixth = await guard.executeContentRequest(
      lease,
      { kind: 'batch', performsScroll: true },
      async () => {
        calls += 1;
        return { kind: 'response', value: 6 };
      },
    );
    expect(sixth).toMatchObject({
      kind: 'paused',
      pause: { reason: 'budget_exceeded', code: 'scroll_budget_exceeded' },
    });
    expect(calls).toBe(X_SYNC_PROBE_MAX_SCROLL_ACTIONS);
    expect(guard.snapshot().status).toBe('idle');
  });

  it('keeps the source leased until an outstanding request settles after a user pause', async () => {
    const guard = runtime({ now: () => 1_000 });
    const lease = start(guard);
    let resolveRequest: ((value: { kind: 'response'; value: string }) => void) | undefined;
    const request = guard.executeContentRequest(
      lease,
      { kind: 'batch', performsScroll: false },
      () =>
        new Promise<{ kind: 'response'; value: string }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    await Promise.resolve();

    expect(guard.requestPause(lease)).toMatchObject({
      kind: 'pause-requested',
      pause: { reason: 'user_paused' },
    });
    expect(guard.snapshot()).toMatchObject({ status: 'stopping', outstandingRequest: true });
    expect(
      guard.beginInvocation({
        jobId: 'x-job-2',
        scanRevision: 1,
        tabId: 42,
        windowId: 7,
        documentId: 'document-2',
        mode: 'incremental',
      }),
    ).toMatchObject({ kind: 'conflict', conflict: { code: 'source_busy' } });

    resolveRequest?.({ kind: 'response', value: 'late-response' });
    await expect(request).resolves.toMatchObject({
      kind: 'paused',
      pause: { reason: 'user_paused' },
    });
    expect(guard.snapshot().status).toBe('idle');
    expect(
      guard.beginInvocation({
        jobId: 'x-job-2',
        scanRevision: 1,
        tabId: 42,
        windowId: 7,
        documentId: 'document-2',
        mode: 'incremental',
      }).kind,
    ).toBe('started');
  });

  it('does not retry after a challenge or rate limit', async () => {
    for (const reason of ['login_required', 'rate_limited'] as const) {
      const guard = runtime({ now: () => 1_000 });
      const lease = start(guard);
      const operation = vi.fn(async () => ({ kind: 'pause', reason }) as const);
      expect(
        await guard.executeContentRequest(
          lease,
          { kind: 'batch', performsScroll: false },
          operation,
        ),
      ).toMatchObject({ kind: 'paused', pause: { reason, code: 'content_stop' } });
      expect(operation).toHaveBeenCalledTimes(1);
      expect(
        await guard.executeContentRequest(
          lease,
          { kind: 'batch', performsScroll: false },
          operation,
        ),
      ).toEqual({ kind: 'conflict', conflict: { code: 'stale_invocation' } });
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it('fails closed if the monotonic clock moves backwards between batches', async () => {
    let now = 1_000;
    let calls = 0;
    const guard = runtime({
      now: () => now,
      sleep: async () => undefined,
    });
    const lease = start(guard);
    await guard.executeContentRequest(lease, { kind: 'batch', performsScroll: true }, async () => {
      calls += 1;
      return { kind: 'response', value: 'first' };
    });
    now = 999;
    const second = await guard.executeContentRequest(
      lease,
      { kind: 'batch', performsScroll: true },
      async () => {
        calls += 1;
        return { kind: 'response', value: 'second' };
      },
    );
    expect(second).toMatchObject({
      kind: 'paused',
      pause: { reason: 'structure_changed', code: 'invalid_clock' },
    });
    expect(calls).toBe(1);
  });

  it('does not copy thrown page or transport details into runtime errors', async () => {
    const guard = runtime({ now: () => 1_000 });
    const lease = start(guard);
    const secret = 'https://x.com/private/status/123?authorization=secret';
    const result = await guard.executeContentRequest(
      lease,
      { kind: 'batch', performsScroll: false },
      async () => {
        throw new Error(secret);
      },
    );

    expect(result).toEqual({
      kind: 'paused',
      pause: {
        reason: 'structure_changed',
        code: 'request_failed',
        phase: 'scanning',
        jobId: 'x-job-1',
        scanRevision: 1,
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('x.com');
    expect(JSON.stringify(result)).not.toContain(lease.binding.nonce);
  });
});
