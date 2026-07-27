import type {
  BackupRecord,
  BackupSummary,
  BookmarkNode,
  MoveRecord,
} from '../shared/bookmark-types.js';
import {
  getLastMoveRecords,
  getLocalValue,
  removeLocalValues,
  saveLastMoveRecords,
  setLocalValues,
} from './storage.js';
import { addActivityEntry } from './activity-log.js';

const BACKUP_INDEX_KEY = 'backupIndex';
const MAX_BACKUPS = 5;
const BACKUP_KEY_PATTERN = /^backup_[0-9]{1,16}$/u;

function isBackupKey(value: unknown): value is string {
  return typeof value === 'string' && BACKUP_KEY_PATTERN.test(value);
}

function isBoundedIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function backupIndex(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.filter(isBackupKey))).slice(0, MAX_BACKUPS);
}

function backupSummary(value: unknown, expectedKey: string): BackupSummary | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const key = descriptors.key;
    const createdAt = descriptors.createdAt;
    const bookmarkCount = descriptors.bookmarkCount;
    if (
      !key ||
      !('value' in key) ||
      key.value !== expectedKey ||
      !isBackupKey(key.value) ||
      !createdAt ||
      !('value' in createdAt) ||
      !isBoundedIsoTimestamp(createdAt.value) ||
      !bookmarkCount ||
      !('value' in bookmarkCount) ||
      !Number.isSafeInteger(bookmarkCount.value) ||
      (bookmarkCount.value as number) < 0
    ) {
      return undefined;
    }
    return {
      key: key.value as string,
      createdAt: createdAt.value,
      bookmarkCount: bookmarkCount.value as number,
    };
  } catch {
    return undefined;
  }
}

function countBookmarks(nodes: BookmarkNode[]): number {
  let total = 0;

  for (const node of nodes) {
    if (node.url) {
      total += 1;
    }

    if (node.children) {
      total += countBookmarks(node.children);
    }
  }

  return total;
}

export async function createBackupSnapshot(
  tree: BookmarkNode[],
  now = new Date(),
): Promise<BackupRecord> {
  const key = `backup_${now.getTime()}`;
  const backup: BackupRecord = {
    key,
    createdAt: now.toISOString(),
    bookmarkCount: countBookmarks(tree),
    tree,
  };

  const existingKeys = backupIndex(await getLocalValue<unknown>(BACKUP_INDEX_KEY, []));
  const nextKeys = [key, ...existingKeys].slice(0, MAX_BACKUPS);
  const staleKeys = existingKeys.slice(MAX_BACKUPS - 1);

  await setLocalValues({
    [key]: backup,
    [BACKUP_INDEX_KEY]: nextKeys,
  });

  if (staleKeys.length > 0) {
    await removeLocalValues(staleKeys);
  }

  await addActivityEntry({
    type: 'backup_create',
    summary: `创建了书签备份（${backup.bookmarkCount} 个书签）`,
  });

  return backup;
}

export async function listBackupSummaries(): Promise<BackupSummary[]> {
  const keys = backupIndex(await getLocalValue<unknown>(BACKUP_INDEX_KEY, []));

  if (keys.length === 0) {
    return [];
  }

  const backups = await Promise.all(keys.map((key) => getLocalValue<unknown>(key, undefined)));

  return backups
    .map((backup, index) => backupSummary(backup, keys[index]!))
    .filter((summary): summary is BackupSummary => Boolean(summary));
}

export async function getBackupByKey(key: string): Promise<BackupRecord | undefined> {
  if (!isBackupKey(key)) {
    return undefined;
  }
  const keys = backupIndex(await getLocalValue<unknown>(BACKUP_INDEX_KEY, []));
  if (!keys.includes(key)) {
    return undefined;
  }
  const value = await getLocalValue<unknown>(key, undefined);
  if (!backupSummary(value, key) || value === null || typeof value !== 'object') {
    return undefined;
  }
  const tree = Object.getOwnPropertyDescriptor(value, 'tree');
  return tree && 'value' in tree && Array.isArray(tree.value) ? (value as BackupRecord) : undefined;
}

export { getLastMoveRecords, saveLastMoveRecords };
export type { MoveRecord };
