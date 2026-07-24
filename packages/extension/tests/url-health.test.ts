import { describe, expect, it, vi } from 'vitest';
import type { BookmarkItem, UrlHealthRecord } from '../src/shared/bookmark-types.js';
import {
  URL_HEALTH_UNAVAILABLE,
  checkBookmarkUrl,
  checkBookmarkUrls,
  summarizeHealthRecords,
  type HealthFetch,
} from '../src/utils/url-health.js';

function bookmark(url: string, id = 'b1', index = 0): BookmarkItem {
  return {
    id,
    title: 'Example',
    url,
    parentId: 'p1',
    parentPath: 'Bookmarks Bar',
    parentTitle: 'Bookmarks Bar',
    index,
  };
}

function record(status: UrlHealthRecord['status'], bookmarkId: string): UrlHealthRecord {
  return {
    bookmarkId,
    bookmarkTitle: bookmarkId,
    bookmarkUrl: `https://${bookmarkId}.example`,
    checkedAt: new Date(0).toISOString(),
    durationMs: 0,
    parentPath: 'Bookmarks Bar',
    status,
  };
}

describe('URL health retirement boundary', () => {
  it('rejects a single check before invoking fetch', async () => {
    const fetchImpl = vi.fn<HealthFetch>();

    await expect(
      checkBookmarkUrl(bookmark('https://example.com/a'), { fetchImpl }),
    ).rejects.toMatchObject({
      code: URL_HEALTH_UNAVAILABLE,
      message: URL_HEALTH_UNAVAILABLE,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a batch check before invoking fetch or progress callbacks', async () => {
    const fetchImpl = vi.fn<HealthFetch>();
    const onProgress = vi.fn();

    await expect(
      checkBookmarkUrls(
        [bookmark('https://example.com/a', 'a'), bookmark('https://example.com/b', 'b')],
        { fetchImpl, onProgress },
      ),
    ).rejects.toMatchObject({
      code: URL_HEALTH_UNAVAILABLE,
      message: URL_HEALTH_UNAVAILABLE,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('keeps historical summary calculation as a pure display helper', () => {
    expect(
      summarizeHealthRecords([
        record('alive', 'alive'),
        record('dead', 'dead'),
        record('redirected', 'redirected'),
        record('error', 'error'),
        record('skipped', 'skipped'),
      ]),
    ).toEqual({
      alive: 1,
      dead: 1,
      error: 1,
      redirected: 1,
      skipped: 1,
    });
  });
});
