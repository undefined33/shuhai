import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIVITY_DETAILS,
  MAX_ACTIVITY_ENTRIES,
  addActivityEntry,
  calculateActivityStats,
  filterActivityLog,
  generateActivityMarkdown,
  getActivityLog,
  groupActivityEntries,
  summarizeClassifyApply,
  trimActivityLog,
} from '../src/utils/activity-log.js';

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
