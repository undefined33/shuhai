import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessedBookmark } from '@shuhai/shared';
import { ShuHaiDatabase } from '../src/main/db/database.js';
import {
  DomainScheduler,
  UrlHealthChecker,
  type UrlCheckOptions,
  type UrlCheckProgress,
} from '../src/main/health/index.js';

let database: ShuHaiDatabase;

beforeEach(() => {
  database = new ShuHaiDatabase(':memory:');
});

afterEach(() => {
  database.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DomainScheduler', () => {
  it('interleaves URLs across domains and reserves rate-limit slots', () => {
    const queue = DomainScheduler.interleaveByDomain([
      { id: 'a1', url: 'https://a.example/1' },
      { id: 'a2', url: 'https://a.example/2' },
      { id: 'b1', url: 'https://b.example/1' },
      { id: 'b2', url: 'https://b.example/2' },
    ]);

    expect(queue.map((item) => item.id)).toEqual(['a1', 'b1', 'a2', 'b2']);

    const scheduler = new DomainScheduler(2_000);
    expect(scheduler.getDelay('a.example')).toBe(0);
    scheduler.recordRequest('a.example');
    expect(scheduler.getDelay('a.example')).toBeGreaterThan(0);
  });
});

describe('UrlHealthChecker', () => {
  it('marks 2xx responses alive and records url_checks', async () => {
    database.upsertBookmark(makeBookmark({ id: 'alive' }));
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const checker = makeChecker();
    const status = await checker.checkOne('alive');

    expect(status).toBe('alive');
    expect(database.getBookmark('alive')?.status).toBe('alive');
    expect(database.getLastCheck('alive')).toMatchObject({
      bookmarkId: 'alive',
      statusCode: 204,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD' });
  });

  it('falls back from HEAD to GET for blocked methods', async () => {
    database.upsertBookmark(makeBookmark({ id: 'fallback' }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const status = await makeChecker().checkOne('fallback');

    expect(status).toBe('alive');
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(['HEAD', 'GET']);
  });

  it('maps redirect, dead, and server-error responses', async () => {
    database.upsertBookmarks([
      makeBookmark({ id: 'redirect', url: 'https://redirect.example/start' }),
      makeBookmark({ id: 'dead', url: 'https://dead.example/missing' }),
      makeBookmark({ id: 'server-error', url: 'https://error.example/fail' }),
    ]);
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('redirect.example')) {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://redirect.example/final' },
        });
      }

      if (value.includes('dead.example')) {
        return new Response(null, { status: 404 });
      }

      return new Response(null, { status: 503 });
    }));

    const checker = makeChecker();

    await expect(checker.checkOne('redirect')).resolves.toBe('redirect');
    await expect(checker.checkOne('dead')).resolves.toBe('dead');
    await expect(checker.checkOne('server-error')).resolves.toBe('error');
    expect(database.getLastCheck('redirect')?.finalUrl).toBe('https://redirect.example/final');
  });

  it('limits global concurrency and reports progress', async () => {
    database.upsertBookmarks(
      Array.from({ length: 6 }, (_, index) => makeBookmark({
        id: `bookmark-${index}`,
        url: `https://domain-${index}.example/page`,
      })),
    );

    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetchMock = vi.fn(async () => {
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRequests--;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const progressReports: UrlCheckProgress[] = [];
    const result = await makeChecker({
      concurrency: 2,
      onProgress: (progress) => progressReports.push(progress),
    }).runAll();

    expect(maxActiveRequests).toBeLessThanOrEqual(2);
    expect(result).toMatchObject({
      total: 6,
      completed: 6,
      alive: 6,
    });
    expect(progressReports.at(-1)).toMatchObject({ completed: 6, alive: 6 });
  });

  it('does not fetch unsafe URLs', async () => {
    database.upsertBookmark(makeBookmark({
      id: 'unsafe',
      url: 'http://127.0.0.1/admin',
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const status = await makeChecker().checkOne('unsafe');

    expect(status).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.getLastCheck('unsafe')?.errorMessage).toBe('Blocked unsafe URL');
  });

  it('aborts an in-flight check without recording a result', async () => {
    database.upsertBookmark(makeBookmark({ id: 'slow' }));
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const checker = makeChecker();
    const run = checker.runAll();
    await waitForFetch(fetchMock);
    checker.abort();
    const result = await run;

    expect(result.completed).toBe(0);
    expect(database.getLastCheck('slow')).toBeNull();
  });
});

function makeChecker(options: UrlCheckOptions = {}): UrlHealthChecker {
  return new UrlHealthChecker(database, {
    domainRateLimitMs: 0,
    timeoutMs: 100,
    dnsLookup: async () => ['93.184.216.34'],
    ...options,
  });
}

function makeBookmark(overrides: Partial<ProcessedBookmark> = {}): ProcessedBookmark {
  const id = overrides.id ?? 'bookmark-1';

  return {
    id,
    url: overrides.url ?? `https://example.com/${id}`,
    normalizedUrl: overrides.normalizedUrl ?? overrides.url ?? `https://example.com/${id}`,
    title: overrides.title ?? id,
    source: overrides.source ?? 'chrome:Default',
    contentType: overrides.contentType ?? 'article',
    createdAt: overrides.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
    category: overrides.category ?? '未分类',
    status: overrides.status ?? 'unchecked',
    tags: overrides.tags,
    aiTags: overrides.aiTags,
    confidence: overrides.confidence,
    categories: overrides.categories,
    metadata: overrides.metadata,
    exportedAt: overrides.exportedAt,
  };
}

async function waitForFetch(fetchMock: ReturnType<typeof vi.fn>): Promise<void> {
  while (fetchMock.mock.calls.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
