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
const MAX_SAFE_PATH_LENGTH = 512;
const MAX_SAFE_PATH_SEGMENT_LENGTH = 120;
const MAX_SAFE_DIRECTORY_ENTRIES = 20_000;
const VAULT_WIDE_WRITE_LOCK = 'vault-wide-write';
export const MAX_SAFE_VAULT_WRITE_BYTES = 16 * 1024 * 1024;
export const MAX_SAFE_VAULT_PREFIX_BYTES = 8 * 1024;
const RESERVED_DEVICE_NAME =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;
const vaultTextEncoder = new TextEncoder();

interface VaultWriteRegistryEntry {
  root: FileSystemDirectoryHandle;
  queues: Map<string, Promise<void>>;
  users: number;
}

interface ExclusiveWritableFileHandle extends FileSystemFileHandle {
  createWritable(options?: {
    keepExistingData?: boolean;
    mode?: 'exclusive' | 'siloed';
  }): Promise<FileSystemWritableFileStream>;
}

interface IterableDirectoryHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

const vaultWriteRegistry: VaultWriteRegistryEntry[] = [];
let vaultWriteRegistryQueue: Promise<void> = Promise.resolve();

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

export type VaultFileOutcomeStatus =
  | 'created'
  | 'already_exists'
  | 'changed'
  | 'renamed'
  | 'skipped'
  | 'error';

export interface VaultFileOutcome {
  status: VaultFileOutcomeStatus;
  relativePath: string;
  errorCode?:
    | 'invalid_path'
    | 'path_collision'
    | 'permission_denied'
    | 'not_found'
    | 'file_too_large'
    | 'write_failed'
    | 'read_failed';
  error?: string;
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

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    ? (error as { name?: unknown }).name === 'NotFoundError'
    : false;
}

function isPermissionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return false;
  }

  const name = (error as { name?: unknown }).name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown Vault error';
  return message.slice(0, 500);
}

function containsUnsafePathCharacter(segment: string): boolean {
  return (
    /[<>:"/\\|?*]/.test(segment) ||
    Array.from(segment).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159);
    })
  );
}

function assertStrictVaultPath(segments: readonly string[]): void {
  if (segments.length === 0) {
    throw new Error('Vault path must contain a file name');
  }

  const relativePath = segments.join('/');
  if (vaultTextEncoder.encode(relativePath).byteLength > MAX_SAFE_PATH_LENGTH) {
    throw new Error('Vault path exceeds the maximum length');
  }

  for (const segment of segments) {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment !== segment.normalize('NFC') ||
      segment !== segment.normalize('NFKC') ||
      vaultTextEncoder.encode(segment).byteLength > MAX_SAFE_PATH_SEGMENT_LENGTH ||
      containsUnsafePathCharacter(segment) ||
      /[. ]$/.test(segment) ||
      RESERVED_DEVICE_NAME.test(segment)
    ) {
      throw new Error('Vault path contains an unsafe segment');
    }
  }
}

function assertExactHandleName(actual: string, expected: string): void {
  if (actual !== expected || actual.normalize('NFC') !== expected) {
    throw new Error('Vault path collides by case or Unicode normalization');
  }
}

function vaultCollisionKey(value: string): string {
  return value.normalize('NFKC').toUpperCase().normalize('NFC');
}

async function assertNoSiblingCollision(
  directory: FileSystemDirectoryHandle,
  expectedName: string,
  expectedKind: FileSystemHandle['kind'],
): Promise<void> {
  const entries = (directory as Partial<IterableDirectoryHandle>).entries;
  if (typeof entries !== 'function') {
    throw new Error('Vault directory enumeration is unavailable');
  }

  const expectedKey = vaultCollisionKey(expectedName);
  let entryCount = 0;
  for await (const entry of entries.call(directory as IterableDirectoryHandle)) {
    entryCount += 1;
    if (entryCount > MAX_SAFE_DIRECTORY_ENTRIES) {
      throw new Error('Vault directory exceeds the bounded collision scan');
    }
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error('Vault directory returned an invalid entry');
    }

    const [listedName, handle] = entry;
    if (
      typeof listedName !== 'string' ||
      typeof handle !== 'object' ||
      handle === null ||
      typeof handle.name !== 'string' ||
      (handle.kind !== 'file' && handle.kind !== 'directory') ||
      listedName !== handle.name
    ) {
      throw new Error('Vault directory returned an invalid entry');
    }
    if (
      vaultCollisionKey(listedName) === expectedKey &&
      (listedName !== expectedName || handle.kind !== expectedKind)
    ) {
      throw new Error('Vault path collides by case, Unicode normalization, or entry kind');
    }
  }
}

async function ensureStrictDirectory(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
): Promise<FileSystemDirectoryHandle> {
  let current = root;

  for (const segment of segments) {
    await assertNoSiblingCollision(current, segment, 'directory');
    const next = await current.getDirectoryHandle(segment, { create: true });
    assertExactHandleName(next.name, segment);
    await assertNoSiblingCollision(current, segment, 'directory');
    current = next;
  }

  return current;
}

async function getExistingFileHandle(
  directory: FileSystemDirectoryHandle,
  fileName: string,
): Promise<FileSystemFileHandle | null> {
  await assertNoSiblingCollision(directory, fileName, 'file');
  try {
    const handle = await directory.getFileHandle(fileName, { create: false });
    assertExactHandleName(handle.name, fileName);
    return handle;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function withVaultWriteLock<T>(
  root: FileSystemDirectoryHandle,
  operation: () => Promise<T>,
): Promise<T> {
  const registryEntry = await acquireVaultWriteRegistryEntry(root);
  const { queues } = registryEntry;

  const previous = queues.get(VAULT_WIDE_WRITE_LOCK) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(
    () => current,
    () => current,
  );
  queues.set(VAULT_WIDE_WRITE_LOCK, queued);

  try {
    await previous.catch(() => undefined);
    return await operation();
  } finally {
    release?.();
    if (queues.get(VAULT_WIDE_WRITE_LOCK) === queued) {
      queues.delete(VAULT_WIDE_WRITE_LOCK);
    }
    await releaseVaultWriteRegistryEntry(registryEntry);
  }
}

async function withVaultWriteRegistryLock<T>(operation: () => Promise<T> | T): Promise<T> {
  const previous = vaultWriteRegistryQueue;
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(
    () => current,
    () => current,
  );
  vaultWriteRegistryQueue = queued;

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release?.();
    if (vaultWriteRegistryQueue === queued) {
      vaultWriteRegistryQueue = Promise.resolve();
    }
  }
}

async function acquireVaultWriteRegistryEntry(
  root: FileSystemDirectoryHandle,
): Promise<VaultWriteRegistryEntry> {
  return withVaultWriteRegistryLock(async () => {
    for (const entry of vaultWriteRegistry) {
      if (entry.root === root || (await entry.root.isSameEntry(root))) {
        entry.users += 1;
        return entry;
      }
    }

    const entry: VaultWriteRegistryEntry = { root, queues: new Map(), users: 1 };
    vaultWriteRegistry.push(entry);
    return entry;
  });
}

async function releaseVaultWriteRegistryEntry(entry: VaultWriteRegistryEntry): Promise<void> {
  await withVaultWriteRegistryLock(() => {
    entry.users -= 1;
    if (entry.users === 0 && entry.queues.size === 0) {
      const index = vaultWriteRegistry.indexOf(entry);
      if (index >= 0) {
        vaultWriteRegistry.splice(index, 1);
      }
    }
  });
}

export async function writeVaultFileSafely(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  content: string,
): Promise<VaultFileOutcome> {
  let relativePath = '';

  try {
    if (!Array.isArray(segments) || !segments.every((segment) => typeof segment === 'string')) {
      throw new TypeError('Vault path must be an array of strings');
    }
    relativePath = segments.join('/');
    assertStrictVaultPath(segments);
    if (typeof content !== 'string') {
      throw new TypeError('Vault content must be a string');
    }
    if (vaultTextEncoder.encode(content).byteLength > MAX_SAFE_VAULT_WRITE_BYTES) {
      return {
        status: 'error',
        relativePath,
        errorCode: 'file_too_large',
        error: 'Vault content exceeds the write limit',
      };
    }
  } catch (error) {
    return {
      status: 'error',
      relativePath,
      errorCode: 'invalid_path',
      error: safeErrorMessage(error),
    };
  }

  try {
    return await withVaultWriteLock(root, async () => {
      try {
        const directory = await ensureStrictDirectory(root, segments.slice(0, -1));
        const fileName = segments.at(-1) as string;
        if (await getExistingFileHandle(directory, fileName)) {
          return { status: 'already_exists', relativePath };
        }

        const fileHandle = await directory.getFileHandle(fileName, { create: true });
        assertExactHandleName(fileHandle.name, fileName);
        await assertNoSiblingCollision(directory, fileName, 'file');
        const writable = await (fileHandle as ExclusiveWritableFileHandle).createWritable({
          keepExistingData: true,
          mode: 'exclusive',
        });

        try {
          const snapshot = await fileHandle.getFile();
          if (snapshot.size !== 0) {
            await writable.abort('Target appeared before the exclusive writer was acquired');
            return { status: 'already_exists', relativePath };
          }
          await writable.write(content);
          await writable.close();
        } catch (error) {
          try {
            await writable.abort(error);
          } catch {
            // The original write/close error is the actionable result.
          }
          throw error;
        }

        return { status: 'created', relativePath };
      } catch (error) {
        const collision = safeErrorMessage(error).includes('collides');
        return {
          status: 'error',
          relativePath,
          errorCode: collision
            ? 'path_collision'
            : isPermissionError(error)
              ? 'permission_denied'
              : 'write_failed',
          error: safeErrorMessage(error),
        };
      }
    });
  } catch (error) {
    return {
      status: 'error',
      relativePath,
      errorCode: isPermissionError(error) ? 'permission_denied' : 'write_failed',
      error: safeErrorMessage(error),
    };
  }
}

export async function readVaultTextFile(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  maxBytes = 8 * 1024,
): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SAFE_VAULT_WRITE_BYTES) {
    throw new RangeError(
      `Vault file read limit must be an integer from 1 to ${MAX_SAFE_VAULT_WRITE_BYTES}`,
    );
  }
  const file = await getVaultFile(root, segments);
  if (!file) {
    return null;
  }
  if (file.size > maxBytes) {
    throw new Error('Vault file exceeds the read limit');
  }

  const text = await file.text();
  if (vaultTextEncoder.encode(text).byteLength > maxBytes) {
    throw new Error('Vault file exceeds the read limit');
  }
  return text;
}

export async function readVaultTextPrefix(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  maxBytes = 8 * 1024,
): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SAFE_VAULT_PREFIX_BYTES) {
    throw new RangeError(
      `Vault prefix read limit must be an integer from 1 to ${MAX_SAFE_VAULT_PREFIX_BYTES}`,
    );
  }

  const file = await getVaultFile(root, segments);
  if (!file) {
    return null;
  }

  const prefix = await file.slice(0, maxBytes + 1).text();
  if (vaultTextEncoder.encode(prefix).byteLength > maxBytes + 1) {
    throw new Error('Vault prefix reader exceeded its byte budget');
  }
  return prefix;
}

async function getVaultFile(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
): Promise<File | null> {
  assertStrictVaultPath(segments);

  let directory = root;
  try {
    for (const segment of segments.slice(0, -1)) {
      await assertNoSiblingCollision(directory, segment, 'directory');
      const next = await directory.getDirectoryHandle(segment, { create: false });
      assertExactHandleName(next.name, segment);
      directory = next;
    }

    const fileName = segments.at(-1) as string;
    const fileHandle = await getExistingFileHandle(directory, fileName);
    if (!fileHandle) {
      return null;
    }
    return fileHandle.getFile();
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function fileExists(
  directory: FileSystemDirectoryHandle,
  fileName: string,
): Promise<boolean> {
  try {
    await directory.getFileHandle(fileName, { create: false });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
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
    sourceLabel: '书签目录',
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
    sourceLabel: '历史记录',
  });

  return path;
}
