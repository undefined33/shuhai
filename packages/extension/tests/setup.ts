import { beforeEach, vi } from 'vitest';

type TreeNode = chrome.bookmarks.BookmarkTreeNode;
type StorageData = Record<string, unknown>;

let storageData: StorageData = {};
let bookmarkTree: TreeNode[] = [];
let createdFolderCount = 0;

function getStorageItems(keys: string | string[] | StorageData | null | undefined): StorageData {
  if (typeof keys === 'string') {
    return { [keys]: storageData[keys] };
  }

  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, storageData[key]]));
  }

  if (keys && typeof keys === 'object') {
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [
        key,
        storageData[key] ?? fallback,
      ]),
    );
  }

  return { ...storageData };
}

const runtime = {
  lastError: undefined as chrome.runtime.LastError | undefined,
  sendMessage: vi.fn(),
  onInstalled: {
    addListener: vi.fn(),
  },
  onMessage: {
    addListener: vi.fn(),
  },
};

const bookmarks = {
  getTree: vi.fn((callback: (results: TreeNode[]) => void) => {
    callback(bookmarkTree);
  }),
  move: vi.fn(
    (
      _id: string,
      _destination: chrome.bookmarks.MoveDestination,
      callback?: (result: TreeNode) => void,
    ) => {
      callback?.({ id: _id, title: 'moved', syncing: false });
    },
  ),
  update: vi.fn(
    (
      id: string,
      changes: { title?: string; url?: string },
      callback?: (result: TreeNode) => void,
    ) => {
      callback?.({ id, title: 'updated', url: changes.url, syncing: false });
    },
  ),
  remove: vi.fn((_id: string, callback?: () => void) => {
    callback?.();
  }),
  create: vi.fn(
    (
      bookmark: chrome.bookmarks.CreateDetails,
      callback?: (result: TreeNode) => void,
    ) => {
      createdFolderCount += 1;
      callback?.({
        id: `created-${createdFolderCount}`,
        title: bookmark.title ?? '',
        parentId: bookmark.parentId,
        index: 0,
        syncing: false,
      });
    },
  ),
  search: vi.fn((_query: string, callback: (results: TreeNode[]) => void) => {
    callback([]);
  }),
};

const storage = {
  local: {
    get: vi.fn((keys: string | string[] | StorageData | null, callback: (items: StorageData) => void) => {
      callback(getStorageItems(keys));
    }),
    set: vi.fn((items: StorageData, callback?: () => void) => {
      storageData = {
        ...storageData,
        ...items,
      };
      callback?.();
    }),
    remove: vi.fn((keys: string | string[], callback?: () => void) => {
      const keysToRemove = Array.isArray(keys) ? keys : [keys];
      for (const key of keysToRemove) {
        delete storageData[key];
      }
      callback?.();
    }),
  },
};

const chromeMock = {
  bookmarks,
  contextMenus: {
    create: vi.fn(),
    removeAll: vi.fn((callback?: () => void) => callback?.()),
  },
  runtime,
  scripting: {
    executeScript: vi.fn(),
  },
  storage,
} as unknown as typeof chrome;

(globalThis as unknown as { chrome: typeof chrome }).chrome = chromeMock;

export function setBookmarkTree(tree: TreeNode[]): void {
  bookmarkTree = tree;
}

export function getStorageSnapshot(): StorageData {
  return { ...storageData };
}

export function setStorageSnapshot(nextStorage: StorageData): void {
  storageData = { ...nextStorage };
}

export function getBookmarkMocks() {
  return bookmarks;
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.lastError = undefined;
  storageData = {};
  bookmarkTree = [];
  createdFolderCount = 0;
});
