import { describe, expect, it } from 'vitest';
import { extractArticleContent } from '../src/content/article.js';
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

class FakeDomText {
  readonly nodeType = 3;

  constructor(readonly textContent: string) {}
}

class FakeDomElement {
  readonly nodeType = 1;
  readonly childNodes: Array<FakeDomElement | FakeDomText>;

  constructor(
    readonly tagName: string,
    children: Array<FakeDomElement | FakeDomText | string> = [],
    private readonly attrs: Record<string, string> = {},
  ) {
    this.childNodes = children.map((child) =>
      typeof child === 'string' ? new FakeDomText(child) : child,
    );
  }

  get children(): FakeDomElement[] {
    return this.childNodes.filter((child): child is FakeDomElement => child.nodeType === 1);
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  get innerHTML(): string {
    return this.textContent;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  querySelector(selector: string): FakeDomElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeDomElement[] {
    const selectors = selector.split(',').map((item) => item.trim());
    const matches: FakeDomElement[] = [];

    for (const child of this.children) {
      if (selectors.some((item) => child.matches(item))) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }

    return matches;
  }

  matches(selector: string): boolean {
    const tag = this.tagName.toLowerCase();
    if (selector === tag || selector === '*') {
      return true;
    }

    if (selector.startsWith('.')) {
      return (this.attrs.class ?? '').split(/\s+/).includes(selector.slice(1));
    }

    if (selector.startsWith('#')) {
      return this.attrs.id === selector.slice(1);
    }

    if (selector === '[role="main"]') {
      return this.attrs.role === 'main';
    }

    const attrMatch = selector.match(/^([a-z]+)?\[([^=]+)="([^"]+)"\]$/);
    if (attrMatch) {
      const [, selectorTag, attr, value] = attrMatch;
      return (!selectorTag || selectorTag === tag) && this.attrs[attr] === value;
    }

    return false;
  }
}

class FakeArticleDocument {
  constructor(
    readonly title: string,
    readonly body: FakeDomElement,
    private readonly headElements: FakeDomElement[],
  ) {}

  querySelector(selector: string): FakeDomElement | null {
    for (const element of this.headElements) {
      if (element.querySelector(selector) || elementMatches(element, selector)) {
        return elementMatches(element, selector) ? element : element.querySelector(selector);
      }
    }

    if (selector.includes('article')) {
      return this.body.querySelector('article');
    }

    return this.body.querySelector(selector);
  }
}

function elementMatches(element: FakeDomElement, selector: string): boolean {
  return selector.split(',').map((item) => item.trim()).some((item) => element.matches(item));
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

  it('extracts an article as safe Markdown without remote image embeds', () => {
    const article = new FakeDomElement('article', [
      new FakeDomElement('h1', ['eBPF 深入理解']),
      new FakeDomElement('p', [
        '正文 ',
        new FakeDomElement('a', ['危险链接'], { href: 'javascript:alert(1)' }),
        ' ',
        new FakeDomElement('a', ['参考链接'], { href: '/safe' }),
      ]),
      new FakeDomElement('img', [], { src: '/diagram.png', alt: 'diagram' }),
      new FakeDomElement('img', [], { src: 'data:image/svg+xml,evil', alt: 'evil' }),
      new FakeDomElement('pre', [
        new FakeDomElement('code', ['TABLE file.mtime'], { class: 'language-dataviewjs' }),
      ]),
      new FakeDomElement('script', ['alert(1)']),
      new FakeDomElement('p', ['<% tp.system.exec("calc") %> {{bad}}']),
    ]);
    const documentRef = new FakeArticleDocument(
      'Fallback title',
      new FakeDomElement('body', [article]),
      [
        new FakeDomElement('meta', [], {
          property: 'og:title',
          content: '深入理解 Linux eBPF',
        }),
        new FakeDomElement('meta', [], {
          property: 'og:site_name',
          content: 'Example Blog',
        }),
      ],
    );

    const result = extractArticleContent(
      documentRef as unknown as Document,
      'https://example.com/posts/ebpf',
    );

    expect(result.source).toBe('article');
    expect(result.title).toBe('深入理解 Linux eBPF');
    expect(result.siteName).toBe('Example Blog');
    expect(result.text).toContain('[参考链接](https://example.com/safe)');
    expect(result.text).toContain('[图片: diagram](https://example.com/diagram.png)');
    expect(result.text).toContain('```text');
    expect(result.text).not.toContain('javascript:alert');
    expect(result.text).not.toContain('data:image');
    expect(result.text).not.toContain('alert(1)');
    expect(result.text).not.toContain('![diagram]');
    expect(result.text).not.toContain('<% tp.system');
    expect(result.text).not.toContain('{{bad}}');
  });
});
