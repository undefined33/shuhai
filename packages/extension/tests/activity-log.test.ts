import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIVITY_DETAILS,
  MAX_ACTIVITY_ENTRIES,
  addActivityEntry,
  getActivityLog,
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

  it('keeps at most 50 entries', () => {
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
});
