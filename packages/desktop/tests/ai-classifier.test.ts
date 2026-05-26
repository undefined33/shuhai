import { describe, it, expect, vi } from 'vitest';
import { AIClassifier } from '../src/main/ai/ai-classifier.js';
import type { RawBookmark } from '@shuhai/shared';

function makeBookmark(overrides: Partial<RawBookmark> = {}): RawBookmark {
  return {
    url: 'https://example.com',
    title: 'Test Bookmark',
    source: 'chrome',
    contentType: 'article',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AIClassifier', () => {
  describe('without AI (provider = none)', () => {
    const classifier = new AIClassifier({
      provider: 'none',
      batchSize: 50,
      autoClassify: false,
    });

    it('reports no AI available', () => {
      expect(classifier.hasAI()).toBe(false);
    });

    it('falls back to rule-based classification', async () => {
      const bm = makeBookmark({ url: 'https://github.com/user/repo', title: 'My Repo' });
      const result = await classifier.classify(bm, []);
      expect(result.aiClassified).toBe(false);
      expect(result.category).toBe('开发/代码');
    });

    it('batch classify uses rules for all', async () => {
      const bookmarks = [
        makeBookmark({ url: 'https://github.com/a', title: 'Repo A' }),
        makeBookmark({ url: 'https://youtube.com/watch', title: 'Video' }),
        makeBookmark({ url: 'https://random.xyz', title: 'Unknown' }),
      ];
      const results = await classifier.batchClassify(bookmarks);
      expect(results.size).toBe(3);
      expect(results.get('https://github.com/a')?.category).toBe('开发/代码');
      expect(results.get('https://youtube.com/watch')?.category).toBe('视频');
      expect(results.get('https://random.xyz')?.category).toBe('未分类');
    });
  });

  describe('with invalid API key', () => {
    const classifier = new AIClassifier({
      provider: 'deepseek',
      apiKey: 'invalid-key',
      batchSize: 50,
      autoClassify: true,
    });

    it('reports AI available', () => {
      expect(classifier.hasAI()).toBe(true);
    });

    it('falls back to rules on API error', async () => {
      const bm = makeBookmark({ url: 'https://github.com/test', title: 'Test' });
      const result = await classifier.classify(bm, []);
      // Should gracefully fall back
      expect(result.aiClassified).toBe(false);
      expect(result.category).toBe('开发/代码');
    });
  });
});
