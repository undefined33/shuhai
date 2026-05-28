import { describe, expect, it } from 'vitest';
import type { ClassificationPlan } from '../src/shared/bookmark-types.js';
import {
  applyClassificationPlan,
  flattenBookmarkTree,
  getFullTree,
  undoMoveRecords,
} from '../src/utils/chrome-bookmarks.js';
import { getBookmarkMocks, setBookmarkTree } from './setup.js';

function chromeTree(): chrome.bookmarks.BookmarkTreeNode[] {
  return [
    {
      id: '0',
      title: '',
      syncing: false,
      children: [
        {
          id: '1',
          title: 'Bookmarks Bar',
          parentId: '0',
          index: 0,
          syncing: false,
          children: [
            {
              id: '10',
              title: 'Exploit DB',
              url: 'https://www.exploit-db.com/exploits/1',
              parentId: '1',
              index: 0,
              syncing: false,
            },
          ],
        },
      ],
    },
  ];
}

describe('chrome bookmark utilities', () => {
  it('reads and flattens the Chrome bookmark tree', async () => {
    setBookmarkTree(chromeTree());

    const tree = await getFullTree();
    const summary = flattenBookmarkTree(tree);

    expect(summary.bookmarks).toHaveLength(1);
    expect(summary.bookmarks[0]?.parentPath).toBe('Bookmarks Bar');
    expect(summary.rootParentId).toBe('1');
  });

  it('creates a backup, creates target folders, and moves selected bookmarks', async () => {
    setBookmarkTree(chromeTree());
    const plan: ClassificationPlan = {
      mode: 'safe',
      generatedAt: new Date(0).toISOString(),
      moves: [
        {
          id: '10:安全/漏洞',
          bookmarkId: '10',
          bookmarkTitle: 'Exploit DB',
          bookmarkUrl: 'https://www.exploit-db.com/exploits/1',
          currentFolder: 'Bookmarks Bar',
          targetFolder: '安全/漏洞',
          confidence: 0.95,
          reason: 'rule',
          ruleName: 'domain:exploit-db.com',
          tags: ['exploit'],
          selected: true,
        },
      ],
      newFolders: ['安全/漏洞'],
      totalBookmarks: 1,
      unchanged: 0,
    };

    const result = await applyClassificationPlan(plan, ['10:安全/漏洞']);
    const mocks = getBookmarkMocks();

    expect(result.moved).toBe(1);
    expect(result.backupKey).toMatch(/^backup_/);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.move).toHaveBeenCalledWith('10', { parentId: 'created-2' }, expect.any(Function));
  });

  it('undoes move records in reverse order', async () => {
    const undone = await undoMoveRecords([
      {
        bookmarkId: '10',
        bookmarkTitle: 'A',
        fromParentId: '1',
        fromIndex: 0,
        toParentId: '2',
      },
      {
        bookmarkId: '11',
        bookmarkTitle: 'B',
        fromParentId: '1',
        fromIndex: 1,
        toParentId: '2',
      },
    ]);
    const mocks = getBookmarkMocks();

    expect(undone).toBe(2);
    expect(mocks.move).toHaveBeenNthCalledWith(
      1,
      '11',
      { parentId: '1', index: 1 },
      expect.any(Function),
    );
    expect(mocks.move).toHaveBeenNthCalledWith(
      2,
      '10',
      { parentId: '1', index: 0 },
      expect.any(Function),
    );
  });
});
