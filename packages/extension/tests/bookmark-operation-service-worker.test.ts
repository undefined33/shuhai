import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { X_SYNC_PROTOCOL } from '../src/social/x-sync-messages.js';

const parseResponseMock = vi.hoisted(() => vi.fn((value: unknown) => value));
const operationMocks = vi.hoisted(() => ({
  acceptCurrent: vi.fn(),
  cancel: vi.fn(),
  executeDelete: vi.fn(),
  executeMove: vi.fn(),
  executeUpdateUrls: vi.fn(),
  reconcile: vi.fn(),
  restore: vi.fn(),
}));
const stateMocks = vi.hoisted(() => ({
  ensureTrustedLocalStorageAccess: vi.fn(async () => undefined),
  getBookmarkOperations: vi.fn(async () => []),
  getLastMoveRecords: vi.fn(async () => []),
  listBackups: vi.fn(async () => []),
  getFullTree: vi.fn(async () => []),
  flattenBookmarkTree: vi.fn(() => ({ bookmarks: [], folders: [] })),
}));

vi.mock('../src/shared/bookmark-types.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/bookmark-types.js')>();
  return {
    ...actual,
    parseBookmarkOperationCommandResponse: parseResponseMock,
  };
});

vi.mock('../src/utils/bookmark-operations.js', () => {
  class BookmarkOperationCommandError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }

  return {
    BookmarkOperationCommandError,
    acceptBookmarkOperationCurrentState: operationMocks.acceptCurrent,
    cancelBookmarkOperation: operationMocks.cancel,
    executeBookmarkMoves: operationMocks.executeMove,
    executeBookmarkUrlUpdates: operationMocks.executeUpdateUrls,
    executeDeleteBookmarks: operationMocks.executeDelete,
    reconcileInterruptedBookmarkOperations: operationMocks.reconcile,
    restoreBookmarkOperation: operationMocks.restore,
  };
});

vi.mock('../src/utils/backup.js', () => ({
  getLastMoveRecords: stateMocks.getLastMoveRecords,
  listBackups: stateMocks.listBackups,
}));

vi.mock('../src/utils/chrome-bookmarks.js', () => ({
  flattenBookmarkTree: stateMocks.flattenBookmarkTree,
  getFullTree: stateMocks.getFullTree,
}));

vi.mock('../src/utils/storage.js', () => {
  class BookmarkOperationStorageError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }

  return {
    BookmarkOperationStorageError,
    clearPendingCapture: vi.fn(async () => undefined),
    clearUrlHealthRecords: vi.fn(async () => undefined),
    ensureTrustedLocalStorageAccess: stateMocks.ensureTrustedLocalStorageAccess,
    getBookmarkOperations: stateMocks.getBookmarkOperations,
    getExportManifests: vi.fn(async () => []),
    getOnboarded: vi.fn(async () => false),
    getOnboardingProgress: vi.fn(async () => undefined),
    getPendingCaptures: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({
      useAi: false,
      activeProviderId: 'deepseek-default',
      aiProviders: [],
      customRules: [],
      templates: [],
      activeTemplateIds: {},
      defaultClassifyMode: 'safe',
      exportDirectory: 'Bookmarks',
    })),
    getUrlHealthRecords: vi.fn(async () => []),
    normalizeSettings: vi.fn((settings: unknown) => settings),
    removePendingCapture: vi.fn(async () => false),
    saveOnboarded: vi.fn(async () => undefined),
    savePendingCapture: vi.fn(async () => undefined),
    saveSettings: vi.fn(async () => undefined),
    saveUrlHealthRecords: vi.fn(async () => undefined),
  };
});

vi.mock('../src/utils/activity-log.js', () => ({
  addActivityEntry: vi.fn(async () => undefined),
}));

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
  readonly mutationMocks: {
    readonly create: ReturnType<typeof vi.fn>;
    readonly move: ReturnType<typeof vi.fn>;
    readonly remove: ReturnType<typeof vi.fn>;
    readonly update: ReturnType<typeof vi.fn>;
  };
  readonly runtimeSendMessage: ReturnType<typeof vi.fn>;
  getMessageListener(): MessageListener;
}

function event<T extends (...args: never[]) => unknown>() {
  return {
    addListener: vi.fn((_listener: T) => undefined),
    removeListener: vi.fn((_listener: T) => undefined),
  };
}

function createChromeHarness(): ChromeHarness {
  let messageListener: MessageListener | undefined;
  const mutationMocks = {
    create: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  };
  const runtimeSendMessage = vi.fn((_message: unknown, callback?: (response?: unknown) => void) =>
    callback?.(),
  );
  const runtime = {
    id: EXTENSION_ID,
    lastError: undefined,
    getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
    sendMessage: runtimeSendMessage,
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
    bookmarks: mutationMocks,
    contextMenus: {
      create: vi.fn(),
      onClicked: event(),
      removeAll: vi.fn(),
    },
    permissions: {
      getAll: vi.fn((callback: (permissions: chrome.permissions.Permissions) => void) => {
        callback({ origins: [] });
      }),
      remove: vi.fn(
        (_permissions: chrome.permissions.Permissions, callback: (removed: boolean) => void) => {
          callback(true);
        },
      ),
      onRemoved: event(),
    },
    runtime,
    scripting: {
      executeScript: vi.fn(),
    },
    sidePanel: {},
    storage: {
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

  return {
    chrome: chromeMock,
    mutationMocks,
    runtimeSendMessage,
    getMessageListener: () => {
      if (!messageListener) {
        throw new Error('service worker message listener was not installed');
      }
      return messageListener;
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

function expectNoChromeMutation(harness: ChromeHarness): void {
  expect(harness.mutationMocks.create).not.toHaveBeenCalled();
  expect(harness.mutationMocks.move).not.toHaveBeenCalled();
  expect(harness.mutationMocks.remove).not.toHaveBeenCalled();
  expect(harness.mutationMocks.update).not.toHaveBeenCalled();
}

async function loadServiceWorker(): Promise<ChromeHarness> {
  const harness = createChromeHarness();
  vi.stubGlobal('chrome', harness.chrome);
  await import('../src/background/service-worker.js');
  return harness;
}

describe('bookmark operation service worker boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('indexedDB', new IDBFactory());
    parseResponseMock.mockImplementation((value: unknown) => value);
    operationMocks.reconcile.mockResolvedValue([]);
  });

  it.each([
    {
      label: 'unknown field',
      message: {
        type: 'bookmarkOperations:delete',
        requestId: 'delete-malformed-1',
        bookmarkIds: ['bookmark-1'],
        unknown: true,
      },
    },
    {
      label: 'unknown command',
      message: {
        type: 'bookmarkOperations:unknown',
        requestId: 'unknown-command-1',
      },
    },
    {
      label: 'invalid value',
      message: {
        type: 'bookmarkOperations:updateUrls',
        requestId: 'short',
        updates: [{ id: 'bookmark-1', url: 'javascript:alert(1)' }],
      },
    },
  ])('fails a malformed command closed: $label', async ({ message }) => {
    const harness = await loadServiceWorker();

    await expect(send(harness.getMessageListener(), message, sender('popup'))).resolves.toEqual({
      ok: false,
      error: 'Bookmark operation command rejected',
      errorCode: 'invalid_request',
    });
    expect(operationMocks.reconcile).not.toHaveBeenCalled();
    expect(operationMocks.executeDelete).not.toHaveBeenCalled();
    expect(operationMocks.executeUpdateUrls).not.toHaveBeenCalled();
    expectNoChromeMutation(harness);
  });

  it.each([
    {
      label: 'wrong extension id',
      messageSender: {
        ...sender('popup'),
        id: 'b'.repeat(32),
      },
    },
    {
      label: 'sender with a tab',
      messageSender: {
        ...sender('sidepanel'),
        tab: { id: 7 } as chrome.tabs.Tab,
      },
    },
    {
      label: 'popup URL with a query',
      messageSender: {
        ...sender('popup'),
        url: `${POPUP_URL}?source=page`,
      },
    },
    {
      label: 'different extension surface',
      messageSender: {
        ...sender('sidepanel'),
        url: `chrome-extension://${EXTENSION_ID}/options/index.html`,
      },
    },
  ])('rejects a mutation from a forbidden sender: $label', async ({ messageSender }) => {
    const harness = await loadServiceWorker();

    await expect(
      send(
        harness.getMessageListener(),
        {
          type: 'bookmarkOperations:delete',
          requestId: 'sender-check-1',
          bookmarkIds: ['bookmark-1'],
        },
        messageSender,
      ),
    ).resolves.toEqual({
      ok: false,
      error: 'Bookmark operation command rejected',
      errorCode: 'forbidden_sender',
    });
    expect(operationMocks.reconcile).not.toHaveBeenCalled();
    expect(operationMocks.executeDelete).not.toHaveBeenCalled();
    expectNoChromeMutation(harness);
  });

  it.each([
    {
      label: 'delete from Popup',
      surface: 'popup' as const,
      message: {
        type: 'bookmarkOperations:delete',
        requestId: 'delete-route-1',
        bookmarkIds: ['bookmark-1'],
      },
      coreMock: operationMocks.executeDelete,
      expectedArgs: ['delete-route-1', ['bookmark-1'], 'health'],
    },
    {
      label: 'URL updates from Side Panel',
      surface: 'sidepanel' as const,
      message: {
        type: 'bookmarkOperations:updateUrls',
        requestId: 'update-route-1',
        updates: [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      },
      coreMock: operationMocks.executeUpdateUrls,
      expectedArgs: [
        'update-route-1',
        [{ id: 'bookmark-1', url: 'https://example.com/new' }],
        'health',
      ],
    },
    {
      label: 'moves from Popup',
      surface: 'popup' as const,
      message: {
        type: 'bookmarkOperations:move',
        requestId: 'move-route-1',
        moves: [
          {
            bookmarkId: 'bookmark-1',
            targetFolder: 'Research/Security',
            targetIndex: 2,
          },
        ],
      },
      coreMock: operationMocks.executeMove,
      expectedArgs: [
        'move-route-1',
        [
          {
            bookmarkId: 'bookmark-1',
            targetFolder: 'Research/Security',
            targetIndex: 2,
          },
        ],
        'classification',
      ],
    },
    {
      label: 'restore from Side Panel',
      surface: 'sidepanel' as const,
      message: {
        type: 'bookmarkOperations:restore',
        requestId: 'restore-route-1',
        operationId: 'operation-restore-1',
      },
      coreMock: operationMocks.restore,
      expectedArgs: ['restore-route-1', 'operation-restore-1'],
    },
    {
      label: 'accept current from Popup',
      surface: 'popup' as const,
      message: {
        type: 'bookmarkOperations:acceptCurrent',
        requestId: 'accept-route-1',
        operationId: 'operation-accept-1',
      },
      coreMock: operationMocks.acceptCurrent,
      expectedArgs: ['accept-route-1', 'operation-accept-1'],
    },
    {
      label: 'cancel from Side Panel',
      surface: 'sidepanel' as const,
      message: {
        type: 'bookmarkOperations:cancel',
        requestId: 'cancel-route-1',
        operationId: 'operation-cancel-1',
      },
      coreMock: operationMocks.cancel,
      expectedArgs: ['cancel-route-1', 'operation-cancel-1'],
    },
  ])(
    'reconciles and routes $label with the original requestId',
    async ({ surface, message, coreMock, expectedArgs }) => {
      const harness = await loadServiceWorker();
      const coreResponse = {
        marker: message.type,
        requestId: message.requestId,
      };
      coreMock.mockResolvedValue(coreResponse);

      await expect(send(harness.getMessageListener(), message, sender(surface))).resolves.toEqual({
        ok: true,
        data: coreResponse,
      });
      expect(operationMocks.reconcile).toHaveBeenCalledTimes(1);
      const call = coreMock.mock.calls[0] ?? [];
      expect(call.slice(0, expectedArgs.length)).toEqual(expectedArgs);
      expect(call[expectedArgs.length]).toEqual({
        onChange: expect.any(Function),
      });
      expect(operationMocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
        coreMock.mock.invocationCallOrder[0]!,
      );
      expect(parseResponseMock).toHaveBeenCalledWith(coreResponse);
      expectNoChromeMutation(harness);
    },
  );

  it('keeps operation recovery independent from state:get', async () => {
    const harness = await loadServiceWorker();

    const stateResponse = (await send(
      harness.getMessageListener(),
      { type: 'state:get' },
      sender('sidepanel'),
    )) as { ok: true; data: { bookmarkOperations: unknown[] } };
    const operationsResponse = await send(
      harness.getMessageListener(),
      { type: 'operations:getRecent' },
      sender('sidepanel'),
    );

    expect(stateResponse.ok).toBe(true);
    expect(stateResponse.data.bookmarkOperations).toEqual([]);
    expect(operationsResponse).toEqual({ ok: true, data: { operations: [] } });
    expect(stateMocks.getBookmarkOperations).toHaveBeenCalledTimes(1);
    expect(operationMocks.reconcile).not.toHaveBeenCalled();
    expectNoChromeMutation(harness);
  });

  it('publishes only a validated operation snapshot for in-flight cancellation UI', async () => {
    const operation = { id: 'operation-progress-1', status: 'running' };
    const response = { receipt: { result: { ok: true } }, operation };
    operationMocks.executeDelete.mockImplementationOnce(
      async (
        _requestId: string,
        _bookmarkIds: string[],
        _source: string,
        options: { onChange(operationValue: unknown): void },
      ) => {
        options.onChange(operation);
        return response;
      },
    );
    const harness = await loadServiceWorker();

    await send(
      harness.getMessageListener(),
      {
        type: 'bookmarkOperations:delete',
        requestId: 'progress-route-1',
        bookmarkIds: ['bookmark-1'],
      },
      sender('sidepanel'),
    );

    expect(harness.runtimeSendMessage).toHaveBeenCalledWith(
      { type: 'bookmarkOperations:progress', operation },
      expect.any(Function),
    );
  });

  it('does not reflect a core error message or private URL', async () => {
    operationMocks.executeUpdateUrls.mockRejectedValueOnce(
      new Error('failed for https://private.example/account?token=secret'),
    );
    const harness = await loadServiceWorker();

    const response = await send(
      harness.getMessageListener(),
      {
        type: 'bookmarkOperations:updateUrls',
        requestId: 'redacted-error-1',
        updates: [{ id: 'bookmark-1', url: 'https://private.example/new' }],
      },
      sender('popup'),
    );

    expect(response).toEqual({
      ok: false,
      error: 'Bookmark operation command rejected',
      errorCode: 'internal_error',
    });
    expect(JSON.stringify(response)).not.toContain('private.example');
    expectNoChromeMutation(harness);
  });

  it.each([
    {
      type: 'plan:apply',
      plan: { moves: [] },
      selectedMoveIds: [],
    },
    { type: 'plan:undoLast' },
    { type: 'bookmark:delete', id: 'bookmark-1' },
    {
      type: 'bookmark:updateUrl',
      id: 'bookmark-1',
      url: 'https://example.com/private',
    },
  ])('keeps the legacy mutation route unreachable: $type', async (message) => {
    const harness = await loadServiceWorker();

    await expect(send(harness.getMessageListener(), message, sender('popup'))).resolves.toEqual({
      ok: false,
      error: 'Extension request rejected',
      errorCode: 'invalid_request',
    });
    expect(operationMocks.reconcile).not.toHaveBeenCalled();
    expect(operationMocks.executeDelete).not.toHaveBeenCalled();
    expect(operationMocks.executeMove).not.toHaveBeenCalled();
    expect(operationMocks.executeUpdateUrls).not.toHaveBeenCalled();
    expectNoChromeMutation(harness);
  });

  it('keeps the strict X protocol route ahead of bookmark command routing', async () => {
    const harness = await loadServiceWorker();

    const response = await send(
      harness.getMessageListener(),
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'bookmarkOperations:delete',
        requestId: 'x-protocol-priority-1',
        bookmarkIds: ['bookmark-1'],
      },
      sender('popup'),
    );

    expect(response).toMatchObject({
      protocol: X_SYNC_PROTOCOL,
      ok: false,
      error: { code: 'invalid_message' },
    });
    expect(operationMocks.reconcile).not.toHaveBeenCalled();
    expect(operationMocks.executeDelete).not.toHaveBeenCalled();
    expectNoChromeMutation(harness);
  });
});
