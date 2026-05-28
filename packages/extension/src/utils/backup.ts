import type { BackupRecord, BookmarkNode, MoveRecord } from '../shared/bookmark-types.js';
import {
  getLastMoveRecords,
  getLocalValue,
  removeLocalValues,
  saveLastMoveRecords,
  setLocalValues,
} from './storage.js';

const BACKUP_INDEX_KEY = 'backupIndex';
const MAX_BACKUPS = 5;

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

  const existingKeys = await getLocalValue<string[]>(BACKUP_INDEX_KEY, []);
  const nextKeys = [key, ...existingKeys].slice(0, MAX_BACKUPS);
  const staleKeys = existingKeys.slice(MAX_BACKUPS - 1);

  await setLocalValues({
    [key]: backup,
    [BACKUP_INDEX_KEY]: nextKeys,
  });

  if (staleKeys.length > 0) {
    await removeLocalValues(staleKeys);
  }

  return backup;
}

export async function listBackups(): Promise<BackupRecord[]> {
  const keys = await getLocalValue<string[]>(BACKUP_INDEX_KEY, []);

  if (keys.length === 0) {
    return [];
  }

  const backups = await Promise.all(
    keys.map((key) => getLocalValue<BackupRecord | undefined>(key, undefined)),
  );

  return backups.filter((backup): backup is BackupRecord => Boolean(backup));
}

export { getLastMoveRecords, saveLastMoveRecords };
export type { MoveRecord };
