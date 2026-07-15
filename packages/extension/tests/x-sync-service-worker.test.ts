import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { X_SYNC_BOOKMARKS_URL, X_SYNC_PROTOCOL } from '../src/social/x-sync-messages.js';
import { openSyncStore } from '../src/social/sync-store.js';

const EXTENSION_ID = 'a'.repeat(32);
const POPUP_URL = `chrome-extension://${EXTENSION_ID}/popup/index.html`;
const SIDEPANEL_URL = `chrome-extension://${EXTENSION_ID}/sidepanel/index.html`;

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | void;

interface ChromeHarness {
  readonly chrome: typeof chrome;
  readonly session: Record<string, unknown>;
  readonly executeScript: ReturnType<typeof vi.fn>;
  readonly queries: chrome.tabs.QueryInfo[];
  getMessageListener(): MessageListener;
  emitPermissionRemoved(): void;
  setActiveTab(overrides: Partial<chrome.tabs.Tab>): void;
  setPermission(granted: boolean): void;
  setPermissionOrigins(origins: string[]): void;
}

function event<T extends (...args: never[]) => unknown>() {
  return {
    addListener: vi.fn((_listener: T) => undefined),
    removeListener: vi.fn((_listener: T) => undefined),
  };
}

function xBookmarksTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    index: 0,
    pinned: false,
    highlighted: true,
    windowId: 4,
    active: true,
    frozen: false,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    id: 17,
    url: X_SYNC_BOOKMARKS_URL,
    ...overrides,
  };
}

function createChromeHarness(): ChromeHarness {
  let messageListener: MessageListener | undefined;
  let permissionRemovedListener:
    | ((permissions: chrome.permissions.Permissions) => void)
    | undefined;
  let activeTab = xBookmarksTab({ title: 'Fixture bookmarks' });
  let permissionOrigins: string[] = [];
  const session: Record<string, unknown> = {};
  const queries: chrome.tabs.QueryInfo[] = [];
  const executeScript = vi.fn(async () => [
    { frameId: 0, documentId: 'document-fixture', result: undefined },
  ]);
  const runtime = {
    id: EXTENSION_ID,
    lastError: undefined,
    getURL: (path: string) => `chrome-extension://${EXTENSION_ID}${path}`,
    onInstalled: event(),
    onConnect: event(),
    onMessage: {
      addListener: vi.fn((listener: MessageListener) => {
        messageListener = listener;
      }),
      removeListener: vi.fn(),
    },
  };
  const chromeMock = {
    runtime,
    storage: {
      session: {
        get: (key: string, callback: (items: Record<string, unknown>) => void) => {
          callback(
            Object.prototype.hasOwnProperty.call(session, key) ? { [key]: session[key] } : {},
          );
        },
        set: (items: Record<string, unknown>, callback: () => void) => {
          Object.assign(session, items);
          callback();
        },
        remove: (key: string, callback: () => void) => {
          delete session[key];
          callback();
        },
      },
    },
    tabs: {
      query: (query: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        queries.push({ ...query });
        callback([activeTab]);
      },
      get: (_tabId: number, callback: (tab: chrome.tabs.Tab) => void) => {
        callback(activeTab);
      },
      sendMessage: vi.fn(),
      onUpdated: event(),
      onActivated: event(),
      onRemoved: event(),
    },
    scripting: { executeScript },
    permissions: {
      contains: (
        _permissions: chrome.permissions.Permissions,
        callback: (granted: boolean) => void,
      ) => {
        callback(
          permissionOrigins.includes('https://x.com/*') ||
            permissionOrigins.includes('https://*/*'),
        );
      },
      getAll: (callback: (permissions: chrome.permissions.Permissions) => void) => {
        callback({ origins: [...permissionOrigins] });
      },
      onRemoved: {
        addListener: vi.fn((listener: (permissions: chrome.permissions.Permissions) => void) => {
          permissionRemovedListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
    contextMenus: {
      onClicked: event(),
      removeAll: vi.fn(),
      create: vi.fn(),
    },
    sidePanel: {},
  } as unknown as typeof chrome;

  return {
    chrome: chromeMock,
    session,
    executeScript,
    queries,
    emitPermissionRemoved: () => {
      permissionRemovedListener?.({ origins: ['https://x.com/*'] });
    },
    getMessageListener: () => {
      if (!messageListener) {
        throw new Error('service worker message listener was not installed');
      }
      return messageListener;
    },
    setActiveTab: (overrides) => {
      activeTab = xBookmarksTab(overrides);
    },
    setPermission: (granted) => {
      permissionOrigins = granted ? ['https://x.com/*'] : [];
    },
    setPermissionOrigins: (origins) => {
      permissionOrigins = [...origins];
    },
  };
}

function sender(surface: 'popup' | 'sidepanel'): chrome.runtime.MessageSender {
  return {
    id: EXTENSION_ID,
    origin: `chrome-extension://${EXTENSION_ID}`,
    url: surface === 'popup' ? POPUP_URL : SIDEPANEL_URL,
  };
}

function send(
  listener: MessageListener,
  message: unknown,
  messageSender: chrome.runtime.MessageSender,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const keepAlive = listener(message, messageSender, resolve);
    if (keepAlive !== true) {
      reject(new Error('service worker did not keep the async response channel open'));
    }
  });
}

function openNativeSyncDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('shuhai-sync', 3);
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error));
    transaction.addEventListener('error', () => reject(transaction.error));
  });
}

describe('X sync service worker route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  it('fails a malformed X envelope closed instead of falling through to the legacy handler', async () => {
    const harness = createChromeHarness();
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'state:get',
        requestId: 'legacy-looking-x-message',
      },
      sender('popup'),
    );

    expect(response).toMatchObject({
      protocol: X_SYNC_PROTOCOL,
      ok: false,
      error: { code: 'invalid_message' },
    });
  });

  it('lets only Popup mint an intent and binds the Side Panel mode when it is consumed', async () => {
    const harness = createChromeHarness();
    harness.setPermission(true);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');
    const listener = harness.getMessageListener();

    const forbidden = await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'sidepanel-cannot-launch',
      },
      sender('sidepanel'),
    );
    expect(forbidden).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(Object.keys(harness.session)).toHaveLength(0);

    const launched = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'popup-launches-context',
      },
      sender('popup'),
    )) as { result: { nonce: string } };
    const started = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'sidepanel-selects-backfill',
        launchNonce: launched.result.nonce,
        mode: 'backfill',
      },
      sender('sidepanel'),
    )) as { ok: boolean; result?: { jobId: string } };
    expect(started).toMatchObject({ ok: true, result: { kind: 'accepted' } });

    const store = await openSyncStore();
    try {
      await expect(store.getJob(started.result!.jobId)).resolves.toMatchObject({
        scanMode: 'backfill',
      });
    } finally {
      store.close();
    }

    harness.setPermission(false);
    harness.emitPermissionRemoved();
  });

  it('rejects every command when startup recovery cannot open the sync store safely', async () => {
    const factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
    const initialized = await openSyncStore({ indexedDB: factory });
    initialized.close();
    const raw = await openNativeSyncDatabase(factory);
    const transaction = raw.transaction('meta', 'readwrite');
    transaction.objectStore('meta').put({
      key: 'schema',
      schemaVersion: 1,
      databaseVersion: 3,
      validationState: 'failed',
    });
    await transactionDone(transaction);
    raw.close();

    const harness = createChromeHarness();
    harness.setPermission(true);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'storage-corrupt',
      },
      sender('popup'),
    );

    expect(response).toMatchObject({ ok: false, error: { code: 'storage_corrupt' } });
    expect(harness.executeScript).not.toHaveBeenCalled();
  });

  it('rejects every command when startup recovery fails after the store opens', async () => {
    const factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
    const initialized = await openSyncStore({ indexedDB: factory });
    initialized.close();

    const raw = await openNativeSyncDatabase(factory);
    const databasePrototype = Object.getPrototypeOf(raw) as {
      transaction: IDBDatabase['transaction'];
    };
    const originalTransaction = databasePrototype.transaction;
    raw.close();
    databasePrototype.transaction = function (
      this: IDBDatabase,
      storeNames: string | string[],
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ): IDBTransaction {
      const names = typeof storeNames === 'string' ? [storeNames] : storeNames;
      if (mode === 'readwrite' && names.length === 1 && names[0] === 'jobs') {
        throw new Error('fixture recovery transaction failure');
      }
      return originalTransaction.call(this, storeNames, mode, options);
    } as IDBDatabase['transaction'];

    try {
      const harness = createChromeHarness();
      harness.setPermission(true);
      vi.stubGlobal('chrome', harness.chrome);
      await import('../src/background/service-worker.js');

      const response = await send(
        harness.getMessageListener(),
        {
          protocol: X_SYNC_PROTOCOL,
          type: 'launch',
          requestId: 'recovery-failed-after-open',
        },
        sender('popup'),
      );

      expect(response).toMatchObject({ ok: false, error: { code: 'storage_corrupt' } });
      expect(harness.executeScript).not.toHaveBeenCalled();
    } finally {
      databasePrototype.transaction = originalTransaction;
    }
  });

  it('rejects a valid command from a content-script-like sender', async () => {
    const harness = createChromeHarness();
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'forbidden-sender',
      },
      {
        id: EXTENSION_ID,
        origin: 'https://x.com',
        url: X_SYNC_BOOKMARKS_URL,
        tab: xBookmarksTab(),
      },
    );

    expect(response).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
  });

  it('creates no job and performs no injection when exact X permission is not granted', async () => {
    const harness = createChromeHarness();
    harness.setPermission(false);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');
    const listener = harness.getMessageListener();

    const launched = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'launch-denied',
      },
      sender('popup'),
    )) as { result: { nonce: string } };
    const response = await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'start-denied',
        launchNonce: launched.result.nonce,
        mode: 'incremental',
      },
      sender('sidepanel'),
    );

    expect(response).toMatchObject({ ok: false, error: { code: 'permission_revoked' } });
    expect(harness.executeScript).not.toHaveBeenCalled();
    expect(Object.keys(harness.session)).toHaveLength(0);
    const store = await openSyncStore();
    try {
      await expect(store.listJobs({ source: 'x' })).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it('consumes the intent and rejects a changed active tab before injection', async () => {
    const harness = createChromeHarness();
    harness.setPermission(true);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');
    const listener = harness.getMessageListener();

    const launched = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'launch-before-tab-change',
      },
      sender('popup'),
    )) as { result: { nonce: string } };
    harness.setActiveTab({ url: 'https://x.com/home' });
    const response = await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'start-after-tab-change',
        launchNonce: launched.result.nonce,
        mode: 'incremental',
      },
      sender('sidepanel'),
    );

    expect(response).toMatchObject({ ok: false, error: { code: 'tab_changed' } });
    expect(harness.queries).toEqual([
      { active: true, lastFocusedWindow: true },
      { active: true, windowId: 4 },
    ]);
    expect(harness.executeScript).not.toHaveBeenCalled();
    expect(Object.keys(harness.session)).toHaveLength(0);
    const store = await openSyncStore();
    try {
      await expect(store.listJobs({ source: 'x' })).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it.each([
    ['broad HTTP', ['http://*/*']],
    ['broad HTTPS', ['https://*/*']],
    ['exact X plus broad HTTPS', ['https://x.com/*', 'https://*/*']],
  ])('rejects %s instead of treating it as exact X permission', async (_label, origins) => {
    const harness = createChromeHarness();
    harness.setPermissionOrigins(origins);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');
    const listener = harness.getMessageListener();

    const launched = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'launch-overbroad',
      },
      sender('popup'),
    )) as { result: { nonce: string } };
    const response = await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'start-overbroad',
        launchNonce: launched.result.nonce,
        mode: 'incremental',
      },
      sender('sidepanel'),
    );

    expect(response).toMatchObject({ ok: false, error: { code: 'permission_revoked' } });
    expect(harness.executeScript).not.toHaveBeenCalled();
    const store = await openSyncStore();
    try {
      await expect(store.listJobs({ source: 'x' })).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it('keeps the bounded first-run probe after a cancelled prior job', async () => {
    const factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
    const previous = await openSyncStore({ indexedDB: factory });
    const cancelled = await previous.createJob({
      id: 'cancelled-probe',
      source: 'x',
      adapterVersion: 1,
      budgets: {
        maxItems: 10,
        maxPages: 5,
        maxDurationMs: 60_000,
        maxItemBytes: 65_536,
        maxMediaPerItem: 12,
      },
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    await previous.cancelJob(
      cancelled.id,
      cancelled.scanRevision,
      cancelled.reviewRevision,
      '2026-07-13T00:00:01.000Z',
    );
    previous.close();

    const harness = createChromeHarness();
    harness.setPermission(true);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');
    const listener = harness.getMessageListener();
    const launched = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'launch-after-cancelled-probe',
      },
      sender('popup'),
    )) as { result: { nonce: string } };
    const started = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'start-after-cancelled-probe',
        launchNonce: launched.result.nonce,
        mode: 'incremental',
      },
      sender('sidepanel'),
    )) as { ok: boolean; result?: { jobId: string } };
    expect(started).toMatchObject({ ok: true, result: { kind: 'accepted' } });

    const inspected = await openSyncStore({ indexedDB: factory });
    await expect(inspected.getJob(started.result!.jobId)).resolves.toMatchObject({
      budgets: { maxItems: 10, maxPages: 5 },
    });
    inspected.close();

    harness.setPermission(false);
    harness.emitPermissionRemoved();
    await vi.waitFor(async () => {
      const stopped = await openSyncStore({ indexedDB: factory });
      try {
        expect(await stopped.getJob(started.result!.jobId)).toMatchObject({ status: 'paused' });
      } finally {
        stopped.close();
      }
    });
  });

  it('does not silently expand a later user-started batch after a completed job', async () => {
    const factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
    const previous = await openSyncStore({ indexedDB: factory });
    await previous.createJob({
      id: 'completed-bounded-batch',
      source: 'x',
      adapterVersion: 1,
      budgets: {
        maxItems: 10,
        maxPages: 5,
        maxDurationMs: 60_000,
        maxItemBytes: 65_536,
        maxMediaPerItem: 12,
      },
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    await previous.claimScanRevision('completed-bounded-batch', 0, '2026-07-13T00:00:01.000Z');
    await previous.finishScan('completed-bounded-batch', 1, '2026-07-13T00:00:02.000Z');
    await previous.completeReviewWithoutWrites(
      'completed-bounded-batch',
      0,
      '2026-07-13T00:00:03.000Z',
    );
    previous.close();

    const harness = createChromeHarness();
    harness.setPermission(true);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');
    const listener = harness.getMessageListener();
    const missingIntent = await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'start-later-batch-without-intent',
        launchNonce: 'z'.repeat(43),
        mode: 'incremental',
      },
      sender('sidepanel'),
    );
    expect(missingIntent).toMatchObject({ ok: false, error: { code: 'launch_missing' } });

    const launched = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'launch-after-completed-batch',
      },
      sender('popup'),
    )) as { result: { nonce: string } };
    const started = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'start-after-completed-batch',
        launchNonce: launched.result.nonce,
        mode: 'incremental',
      },
      sender('sidepanel'),
    )) as { ok: boolean; result?: { jobId: string } };

    const inspected = await openSyncStore({ indexedDB: factory });
    await expect(inspected.getJob(started.result!.jobId)).resolves.toMatchObject({
      budgets: { maxItems: 10, maxPages: 5 },
    });
    inspected.close();

    harness.setPermission(false);
    harness.emitPermissionRemoved();
  });

  it('resumes a prepared job left behind before its scan invocation started', async () => {
    const factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
    const preparedStore = await openSyncStore({ indexedDB: factory });
    await preparedStore.createJob({
      id: 'prepared-after-interruption',
      source: 'x',
      adapterVersion: 1,
      budgets: {
        maxItems: 10,
        maxPages: 5,
        maxDurationMs: 60_000,
        maxItemBytes: 65_536,
        maxMediaPerItem: 12,
      },
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    preparedStore.close();

    const harness = createChromeHarness();
    harness.setPermission(true);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'resume',
        requestId: 'resume-prepared',
        jobId: 'prepared-after-interruption',
        expectedScanRevision: 0,
      },
      sender('sidepanel'),
    );

    expect(response).toMatchObject({ ok: true, result: { kind: 'accepted' } });
    await vi.waitFor(() => {
      expect(harness.executeScript).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(async () => {
      const inspected = await openSyncStore({ indexedDB: factory });
      try {
        expect(await inspected.getJob('prepared-after-interruption')).toMatchObject({
          status: 'scanning',
          scanRevision: 1,
        });
      } finally {
        inspected.close();
      }
    });

    harness.setPermission(false);
    harness.emitPermissionRemoved();
    await vi.waitFor(async () => {
      const stopped = await openSyncStore({ indexedDB: factory });
      try {
        expect(await stopped.getJob('prepared-after-interruption')).toMatchObject({
          status: 'paused',
        });
      } finally {
        stopped.close();
      }
    });
  });

  it('pauses an active scan when the exact X permission is revoked', async () => {
    const harness = createChromeHarness();
    harness.setPermission(true);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');
    const listener = harness.getMessageListener();

    const launched = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'launch-before-revoke',
      },
      sender('popup'),
    )) as { result: { nonce: string } };
    const started = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'start-before-revoke',
        launchNonce: launched.result.nonce,
        mode: 'incremental',
      },
      sender('sidepanel'),
    )) as { ok: boolean; result?: { jobId: string } };
    expect(started).toMatchObject({ ok: true, result: { kind: 'accepted' } });

    expect(harness.executeScript).toHaveBeenCalledWith({
      target: { tabId: 17, frameIds: [0] },
      files: ['content/x-bookmarks.js'],
    });
    await vi.waitFor(() => {
      expect(harness.chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

    harness.setPermission(false);
    harness.emitPermissionRemoved();

    await vi.waitFor(
      async () => {
        const store = await openSyncStore();
        try {
          expect(await store.getJob(started.result!.jobId)).toMatchObject({
            status: 'paused',
            stopRecord: { code: 'permission_revoked', phase: 'scanning' },
          });
        } finally {
          store.close();
        }
      },
      { timeout: 2_000 },
    );
  });
});
