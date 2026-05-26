import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawBookmark } from '@shuhai/shared';
import { ShuHaiDatabase } from '../src/main/db/database.js';
import type { ChromeBookmarkReader } from '../src/main/bookmark-service.js';

const watchMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    watch: watchMock,
  };
});

const { ChromeBookmarkWatcher } = await import('../src/main/sync/chrome-watcher.js');

let database: ShuHaiDatabase;
let watchCallbacks: Array<(eventType: string) => void>;
let closeWatcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
  database = new ShuHaiDatabase(':memory:');
  watchCallbacks = [];
  closeWatcher = vi.fn();
  watchMock.mockReset();
  watchMock.mockImplementation((_path: string, callback: (eventType: string) => void) => {
    watchCallbacks.push(callback);
    return { close: closeWatcher };
  });
});

afterEach(() => {
  database.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChromeBookmarkWatcher', () => {
  it('syncs added, updated, removed bookmarks and skips identical checksums', async () => {
    let bookmarks = [bookmark('https://example.com/a', 'Old title')];
    const onSync = vi.fn();
    const watcher = createWatcher(() => bookmarks, onSync);

    await expect(watcher.syncNow()).resolves.toEqual({
      added: 1,
      updated: 0,
      removed: 0,
      total: 1,
    });
    expect(onSync).toHaveBeenCalledTimes(1);

    await expect(watcher.syncNow()).resolves.toEqual({
      added: 0,
      updated: 0,
      removed: 0,
      total: 1,
    });
    expect(onSync).toHaveBeenCalledTimes(1);

    bookmarks = [
      bookmark('https://example.com/a', 'New title'),
      bookmark('https://example.com/b', 'Second bookmark'),
    ];
    await expect(watcher.syncNow()).resolves.toEqual({
      added: 1,
      updated: 1,
      removed: 0,
      total: 2,
    });
    expect(database.getBookmarkByNormalizedUrl('https://example.com/a')?.title).toBe('New title');

    bookmarks = [bookmark('https://example.com/b', 'Second bookmark')];
    await expect(watcher.syncNow()).resolves.toEqual({
      added: 0,
      updated: 0,
      removed: 1,
      total: 1,
    });
    expect(database.getBookmarkByNormalizedUrl('https://example.com/a')?.status as string).toBe('removed');
  });

  it('debounces fs.watch changes for at least two seconds before syncing', async () => {
    vi.useFakeTimers();
    const onSync = vi.fn();
    const watcher = createWatcher(() => [bookmark('https://example.com/a', 'A')], onSync);

    watcher.start();
    expect(watcher.isWatching()).toBe(true);
    expect(watchMock).toHaveBeenCalledWith('C:\\fake\\Bookmarks', expect.any(Function));

    watchCallbacks[0]?.('change');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(onSync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onSync).toHaveBeenCalledWith({
      added: 1,
      updated: 0,
      removed: 0,
      total: 1,
    });
  });

  it('cleans up the watcher and pending debounce timer on stop', async () => {
    vi.useFakeTimers();
    const onSync = vi.fn();
    const watcher = createWatcher(() => [bookmark('https://example.com/a', 'A')], onSync);

    watcher.start();
    watchCallbacks[0]?.('change');
    watcher.stop();

    expect(watcher.isWatching()).toBe(false);
    expect(closeWatcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(onSync).not.toHaveBeenCalled();
  });

  it('does not crash or start fs.watch when the Chrome bookmarks file is missing', async () => {
    const watcher = createWatcher(() => [], vi.fn(), false);

    watcher.start();

    expect(watcher.isWatching()).toBe(false);
    expect(watchMock).not.toHaveBeenCalled();
    await expect(watcher.syncNow()).resolves.toEqual({
      added: 0,
      updated: 0,
      removed: 0,
      total: 0,
    });
  });
});

function createWatcher(
  getBookmarks: () => RawBookmark[],
  onSync: (result: unknown) => void,
  exists = true,
): InstanceType<typeof ChromeBookmarkWatcher> {
  return new ChromeBookmarkWatcher({
    profile: 'Default',
    database,
    onSync,
    readerFactory: () => new FakeReader(getBookmarks, exists),
  });
}

class FakeReader implements ChromeBookmarkReader {
  constructor(
    private readonly getBookmarks: () => RawBookmark[],
    private readonly hasFile: boolean,
  ) {}

  exists(): boolean {
    return this.hasFile;
  }

  getPath(): string {
    return 'C:\\fake\\Bookmarks';
  }

  async read(): Promise<RawBookmark[]> {
    return this.getBookmarks();
  }
}

function bookmark(url: string, title: string): RawBookmark {
  return {
    url,
    title,
    source: 'chrome',
    contentType: 'article',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    categories: ['Bookmarks Bar'],
  };
}
