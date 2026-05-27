import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RawBookmark } from '@shuhai/shared';
import {
  syncChromeBookmarks,
  type ChromeBookmarkReader,
} from '../src/main/bookmark-service.js';
import { ShuHaiDatabase } from '../src/main/db/database.js';

let database: ShuHaiDatabase;

beforeEach(() => {
  database = new ShuHaiDatabase(':memory:');
});

afterEach(() => {
  database.close();
});

describe('syncChromeBookmarks', () => {
  it('serializes concurrent sync requests through one mutex', async () => {
    let releaseFirstRead: () => void = () => {};
    const firstReadCanFinish = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const reads: string[] = [];

    const firstSync = syncChromeBookmarks({
      profile: 'Default',
      database,
      reader: new FakeReader('first', async () => {
        reads.push('first:start');
        await firstReadCanFinish;
        reads.push('first:end');
        return [bookmark('https://example.com/first', 'First')];
      }),
    });

    await waitForMicrotasks();

    const secondSync = syncChromeBookmarks({
      profile: 'Default',
      database,
      reader: new FakeReader('second', async () => {
        reads.push('second:start');
        return [bookmark('https://example.com/second', 'Second')];
      }),
    });

    await waitForMicrotasks();
    expect(reads).toEqual(['first:start']);

    releaseFirstRead();
    await Promise.all([firstSync, secondSync]);

    expect(reads).toEqual(['first:start', 'first:end', 'second:start']);
  });
});

class FakeReader implements ChromeBookmarkReader {
  constructor(
    private readonly pathSuffix: string,
    private readonly readBookmarks: () => Promise<RawBookmark[]>,
  ) {}

  exists(): boolean {
    return true;
  }

  getPath(): string {
    return `C:\\fake\\${this.pathSuffix}\\Bookmarks`;
  }

  read(): Promise<RawBookmark[]> {
    return this.readBookmarks();
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

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
