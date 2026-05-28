import { describe, expect, it } from 'vitest';
import { extractTwitterContent } from '../src/content/twitter.js';
import { extractWeiboContent } from '../src/content/weibo.js';

class FakeElement {
  constructor(
    readonly textContent: string,
    private readonly attrs: Record<string, string> = {},
  ) {}

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
}

class FakeDocument {
  readonly body = { textContent: 'fallback body' };

  constructor(
    readonly title: string,
    private readonly firstBySelector: Record<string, FakeElement>,
    private readonly allBySelector: Record<string, FakeElement[]>,
  ) {}

  querySelector(selector: string): FakeElement | null {
    return this.firstBySelector[selector] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.allBySelector[selector] ?? [];
  }
}

describe('content extractors', () => {
  it('extracts Twitter text and keeps media as URLs', () => {
    const documentRef = new FakeDocument(
      'Tweet title',
      {
        '[data-testid="User-Name"] a[href^="/"]': new FakeElement('@alice'),
        time: new FakeElement('', { datetime: '2026-05-28T00:00:00Z' }),
      },
      {
        '[data-testid="tweetText"]': [new FakeElement('hello payload')],
        'img[src*="twimg.com"]': [
          new FakeElement('', {
            src: 'https://pbs.twimg.com/media/a.jpg',
            alt: 'sample',
          }),
        ],
      },
    );

    const result = extractTwitterContent(
      documentRef as unknown as Document,
      'https://x.com/alice/status/123',
    );

    expect(result.source).toBe('twitter');
    expect(result.id).toBe('twitter-123');
    expect(result.text).toBe('hello payload');
    expect(result.media[0]?.url).toBe('https://pbs.twimg.com/media/a.jpg');
  });

  it('extracts Weibo text and author', () => {
    const documentRef = new FakeDocument(
      'Weibo title',
      {
        '[class*="head_name"]': new FakeElement('研究员'),
        '[class*="detail_wbtext"]': new FakeElement('微博正文'),
        time: new FakeElement('2026-05-28'),
      },
      {
        img: [
          new FakeElement('', {
            src: 'https://wx1.sinaimg.cn/large/a.jpg',
            alt: 'sample',
          }),
        ],
      },
    );

    const result = extractWeiboContent(
      documentRef as unknown as Document,
      'https://weibo.com/detail/1',
    );

    expect(result.source).toBe('weibo');
    expect(result.author).toBe('研究员');
    expect(result.text).toBe('微博正文');
    expect(result.media[0]?.url).toBe('https://wx1.sinaimg.cn/large/a.jpg');
  });
});
