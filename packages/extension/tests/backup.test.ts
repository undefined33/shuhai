import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '../src/shared/bookmark-types.js';
import { createBackupSnapshot, getBackupByKey, listBackupSummaries } from '../src/utils/backup.js';
import { getStorageSnapshot, setStorageSnapshot } from './setup.js';

const tree: BookmarkNode[] = [
  {
    id: '0',
    title: '',
    folderPath: '',
    bookmarkCount: 1,
    children: [
      {
        id: '1',
        title: 'Bookmarks Bar',
        folderPath: 'Bookmarks Bar',
        bookmarkCount: 1,
        children: [
          {
            id: '10',
            title: 'Example',
            url: 'https://example.com',
            parentId: '1',
            index: 0,
            folderPath: 'Bookmarks Bar',
            bookmarkCount: 1,
          },
        ],
      },
    ],
  },
];

describe('backup utilities', () => {
  it('stores bookmark backups and keeps only the latest five', async () => {
    for (let index = 0; index < 6; index += 1) {
      await createBackupSnapshot(tree, new Date(1_700_000_000_000 + index));
    }

    const backups = await listBackupSummaries();
    const storage = getStorageSnapshot();

    expect(backups).toHaveLength(5);
    expect(backups[0]?.bookmarkCount).toBe(1);
    expect(backups[0]).not.toHaveProperty('tree');
    expect(storage.backup_1700000000000).toBeUndefined();
  });

  it('returns one exact indexed backup and rejects invalid or unindexed keys', async () => {
    const backup = await createBackupSnapshot(tree, new Date(1_700_000_000_000));

    await expect(getBackupByKey(backup.key)).resolves.toEqual(backup);
    await expect(getBackupByKey('backup_1700000000001')).resolves.toBeUndefined();
    await expect(getBackupByKey('../backup_1700000000000')).resolves.toBeUndefined();
  });

  it('omits malformed index entries and metadata without enumerating arbitrary keys', async () => {
    setStorageSnapshot({
      backupIndex: [
        'backup_1700000000000',
        'private-key',
        'backup_1700000000001',
        'backup_1700000000002',
        'backup_1700000000003',
        'backup_1700000000004',
        'backup_1700000000005',
      ],
      backup_1700000000000: {
        key: 'backup_1700000000000',
        createdAt: new Date(0).toISOString(),
        bookmarkCount: 1,
        tree,
      },
      backup_1700000000001: {
        key: 'different-key',
        createdAt: new Date(0).toISOString(),
        bookmarkCount: 1,
        tree,
      },
    });

    await expect(listBackupSummaries()).resolves.toEqual([
      {
        key: 'backup_1700000000000',
        createdAt: new Date(0).toISOString(),
        bookmarkCount: 1,
      },
    ]);
    await expect(getBackupByKey('backup_1700000000005')).resolves.toBeUndefined();
  });

  it('sanitizes a corrupted index before rotating backups and preserves unrelated storage', async () => {
    setStorageSnapshot({
      backupIndex: ['private-key', { key: 'backup_1700000000000' }],
      'private-key': { secret: true },
    });

    const backup = await createBackupSnapshot(tree, new Date(1_700_000_000_000));
    const storage = getStorageSnapshot();

    expect(storage.backupIndex).toEqual([backup.key]);
    expect(storage['private-key']).toEqual({ secret: true });
  });
});
