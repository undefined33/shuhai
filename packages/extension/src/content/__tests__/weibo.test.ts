import { describe, expect, it } from 'vitest';
import { extractWeiboContent, extractWeiboContentWithDiagnostics } from '../weibo.js';

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
  readonly title = 'Weibo';

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

describe('Weibo content extractor', () => {
  it('extracts stable id, author, repost text and filtered media', () => {
    const documentRef = new FakeDocument(
      {
        '[class*="head_name"]': new FakeElement('研究员'),
        '[class*="detail_wbtext"], [class*="weibo-text"]': new FakeElement('转发评论'),
        '[class*="head_name"], [class*="username"]': new FakeElement('研究员'),
        'article [class*="detail_wbtext"]': new FakeElement('转发评论'),
        '[class*="retweet"] [class*="detail_wbtext"]': new FakeElement('原微博正文'),
        time: new FakeElement('2026-05-28'),
      },
      {
        'a, button, span': [],
        '[class*="pic"] img, [class*="media"] img': [
          new FakeElement('', {
            src: 'https://wx1.sinaimg.cn/large/a.jpg',
            alt: 'sample',
            width: '1200',
            height: '800',
          }),
          new FakeElement('', {
            src: 'https://tvax1.sinaimg.cn/crop.0.0.100.100.180/face/avatar.jpg',
            width: '180',
            height: '180',
          }),
          new FakeElement('', {
            src: 'https://h5.sinaimg.cn/m/emoticon/icon.png',
            width: '160',
            height: '160',
          }),
          new FakeElement('', {
            src: 'https://wx1.sinaimg.cn/large/tiny.jpg',
            width: '48',
            height: '48',
          }),
        ],
      },
    );

    const result = extractWeiboContent(
      documentRef as unknown as Document,
      'https://weibo.com/detail/Nabc123',
    );

    expect(result.id).toBe('weibo-Nabc123');
    expect(result.author).toBe('研究员');
    expect(result.created).toBe('2026-05-28');
    expect(result.text).toContain('转发评论');
    expect(result.text).toContain('转发原文');
    expect(result.text).toContain('原微博正文');
    expect(result.media).toEqual([
      { type: 'image', url: 'https://wx1.sinaimg.cn/large/a.jpg', alt: 'sample' },
    ]);
  });

  it('requires users to expand long Weibo text before saving', () => {
    const documentRef = new FakeDocument(
      {
        '[class*="detail_wbtext"], [class*="weibo-text"]': new FakeElement('微博正文'),
        '[class*="head_name"], [class*="username"]': new FakeElement('研究员'),
        '[class*="detail_wbtext"]': new FakeElement('微博正文'),
      },
      {
        'a, button, span': [new FakeElement('展开全文')],
      },
    );

    expect(() =>
      extractWeiboContent(documentRef as unknown as Document, 'https://weibo.com/detail/Nabc123'),
    ).toThrow('请先点击"展开全文"后再保存');
  });

  it('requires a Weibo detail URL', () => {
    const documentRef = new FakeDocument({}, {});

    expect(() =>
      extractWeiboContent(documentRef as unknown as Document, 'https://weibo.com/u/123'),
    ).toThrow('请先打开一条微博的详情页');
  });

  it('records fallback selectors when primary Weibo selectors miss', () => {
    const documentRef = new FakeDocument(
      {
        '[class*="detail_wbtext"], [class*="weibo-text"]': new FakeElement('微博正文'),
        '[class*="head_name"], [class*="username"]': new FakeElement('研究员'),
        '[class*="weibo-text"]': new FakeElement('微博正文'),
        '[class*="username"]': new FakeElement('研究员'),
      },
      {
        'a, button, span': [],
      },
    );

    const result = extractWeiboContentWithDiagnostics(
      documentRef as unknown as Document,
      'https://weibo.com/detail/Nabc123',
    );

    expect(result.capture.text).toBe('微博正文');
    expect(result.diagnostic.fallbacksUsed).toContain('Weibo 正文: [class*="weibo-text"]');
  });
});
