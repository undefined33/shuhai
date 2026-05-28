import type {
  ApplyFailure,
  ApplyResult,
  BookmarkItem,
  BookmarkNode,
  ClassificationPlan,
  FolderItem,
  MovePlan,
  MoveRecord,
} from '../shared/bookmark-types.js';
import { normalizeFolderPath, stripRootFolder } from '../shared/classifier.js';
import { createBackupSnapshot, saveLastMoveRecords } from './backup.js';

interface BookmarkTreeSummary {
  bookmarks: BookmarkItem[];
  folders: FolderItem[];
  rootParentId: string;
}

function getLastError(): Error | undefined {
  const message = chrome.runtime.lastError?.message;
  return message ? new Error(message) : undefined;
}

function isBookmarkNode(node: BookmarkNode): boolean {
  return Boolean(node.url);
}

function countBookmarks(node: chrome.bookmarks.BookmarkTreeNode): number {
  if (node.url) {
    return 1;
  }

  return (node.children ?? []).reduce((total, child) => total + countBookmarks(child), 0);
}

function toBookmarkNode(
  node: chrome.bookmarks.BookmarkTreeNode,
  parentPath = '',
): BookmarkNode {
  const title = node.title ?? '';
  const folderPath = node.url ? parentPath : normalizeFolderPath(`${parentPath}/${title}`);
  const children = node.children?.map((child) => toBookmarkNode(child, folderPath));

  return {
    id: node.id,
    title,
    url: node.url,
    parentId: node.parentId,
    index: node.index,
    dateAdded: node.dateAdded,
    children,
    folderPath,
    bookmarkCount: countBookmarks(node),
  };
}

export function getFullTree(): Promise<BookmarkNode[]> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((nodes) => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve(nodes.map((node) => toBookmarkNode(node)));
    });
  });
}

export function moveBookmark(
  id: string,
  destination: chrome.bookmarks.MoveDestination,
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.move(id, destination, () => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function updateBookmarkUrl(id: string, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.update(id, { url }, () => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function removeBookmark(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.remove(id, () => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function createFolder(title: string, parentId: string): Promise<BookmarkNode> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create({ parentId, title }, (node) => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve(toBookmarkNode(node));
    });
  });
}

export function searchBookmarks(query: string): Promise<BookmarkNode[]> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.search(query, (nodes) => {
      const error = getLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve(nodes.map((node) => toBookmarkNode(node)));
    });
  });
}

function getDefaultParentFolderId(nodes: BookmarkNode[]): string {
  const root = nodes[0];
  const folders = root?.children?.filter((node) => !isBookmarkNode(node)) ?? [];
  const bookmarkBar = folders.find((folder) =>
    ['Bookmarks Bar', '书签栏'].includes(folder.title),
  );

  return bookmarkBar?.id ?? folders[0]?.id ?? root?.id ?? '1';
}

function flattenNode(
  node: BookmarkNode,
  nodesById: Map<string, BookmarkNode>,
  bookmarks: BookmarkItem[],
  folders: FolderItem[],
): void {
  nodesById.set(node.id, node);

  if (!isBookmarkNode(node)) {
    folders.push({
      id: node.id,
      title: node.title,
      path: node.folderPath,
      parentId: node.parentId,
      bookmarkCount: node.bookmarkCount,
    });
  }

  if (node.url && node.parentId) {
    const parent = nodesById.get(node.parentId);

    bookmarks.push({
      id: node.id,
      title: node.title,
      url: node.url,
      parentId: node.parentId,
      parentTitle: parent?.title ?? '',
      parentPath: parent?.folderPath ?? '',
      index: node.index ?? 0,
      dateAdded: node.dateAdded,
    });
  }

  for (const child of node.children ?? []) {
    flattenNode(child, nodesById, bookmarks, folders);
  }
}

export function flattenBookmarkTree(nodes: BookmarkNode[]): BookmarkTreeSummary {
  const bookmarks: BookmarkItem[] = [];
  const folders: FolderItem[] = [];
  const nodesById = new Map<string, BookmarkNode>();

  for (const node of nodes) {
    flattenNode(node, nodesById, bookmarks, folders);
  }

  return {
    bookmarks,
    folders,
    rootParentId: getDefaultParentFolderId(nodes),
  };
}

function makeFolderMap(folders: FolderItem[]): Map<string, FolderItem> {
  const map = new Map<string, FolderItem>();

  for (const folder of folders) {
    const path = stripRootFolder(folder.path);
    if (path) {
      map.set(path, folder);
    }
  }

  return map;
}

async function ensureFolderPath(
  targetFolder: string,
  folders: FolderItem[],
  rootParentId: string,
): Promise<FolderItem> {
  const segments = normalizeFolderPath(targetFolder).split('/').filter(Boolean);
  const folderMap = makeFolderMap(folders);
  let parentId = rootParentId;
  let currentPath = '';

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = folderMap.get(currentPath);

    if (existing) {
      parentId = existing.id;
      continue;
    }

    const created = await createFolder(segment, parentId);
    const folder: FolderItem = {
      id: created.id,
      title: created.title,
      path: currentPath,
      parentId,
      bookmarkCount: 0,
    };

    folders.push(folder);
    folderMap.set(currentPath, folder);
    parentId = folder.id;
  }

  const folder = folderMap.get(segments.join('/'));
  if (!folder) {
    throw new Error(`Cannot create target folder: ${targetFolder}`);
  }

  return folder;
}

function selectedMoves(plan: ClassificationPlan, selectedMoveIds: string[]): MovePlan[] {
  const selected = new Set(selectedMoveIds);
  return plan.moves.filter((move) => selected.has(move.id));
}

export async function applyClassificationPlan(
  plan: ClassificationPlan,
  selectedMoveIds: string[],
): Promise<ApplyResult> {
  const moves = selectedMoves(plan, selectedMoveIds);

  if (moves.length === 0) {
    return {
      moved: 0,
      failed: [],
      backupKey: '',
      records: [],
    };
  }

  const tree = await getFullTree();
  const backup = await createBackupSnapshot(tree);
  const summary = flattenBookmarkTree(tree);
  const bookmarksById = new Map(summary.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const records: MoveRecord[] = [];
  const failed: ApplyFailure[] = [];

  for (const move of moves) {
    const bookmark = bookmarksById.get(move.bookmarkId);

    if (!bookmark) {
      failed.push({
        bookmarkId: move.bookmarkId,
        bookmarkTitle: move.bookmarkTitle,
        error: '书签不存在，可能已经被删除',
      });
      continue;
    }

    try {
      const targetFolder = await ensureFolderPath(
        move.targetFolder,
        summary.folders,
        summary.rootParentId,
      );

      await moveBookmark(move.bookmarkId, { parentId: targetFolder.id });
      records.push({
        bookmarkId: move.bookmarkId,
        bookmarkTitle: move.bookmarkTitle,
        fromParentId: bookmark.parentId,
        fromIndex: bookmark.index,
        toParentId: targetFolder.id,
      });
    } catch (error) {
      failed.push({
        bookmarkId: move.bookmarkId,
        bookmarkTitle: move.bookmarkTitle,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await saveLastMoveRecords(records);

  return {
    moved: records.length,
    failed,
    backupKey: backup.key,
    records,
  };
}

function assertHttpUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return;
    }
  } catch {
    // Fall through to the shared error below.
  }

  throw new Error('只允许替换为 http/https 链接');
}

export async function updateBookmarkUrlWithBackup(
  id: string,
  url: string,
): Promise<{ updated: boolean; backupKey: string }> {
  assertHttpUrl(url);
  const tree = await getFullTree();
  const backup = await createBackupSnapshot(tree);
  await updateBookmarkUrl(id, url);

  return {
    updated: true,
    backupKey: backup.key,
  };
}

export async function removeBookmarkWithBackup(
  id: string,
): Promise<{ deleted: boolean; backupKey: string }> {
  const tree = await getFullTree();
  const backup = await createBackupSnapshot(tree);
  await removeBookmark(id);

  return {
    deleted: true,
    backupKey: backup.key,
  };
}

export async function undoMoveRecords(records: MoveRecord[]): Promise<number> {
  const reversed = [...records].reverse();
  let undone = 0;

  for (const record of reversed) {
    await moveBookmark(record.bookmarkId, {
      parentId: record.fromParentId,
      index: record.fromIndex,
    });
    undone += 1;
  }

  await saveLastMoveRecords([]);
  return undone;
}
