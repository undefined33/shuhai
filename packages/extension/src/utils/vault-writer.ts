import type {
  BookmarkItem,
  AppSettings,
  CapturedContent,
  ExportManifest,
  ExportPreview,
  MovePlan,
} from '../shared/bookmark-types.js';
import { stripRootFolder } from '../shared/classifier.js';
import { generateBookmarkMarkdown, generateCapturedContentMarkdown } from './markdown-generator.js';
import {
  assertSafeRelativePath,
  sanitizeFileName,
  sanitizePathSegment,
  sanitizeRelativePath,
} from './sanitize.js';
import {
  addActivityEntry,
  generateActivityMarkdown,
  summarizeVaultExport,
  type ActivityEntry,
} from './activity-log.js';
import { saveExportManifest } from './storage.js';

const DB_NAME = 'shuhai-vault';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const VAULT_HANDLE_KEY = 'vault';

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
}

interface PermissionedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface ExportOptions {
  directoryPrefix: string;
  moves?: MovePlan[];
  signal?: AbortSignal;
  settings?: Pick<AppSettings, 'templates' | 'activeTemplateIds'>;
}

export interface ExportResult {
  exported: number;
  skipped: number;
  errors: Array<{ path: string; error: string }>;
  files: string[];
  manifest: ExportManifest;
}

function captureSourceFolder(source: CapturedContent['source']): string {
  if (source === 'article') {
    return '文章';
  }

  return source;
}

function captureSourceLabel(source: CapturedContent['source']): string {
  if (source === 'article') {
    return '文章';
  }

  if (source === 'twitter') {
    return 'Twitter/X';
  }

  return '微博';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(request.error ?? new Error('Cannot open IndexedDB'));
    request.onsuccess = () => resolve(request.result);
  });
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(key);

        request.onerror = () => reject(request.error ?? new Error('Cannot read vault handle'));
        request.onsuccess = () => resolve(request.result as T | undefined);
        transaction.oncomplete = () => db.close();
      }),
  );
}

function idbSet(key: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const request = transaction.objectStore(STORE_NAME).put(value, key);

        request.onerror = () => reject(request.error ?? new Error('Cannot save vault handle'));
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Cannot save vault handle'));
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
      }),
  );
}

export async function getVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  return (await idbGet<FileSystemDirectoryHandle>(VAULT_HANDLE_KEY)) ?? null;
}

export async function requestVaultAccess(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;

  if (!picker) {
    throw new Error('当前浏览器不支持 File System Access API');
  }

  const handle = await picker({
    id: 'shuhai-obsidian-vault',
    mode: 'readwrite',
  });
  await idbSet(VAULT_HANDLE_KEY, handle);
  return handle;
}

export async function checkVaultPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const permissioned = handle as PermissionedDirectoryHandle;
  const descriptor = { mode: 'readwrite' as const };
  const current = await permissioned.queryPermission(descriptor);

  if (current === 'granted') {
    return true;
  }

  const requested = await permissioned.requestPermission(descriptor);
  return requested === 'granted';
}

function moveByBookmarkId(moves: MovePlan[] = []): Map<string, MovePlan> {
  return new Map(moves.map((move) => [move.bookmarkId, move]));
}

export function buildBookmarkExportPath(bookmark: BookmarkItem, options: ExportOptions): string[] {
  const move = moveByBookmarkId(options.moves).get(bookmark.id);
  const folder = stripRootFolder(move?.targetFolder ?? bookmark.parentPath);
  const prefix = sanitizeRelativePath(options.directoryPrefix || 'Bookmarks');
  const folderSegments = sanitizeRelativePath(folder);
  const fileName = sanitizeFileName(bookmark.title || bookmark.url);
  const segments = [...prefix, ...folderSegments, fileName];

  assertSafeRelativePath(segments);
  return segments;
}

export function buildCaptureExportPath(
  capture: CapturedContent,
  directoryPrefix: string,
): string[] {
  const prefix = sanitizeRelativePath(directoryPrefix || 'Bookmarks');
  const source = sanitizePathSegment(captureSourceFolder(capture.source));
  const fileName = sanitizeFileName(capture.title || capture.url);
  const segments = [...prefix, source, fileName];

  assertSafeRelativePath(segments);
  return segments;
}

export function previewBookmarkExport(
  bookmarks: BookmarkItem[],
  options: ExportOptions,
): ExportPreview {
  const counts = new Map<string, number>();

  for (const bookmark of bookmarks) {
    const segments = buildBookmarkExportPath(bookmark, options);
    const folder = segments.slice(0, -1).join('/');
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }

  return {
    total: bookmarks.length,
    folders: Array.from(counts.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)),
  };
}

async function ensureDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle> {
  let current = root;

  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }

  return current;
}

async function fileExists(
  directory: FileSystemDirectoryHandle,
  fileName: string,
): Promise<boolean> {
  try {
    await directory.getFileHandle(fileName, { create: false });
    return true;
  } catch {
    return false;
  }
}

async function writeTextFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  content: string,
): Promise<void> {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();

  await writable.write(content);
  await writable.close();
}

export async function exportBookmarksToVault(
  handle: FileSystemDirectoryHandle,
  bookmarks: BookmarkItem[],
  options: ExportOptions,
  onProgress?: (done: number, total: number, path?: string) => void,
): Promise<ExportResult> {
  const manifest: ExportManifest = {
    id: crypto.randomUUID(),
    exportedAt: new Date().toISOString(),
    vaultPath: handle.name,
    files: [],
    fileLabels: [],
    bookmarkCount: bookmarks.length,
    type: 'bookmark-index',
    sourceLabel: '书签索引',
  };
  const result: ExportResult = {
    exported: 0,
    skipped: 0,
    errors: [],
    files: manifest.files,
    manifest,
  };
  const moves = moveByBookmarkId(options.moves);

  for (const bookmark of bookmarks) {
    if (options.signal?.aborted) {
      break;
    }

    const segments = buildBookmarkExportPath(bookmark, options);
    const fileName = segments.at(-1) ?? sanitizeFileName(bookmark.title || bookmark.url);
    const folderSegments = segments.slice(0, -1);
    const relativePath = segments.join('/');

    try {
      const directory = await ensureDirectory(handle, folderSegments);
      if (await fileExists(directory, fileName)) {
        result.skipped += 1;
      } else {
        await writeTextFile(
          directory,
          fileName,
          generateBookmarkMarkdown(bookmark, moves.get(bookmark.id), new Date(), options.settings),
        );
        result.exported += 1;
        result.files.push(relativePath);
        result.manifest.fileLabels?.push(fileName);
      }
    } catch (error) {
      result.errors.push({
        path: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    onProgress?.(
      result.exported + result.skipped + result.errors.length,
      bookmarks.length,
      relativePath,
    );
  }

  await saveExportManifest(manifest);
  if (result.exported > 0) {
    await addActivityEntry({
      type: 'vault_export',
      summary: summarizeVaultExport(result.exported, options.directoryPrefix),
      details: result.files.map((file) => ({ label: file })),
    });
  }
  return result;
}

export async function exportCaptureToVault(
  handle: FileSystemDirectoryHandle,
  capture: CapturedContent,
  directoryPrefix: string,
  settings?: Pick<AppSettings, 'templates' | 'activeTemplateIds'>,
): Promise<ExportResult> {
  const segments = buildCaptureExportPath(capture, directoryPrefix);
  const fileName = segments.at(-1) ?? sanitizeFileName(capture.title || capture.url);
  const folderSegments = segments.slice(0, -1);
  const relativePath = segments.join('/');
  const manifest: ExportManifest = {
    id: crypto.randomUUID(),
    exportedAt: new Date().toISOString(),
    vaultPath: handle.name,
    files: [],
    fileLabels: [],
    bookmarkCount: 1,
    type: 'capture',
    sourceLabel: captureSourceLabel(capture.source),
  };
  const result: ExportResult = {
    exported: 0,
    skipped: 0,
    errors: [],
    files: manifest.files,
    manifest,
  };

  try {
    const directory = await ensureDirectory(handle, folderSegments);
    if (await fileExists(directory, fileName)) {
      result.skipped = 1;
    } else {
      await writeTextFile(
        directory,
        fileName,
        generateCapturedContentMarkdown(capture, new Date(), settings),
      );
      result.exported = 1;
      result.files.push(relativePath);
      result.manifest.fileLabels?.push(fileName);
    }
  } catch (error) {
    result.errors.push({
      path: relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await saveExportManifest(manifest);
  if (result.exported > 0) {
    await addActivityEntry({
      type: 'vault_export',
      summary: summarizeVaultExport(result.exported, directoryPrefix),
      details: result.files.map((file) => ({ label: file })),
    });
  }
  return result;
}

export async function exportActivityLogToVault(
  handle: FileSystemDirectoryHandle,
  entries: ActivityEntry[],
  directoryPrefix: string,
): Promise<string> {
  const prefix = sanitizeRelativePath(directoryPrefix || 'Bookmarks');
  const segments = [...prefix, '_activity'];
  assertSafeRelativePath(segments);

  const directory = await ensureDirectory(handle, segments);
  const content = generateActivityMarkdown(entries);
  await writeTextFile(directory, 'activity-log.md', content);

  const path = [...segments, 'activity-log.md'].join('/');
  await saveExportManifest({
    id: crypto.randomUUID(),
    exportedAt: new Date().toISOString(),
    vaultPath: handle.name,
    files: [path],
    fileLabels: ['activity-log.md'],
    bookmarkCount: entries.length,
    type: 'activity',
    sourceLabel: '操作历史',
  });

  return path;
}
