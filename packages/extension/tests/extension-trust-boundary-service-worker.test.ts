import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { X_SYNC_PROTOCOL } from '../src/social/x-sync-messages.js';

const EXTENSION_ID = 'a'.repeat(32);
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const POPUP_URL = `${EXTENSION_ORIGIN}/popup/index.html`;
const SIDEPANEL_URL = `${EXTENSION_ORIGIN}/sidepanel/index.html`;

type BootstrapStage = 'setAccessLevel' | 'firstGetAll' | 'remove' | 'secondGetAll';
type BootstrapFailureMode = 'runtime-error' | 'reject' | 'throw';
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | void;
type ConnectListener = (port: chrome.runtime.Port) => void;

interface HarnessOptions {
  readonly dropExactXBeforeSecondGetAll?: boolean;
  readonly failedStage?: Exclude<BootstrapStage, 'setAccessLevel'>;
  readonly failureMode?: BootstrapFailureMode;
  readonly initialOrigins?: string[];
  readonly keepOriginsAfterRemove?: boolean;
  readonly missingApi?: 'getAll' | 'remove';
  readonly removeResult?: boolean;
  readonly storageData?: Record<string, unknown>;
  readonly stalledStage?: BootstrapStage;
}

interface BootstrapHarness {
  readonly bookmarks: {
    readonly create: ReturnType<typeof vi.fn>;
    readonly getTree: ReturnType<typeof vi.fn>;
    readonly move: ReturnType<typeof vi.fn>;
    readonly remove: ReturnType<typeof vi.fn>;
    readonly update: ReturnType<typeof vi.fn>;
  };
  readonly getAll: ReturnType<typeof vi.fn>;
  readonly indexedDbOpen: ReturnType<typeof vi.fn>;
  readonly removePermission: ReturnType<typeof vi.fn>;
  readonly setAccessLevel: ReturnType<typeof vi.fn>;
  currentOrigins(): string[];
  getConnectListener(): ConnectListener;
  getMessageListener(): MessageListener;
  getPermissionRemovedListener(): (permissions: chrome.permissions.Permissions) => void;
  revokeOrigins(origins: string[]): void;
  release(stage: BootstrapStage): void;
}

function event<T extends (...args: never[]) => unknown>(capture?: (listener: T) => void) {
  return {
    addListener: vi.fn((listener: T) => capture?.(listener)),
    removeListener: vi.fn(),
  };
}

function extensionUrl(path: string): string {
  return `${EXTENSION_ORIGIN}/${path.replace(/^\/+/u, '')}`;
}

function createHarness(options: HarnessOptions = {}): BootstrapHarness {
  let messageListener: MessageListener | undefined;
  let connectListener: ConnectListener | undefined;
  let permissionRemovedListener:
    | ((permissions: chrome.permissions.Permissions) => void)
    | undefined;
  let origins = [...(options.initialOrigins ?? [])];
  let storageData = structuredClone(options.storageData ?? {});
  let getAllCount = 0;
  const releases = new Map<BootstrapStage, () => void>();

  const setAccessLevel = vi.fn(
    (_options: { accessLevel: 'TRUSTED_CONTEXTS' }, callback: () => void) => {
      if (options.stalledStage === 'setAccessLevel') {
        releases.set('setAccessLevel', callback);
        return;
      }
      callback();
    },
  );
  const getAll = vi.fn((callback: (permissions: chrome.permissions.Permissions) => void) => {
    getAllCount += 1;
    const stage = getAllCount === 1 ? 'firstGetAll' : 'secondGetAll';
    const respond = () => {
      if (stage === 'secondGetAll' && options.dropExactXBeforeSecondGetAll) {
        origins = origins.filter((origin) => origin !== 'https://x.com/*');
      }
      callback({ origins: [...origins] });
    };
    if (options.failedStage === stage) {
      if (options.failureMode === 'reject') {
        return Promise.reject(new Error('private permission failure'));
      }
      if (options.failureMode === 'throw') {
        throw new Error('private permission failure');
      }
      runtime.lastError = { message: 'private permission failure' };
      callback({ origins: [...origins] });
      runtime.lastError = undefined;
      return;
    }
    if (options.stalledStage === stage) {
      releases.set(stage, respond);
      return;
    }
    respond();
  });
  const removePermission = vi.fn(
    (permissions: chrome.permissions.Permissions, callback: (removed: boolean) => void) => {
      if (options.failedStage === 'remove') {
        if (options.failureMode === 'reject') {
          return Promise.reject(new Error('private permission failure'));
        }
        if (options.failureMode === 'throw') {
          throw new Error('private permission failure');
        }
        runtime.lastError = { message: 'private permission failure' };
        callback(false);
        runtime.lastError = undefined;
        return;
      }
      const respond = () => {
        if (!options.keepOriginsAfterRemove) {
          const removedOrigins = new Set(permissions.origins ?? []);
          origins = origins.filter((origin) => !removedOrigins.has(origin));
        }
        callback(options.removeResult ?? true);
      };
      if (options.stalledStage === 'remove') {
        releases.set('remove', respond);
        return;
      }
      respond();
    },
  );

  const factory = new IDBFactory();
  const originalOpen = factory.open.bind(factory);
  const indexedDbOpen = vi.fn(originalOpen);
  Object.defineProperty(factory, 'open', {
    configurable: true,
    value: indexedDbOpen,
  });
  vi.stubGlobal('indexedDB', factory);

  const bookmarks = {
    create: vi.fn(),
    get: vi.fn(),
    getChildren: vi.fn(),
    getTree: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    search: vi.fn(),
    update: vi.fn(),
  };
  const runtime = {
    id: EXTENSION_ID,
    lastError: undefined as chrome.runtime.LastError | undefined,
    getURL: extensionUrl,
    onConnect: event<ConnectListener>((listener) => {
      connectListener = listener;
    }),
    onInstalled: event(),
    onMessage: event<MessageListener>((listener) => {
      messageListener = listener;
    }),
    sendMessage: vi.fn(),
  };
  const chromeMock = {
    bookmarks,
    contextMenus: {
      create: vi.fn(),
      onClicked: event(),
      removeAll: vi.fn(),
    },
    permissions: {
      contains: vi.fn(
        (permissions: chrome.permissions.Permissions, callback: (granted: boolean) => void) =>
          callback((permissions.origins ?? []).every((origin) => origins.includes(origin))),
      ),
      getAll: options.missingApi === 'getAll' ? undefined : getAll,
      onRemoved: event<(permissions: chrome.permissions.Permissions) => void>((listener) => {
        permissionRemovedListener = listener;
      }),
      remove: options.missingApi === 'remove' ? undefined : removePermission,
    },
    runtime,
    scripting: {
      executeScript: vi.fn(),
    },
    sidePanel: {},
    storage: {
      local: {
        get: vi.fn(
          (
            keys: string | string[] | Record<string, unknown> | null,
            callback: (items: Record<string, unknown>) => void,
          ) => {
            if (typeof keys === 'string') {
              callback(
                Object.prototype.hasOwnProperty.call(storageData, keys)
                  ? { [keys]: structuredClone(storageData[keys]) }
                  : {},
              );
              return;
            }
            if (Array.isArray(keys)) {
              callback(
                Object.fromEntries(
                  keys
                    .filter((key) => Object.prototype.hasOwnProperty.call(storageData, key))
                    .map((key) => [key, structuredClone(storageData[key])]),
                ),
              );
              return;
            }
            if (keys && typeof keys === 'object') {
              callback(
                Object.fromEntries(
                  Object.entries(keys).map(([key, fallback]) => [
                    key,
                    Object.prototype.hasOwnProperty.call(storageData, key)
                      ? structuredClone(storageData[key])
                      : fallback,
                  ]),
                ),
              );
              return;
            }
            callback(structuredClone(storageData));
          },
        ),
        getBytesInUse: vi.fn((key: string, callback: (bytes: number) => void) => {
          const value = Object.prototype.hasOwnProperty.call(storageData, key)
            ? { [key]: storageData[key] }
            : {};
          callback(
            Object.keys(value).length === 0
              ? 0
              : new TextEncoder().encode(JSON.stringify(value)).byteLength,
          );
        }),
        remove: vi.fn((keys: string | string[], callback?: () => void) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storageData[key];
          }
          callback?.();
        }),
        set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
          storageData = { ...storageData, ...structuredClone(items) };
          callback?.();
        }),
        setAccessLevel,
      },
      session: {
        get: vi.fn(),
        remove: vi.fn(),
        set: vi.fn(),
      },
    },
    tabs: {
      get: vi.fn(),
      onActivated: event(),
      onRemoved: event(),
      onUpdated: event(),
      query: vi.fn(),
      sendMessage: vi.fn(),
    },
  } as unknown as typeof chrome;
  vi.stubGlobal('chrome', chromeMock);

  return {
    bookmarks,
    getAll,
    indexedDbOpen,
    removePermission,
    setAccessLevel,
    currentOrigins: () => [...origins],
    getConnectListener: () => {
      if (!connectListener) {
        throw new Error('connect listener missing');
      }
      return connectListener;
    },
    getMessageListener: () => {
      if (!messageListener) {
        throw new Error('message listener missing');
      }
      return messageListener;
    },
    getPermissionRemovedListener: () => {
      if (!permissionRemovedListener) {
        throw new Error('permission removed listener missing');
      }
      return permissionRemovedListener;
    },
    revokeOrigins: (removedOrigins) => {
      const removed = new Set(removedOrigins);
      origins = origins.filter((origin) => !removed.has(origin));
      if (!permissionRemovedListener) {
        throw new Error('permission removed listener missing');
      }
      permissionRemovedListener({ origins: removedOrigins });
    },
    release: (stage) => {
      const release = releases.get(stage);
      if (!release) {
        throw new Error(`stage ${stage} is not stalled`);
      }
      releases.delete(stage);
      release();
    },
  };
}

function sender(surface: 'popup' | 'sidepanel'): chrome.runtime.MessageSender {
  return {
    id: EXTENSION_ID,
    origin: EXTENSION_ORIGIN,
    url: surface === 'popup' ? POPUP_URL : SIDEPANEL_URL,
  };
}

function legacyAiStorage(apiKey = 'private-key'): Record<string, unknown> {
  return {
    settings: {
      deepSeekApiKey: apiKey,
      deepSeekModel: 'deepseek-v4-flash',
      useAi: true,
      defaultClassifyMode: 'safe',
      exportDirectory: 'Bookmarks',
    },
  };
}

function classificationTree(folderCount = 1): chrome.bookmarks.BookmarkTreeNode[] {
  const folders: chrome.bookmarks.BookmarkTreeNode[] = Array.from(
    { length: folderCount },
    (_, index) => ({
      id: `folder-${index + 1}`,
      parentId: '1',
      index: index + 1,
      title: index === 0 ? 'Research' : `Folder ${index + 1}`,
      syncing: false,
      children: [],
    }),
  );
  return [
    {
      id: '0',
      title: '',
      syncing: false,
      children: [
        {
          id: '1',
          parentId: '0',
          title: 'Bookmarks bar',
          syncing: false,
          children: [
            {
              id: 'bookmark-1',
              parentId: '1',
              index: 0,
              title: 'Bookmark permission revoke',
              url: 'https://examplepermissionrevoke.com/private-path?token=secret',
              syncing: false,
            },
            ...folders,
          ],
        },
      ],
    },
  ];
}

function extensionPort(messageSender: chrome.runtime.MessageSender, name = 'classify') {
  let messageListener: ((message: unknown) => void) | undefined;
  let disconnectListener: (() => void) | undefined;
  const disconnect = vi.fn(() => disconnectListener?.());
  const postMessage = vi.fn();
  const port = {
    name,
    sender: messageSender,
    disconnect,
    postMessage,
    onMessage: event<(message: unknown) => void>((listener) => {
      messageListener = listener;
    }),
    onDisconnect: event<() => void>((listener) => {
      disconnectListener = listener;
    }),
  } as unknown as chrome.runtime.Port;

  return {
    disconnect,
    postMessage,
    port,
    sendMessage: (message: unknown) => {
      if (!messageListener) {
        throw new Error('port message listener missing');
      }
      messageListener(message);
    },
  };
}

function send(
  listener: MessageListener,
  message: unknown,
  messageSender = sender('sidepanel'),
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (listener(message, messageSender, resolve) !== true) {
      reject(new Error('message channel was not kept alive'));
    }
  });
}

async function loadServiceWorker(options: HarnessOptions = {}): Promise<BootstrapHarness> {
  const harness = createHarness(options);
  await import('../src/background/service-worker.js');
  return harness;
}

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('service worker security bootstrap', () => {
  it('sets trusted storage access, removes broad grants once, and preserves exact X', async () => {
    const harness = await loadServiceWorker({
      initialOrigins: ['https://x.com/*', 'http://*/*', 'https://*/*'],
    });

    await expect(
      send(harness.getMessageListener(), { type: 'security:getBootstrapStatus' }),
    ).resolves.toEqual({ ok: true, data: { ready: true } });
    expect(harness.setAccessLevel).toHaveBeenCalledTimes(1);
    expect(harness.getAll).toHaveBeenCalledTimes(2);
    expect(harness.removePermission).toHaveBeenCalledWith(
      { origins: ['http://*/*', 'https://*/*'] },
      expect.any(Function),
    );
    expect(harness.currentOrigins()).toEqual(['https://x.com/*']);
    expect(harness.indexedDbOpen).not.toHaveBeenCalled();
  });

  it('is idempotent when no broad or exact platform grant exists', async () => {
    const harness = await loadServiceWorker();

    await expect(
      send(harness.getMessageListener(), { type: 'security:getBootstrapStatus' }),
    ).resolves.toEqual({ ok: true, data: { ready: true } });
    expect(harness.getAll).toHaveBeenCalledTimes(2);
    expect(harness.removePermission).not.toHaveBeenCalled();
    expect(harness.currentOrigins()).toEqual([]);
  });

  it('accepts remove=false only when the postcondition proves broad grants are gone', async () => {
    const harness = await loadServiceWorker({
      initialOrigins: ['https://*/*'],
      removeResult: false,
    });

    await expect(
      send(harness.getMessageListener(), { type: 'security:getBootstrapStatus' }),
    ).resolves.toEqual({ ok: true, data: { ready: true } });
    expect(harness.currentOrigins()).toEqual([]);
  });

  it('fails when remove=true but the broad grant remains after verification', async () => {
    const harness = await loadServiceWorker({
      initialOrigins: ['https://*/*'],
      keepOriginsAfterRemove: true,
      removeResult: true,
    });

    await expect(
      send(harness.getMessageListener(), { type: 'security:getBootstrapStatus' }),
    ).resolves.toEqual({
      ok: false,
      error: 'ShuHai security initialization failed',
      errorCode: 'security_bootstrap_failed',
    });
    expect(harness.getAll).toHaveBeenCalledTimes(2);
    expect(harness.indexedDbOpen).not.toHaveBeenCalled();
  });

  it('fails when an existing exact X grant disappears during cleanup verification', async () => {
    const harness = await loadServiceWorker({
      dropExactXBeforeSecondGetAll: true,
      initialOrigins: ['https://x.com/*'],
    });

    await expect(
      send(harness.getMessageListener(), { type: 'security:getBootstrapStatus' }),
    ).resolves.toEqual({
      ok: false,
      error: 'ShuHai security initialization failed',
      errorCode: 'security_bootstrap_failed',
    });
    expect(harness.removePermission).not.toHaveBeenCalled();
    expect(harness.indexedDbOpen).not.toHaveBeenCalled();
  });

  it.each<[Exclude<BootstrapStage, 'setAccessLevel'>, BootstrapFailureMode]>([
    ['firstGetAll', 'runtime-error'],
    ['firstGetAll', 'reject'],
    ['firstGetAll', 'throw'],
    ['remove', 'runtime-error'],
    ['remove', 'reject'],
    ['remove', 'throw'],
    ['secondGetAll', 'runtime-error'],
    ['secondGetAll', 'reject'],
    ['secondGetAll', 'throw'],
  ])('fails closed when %s returns a %s', async (stage, failureMode) => {
    const harness = await loadServiceWorker({
      failedStage: stage,
      failureMode,
      initialOrigins: stage === 'remove' ? ['https://*/*'] : ['https://x.com/*'],
    });

    await expect(
      send(harness.getMessageListener(), { type: 'security:getBootstrapStatus' }),
    ).resolves.toEqual({
      ok: false,
      error: 'ShuHai security initialization failed',
      errorCode: 'security_bootstrap_failed',
    });
    expect(harness.indexedDbOpen).not.toHaveBeenCalled();
  });

  it.each([
    ['getAll', []],
    ['remove', ['https://*/*']],
  ] as const)(
    'fails closed when permissions.%s is unavailable',
    async (missingApi, initialOrigins) => {
      const harness = await loadServiceWorker({ initialOrigins: [...initialOrigins], missingApi });

      await expect(
        send(harness.getMessageListener(), { type: 'security:getBootstrapStatus' }),
      ).resolves.toEqual({
        ok: false,
        error: 'ShuHai security initialization failed',
        errorCode: 'security_bootstrap_failed',
      });
      expect(harness.indexedDbOpen).not.toHaveBeenCalled();
    },
  );

  it('does not expose raw AI provider failures through the strict connection response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('secret-token-and-url'))),
    );
    const harness = await loadServiceWorker({
      initialOrigins: ['https://api.deepseek.com/*'],
      storageData: legacyAiStorage(),
    });

    await expect(
      send(harness.getMessageListener(), {
        type: 'ai:testConnection',
        provider: 'deepseek',
      }),
    ).resolves.toEqual({
      ok: true,
      data: {
        success: false,
        code: 'network_failed',
        message: 'AI 网络连接失败',
      },
    });
  });

  it('returns a fixed permission result and never fetches when provider access is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const harness = await loadServiceWorker({
      storageData: legacyAiStorage(),
    });

    await expect(
      send(harness.getMessageListener(), {
        type: 'ai:testConnection',
        provider: 'deepseek',
      }),
    ).resolves.toEqual({
      ok: true,
      data: {
        success: false,
        code: 'permission_required',
        message: '需要先允许访问当前 AI 服务',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('completes a local-only classification plan without fetching when provider access is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const harness = await loadServiceWorker({
      storageData: legacyAiStorage(),
    });
    harness.bookmarks.getTree.mockImplementation(
      (callback: (tree: chrome.bookmarks.BookmarkTreeNode[]) => void) =>
        callback(classificationTree()),
    );
    const classification = extensionPort(sender('sidepanel'));
    harness.getConnectListener()(classification.port);

    classification.sendMessage({
      type: 'plan:create',
      requestId: 'classify-permission-denied',
      mode: 'safe',
      ai: { provider: 'deepseek', confirmed: true },
    });

    await vi.waitFor(() =>
      expect(classification.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete',
          requestId: 'classify-permission-denied',
          cancelled: false,
        }),
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(classification.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('keeps the local classification plan when AI folder targets exceed the request limit', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const harness = await loadServiceWorker({
      initialOrigins: ['https://api.deepseek.com/*'],
      storageData: legacyAiStorage(),
    });
    harness.bookmarks.getTree.mockImplementation(
      (callback: (tree: chrome.bookmarks.BookmarkTreeNode[]) => void) =>
        callback(classificationTree(65)),
    );
    const classification = extensionPort(sender('sidepanel'));
    harness.getConnectListener()(classification.port);

    classification.sendMessage({
      type: 'plan:create',
      requestId: 'classify-folder-target-overflow',
      mode: 'safe',
      ai: { provider: 'deepseek', confirmed: true },
    });

    await vi.waitFor(() =>
      expect(classification.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete',
          requestId: 'classify-folder-target-overflow',
          cancelled: false,
        }),
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(classification.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('fails a quarantined legacy provider conflict closed without reading a secret or fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const harness = await loadServiceWorker({
      initialOrigins: ['https://api.deepseek.com/*'],
      storageData: {
        settings: {
          useAi: true,
          aiProviders: [
            {
              id: 'legacy-a',
              name: 'A',
              provider: 'deepseek',
              enabled: true,
              apiKey: 'private-a',
              model: 'deepseek-v4-flash',
            },
            {
              id: 'legacy-b',
              name: 'B',
              provider: 'deepseek',
              enabled: true,
              apiKey: 'private-b',
              model: 'deepseek-v4-flash',
            },
          ],
        },
      },
    });

    await expect(
      send(harness.getMessageListener(), {
        type: 'ai:testConnection',
        provider: 'deepseek',
      }),
    ).resolves.toEqual({
      ok: true,
      data: {
        success: false,
        code: 'legacy_ai_config_conflict',
        message: '旧 AI 配置存在冲突，请先在设置中处理',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a running Provider request on permission revoke and completes a local-only plan', async () => {
    const fetchMock = vi.fn(
      (_input: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('private abort')), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const harness = await loadServiceWorker({
      initialOrigins: ['https://api.deepseek.com/*'],
      storageData: legacyAiStorage(),
    });
    harness.bookmarks.getTree.mockImplementation(
      (callback: (tree: chrome.bookmarks.BookmarkTreeNode[]) => void) =>
        callback(classificationTree()),
    );
    const classification = extensionPort(sender('sidepanel'));
    harness.getConnectListener()(classification.port);

    classification.sendMessage({
      type: 'plan:create',
      requestId: 'classify-permission-revoke',
      mode: 'safe',
      ai: { provider: 'deepseek', confirmed: true },
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    harness.revokeOrigins(['https://api.deepseek.com/*']);

    await vi.waitFor(() =>
      expect(classification.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete',
          requestId: 'classify-permission-revoke',
          cancelled: false,
        }),
      ),
    );
    expect(classification.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
    expect(JSON.stringify(classification.postMessage.mock.calls)).not.toMatch(
      /private abort|private-key|api\.deepseek/iu,
    );
  });

  it('aborts a running Provider connection test when its permission is revoked', async () => {
    const fetchMock = vi.fn(
      (_input: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('private abort')), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const harness = await loadServiceWorker({
      initialOrigins: ['https://api.deepseek.com/*'],
      storageData: legacyAiStorage(),
    });

    const response = send(harness.getMessageListener(), {
      type: 'ai:testConnection',
      provider: 'deepseek',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    harness.revokeOrigins(['https://api.deepseek.com/*']);

    await expect(response).resolves.toEqual({
      ok: true,
      data: {
        success: false,
        code: 'aborted',
        message: 'AI 请求已取消',
      },
    });
  });

  it.each<BootstrapStage>(['setAccessLevel', 'firstGetAll', 'remove', 'secondGetAll'])(
    'expires permanently when %s never settles and ignores its late callback',
    async (stage) => {
      vi.useFakeTimers();
      const harness = await loadServiceWorker({
        initialOrigins: ['https://*/*'],
        stalledStage: stage,
      });
      const response = send(
        harness.getMessageListener(),
        { type: 'security:getBootstrapStatus' },
        sender('popup'),
      );
      const callsBeforeTimeout = {
        getAll: harness.getAll.mock.calls.length,
        remove: harness.removePermission.mock.calls.length,
      };

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(response).resolves.toEqual({
        ok: false,
        error: 'ShuHai security initialization failed',
        errorCode: 'security_bootstrap_failed',
      });

      harness.release(stage);
      await vi.runAllTimersAsync();
      expect(harness.getAll).toHaveBeenCalledTimes(callsBeforeTimeout.getAll);
      expect(harness.removePermission).toHaveBeenCalledTimes(callsBeforeTimeout.remove);
      expect(harness.indexedDbOpen).not.toHaveBeenCalled();
    },
  );

  it('maps bootstrap failure per route without bookmark, storage, or X side effects', async () => {
    vi.useFakeTimers();
    const harness = await loadServiceWorker({ stalledStage: 'setAccessLevel' });
    const listener = harness.getMessageListener();
    const legacy = send(listener, { type: 'state:get' });
    const bookmark = send(listener, {
      type: 'bookmarkOperations:delete',
      requestId: 'bootstrap-bookmark-1',
      bookmarkIds: ['bookmark-1'],
    });
    const x = send(
      listener,
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'bootstrap-x-failure',
      },
      sender('popup'),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(legacy).resolves.toMatchObject({
      ok: false,
      errorCode: 'storage_unavailable',
    });
    await expect(bookmark).resolves.toMatchObject({
      ok: false,
      errorCode: 'storage_read_failed',
    });
    await expect(x).resolves.toMatchObject({
      ok: false,
      error: { code: 'security_bootstrap_failed' },
    });
    expect(harness.bookmarks.getTree).not.toHaveBeenCalled();
    expect(harness.bookmarks.remove).not.toHaveBeenCalled();
    expect(harness.indexedDbOpen).not.toHaveBeenCalled();
  });

  it.each(['popup', 'sidepanel'] as const)(
    'accepts a strict %s classification port and disconnects after a correlated cancel ack',
    async (surface) => {
      const harness = await loadServiceWorker();
      const classification = extensionPort(sender(surface));

      harness.getConnectListener()(classification.port);
      expect(classification.disconnect).not.toHaveBeenCalled();

      classification.sendMessage({
        type: 'plan:create',
        requestId: `classify-${surface}-request`,
        mode: 'safe',
      });
      classification.sendMessage({
        type: 'cancel',
        requestId: `cancel-${surface}-request`,
        targetRequestId: `classify-${surface}-request`,
      });

      expect(classification.postMessage).toHaveBeenCalledWith({
        type: 'cancelled',
        requestId: `cancel-${surface}-request`,
        targetRequestId: `classify-${surface}-request`,
      });
      expect(classification.disconnect).toHaveBeenCalledOnce();
      expect(harness.bookmarks.getTree).not.toHaveBeenCalled();
    },
  );

  it('disconnects a classification port from any non-popup, non-sidepanel extension page', async () => {
    const harness = await loadServiceWorker();
    const classification = extensionPort({
      id: EXTENSION_ID,
      origin: EXTENSION_ORIGIN,
      url: `${EXTENSION_ORIGIN}/options/index.html`,
    });

    harness.getConnectListener()(classification.port);

    expect(classification.disconnect).toHaveBeenCalledOnce();
    expect(classification.postMessage).not.toHaveBeenCalled();
  });

  it('fails a mismatched classification cancel closed before reading bookmarks', async () => {
    const harness = await loadServiceWorker();
    const classification = extensionPort(sender('sidepanel'));

    harness.getConnectListener()(classification.port);
    classification.sendMessage({
      type: 'plan:create',
      requestId: 'classify-active-request',
      mode: 'safe',
    });
    classification.sendMessage({
      type: 'cancel',
      requestId: 'cancel-wrong-target',
      targetRequestId: 'classify-other-request',
    });

    expect(classification.postMessage).toHaveBeenCalledWith({
      type: 'error',
      requestId: 'cancel-wrong-target',
      error: 'Classification request failed',
      errorCode: 'operation_failed',
    });
    expect(classification.disconnect).toHaveBeenCalledOnce();
    expect(harness.bookmarks.getTree).not.toHaveBeenCalled();
  });

  it('fails a second classification plan closed before reading bookmarks', async () => {
    const harness = await loadServiceWorker();
    const classification = extensionPort(sender('popup'));

    harness.getConnectListener()(classification.port);
    classification.sendMessage({
      type: 'plan:create',
      requestId: 'classify-first-request',
      mode: 'safe',
    });
    classification.sendMessage({
      type: 'plan:create',
      requestId: 'classify-second-request',
      mode: 'full',
    });

    expect(classification.postMessage).toHaveBeenCalledWith({
      type: 'error',
      requestId: 'classify-second-request',
      error: 'Classification request failed',
      errorCode: 'classification_in_progress',
    });
    expect(classification.disconnect).toHaveBeenCalledOnce();
    expect(harness.bookmarks.getTree).not.toHaveBeenCalled();
  });

  it.each(['health', 'unknown-port'])(
    'disconnects the retired or unknown %s port without registering work or fetching',
    async (name) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const harness = await loadServiceWorker();
      const port = extensionPort(sender('sidepanel'), name);

      harness.getConnectListener()(port.port);

      expect(port.disconnect).toHaveBeenCalledOnce();
      expect(port.postMessage).not.toHaveBeenCalled();
      expect(() => port.sendMessage({ type: 'health:check' })).toThrow(
        'port message listener missing',
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(harness.bookmarks.getTree).not.toHaveBeenCalled();
    },
  );
});
