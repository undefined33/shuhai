import { describe, expect, it } from 'vitest';
import {
  SETTINGS_KEY,
  getOnboarded,
  getPendingCaptures,
  getSettings,
  getUrlHealthRecords,
  removePendingCapture,
  saveOnboarded,
  savePendingCapture,
  saveUrlHealthRecords,
  setLocalValues,
} from '../src/utils/storage.js';
import { getStorageSnapshot } from './setup.js';

describe('storage helpers', () => {
  it('defaults onboarding to false', async () => {
    await expect(getOnboarded()).resolves.toBe(false);
  });

  it('persists onboarding state', async () => {
    await saveOnboarded(true);

    expect(getStorageSnapshot()).toMatchObject({
      onboarded: true,
    });
    await expect(getOnboarded()).resolves.toBe(true);
  });

  it('stores captured content as a queue and removes one item by id', async () => {
    await savePendingCapture({
      id: 'article-1',
      source: 'article',
      title: 'Article',
      url: 'https://example.com/a',
      text: 'body',
      media: [],
      tags: ['article'],
      capturedAt: new Date(0).toISOString(),
    });
    await savePendingCapture({
      id: 'tweet-1',
      source: 'twitter',
      title: 'Tweet',
      url: 'https://x.com/a/status/1',
      text: 'tweet',
      media: [],
      tags: ['twitter'],
      capturedAt: new Date(0).toISOString(),
    });

    await expect(getPendingCaptures()).resolves.toHaveLength(2);
    await expect(removePendingCapture('article-1')).resolves.toBe(true);
    await expect(getPendingCaptures()).resolves.toEqual([
      expect.objectContaining({ id: 'tweet-1' }),
    ]);
  });

  it('stores URL health records', async () => {
    await saveUrlHealthRecords([
      {
        bookmarkId: '1',
        bookmarkTitle: 'Missing',
        bookmarkUrl: 'https://example.com/missing',
        checkedAt: new Date(0).toISOString(),
        durationMs: 12,
        httpStatus: 404,
        parentPath: 'Bookmarks Bar',
        status: 'dead',
      },
    ]);

    await expect(getUrlHealthRecords()).resolves.toEqual([
      expect.objectContaining({ bookmarkId: '1', status: 'dead' }),
    ]);
  });

  it('migrates legacy DeepSeek settings into provider config', async () => {
    await setLocalValues({
      [SETTINGS_KEY]: {
        deepSeekApiKey: 'legacy-key',
        deepSeekModel: 'deepseek-reasoner',
        useAi: true,
        defaultClassifyMode: 'full',
        exportDirectory: 'Knowledge',
      },
    });

    await expect(getSettings()).resolves.toMatchObject({
      useAi: true,
      activeProviderId: 'deepseek-migrated',
      defaultClassifyMode: 'full',
      exportDirectory: 'Knowledge',
      aiProviders: [
        expect.objectContaining({
          id: 'deepseek-migrated',
          provider: 'deepseek',
          apiKey: 'legacy-key',
          model: 'deepseek-reasoner',
        }),
        expect.objectContaining({ provider: 'kimi' }),
        expect.objectContaining({ provider: 'glm' }),
      ],
    });
  });
});
