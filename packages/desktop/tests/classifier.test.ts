import { describe, it, expect } from 'vitest';
import { RuleClassifier } from '../src/main/pipeline/classifier.js';
import type { RawBookmark } from '@shuhai/shared';

function makeBookmark(overrides: Partial<RawBookmark>): RawBookmark {
  return {
    url: 'https://example.com',
    title: 'Test',
    source: 'chrome',
    contentType: 'article',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('RuleClassifier', () => {
  const classifier = new RuleClassifier();

  it('uses Chrome folder path as category when available', () => {
    const bm = makeBookmark({ categories: ['开发资源', '前端', 'React'] });
    const result = classifier.classify(bm);
    expect(result.category).toBe('开发资源/前端/React');
    expect(result.tags).toEqual(['开发资源', '前端', 'React']);
  });

  it('classifies GitHub URLs', () => {
    const bm = makeBookmark({ url: 'https://github.com/user/repo' });
    const result = classifier.classify(bm);
    expect(result.category).toBe('开发/代码');
    expect(result.tags).toContain('GitHub');
  });

  it('classifies by title keyword', () => {
    const bm = makeBookmark({
      url: 'https://blog.example.com/post',
      title: 'Getting Started with React Hooks',
    });
    const result = classifier.classify(bm);
    expect(result.category).toBe('开发/前端');
    expect(result.tags).toContain('前端');
  });

  it('returns uncategorized for unknown URLs', () => {
    const bm = makeBookmark({
      url: 'https://random-site.xyz/page',
      title: 'Some random page',
    });
    const result = classifier.classify(bm);
    expect(result.category).toBe('未分类');
  });

  it('supports custom rules with higher priority', () => {
    const custom = new RuleClassifier([
      { type: 'domain', pattern: 'example.com', category: '自定义', tags: ['test'], priority: 10 },
    ]);
    const bm = makeBookmark({ url: 'https://example.com/page' });
    const result = custom.classify(bm);
    expect(result.category).toBe('自定义');
  });
});
