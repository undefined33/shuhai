import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LOG_KEY,
  MAX_ACTIVITY_DETAILS,
  MAX_ACTIVITY_ENTRIES,
  addActivityEntry,
  addXItemReviewActivity,
  calculateActivityStats,
  filterActivityLog,
  generateActivityMarkdown,
  getActivityLog,
  groupActivityEntries,
  summarizeClassifyApply,
  trimActivityLog,
} from '../src/utils/activity-log.js';
import { getStorageMocks, getStorageSnapshot, setStorageSnapshot } from './setup.js';

describe('activity log', () => {
  it('stores newest entries first and trims details', async () => {
    await addActivityEntry({
      type: 'classify_apply',
      summary: '整理了 30 个书签到 3 个文件夹',
      details: Array.from({ length: MAX_ACTIVITY_DETAILS + 5 }, (_, index) => ({
        label: `Bookmark ${index}`,
      })),
    });

    const entries = await getActivityLog();

    expect(entries).toHaveLength(1);
    expect(entries[0].details).toHaveLength(MAX_ACTIVITY_DETAILS);
  });

  it('redacts legacy capture content before writing it to storage', async () => {
    const entry = await addActivityEntry({
      type: 'capture_save',
      summary: 'https://private.example/path?token=secret-value',
      details: [
        {
          label: 'Authorization',
          meta: 'Bearer private-secret',
        },
      ],
    });

    const stored = getStorageSnapshot()[ACTIVITY_LOG_KEY];
    const serialized = JSON.stringify(stored);

    expect(entry).toMatchObject({
      type: 'capture_save',
      summary: '旧内容保存记录',
    });
    expect(entry).not.toHaveProperty('details');
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('private-secret');
  });

  it('normalizes stored legacy capture content without rewriting storage', async () => {
    setStorageSnapshot({
      [ACTIVITY_LOG_KEY]: [
        {
          id: 'legacy-capture',
          type: 'capture_save',
          timestamp: '2026-07-18T00:00:00.000Z',
          summary: 'https://private.example/legacy',
          details: [{ label: 'Cookie', meta: 'session=private' }],
        },
      ],
    });

    const entries = await getActivityLog();

    expect(entries).toEqual([
      {
        id: 'legacy-capture',
        type: 'capture_save',
        timestamp: '2026-07-18T00:00:00.000Z',
        summary: '旧内容保存记录',
      },
    ]);
    expect(getStorageMocks().set).not.toHaveBeenCalled();
    expect(JSON.stringify(getStorageSnapshot())).toContain('private.example/legacy');
  });

  it('rejects accessor input without invoking it or writing storage', async () => {
    let getterInvoked = false;
    const input = {
      type: 'capture_save',
    } as Record<string, unknown>;
    Object.defineProperty(input, 'summary', {
      enumerable: true,
      get() {
        getterInvoked = true;
        return 'must-not-run';
      },
    });

    await expect(addActivityEntry(input as never)).rejects.toThrow();

    expect(getterInvoked).toBe(false);
    expect(getStorageMocks().set).not.toHaveBeenCalled();
    expect(getStorageSnapshot()).toEqual({});
  });

  it('stores X review activity with only fixed bounded fields', async () => {
    const entry = await addXItemReviewActivity('changed', 'review_ready');

    expect(entry.summary).toBe('X 收藏已进入复核');
    expect(entry.details).toEqual([
      { label: 'source', meta: 'x' },
      { label: 'classification', meta: 'changed' },
      { label: 'outcome', meta: 'review_ready' },
    ]);
    expect(Object.keys(entry)).toEqual(['id', 'type', 'timestamp', 'summary', 'details']);
  });

  it('fails malformed stored X review activity closed without rewriting it', async () => {
    setStorageSnapshot({
      [ACTIVITY_LOG_KEY]: [
        {
          id: 'malformed-x-review',
          type: 'x_item_review',
          timestamp: '2026-07-18T00:00:00.000Z',
          summary: 'untrusted',
          details: [{ label: 'source', meta: 'x' }],
        },
      ],
    });

    await expect(getActivityLog()).rejects.toThrow('activity_log_invalid');

    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('keeps at most 200 entries', () => {
    const entries = Array.from({ length: MAX_ACTIVITY_ENTRIES + 5 }, (_, index) => ({
      id: `entry-${index}`,
      type: 'capture_save' as const,
      summary: `Entry ${index}`,
      timestamp: new Date(index * 1000).toISOString(),
    }));

    const trimmed = trimActivityLog(entries);

    expect(trimmed).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(trimmed[0].summary).toBe(`Entry ${MAX_ACTIVITY_ENTRIES + 4}`);
  });

  it('generates classify summaries', () => {
    expect(summarizeClassifyApply(12, 3)).toBe('整理了 12 个书签到 3 个文件夹');
  });

  it('filters by type, keyword and date range', () => {
    const entries = [
      {
        id: '1',
        type: 'vault_export' as const,
        summary: '写入 GitHub 索引',
        timestamp: '2026-05-20T10:00:00Z',
        details: [{ label: 'github.md' }],
      },
      {
        id: '2',
        type: 'health_delete' as const,
        summary: '删除检查失败书签',
        timestamp: '2026-05-21T10:00:00Z',
      },
    ];

    expect(
      filterActivityLog(entries, {
        types: ['vault_export'],
        keyword: 'github',
        dateFrom: '2026-05-20',
        dateTo: '2026-05-20',
      }),
    ).toEqual([entries[0]]);
  });

  it('groups entries into smart date buckets and calculates stats', () => {
    const now = new Date('2026-05-29T12:00:00');
    const entries = [
      {
        id: 'today',
        type: 'capture_save' as const,
        summary: '保存内容',
        timestamp: '2026-05-29T08:00:00',
      },
      {
        id: 'yesterday',
        type: 'backup_create' as const,
        summary: '创建备份',
        timestamp: '2026-05-28T08:00:00',
      },
      {
        id: 'last-week',
        type: 'vault_export' as const,
        summary: '写入 Vault',
        timestamp: '2026-05-20T08:00:00',
      },
    ];

    expect(groupActivityEntries(entries, now).map((group) => group.label)).toEqual([
      '今天',
      '昨天',
      '上周',
    ]);
    expect(calculateActivityStats(entries, now).thisWeek).toBe(2);
  });

  it('exports sanitized markdown', () => {
    const markdown = generateActivityMarkdown([
      {
        id: 'evil',
        type: 'capture_save',
        summary: '保存 <% tp.system.exec("calc") %>',
        timestamp: '2026-05-29T00:00:00Z',
        details: [{ label: '![x](https://example.com/x.png)' }],
      },
    ]);

    expect(markdown).toContain('<\\%');
    expect(markdown).toContain('[图片: x](https://example.com/x.png)');
    expect(markdown).not.toContain('![');
  });
});
