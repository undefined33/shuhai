import { describe, expect, it } from 'vitest';

import {
  X_SYNC_LAUNCH_INTENT_KEY,
  XSyncLaunchIntentError,
  XSyncLaunchIntentStore,
  type XSyncSessionStoragePort,
} from '../src/social/x-sync-launch-intent.js';
import {
  X_SYNC_LAUNCH_INTENT_TTL_MS,
  X_SYNC_PROTOCOL,
  type XSyncLaunchIntent,
} from '../src/social/x-sync-messages.js';

const nonce = 'a'.repeat(64);

class MemorySessionStorage implements XSyncSessionStoragePort {
  value: unknown;
  getCount = 0;
  setCount = 0;
  removeCount = 0;

  async get(): Promise<unknown> {
    this.getCount += 1;
    return this.value;
  }

  async set(_key: typeof X_SYNC_LAUNCH_INTENT_KEY, value: XSyncLaunchIntent): Promise<void> {
    this.setCount += 1;
    this.value = value;
  }

  async remove(): Promise<void> {
    this.removeCount += 1;
    this.value = undefined;
  }
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    protocol: X_SYNC_PROTOCOL,
    action: 'start',
    windowId: 7,
    createdAtMs: 1_000,
    expiresAtMs: 1_000 + X_SYNC_LAUNCH_INTENT_TTL_MS,
    nonce,
    ...overrides,
  };
}

function codeOf(result: Promise<unknown>): Promise<string | undefined> {
  return result.then(
    () => undefined,
    (error: unknown) => (error instanceof XSyncLaunchIntentError ? error.code : undefined),
  );
}

describe('X sync one-shot launch intent', () => {
  it('creates a fixed-key 60-second intent with only bounded launch metadata', async () => {
    const storage = new MemorySessionStorage();
    const store = new XSyncLaunchIntentStore(storage, {
      now: () => 1_000,
      randomNonce: () => nonce,
    });

    const created = await store.create({
      serverValidatedWindowId: 7,
    });

    expect(created).toEqual(intent());
    expect(storage.setCount).toBe(1);
    expect(new TextEncoder().encode(JSON.stringify(created)).byteLength).toBeLessThanOrEqual(1_024);
    expect(Object.keys(created).sort()).toEqual([
      'action',
      'createdAtMs',
      'expiresAtMs',
      'nonce',
      'protocol',
      'windowId',
    ]);
    expect(JSON.stringify(created)).not.toContain('url');
    expect(JSON.stringify(created)).not.toContain('tabId');
    expect(JSON.stringify(created)).not.toContain('vault');
  });

  it('atomically consumes once and rejects a duplicate or concurrent consumer', async () => {
    const storage = new MemorySessionStorage();
    storage.value = intent();
    const store = new XSyncLaunchIntentStore(storage, { now: () => 2_000 });
    const validate = async () => ({ ok: true }) as const;

    const results = await Promise.allSettled([
      store.consume(nonce, validate),
      store.consume(nonce, validate),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: 'missing' });
    expect(storage.removeCount).toBe(1);
    expect(await codeOf(store.consume(nonce, validate))).toBe('missing');
  });

  it('deletes expired, corrupt, or accessor-backed intents without burning a newer nonce', async () => {
    const validation = async () => ({ ok: true }) as const;

    const expiredStorage = new MemorySessionStorage();
    expiredStorage.value = intent();
    const expiredStore = new XSyncLaunchIntentStore(expiredStorage, { now: () => 61_000 });
    expect(await codeOf(expiredStore.consume(nonce, validation))).toBe('expired');
    expect(expiredStorage.value).toBeUndefined();

    const mismatchStorage = new MemorySessionStorage();
    mismatchStorage.value = intent();
    const mismatchStore = new XSyncLaunchIntentStore(mismatchStorage, { now: () => 2_000 });
    expect(await codeOf(mismatchStore.consume('b'.repeat(64), validation))).toBe('nonce_mismatch');
    expect(mismatchStorage.value).toEqual(intent());
    expect(mismatchStorage.removeCount).toBe(0);

    const corruptStorage = new MemorySessionStorage();
    corruptStorage.value = { ...intent(), unknown: true };
    const corruptStore = new XSyncLaunchIntentStore(corruptStorage, { now: () => 2_000 });
    expect(await codeOf(corruptStore.consume(nonce, validation))).toBe('storage_corrupt');
    expect(corruptStorage.value).toBeUndefined();

    let getterCalled = false;
    const hostile = intent() as Record<string, unknown>;
    Object.defineProperty(hostile, 'nonce', {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return nonce;
      },
    });
    const hostileStorage = new MemorySessionStorage();
    hostileStorage.value = hostile;
    const hostileStore = new XSyncLaunchIntentStore(hostileStorage, { now: () => 2_000 });
    expect(await codeOf(hostileStore.consume(nonce, validation))).toBe('storage_corrupt');
    expect(getterCalled).toBe(false);
  });

  it('does not let a stale Side Panel nonce delete a newer Popup intent', async () => {
    const storage = new MemorySessionStorage();
    const nonces = [nonce, 'b'.repeat(64)];
    const store = new XSyncLaunchIntentStore(storage, {
      now: () => 2_000,
      randomNonce: () => nonces.shift() ?? 'c'.repeat(64),
    });
    const older = await store.create({ serverValidatedWindowId: 7 });
    const newer = await store.create({ serverValidatedWindowId: 8 });

    expect(await codeOf(store.consume(older.nonce, async () => ({ ok: true })))).toBe(
      'nonce_mismatch',
    );
    expect(storage.value).toEqual(newer);
    expect(storage.removeCount).toBe(0);
    await expect(
      store.consume(newer.nonce, async (windowId) => {
        expect(windowId).toBe(8);
        return { ok: true } as const;
      }),
    ).resolves.toEqual(newer);
    expect(storage.removeCount).toBe(1);
  });

  it('burns the intent when the server-revalidated window disappears or active tab changes', async () => {
    for (const code of ['window_missing', 'tab_changed'] as const) {
      const storage = new MemorySessionStorage();
      storage.value = intent();
      const store = new XSyncLaunchIntentStore(storage, { now: () => 2_000 });
      const result = store.consume(nonce, async (windowId) => {
        expect(windowId).toBe(7);
        return { ok: false, code } as const;
      });
      expect(await codeOf(result)).toBe(code);
      expect(storage.value).toBeUndefined();
      expect(storage.removeCount).toBe(1);
    }
  });

  it('survives a service-worker object reload but remains one-shot', async () => {
    const storage = new MemorySessionStorage();
    const beforeReload = new XSyncLaunchIntentStore(storage, {
      now: () => 1_000,
      randomNonce: () => nonce,
    });
    await beforeReload.create({ serverValidatedWindowId: 9 });

    const afterReload = new XSyncLaunchIntentStore(storage, { now: () => 2_000 });
    const consumed = await afterReload.consume(nonce, async (windowId) => {
      expect(windowId).toBe(9);
      return { ok: true } as const;
    });
    expect(consumed.windowId).toBe(9);
    expect(await codeOf(afterReload.consume(nonce, async () => ({ ok: true })))).toBe('missing');
  });

  it('returns fixed errors without copying storage or validator exception text', async () => {
    const secret = 'private-x-url-and-token';
    const storage = new MemorySessionStorage();
    storage.value = intent();
    const store = new XSyncLaunchIntentStore(storage, { now: () => 2_000 });
    const code = await codeOf(
      store.consume(nonce, async () => {
        throw new Error(secret);
      }),
    );
    expect(code).toBe('validation_failed');

    storage.value = intent();
    let thrown: unknown;
    try {
      await store.consume(nonce, async () => {
        throw new Error(secret);
      });
    } catch (error) {
      thrown = error;
    }
    expect(JSON.stringify(thrown)).not.toContain(secret);
    expect((thrown as Error).message).toBe('The X sync launch context could not be validated');
  });
});
