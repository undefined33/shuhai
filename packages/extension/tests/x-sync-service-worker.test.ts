import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { X_SYNC_BOOKMARKS_URL, X_SYNC_PROTOCOL } from '../src/social/x-sync-messages.js';
import { openSyncStore } from '../src/social/sync-store.js';
import {
  X_SINGLE_PROTOCOL,
  X_SINGLE_RESPONSE_PROTOCOL,
  X_SINGLE_VERSION,
  type XSingleExtractRequest,
} from '../src/social/x-single-item.js';

const EXTENSION_ID = 'a'.repeat(32);
const POPUP_URL = `chrome-extension://${EXTENSION_ID}/popup/index.html`;
const SIDEPANEL_URL = `chrome-extension://${EXTENSION_ID}/sidepanel/index.html`;

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | void;

type ConnectListener = (port: chrome.runtime.Port) => void;

interface ChromeHarness {
  readonly chrome: typeof chrome;
  readonly local: Record<string, unknown>;
  readonly session: Record<string, unknown>;
  readonly executeScript: ReturnType<typeof vi.fn>;
  readonly openSidePanel: ReturnType<typeof vi.fn>;
  readonly sendMessage: ReturnType<typeof vi.fn>;
  readonly queries: chrome.tabs.QueryInfo[];
  emitContextMenuClick(menuItemId: string): void;
  emitInstalled(): void;
  getConnectListener(): ConnectListener;
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

function sidePanelPort() {
  let disconnectListener: (() => void) | undefined;
  let messageListener: ((message: unknown) => void) | undefined;
  const posted: unknown[] = [];
  const port = {
    name: X_SYNC_PROTOCOL,
    sender: sender('sidepanel'),
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => {
        disconnectListener = listener;
      }),
      removeListener: vi.fn(),
    },
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => {
        messageListener = listener;
      }),
      removeListener: vi.fn(),
    },
    postMessage: vi.fn((message: unknown) => {
      posted.push(message);
    }),
    disconnect: vi.fn(() => {
      disconnectListener?.();
    }),
  } as unknown as chrome.runtime.Port;

  return {
    port,
    posted,
    emitMessage: (message: unknown) => messageListener?.(message),
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

function xStatusTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return xBookmarksTab({
    title: 'Fixture X status',
    url: 'https://x.com/alice/status/123456789?source=fixture#reply',
    ...overrides,
  });
}

function xSingleResponse(
  request: XSingleExtractRequest,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    protocol: X_SINGLE_RESPONSE_PROTOCOL,
    version: X_SINGLE_VERSION,
    requestId: request.requestId,
    ok: true,
    item: {
      protocol: X_SINGLE_PROTOCOL,
      version: X_SINGLE_VERSION,
      routeFamily: 'x/status',
      sourceItemId: request.sourceItemId,
      canonicalUrl: request.canonicalUrl,
      title: 'Fixture X item',
      text: 'Fixture body',
      author: {
        displayName: 'Fixture Author',
        handle: 'alice',
      },
      publishedAt: '2026-07-18T00:00:00.000Z',
      media: [],
      contentKind: 'post',
    },
    ...overrides,
  };
}

function createChromeHarness(): ChromeHarness {
  let connectListener: ConnectListener | undefined;
  let contextMenuClickListener:
    | ((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void)
    | undefined;
  let installedListener: ((details: chrome.runtime.InstalledDetails) => void) | undefined;
  let messageListener: MessageListener | undefined;
  let permissionRemovedListener:
    | ((permissions: chrome.permissions.Permissions) => void)
    | undefined;
  let activeTab = xBookmarksTab({ title: 'Fixture bookmarks' });
  let permissionOrigins: string[] = [];
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const queries: chrome.tabs.QueryInfo[] = [];
  const executeScript = vi.fn(async () => [
    { frameId: 0, documentId: 'document-fixture', result: undefined },
  ]);
  const openSidePanel = vi.fn(async () => undefined);
  const sendMessage = vi.fn();
  const runtime = {
    id: EXTENSION_ID,
    lastError: undefined,
    getURL: (path: string) => `chrome-extension://${EXTENSION_ID}${path}`,
    onInstalled: {
      addListener: vi.fn((listener: (details: chrome.runtime.InstalledDetails) => void) => {
        installedListener = listener;
      }),
      removeListener: vi.fn(),
    },
    onConnect: {
      addListener: vi.fn((listener: ConnectListener) => {
        connectListener = listener;
      }),
      removeListener: vi.fn(),
    },
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
      local: {
        get: vi.fn(
          (
            keys: string | string[] | Record<string, unknown> | null,
            callback: (items: Record<string, unknown>) => void,
          ) => {
            if (keys === null) {
              callback(structuredClone(local));
              return;
            }
            const requested = typeof keys === 'string' ? [keys] : keys;
            if (Array.isArray(requested)) {
              callback(
                Object.fromEntries(
                  requested
                    .filter((key) => Object.prototype.hasOwnProperty.call(local, key))
                    .map((key) => [key, structuredClone(local[key])]),
                ),
              );
              return;
            }
            callback({
              ...structuredClone(requested),
              ...Object.fromEntries(
                Object.keys(requested)
                  .filter((key) => Object.prototype.hasOwnProperty.call(local, key))
                  .map((key) => [key, structuredClone(local[key])]),
              ),
            });
          },
        ),
        getBytesInUse: vi.fn(
          (keys: string | string[] | null, callback: (bytesInUse: number) => void) => {
            const requested =
              keys === null ? Object.keys(local) : typeof keys === 'string' ? [keys] : keys;
            const selected = Object.fromEntries(
              requested
                .filter((key) => Object.prototype.hasOwnProperty.call(local, key))
                .map((key) => [key, local[key]]),
            );
            callback(new TextEncoder().encode(JSON.stringify(selected)).byteLength);
          },
        ),
        remove: vi.fn((keys: string | string[], callback?: () => void) => {
          for (const key of typeof keys === 'string' ? [keys] : keys) {
            delete local[key];
          }
          callback?.();
        }),
        set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
          Object.assign(local, structuredClone(items));
          callback?.();
        }),
        setAccessLevel: vi.fn(
          (_options: { accessLevel: 'TRUSTED_CONTEXTS' }, callback: () => void) => callback(),
        ),
      },
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
      sendMessage,
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
      remove: (
        permissions: chrome.permissions.Permissions,
        callback: (removed: boolean) => void,
      ) => {
        const requested = new Set(permissions.origins ?? []);
        const before = permissionOrigins.length;
        permissionOrigins = permissionOrigins.filter((origin) => !requested.has(origin));
        callback(permissionOrigins.length !== before);
      },
      onRemoved: {
        addListener: vi.fn((listener: (permissions: chrome.permissions.Permissions) => void) => {
          permissionRemovedListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
    contextMenus: {
      onClicked: {
        addListener: vi.fn(
          (listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void) => {
            contextMenuClickListener = listener;
          },
        ),
        removeListener: vi.fn(),
      },
      removeAll: vi.fn((callback?: () => void) => callback?.()),
      create: vi.fn(),
    },
    sidePanel: {
      open: openSidePanel,
      setPanelBehavior: vi.fn(async () => undefined),
    },
  } as unknown as typeof chrome;

  return {
    chrome: chromeMock,
    local,
    session,
    executeScript,
    openSidePanel,
    sendMessage,
    queries,
    emitContextMenuClick: (menuItemId) => {
      contextMenuClickListener?.(
        { menuItemId, editable: false, pageUrl: activeTab.url },
        activeTab,
      );
    },
    emitInstalled: () => {
      installedListener?.({
        id: EXTENSION_ID,
        reason: 'install',
        previousVersion: undefined,
      });
    },
    emitPermissionRemoved: () => {
      permissionRemovedListener?.({ origins: ['https://x.com/*'] });
    },
    getConnectListener: () => {
      if (!connectListener) {
        throw new Error('service worker connect listener was not installed');
      }
      return connectListener;
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

  it('installs only the open-workspace menu and ignores retired capture menu IDs', async () => {
    const harness = createChromeHarness();
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    harness.emitInstalled();
    await vi.waitFor(() => {
      expect(harness.chrome.contextMenus.create).toHaveBeenCalledOnce();
    });
    expect(harness.chrome.contextMenus.create).toHaveBeenCalledWith({
      id: 'shuhai-open',
      title: '打开 ShuHai 侧边栏',
      contexts: ['action'],
    });

    harness.emitContextMenuClick('shuhai-save-current-article');
    await Promise.resolve();
    expect(harness.openSidePanel).not.toHaveBeenCalled();

    harness.emitContextMenuClick('shuhai-open');
    await vi.waitFor(() => {
      expect(harness.openSidePanel).toHaveBeenCalledWith({ windowId: 4 });
    });
  });

  it('creates one persisted X review job through the strict single-item route', async () => {
    const harness = createChromeHarness();
    harness.setActiveTab(xStatusTab());
    harness.sendMessage.mockImplementation(
      (_tabId: number, request: XSingleExtractRequest, callback: (response: unknown) => void) =>
        callback(xSingleResponse(request)),
    );
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      { type: 'xSingle:start', requestId: 'single-start-success' },
      sender('popup'),
    );

    expect(response).toMatchObject({
      ok: true,
      data: {
        status: 'ready_for_review',
        classification: 'new',
        noWriteCandidate: false,
      },
    });
    expect(harness.executeScript).toHaveBeenCalledWith({
      target: { tabId: 17 },
      files: ['content/twitter.js'],
      world: 'ISOLATED',
    });
    expect(harness.sendMessage).toHaveBeenCalledTimes(1);
    const store = await openSyncStore();
    try {
      const jobs = await store.listJobs({ source: 'x' });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        source: 'x',
        status: 'ready_for_review',
        scanMode: 'incremental',
      });
      await expect(store.listJobItems(jobs[0].id)).resolves.toHaveLength(1);
    } finally {
      store.close();
    }
    expect(JSON.stringify(harness.local)).not.toContain('Fixture X item');
    expect(JSON.stringify(harness.local)).not.toContain('Fixture body');
    expect(JSON.stringify(harness.local)).not.toContain('/alice/status/');
  });

  it('returns the persisted X review job when the optional activity log is corrupt', async () => {
    const harness = createChromeHarness();
    harness.local.activityLog = [{ privateTitle: 'must-not-be-read-or-rewritten' }];
    harness.setActiveTab(xStatusTab());
    harness.sendMessage.mockImplementation(
      (_tabId: number, request: XSingleExtractRequest, callback: (response: unknown) => void) =>
        callback(xSingleResponse(request)),
    );
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      { type: 'xSingle:start', requestId: 'single-start-corrupt-activity' },
      sender('popup'),
    );

    expect(response).toMatchObject({
      ok: true,
      data: {
        status: 'ready_for_review',
        classification: 'new',
        noWriteCandidate: false,
      },
    });
    expect(harness.local.activityLog).toEqual([{ privateTitle: 'must-not-be-read-or-rewritten' }]);
    const store = await openSyncStore();
    try {
      await expect(store.listJobs({ source: 'x' })).resolves.toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('rejects a non-status active tab before injection or persistence', async () => {
    const harness = createChromeHarness();
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      { type: 'xSingle:start', requestId: 'single-start-wrong-route' },
      sender('popup'),
    );

    expect(response).toMatchObject({ ok: false, errorCode: 'x_route_invalid' });
    expect(harness.executeScript).not.toHaveBeenCalled();
    expect(harness.sendMessage).not.toHaveBeenCalled();
    const store = await openSyncStore();
    try {
      await expect(store.listJobs({ source: 'x' })).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it('fails closed if activeTab injection access disappears before extraction', async () => {
    const harness = createChromeHarness();
    harness.setActiveTab(xStatusTab());
    harness.executeScript.mockRejectedValueOnce(new Error('permission revoked'));
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      { type: 'xSingle:start', requestId: 'single-start-access-revoked' },
      sender('popup'),
    );

    expect(response).toMatchObject({ ok: false, errorCode: 'x_extract_failed' });
    expect(harness.sendMessage).not.toHaveBeenCalled();
    const store = await openSyncStore();
    try {
      await expect(store.listJobs({ source: 'x' })).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it('rejects a response nonce mismatch before creating a job', async () => {
    const harness = createChromeHarness();
    harness.setActiveTab(xStatusTab());
    harness.sendMessage.mockImplementation(
      (_tabId: number, request: XSingleExtractRequest, callback: (response: unknown) => void) =>
        callback(xSingleResponse(request, { requestId: 'xsingle:forged-response' })),
    );
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      { type: 'xSingle:start', requestId: 'single-start-forged-response' },
      sender('popup'),
    );

    expect(response).toMatchObject({ ok: false, errorCode: 'x_payload_invalid' });
    const store = await openSyncStore();
    try {
      await expect(store.listJobs({ source: 'x' })).resolves.toEqual([]);
    } finally {
      store.close();
    }
    expect(JSON.stringify(harness.local)).not.toContain('forged-response');
  });

  it('rejects an oversized content response and stores only a fixed diagnostic', async () => {
    const harness = createChromeHarness();
    harness.setActiveTab(xStatusTab());
    harness.sendMessage.mockImplementation(
      (_tabId: number, request: XSingleExtractRequest, callback: (response: unknown) => void) => {
        const response = xSingleResponse(request);
        const item = response.item as Record<string, unknown>;
        callback({
          ...response,
          item: {
            ...item,
            text: 'private-body'.repeat(1_500),
          },
        });
      },
    );
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      { type: 'xSingle:start', requestId: 'single-start-oversized-response' },
      sender('popup'),
    );

    expect(response).toMatchObject({ ok: false, errorCode: 'x_payload_invalid' });
    expect(harness.local).toMatchObject({
      extractorDiagnostics: [
        expect.objectContaining({
          platform: 'x',
          routeFamily: 'x/status',
          errorCode: 'payload_oversize',
        }),
      ],
    });
    expect(JSON.stringify(harness.local)).not.toContain('private-body');
    const store = await openSyncStore();
    try {
      await expect(store.listJobs({ source: 'x' })).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it('rechecks the original tab identity after extraction and before persistence', async () => {
    const harness = createChromeHarness();
    harness.setActiveTab(xStatusTab());
    harness.sendMessage.mockImplementation(
      (_tabId: number, request: XSingleExtractRequest, callback: (response: unknown) => void) => {
        harness.setActiveTab({
          url: 'https://x.com/bob/status/987654321',
        });
        callback(xSingleResponse(request));
      },
    );
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');

    const response = await send(
      harness.getMessageListener(),
      { type: 'xSingle:start', requestId: 'single-start-tab-changed' },
      sender('popup'),
    );

    expect(response).toMatchObject({ ok: false, errorCode: 'x_tab_changed' });
    const store = await openSyncStore();
    try {
      await expect(store.listJobs({ source: 'x' })).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it('broadcasts persisted task changes to a newly opened Side Panel before its first command', async () => {
    const store = await openSyncStore();
    const job = await store.createJob({
      id: 'zero-command-port-job',
      source: 'x',
      adapterVersion: 1,
      budgets: {
        maxItems: 10,
        maxPages: 5,
        maxDurationMs: 60_000,
        maxItemBytes: 65_536,
        maxMediaPerItem: 12,
      },
      createdAt: '2026-07-17T00:00:00.000Z',
    });
    store.close();

    const harness = createChromeHarness();
    harness.setPermission(true);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');
    const connected = sidePanelPort();
    harness.getConnectListener()(connected.port);

    const response = await send(
      harness.getMessageListener(),
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'cancel',
        requestId: 'cancel-zero-command-port',
        jobId: job.id,
        expectedScanRevision: job.scanRevision,
        expectedReviewRevision: job.reviewRevision,
      },
      sender('sidepanel'),
    );

    expect(response).toMatchObject({ ok: true, result: { kind: 'accepted' } });
    await vi.waitFor(() => {
      expect(connected.posted).toContainEqual({
        protocol: X_SYNC_PROTOCOL,
        type: 'runtime-event',
        event: {
          kind: 'state',
          jobId: job.id,
          status: 'cancelled',
          scanRevision: job.scanRevision,
          reviewRevision: job.reviewRevision,
        },
      });
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
  ])('removes %s and still requires exact X permission', async (_label, origins) => {
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

  it('removes a broad grant while preserving an existing exact X grant', async () => {
    const harness = createChromeHarness();
    harness.setPermissionOrigins(['https://x.com/*', 'https://*/*']);
    vi.stubGlobal('chrome', harness.chrome);
    await import('../src/background/service-worker.js');
    const listener = harness.getMessageListener();

    const launched = (await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'launch-exact-plus-broad',
      },
      sender('popup'),
    )) as { result: { nonce: string } };
    const response = await send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'start-exact-plus-broad',
        launchNonce: launched.result.nonce,
        mode: 'incremental',
      },
      sender('sidepanel'),
    );

    expect(response).toMatchObject({ ok: true, result: { kind: 'accepted' } });
    expect(harness.executeScript).toHaveBeenCalledTimes(1);
    harness.setPermission(false);
    harness.emitPermissionRemoved();
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
