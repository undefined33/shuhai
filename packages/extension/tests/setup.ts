import { beforeEach, vi } from 'vitest';

type TreeNode = chrome.bookmarks.BookmarkTreeNode;
type StorageData = Record<string, unknown>;

let storageData: StorageData = {};
let bookmarkTree: TreeNode[] = [];
let createdNodeCount = 0;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getStorageItems(keys: string | string[] | StorageData | null | undefined): StorageData {
  if (typeof keys === 'string') {
    return Object.prototype.hasOwnProperty.call(storageData, keys)
      ? { [keys]: storageData[keys] }
      : {};
  }
  if (Array.isArray(keys)) {
    return Object.fromEntries(
      keys
        .filter((key) => Object.prototype.hasOwnProperty.call(storageData, key))
        .map((key) => [key, storageData[key]]),
    );
  }
  if (keys && typeof keys === 'object') {
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [
        key,
        Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : fallback,
      ]),
    );
  }
  return clone(storageData);
}

interface FoundNode {
  node: TreeNode;
  siblings: TreeNode[];
}

function findNode(id: string, nodes = bookmarkTree): FoundNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return { node, siblings: nodes };
    }
    const found = node.children ? findNode(id, node.children) : undefined;
    if (found) {
      return found;
    }
  }
  return undefined;
}

function reindex(nodes: TreeNode[], parentId?: string): void {
  nodes.forEach((node, index) => {
    node.index = index;
    if (parentId !== undefined) {
      node.parentId = parentId;
    }
  });
}

const runtime = {
  id: 'test-extension-id',
  lastError: undefined as chrome.runtime.LastError | undefined,
  sendMessage: vi.fn(),
  onInstalled: {
    addListener: vi.fn(),
  },
  onMessage: {
    addListener: vi.fn(),
  },
};

function callbackNotFound(callback: (nodes: TreeNode[]) => void): void {
  runtime.lastError = { message: "Can't find bookmark" };
  callback([]);
  runtime.lastError = undefined;
}

const bookmarks = {
  getTree: vi.fn(),
  get: vi.fn(),
  getChildren: vi.fn(),
  move: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  search: vi.fn(),
};

function resetBookmarkImplementations(): void {
  bookmarks.getTree.mockImplementation((callback: (results: TreeNode[]) => void) => {
    callback(clone(bookmarkTree));
  });
  bookmarks.get.mockImplementation(
    (idOrIds: string | string[], callback: (results: TreeNode[]) => void) => {
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
      const nodes = ids
        .map((id) => findNode(id)?.node)
        .filter((node): node is TreeNode => Boolean(node));
      if (nodes.length === 0) {
        callbackNotFound(callback);
        return;
      }
      callback(clone(nodes));
    },
  );
  bookmarks.getChildren.mockImplementation(
    (parentId: string, callback: (results: TreeNode[]) => void) => {
      const parent = findNode(parentId)?.node;
      if (!parent) {
        callbackNotFound(callback);
        return;
      }
      callback(clone(parent.children ?? []));
    },
  );
  bookmarks.move.mockImplementation(
    (
      id: string,
      destination: chrome.bookmarks.MoveDestination,
      callback?: (result: TreeNode) => void,
    ) => {
      const found = findNode(id);
      const target = destination.parentId ? findNode(destination.parentId)?.node : undefined;
      if (!found || !target || target.url) {
        runtime.lastError = { message: "Can't find bookmark" };
        callback?.({ id, title: '', syncing: false });
        runtime.lastError = undefined;
        return;
      }
      const oldParentId = found.node.parentId;
      found.siblings.splice(found.siblings.indexOf(found.node), 1);
      reindex(found.siblings, oldParentId);
      target.children ??= [];
      const index = Math.min(destination.index ?? target.children.length, target.children.length);
      found.node.parentId = target.id;
      target.children.splice(index, 0, found.node);
      reindex(target.children, target.id);
      callback?.(clone(found.node));
    },
  );
  bookmarks.update.mockImplementation(
    (
      id: string,
      changes: { title?: string; url?: string },
      callback?: (result: TreeNode) => void,
    ) => {
      const found = findNode(id);
      if (!found) {
        runtime.lastError = { message: "Can't find bookmark" };
        callback?.({ id, title: '', syncing: false });
        runtime.lastError = undefined;
        return;
      }
      if (changes.title !== undefined) {
        found.node.title = changes.title;
      }
      if (changes.url !== undefined) {
        found.node.url = changes.url;
      }
      callback?.(clone(found.node));
    },
  );
  bookmarks.remove.mockImplementation((id: string, callback?: () => void) => {
    const found = findNode(id);
    if (!found) {
      runtime.lastError = { message: "Can't find bookmark" };
      callback?.();
      runtime.lastError = undefined;
      return;
    }
    const parentId = found.node.parentId;
    found.siblings.splice(found.siblings.indexOf(found.node), 1);
    reindex(found.siblings, parentId);
    callback?.();
  });
  bookmarks.create.mockImplementation(
    (details: chrome.bookmarks.CreateDetails, callback?: (result: TreeNode) => void) => {
      const parent = details.parentId ? findNode(details.parentId)?.node : undefined;
      if (!parent || parent.url) {
        runtime.lastError = { message: "Can't find parent" };
        callback?.({ id: '', title: '', syncing: false });
        runtime.lastError = undefined;
        return;
      }
      createdNodeCount += 1;
      const node: TreeNode = {
        id: `created-${createdNodeCount}`,
        title: details.title ?? '',
        parentId: parent.id,
        url: details.url,
        index: 0,
        syncing: false,
        ...(details.url ? {} : { children: [] }),
      };
      parent.children ??= [];
      const index = Math.min(details.index ?? parent.children.length, parent.children.length);
      parent.children.splice(index, 0, node);
      reindex(parent.children, parent.id);
      callback?.(clone(node));
    },
  );
  bookmarks.search.mockImplementation((_query: string, callback: (results: TreeNode[]) => void) => {
    callback([]);
  });
}

const storage = {
  local: {
    get: vi.fn(),
    getBytesInUse: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    setAccessLevel: vi.fn(),
  },
  onChanged: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
};

function resetStorageImplementations(): void {
  storage.local.setAccessLevel.mockImplementation(
    (
      _options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' },
      callback?: () => void,
    ) => {
      callback?.();
    },
  );
  storage.local.get.mockImplementation(
    (keys: string | string[] | StorageData | null, callback: (items: StorageData) => void) => {
      callback(getStorageItems(keys));
    },
  );
  storage.local.getBytesInUse.mockImplementation(
    (keys: string | string[] | null, callback: (bytesInUse: number) => void) => {
      const items = getStorageItems(keys);
      callback(
        Object.keys(items).length === 0
          ? 0
          : new TextEncoder().encode(JSON.stringify(items)).byteLength,
      );
    },
  );
  storage.local.set.mockImplementation((items: StorageData, callback?: () => void) => {
    storageData = {
      ...storageData,
      ...clone(items),
    };
    callback?.();
  });
  storage.local.remove.mockImplementation((keys: string | string[], callback?: () => void) => {
    const keysToRemove = Array.isArray(keys) ? keys : [keys];
    for (const key of keysToRemove) {
      delete storageData[key];
    }
    callback?.();
  });
}

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
  bookmarkTree = clone(tree);
}

export function getBookmarkTreeSnapshot(): TreeNode[] {
  return clone(bookmarkTree);
}

export function getStorageSnapshot(): StorageData {
  return clone(storageData);
}

export function setStorageSnapshot(nextStorage: StorageData): void {
  storageData = clone(nextStorage);
}

export function getBookmarkMocks() {
  return bookmarks;
}

export function getStorageMocks() {
  return storage.local;
}

export function setRuntimeLastError(message: string | undefined): void {
  runtime.lastError = message === undefined ? undefined : { message };
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.lastError = undefined;
  storageData = {};
  bookmarkTree = [];
  createdNodeCount = 0;
  resetBookmarkImplementations();
  resetStorageImplementations();
});
