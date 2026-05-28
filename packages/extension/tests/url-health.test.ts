import { describe, expect, it, vi } from 'vitest';
import type { BookmarkItem } from '../src/shared/bookmark-types.js';
import {
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

function response(status: number, url: string, redirected = false): Response {
  return {
    redirected,
    status,
    type: 'basic',
    url,
  } as Response;
}

describe('URL health checker', () => {
  it('marks successful URLs as alive', async () => {
    const fetchImpl = vi.fn<HealthFetch>().mockResolvedValue(
      response(200, 'https://example.com/a'),
    );

    await expect(
      checkBookmarkUrl(bookmark('https://example.com/a'), { fetchImpl }),
    ).resolves.toMatchObject({
      httpStatus: 200,
      status: 'alive',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.objectContaining({
        credentials: 'omit',
        method: 'HEAD',
        referrerPolicy: 'no-referrer',
      }),
    );
  });

  it('detects redirects without changing the bookmark automatically', async () => {
    const fetchImpl = vi.fn<HealthFetch>().mockResolvedValue(
      response(200, 'https://example.org/new', true),
    );

    await expect(
      checkBookmarkUrl(bookmark('https://example.com/old'), { fetchImpl }),
    ).resolves.toMatchObject({
      finalUrl: 'https://example.org/new',
      status: 'redirected',
    });
  });

  it('marks known missing HTTP statuses as dead', async () => {
    const fetchImpl = vi.fn<HealthFetch>().mockResolvedValue(
      response(404, 'https://example.com/missing'),
    );

    await expect(
      checkBookmarkUrl(bookmark('https://example.com/missing'), { fetchImpl }),
    ).resolves.toMatchObject({
      httpStatus: 404,
      status: 'dead',
    });
  });

  it('falls back to a tiny GET when HEAD is not allowed', async () => {
    const fetchImpl = vi
      .fn<HealthFetch>()
      .mockResolvedValueOnce(response(405, 'https://example.com/a'))
      .mockResolvedValueOnce(response(200, 'https://example.com/a'));

    await expect(
      checkBookmarkUrl(bookmark('https://example.com/a'), { fetchImpl }),
    ).resolves.toMatchObject({
      status: 'alive',
    });
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://example.com/a',
      expect.objectContaining({
        headers: { Range: 'bytes=0-0' },
        method: 'GET',
      }),
    );
  });

  it('skips non-web and local network URLs by default', async () => {
    const fetchImpl = vi.fn<HealthFetch>();

    await expect(
      checkBookmarkUrl(bookmark('chrome://extensions'), { fetchImpl }),
    ).resolves.toMatchObject({
      status: 'skipped',
    });
    await expect(
      checkBookmarkUrl(bookmark('http://127.0.0.1:3000'), { fetchImpl }),
    ).resolves.toMatchObject({
      status: 'skipped',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks bookmark URLs with bounded concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn<HealthFetch>(async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      inFlight -= 1;

      return response(200, String(input));
    });
    const progressDone: number[] = [];
    const bookmarks = Array.from({ length: 7 }, (_, index) =>
      bookmark(`https://example.com/${index}`, `b${index}`, index),
    );

    const result = await checkBookmarkUrls(bookmarks, {
      concurrency: 3,
      fetchImpl,
      onProgress: (progress) => progressDone.push(progress.done),
    });

    expect(maxInFlight).toBe(3);
    expect(result.progress.done).toBe(7);
    expect(result.records.map((record) => record.bookmarkId)).toEqual(
      bookmarks.map((item) => item.id),
    );
    expect(progressDone[0]).toBe(0);
    expect(progressDone[progressDone.length - 1]).toBe(7);
  });

  it('summarizes health records for the review UI', () => {
    const records = [
      { ...bookmark('https://ok.example'), bookmarkId: '1', bookmarkTitle: 'ok', bookmarkUrl: 'https://ok.example', checkedAt: '', durationMs: 0, status: 'alive' as const },
      { ...bookmark('https://dead.example'), bookmarkId: '2', bookmarkTitle: 'dead', bookmarkUrl: 'https://dead.example', checkedAt: '', durationMs: 0, status: 'dead' as const },
      { ...bookmark('https://redirect.example'), bookmarkId: '3', bookmarkTitle: 'redirect', bookmarkUrl: 'https://redirect.example', checkedAt: '', durationMs: 0, status: 'redirected' as const },
    ];

    expect(summarizeHealthRecords(records)).toMatchObject({
      alive: 1,
      dead: 1,
      redirected: 1,
    });
  });
});
