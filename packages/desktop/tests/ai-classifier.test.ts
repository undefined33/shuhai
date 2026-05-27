import { describe, it, expect, vi } from 'vitest';
import { AIClassifier } from '../src/main/ai/ai-classifier.js';
import type { LLMProvider, RawBookmark } from '@shuhai/shared';
import type { AiUsageRecord } from '../src/main/db/index.js';

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

  it('records usage drained from an AI provider', async () => {
    const usage: Array<Required<AiUsageRecord>> = [{
      timestamp: '2024-02-01T00:00:00.000Z',
      operation: 'classify',
      promptTokens: 10,
      completionTokens: 5,
      model: 'deepseek-chat',
    }];
    const onUsage = vi.fn();
    const classifier = new AIClassifier({
      provider: 'deepseek',
      apiKey: 'test-key',
      batchSize: 50,
      autoClassify: true,
    }, {
      provider: {
        ...fakeProvider(),
        batchClassify: vi.fn().mockResolvedValue(new Map([['https://example.com', 'AI/分类']])),
        drainUsageRecords: vi.fn(() => usage),
      },
      onUsage,
    });

    const results = await classifier.batchClassify([makeBookmark()]);

    expect(results.get('https://example.com')).toMatchObject({
      category: 'AI/分类',
      aiClassified: true,
    });
    expect(classifier.getTokenUsage()).toBe(15);
    expect(onUsage).toHaveBeenCalledWith(usage[0]);
  });
});

function fakeProvider(): LLMProvider {
  return {
    name: 'fake',
    model: 'fake-model',
    classify: vi.fn(),
    summarize: vi.fn(),
    generateTags: vi.fn(),
    findRelations: vi.fn(),
    batchClassify: vi.fn(),
  };
}
