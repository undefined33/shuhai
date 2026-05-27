import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessedBookmark } from '@shuhai/shared';
import { ShuHaiDatabase } from '../src/main/db/database.js';

let database: ShuHaiDatabase;

beforeEach(() => {
  database = new ShuHaiDatabase(':memory:');
});

afterEach(() => {
  database.close();
});

describe('ShuHaiDatabase', () => {
  it('round-trips processed bookmarks with JSON fields', () => {
    database.upsertBookmark(makeBookmark({
      tags: ['docs'],
      aiTags: ['sqlite'],
      confidence: 0.92,
      categories: ['Bookmarks Bar', '开发'],
      metadata: { pinned: true },
    }));

    const bookmark = database.getBookmark('bookmark-1');

    expect(bookmark).toMatchObject({
      id: 'bookmark-1',
      url: 'https://example.com/bookmark-1',
      normalizedUrl: 'https://example.com/bookmark-1',
      title: 'Bookmark 1',
      source: 'chrome:Default',
      contentType: 'article',
      category: '开发',
      tags: ['docs'],
      aiTags: ['sqlite'],
      confidence: 0.92,
      status: 'unchecked',
      categories: ['Bookmarks Bar', '开发'],
      metadata: { pinned: true },
    });
    expect(bookmark?.createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('filters bookmarks by status, category, source, query, and pagination', () => {
    database.upsertBookmarks([
      makeBookmark({ id: 'alive', title: 'React Docs', category: '开发', status: 'alive' }),
      makeBookmark({ id: 'dead', title: 'Design Note', category: '设计', status: 'dead' }),
      makeBookmark({ id: 'other', title: 'React Video', source: 'chrome:Profile 1' }),
    ]);

    expect(database.getAllBookmarks({ status: 'alive' }).map((bookmark) => bookmark.id)).toEqual([
      'alive',
    ]);
    expect(database.getAllBookmarks({ category: '设计' }).map((bookmark) => bookmark.id)).toEqual([
      'dead',
    ]);
    expect(database.getAllBookmarks({ source: 'chrome:Profile 1' }).map((bookmark) => bookmark.id))
      .toEqual(['other']);
    expect(database.getAllBookmarks({ query: 'react', limit: 1 })).toHaveLength(1);
    expect(database.getAllBookmarks({ query: 'react', limit: 1, offset: 1 })).toHaveLength(1);
  });

  it('uses a transaction for batch upserts', () => {
    const bookmarks = Array.from({ length: 5_000 }, (_, index) => makeBookmark({
      id: `bookmark-${index}`,
      title: `Bookmark ${index}`,
      url: `https://example.com/${index}`,
      normalizedUrl: `https://example.com/${index}`,
    }));

    const startedAt = performance.now();
    database.upsertBookmarks(bookmarks);
    const durationMs = performance.now() - startedAt;

    expect(database.getStats().total).toBe(5_000);
    expect(durationMs).toBeLessThan(1_000);
  });

  it('marks missing Chrome bookmarks as removed without deleting them', () => {
    database.upsertBookmarks([
      makeBookmark({ id: 'active' }),
      makeBookmark({ id: 'removed' }),
      makeBookmark({ id: 'other-profile', source: 'chrome:Profile 1' }),
    ]);

    database.markMissingBookmarksRemoved('chrome:Default', new Set(['active']));

    expect(database.getBookmark('active')?.status).toBe('unchecked');
    expect(database.getBookmark('removed')?.status as string).toBe('removed');
    expect(database.getBookmark('other-profile')?.status).toBe('unchecked');
  });

  it('records URL checks and returns bookmarks that need a fresh check', () => {
    database.upsertBookmarks([
      makeBookmark({ id: 'old-check' }),
      makeBookmark({ id: 'recent-check' }),
      makeBookmark({ id: 'never-checked' }),
    ]);
    database.recordUrlCheck({
      bookmarkId: 'old-check',
      checkedAt: daysAgo(10),
      statusCode: 200,
      finalUrl: 'https://example.com/old-check',
      durationMs: 42,
    });
    database.recordUrlCheck({
      bookmarkId: 'recent-check',
      checkedAt: daysAgo(1),
      statusCode: 200,
    });

    const lastCheck = database.getLastCheck('old-check');
    const needingCheck = database.getBookmarksNeedingCheck(7).map((bookmark) => bookmark.id);

    expect(lastCheck).toMatchObject({
      bookmarkId: 'old-check',
      statusCode: 200,
      finalUrl: 'https://example.com/old-check',
      durationMs: 42,
    });
    expect(needingCheck).toEqual(expect.arrayContaining(['old-check', 'never-checked']));
    expect(needingCheck).not.toContain('recent-check');
  });

  it('returns and resolves dead link review items without deleting Chrome data', () => {
    database.upsertBookmarks([
      makeBookmark({ id: 'dead', status: 'dead', title: 'Dead Link' }),
      makeBookmark({ id: 'error', status: 'error', title: 'Broken Link' }),
      makeBookmark({ id: 'alive', status: 'alive', title: 'Alive Link' }),
    ]);
    database.recordUrlCheck({
      bookmarkId: 'dead',
      checkedAt: '2024-02-01T00:00:00.000Z',
      statusCode: 404,
      errorMessage: 'HTTP 404',
      durationMs: 50,
    });

    const reviewItems = database.getDeadLinkReviewItems();
    expect(reviewItems.map((item) => item.bookmark.id)).toEqual(['dead', 'error']);
    expect(reviewItems[0]?.lastCheck).toMatchObject({
      bookmarkId: 'dead',
      statusCode: 404,
      errorMessage: 'HTTP 404',
    });

    database.markBookmarksReviewed(['dead']);
    expect(database.getBookmark('dead')?.reviewedAt).toBeInstanceOf(Date);

    database.markBookmarksRemoved(['error']);
    expect(database.getBookmark('error')?.status as string).toBe('removed');
    expect(database.getBookmark('error')?.reviewedAt).toBeInstanceOf(Date);
  });

  it('replaces a dead link URL locally and resets the link status', () => {
    database.upsertBookmark(makeBookmark({
      id: 'dead',
      status: 'dead',
      url: 'https://old.example',
      normalizedUrl: 'https://old.example',
      metadata: { note: 'keep' },
    }));
    database.recordUrlCheck({
      bookmarkId: 'dead',
      checkedAt: '2024-02-01T00:00:00.000Z',
      statusCode: 404,
    });

    const updated = database.updateBookmarkUrl('dead', {
      id: 'new-id',
      url: 'https://new.example',
      normalizedUrl: 'https://new.example',
    });

    expect(updated).toMatchObject({
      id: 'new-id',
      url: 'https://new.example',
      normalizedUrl: 'https://new.example',
      status: 'unchecked',
      metadata: {
        note: 'keep',
        originalUrl: 'https://old.example',
        reviewAction: 'replaced',
      },
    });
    expect(updated?.reviewedAt).toBeInstanceOf(Date);
    expect(database.getLastCheck('dead')).toBeNull();
  });

  it('upserts and merges sync state', () => {
    database.updateSyncState('chrome:Default', {
      lastSyncAt: '2024-02-01T00:00:00.000Z',
      bookmarkCount: 10,
      checksum: 'abc',
    });
    database.updateSyncState('chrome:Default', { bookmarkCount: 12 });

    expect(database.getSyncState('chrome:Default')).toEqual({
      source: 'chrome:Default',
      lastSyncAt: '2024-02-01T00:00:00.000Z',
      bookmarkCount: 12,
      checksum: 'abc',
    });
  });

  it('records and summarizes monthly AI token usage', () => {
    database.recordAiUsage({
      timestamp: '2024-02-01T10:00:00.000Z',
      operation: 'classify',
      promptTokens: 100,
      completionTokens: 20,
      model: 'deepseek-chat',
    });
    database.recordAiUsage({
      timestamp: '2024-02-01T11:00:00.000Z',
      operation: 'tag',
      promptTokens: 30,
      completionTokens: 10,
      model: 'deepseek-chat',
    });
    database.recordAiUsage({
      timestamp: '2024-03-01T00:00:00.000Z',
      operation: 'classify',
      promptTokens: 999,
      completionTokens: 999,
      model: 'deepseek-chat',
    });

    expect(database.getAiUsageSummary('2024-02')).toEqual({
      month: '2024-02',
      promptTokens: 130,
      completionTokens: 30,
      totalTokens: 160,
      callCount: 2,
      daily: [{
        date: '2024-02-01',
        promptTokens: 130,
        completionTokens: 30,
        totalTokens: 160,
        callCount: 2,
      }],
    });
  });
});

function makeBookmark(overrides: Partial<ProcessedBookmark> = {}): ProcessedBookmark {
  const id = overrides.id ?? 'bookmark-1';

  return {
    id,
    url: overrides.url ?? `https://example.com/${id}`,
    normalizedUrl: overrides.normalizedUrl ?? `https://example.com/${id}`,
    title: overrides.title ?? 'Bookmark 1',
    source: overrides.source ?? 'chrome:Default',
    contentType: overrides.contentType ?? 'article',
    createdAt: overrides.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
    category: overrides.category ?? '开发',
    status: overrides.status ?? 'unchecked',
    tags: overrides.tags,
    aiTags: overrides.aiTags,
    confidence: overrides.confidence,
    categories: overrides.categories,
    metadata: overrides.metadata,
    exportedAt: overrides.exportedAt,
    reviewedAt: overrides.reviewedAt,
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
