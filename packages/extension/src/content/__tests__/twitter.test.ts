import { describe, expect, it } from 'vitest';
import { extractTwitterContent, extractTwitterContentWithDiagnostics } from '../twitter.js';

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
  readonly body = { textContent: '' };
  readonly title = 'X';

  constructor(
    private readonly firstBySelector: Record<string, FakeElement | undefined>,
    private readonly allBySelector: Record<string, FakeElement[]>,
  ) {}

  querySelector(selector: string): FakeElement | null {
    return this.firstBySelector[selector] ?? this.allBySelector[selector]?.[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.allBySelector[selector] ?? [];
  }
}

describe('Twitter content extractor', () => {
  it('extracts the main tweet, author, quote, video marker and filtered media', () => {
    const documentRef = new FakeDocument(
      {
        '[data-testid="User-Name"] [dir="ltr"] span span': new FakeElement('Alice Research'),
        '[data-testid="User-Name"]': new FakeElement('Alice Research @alice'),
        '[data-testid="tweetText"]': new FakeElement('main tweet payload'),
        article: new FakeElement('main tweet payload'),
        'article [data-testid="tweetText"]': new FakeElement('main tweet payload'),
        'article [data-testid="quoteTweet"] [data-testid="tweetText"]': new FakeElement(
          'quoted tweet payload',
        ),
        '[data-testid="videoPlayer"]': new FakeElement(''),
        time: new FakeElement('', { datetime: '2026-05-28T00:00:00Z' }),
      },
      {
        '[data-testid="User-Name"] a[href^="/"]': [new FakeElement('@alice', { href: '/alice' })],
        'article img[src*="twimg.com"], img[src*="twimg.com"]': [
          new FakeElement('', {
            src: 'https://pbs.twimg.com/media/main.jpg',
            alt: 'main image',
            width: '1200',
            height: '800',
          }),
          new FakeElement('', {
            src: 'https://pbs.twimg.com/profile_images/avatar.jpg',
            width: '400',
            height: '400',
          }),
          new FakeElement('', {
            src: 'https://abs.twimg.com/emoji/v2/72x72/1f600.png',
            width: '72',
            height: '72',
          }),
          new FakeElement('', {
            src: 'https://pbs.twimg.com/media/tiny.jpg',
            width: '32',
            height: '32',
          }),
        ],
      },
    );

    const result = extractTwitterContent(
      documentRef as unknown as Document,
      'https://x.com/alice/status/123456',
    );

    expect(result.id).toBe('twitter-123456');
    expect(result.author).toBe('Alice Research');
    expect(result.handle).toBe('@alice');
    expect(result.created).toBe('2026-05-28T00:00:00Z');
    expect(result.text).toContain('main tweet payload');
    expect(result.text).toContain('引用推文');
    expect(result.text).toContain('quoted tweet payload');
    expect(result.media).toEqual([
      { type: 'image', url: 'https://pbs.twimg.com/media/main.jpg', alt: 'main image' },
      { type: 'video', url: '(视频无法直接提取)', alt: '视频无法直接提取' },
    ]);
  });

  it('requires a tweet detail URL', () => {
    const documentRef = new FakeDocument({}, {});

    expect(() =>
      extractTwitterContent(documentRef as unknown as Document, 'https://x.com/alice'),
    ).toThrow('请先打开一条推文的详情页');
  });

  it('records fallback selectors when the primary tweet text selector misses', () => {
    const documentRef = new FakeDocument(
      {
        '[data-testid="User-Name"]': new FakeElement('Alice @alice'),
        '[data-testid="tweetText"]': new FakeElement('fallback tweet payload'),
        article: new FakeElement('fallback tweet payload'),
      },
      {
        '[data-testid="User-Name"] a[href^="/"]': [new FakeElement('@alice', { href: '/alice' })],
      },
    );

    const result = extractTwitterContentWithDiagnostics(
      documentRef as unknown as Document,
      'https://x.com/alice/status/123456',
    );

    expect(result.capture.text).toBe('fallback tweet payload');
    expect(result.diagnostic.fallbacksUsed).toContain('Twitter 正文: [data-testid="tweetText"]');
  });
});
