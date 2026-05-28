import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '../src/shared/bookmark-types.js';
import { createBackupSnapshot, listBackups } from '../src/utils/backup.js';
import { getStorageSnapshot } from './setup.js';

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

    const backups = await listBackups();
    const storage = getStorageSnapshot();

    expect(backups).toHaveLength(5);
    expect(backups[0]?.bookmarkCount).toBe(1);
    expect(storage.backup_1700000000000).toBeUndefined();
  });
});
