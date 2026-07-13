import {
  parseSocialItem,
  parseSyncRecord,
  WriteIntentIdSchema,
  type SocialItem,
  type SyncRecord,
} from '../social/sync-schema.js';
import {
  MAX_FRONTMATTER_BYTES,
  parseSyncFrontmatter,
  type SafeMarkdownParseErrorCode,
  type SafeSocialProperties,
} from './safe-markdown.js';

export const MAX_VAULT_INDEX_DEPTH = 4;
export const MAX_VAULT_INDEX_MARKDOWN_FILES = 10_000;
export const MAX_VAULT_INDEX_ENTRIES = 20_000;

const MAX_PATH_BYTES = 512;
const MAX_SEGMENT_BYTES = 120;
const WINDOWS_DEVICE_NAME =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;
const FORBIDDEN_PATH_CHARACTERS = /[<>:"/\\|?*]/;

interface IterableDirectoryHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

export type VaultIndexErrorCode =
  | 'invalid_path'
  | 'path_collision'
  | 'depth_limit'
  | 'entry_limit'
  | 'file_limit'
  | 'read_failed'
  | 'missing_frontmatter'
  | 'invalid_frontmatter'
  | 'frontmatter_too_large'
  | 'duplicate_record'
  | 'duplicate_canonical_url';

export interface VaultIndexError {
  code: VaultIndexErrorCode;
  relativePath: string;
  error: string;
  parserCode?: SafeMarkdownParseErrorCode;
}

export interface VaultIndexResult {
  records: SyncRecord[];
  errors: VaultIndexError[];
  partial: boolean;
  scannedEntries: number;
  scannedMarkdownFiles: number;
}

export interface RebuildVaultIndexOptions {
  relativePathPrefix?: string | readonly string[];
  maxDepth?: number;
  maxEntries?: number;
  maxMarkdownFiles?: number;
}

export interface ManagedVaultSubtreeOptions extends RebuildVaultIndexOptions {
  handle: FileSystemDirectoryHandle;
}

export interface VaultIndexRename {
  key: string;
  fromRelativePath: string;
  toRelativePath: string;
}

export interface VaultIndexChanged {
  key: string;
  catalogRecord: SyncRecord;
  rebuiltRecord: SyncRecord;
}

export interface VaultIndexReconciliation {
  renamed: VaultIndexRename[];
  changed: VaultIndexChanged[];
  catalogOrphans: SyncRecord[];
  fileOrphans: SyncRecord[];
  matched: SyncRecord[];
}

interface ScanState {
  readonly records: SyncRecord[];
  readonly errors: VaultIndexError[];
  readonly recordPaths: Map<string, string>;
  readonly canonicalPaths: Map<string, string>;
  readonly relativePathPrefix: readonly string[];
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxMarkdownFiles: number;
  scannedEntries: number;
  scannedMarkdownFiles: number;
  stopped: boolean;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159);
  });
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown Vault index error';
  return message.slice(0, 500);
}

function splitStrictPrefix(prefix: string | readonly string[]): string[] {
  const segments = typeof prefix === 'string' ? prefix.split(/[\\/]/) : [...prefix];
  assertStrictRelativePath(segments);
  return segments;
}

export function assertStrictVaultPathSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..' ||
    segment !== segment.normalize('NFC') ||
    segment !== segment.normalize('NFKC') ||
    utf8Bytes(segment) > MAX_SEGMENT_BYTES ||
    containsControlCharacter(segment) ||
    FORBIDDEN_PATH_CHARACTERS.test(segment) ||
    /[. ]$/.test(segment) ||
    WINDOWS_DEVICE_NAME.test(segment)
  ) {
    throw new Error(`Unsafe Vault path segment: ${segment}`);
  }
}

export function assertStrictRelativePath(segments: readonly string[]): void {
  if (segments.length === 0) {
    throw new Error('Vault relative path cannot be empty');
  }

  for (const segment of segments) {
    assertStrictVaultPathSegment(segment);
  }

  if (utf8Bytes(segments.join('/')) > MAX_PATH_BYTES) {
    throw new Error('Vault relative path exceeds the maximum length');
  }
}

export function buildSafeVaultPath(
  item: SocialItem,
  prefix: string | readonly string[],
  fileToken?: string,
): string[] {
  const prefixSegments = splitStrictPrefix(prefix);
  const parsedItem = parseSocialItem(item);
  const token = fileToken === undefined ? undefined : WriteIntentIdSchema.parse(fileToken);

  const fileName = token
    ? `${parsedItem.sourceItemId}-${token}.md`
    : `${parsedItem.sourceItemId}.md`;
  const segments = [...prefixSegments, parsedItem.source, fileName];
  assertStrictRelativePath(segments);
  return segments;
}

function windowsCollisionKey(name: string): string {
  return name.normalize('NFKC').toUpperCase().normalize('NFC');
}

async function listDirectoryEntries(
  directory: FileSystemDirectoryHandle,
  remainingEntries: number,
): Promise<{ entries: Array<[string, FileSystemHandle]>; exceeded: boolean }> {
  const entries: Array<[string, FileSystemHandle]> = [];
  const iterable = directory as IterableDirectoryHandle;

  for await (const entry of iterable.entries()) {
    if (entries.length >= remainingEntries) {
      return { entries, exceeded: true };
    }
    entries.push(entry);
  }

  return {
    entries: entries.sort(([left], [right]) => left.localeCompare(right, 'en')),
    exceeded: false,
  };
}

function findCollidingNames(entries: ReadonlyArray<[string, FileSystemHandle]>): Set<string> {
  const groups = new Map<string, string[]>();

  for (const [listedName, handle] of entries) {
    const names = listedName === handle.name ? [listedName] : [listedName, handle.name];
    for (const name of names) {
      const key = windowsCollisionKey(name);
      const group = groups.get(key) ?? [];
      if (!group.includes(name)) {
        group.push(name);
      }
      groups.set(key, group);
    }
  }

  const colliding = new Set<string>();
  for (const names of groups.values()) {
    if (names.length > 1) {
      for (const name of names) {
        colliding.add(name);
      }
    }
  }
  return colliding;
}

function parserErrorCode(code: SafeMarkdownParseErrorCode): VaultIndexErrorCode {
  if (code === 'frontmatter_too_large') {
    return 'frontmatter_too_large';
  }
  if (code === 'missing_frontmatter') {
    return 'missing_frontmatter';
  }
  return 'invalid_frontmatter';
}

async function readFrontmatterProbe(fileHandle: FileSystemFileHandle): Promise<string> {
  const file = await fileHandle.getFile();
  return file.slice(0, MAX_FRONTMATTER_BYTES + 1).text();
}

function recordKey(record: Pick<SyncRecord, 'source' | 'sourceItemId'>): string {
  return `${record.source}:${record.sourceItemId}`;
}

function propertiesKey(properties: SafeSocialProperties): string {
  return `${properties.source}:${properties.sourceItemId}`;
}

function toSyncRecord(properties: SafeSocialProperties, relativePath: string): SyncRecord {
  return parseSyncRecord({
    schemaVersion: 1,
    key: propertiesKey(properties),
    source: properties.source,
    sourceItemId: properties.sourceItemId,
    canonicalUrl: properties.canonicalUrl,
    relativePath,
    completeness: properties.completeness,
    contentHash: properties.contentHash,
    extractorVersion: properties.extractorVersion,
    importedAt: properties.capturedAt,
    lastSeenAt: properties.capturedAt,
  });
}

function addError(
  state: ScanState,
  code: VaultIndexErrorCode,
  relativePath: string,
  error: string,
  parserCode?: SafeMarkdownParseErrorCode,
): void {
  state.errors.push({ code, relativePath, error, parserCode });
}

async function indexMarkdownFile(
  fileHandle: FileSystemFileHandle,
  pathSegments: readonly string[],
  state: ScanState,
): Promise<void> {
  const relativePath = pathSegments.join('/');
  if (state.scannedMarkdownFiles >= state.maxMarkdownFiles) {
    if (!state.stopped) {
      addError(
        state,
        'file_limit',
        relativePath,
        `Managed subtree exceeds ${state.maxMarkdownFiles} Markdown files`,
      );
    }
    state.stopped = true;
    return;
  }
  state.scannedMarkdownFiles += 1;

  try {
    const probe = await readFrontmatterProbe(fileHandle);
    const parsed = parseSyncFrontmatter(probe);
    if (!parsed.ok) {
      addError(state, parserErrorCode(parsed.code), relativePath, parsed.error, parsed.code);
      return;
    }

    const key = propertiesKey(parsed.properties);
    const existingPath = state.recordPaths.get(key);
    if (existingPath) {
      addError(
        state,
        'duplicate_record',
        relativePath,
        `Identity already exists at ${existingPath}`,
      );
      return;
    }

    const canonicalPath = state.canonicalPaths.get(parsed.properties.canonicalUrl);
    if (canonicalPath) {
      addError(
        state,
        'duplicate_canonical_url',
        relativePath,
        `Canonical URL already exists at ${canonicalPath}`,
      );
      return;
    }

    state.recordPaths.set(key, relativePath);
    state.canonicalPaths.set(parsed.properties.canonicalUrl, relativePath);
    state.records.push(toSyncRecord(parsed.properties, relativePath));
  } catch (error) {
    addError(state, 'read_failed', relativePath, safeErrorMessage(error));
  }
}

async function scanDirectory(
  directory: FileSystemDirectoryHandle,
  nestedSegments: readonly string[],
  depth: number,
  state: ScanState,
): Promise<void> {
  let entries: Array<[string, FileSystemHandle]>;
  const directoryPath = [...state.relativePathPrefix, ...nestedSegments].join('/');
  try {
    const listing = await listDirectoryEntries(directory, state.maxEntries - state.scannedEntries);
    state.scannedEntries += listing.entries.length;
    if (listing.exceeded) {
      addError(
        state,
        'entry_limit',
        directoryPath,
        `Managed subtree exceeds ${state.maxEntries} total entries`,
      );
      state.stopped = true;
      return;
    }
    entries = listing.entries;
  } catch (error) {
    addError(state, 'read_failed', directoryPath, safeErrorMessage(error));
    return;
  }

  const collidingNames = findCollidingNames(entries);
  const reportedCollisionKeys = new Set<string>();

  for (const [listedName, handle] of entries) {
    if (state.stopped) {
      break;
    }

    const entrySegments = [...state.relativePathPrefix, ...nestedSegments, listedName];
    const relativePath = entrySegments.join('/');
    const collisionKey = windowsCollisionKey(listedName);
    if (collidingNames.has(listedName) || listedName !== handle.name) {
      if (!reportedCollisionKeys.has(collisionKey)) {
        addError(
          state,
          'path_collision',
          relativePath,
          'Directory contains a case or Unicode normalization collision',
        );
        reportedCollisionKeys.add(collisionKey);
      }
      continue;
    }

    try {
      assertStrictRelativePath(entrySegments);
    } catch (error) {
      addError(state, 'invalid_path', relativePath, safeErrorMessage(error));
      continue;
    }

    if (handle.kind === 'directory') {
      if (depth >= state.maxDepth) {
        addError(
          state,
          'depth_limit',
          relativePath,
          `Managed subtree exceeds depth ${state.maxDepth}`,
        );
        continue;
      }
      await scanDirectory(
        handle as FileSystemDirectoryHandle,
        [...nestedSegments, listedName],
        depth + 1,
        state,
      );
      continue;
    }

    if (handle.kind === 'file' && listedName.toLowerCase().endsWith('.md')) {
      await indexMarkdownFile(handle as FileSystemFileHandle, entrySegments, state);
    }
  }
}

function isManagedSubtreeOptions(
  input: FileSystemDirectoryHandle | ManagedVaultSubtreeOptions,
): input is ManagedVaultSubtreeOptions {
  return 'handle' in input;
}

function validateBudget(value: number | undefined, maximum: number, label: string): number {
  if (value === undefined) {
    return maximum;
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an integer from 0 to ${maximum}`);
  }
  return value;
}

export function rebuildVaultIndex(
  handle: FileSystemDirectoryHandle,
  options?: RebuildVaultIndexOptions,
): Promise<VaultIndexResult>;
export function rebuildVaultIndex(options: ManagedVaultSubtreeOptions): Promise<VaultIndexResult>;
export async function rebuildVaultIndex(
  input: FileSystemDirectoryHandle | ManagedVaultSubtreeOptions,
  rebuildOptions: RebuildVaultIndexOptions = {},
): Promise<VaultIndexResult> {
  const options = isManagedSubtreeOptions(input) ? input : { handle: input, ...rebuildOptions };
  const relativePathPrefix = splitStrictPrefix(options.relativePathPrefix ?? [options.handle.name]);
  if (relativePathPrefix.at(-1) !== options.handle.name) {
    throw new Error('Managed subtree prefix must end with the exact handle name');
  }
  const state: ScanState = {
    records: [],
    errors: [],
    recordPaths: new Map(),
    canonicalPaths: new Map(),
    relativePathPrefix,
    maxDepth: validateBudget(options.maxDepth, MAX_VAULT_INDEX_DEPTH, 'maxDepth'),
    maxEntries: validateBudget(options.maxEntries, MAX_VAULT_INDEX_ENTRIES, 'maxEntries'),
    maxMarkdownFiles: validateBudget(
      options.maxMarkdownFiles,
      MAX_VAULT_INDEX_MARKDOWN_FILES,
      'maxMarkdownFiles',
    ),
    scannedEntries: 0,
    scannedMarkdownFiles: 0,
    stopped: false,
  };

  await scanDirectory(options.handle, [], 0, state);
  state.records.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));

  return {
    records: state.records,
    errors: state.errors,
    partial: state.errors.length > 0,
    scannedEntries: state.scannedEntries,
    scannedMarkdownFiles: state.scannedMarkdownFiles,
  };
}

export function reconcileVaultIndex(
  catalogRecords: readonly SyncRecord[],
  rebuiltIndex: VaultIndexResult,
): VaultIndexReconciliation {
  if (rebuiltIndex.partial || rebuiltIndex.errors.length > 0) {
    throw new Error('A partial Vault index cannot produce deterministic orphan results');
  }

  const toUniqueRecordMap = (records: readonly SyncRecord[], label: string) => {
    const mapped = new Map<string, SyncRecord>();
    for (const input of records) {
      const record = parseSyncRecord(input);
      const key = recordKey(record);
      if (mapped.has(key)) {
        throw new Error(`${label} contains duplicate record identity: ${key}`);
      }
      mapped.set(key, record);
    }
    return mapped;
  };
  const catalog = toUniqueRecordMap(catalogRecords, 'Catalog');
  const rebuilt = toUniqueRecordMap(rebuiltIndex.records, 'Rebuilt index');
  const renamed: VaultIndexRename[] = [];
  const changed: VaultIndexChanged[] = [];
  const catalogOrphans: SyncRecord[] = [];
  const fileOrphans: SyncRecord[] = [];
  const matched: SyncRecord[] = [];

  for (const [key, catalogRecord] of catalog) {
    const rebuiltRecord = rebuilt.get(key);
    if (!rebuiltRecord) {
      catalogOrphans.push(catalogRecord);
      continue;
    }

    if (catalogRecord.relativePath !== rebuiltRecord.relativePath) {
      renamed.push({
        key,
        fromRelativePath: catalogRecord.relativePath,
        toRelativePath: rebuiltRecord.relativePath,
      });
    }
    if (
      catalogRecord.canonicalUrl !== rebuiltRecord.canonicalUrl ||
      catalogRecord.contentHash !== rebuiltRecord.contentHash ||
      catalogRecord.completeness !== rebuiltRecord.completeness ||
      catalogRecord.extractorVersion !== rebuiltRecord.extractorVersion
    ) {
      changed.push({ key, catalogRecord, rebuiltRecord });
      continue;
    }
    matched.push(rebuiltRecord);
  }

  for (const [key, rebuiltRecord] of rebuilt) {
    if (!catalog.has(key)) {
      fileOrphans.push(rebuiltRecord);
    }
  }

  const byKey = <T extends { source: string; sourceItemId: string }>(left: T, right: T) =>
    `${left.source}:${left.sourceItemId}`.localeCompare(
      `${right.source}:${right.sourceItemId}`,
      'en',
    );
  renamed.sort((left, right) => left.key.localeCompare(right.key, 'en'));
  changed.sort((left, right) => left.key.localeCompare(right.key, 'en'));
  catalogOrphans.sort(byKey);
  fileOrphans.sort(byKey);
  matched.sort(byKey);

  return { renamed, changed, catalogOrphans, fileOrphans, matched };
}
