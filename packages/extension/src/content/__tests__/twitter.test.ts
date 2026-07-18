import { describe, expect, it } from 'vitest';

import {
  XSingleExtractionError,
  extractXSingleEnvelope,
  handleXSingleExtractRequest,
} from '../twitter.js';
import {
  X_SINGLE_EXTRACT_PROTOCOL,
  X_SINGLE_VERSION,
  canonicalizeXStatusUrl,
} from '../../social/x-single-item.js';

type SelectorMap = Record<string, FakeElement | undefined>;
type SelectorListMap = Record<string, FakeElement[] | undefined>;

class FakeElement {
  constructor(
    readonly textContent = '',
    private readonly attrs: Record<string, string> = {},
    private readonly firstBySelector: SelectorMap = {},
    private readonly allBySelector: SelectorListMap = {},
  ) {}

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.firstBySelector[selector] ?? this.allBySelector[selector]?.[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.allBySelector[selector] ?? [];
  }
}

class FakeDocument {
  constructor(private readonly articles: FakeElement[]) {}

  querySelectorAll(selector: string): FakeElement[] {
    return selector === 'article' ? this.articles : [];
  }
}

const SHOW_MORE_SELECTOR = [
  '[data-testid="tweet-text-show-more-link"]',
  '[data-testid="tweet-text-show-more"]',
  'button[data-testid="tweet-text-show-more"]',
].join(',');
const MEDIA_SELECTOR =
  'img[src*="pbs.twimg.com/media"], img[src*="pbs.twimg.com/amplify_video_thumb"]';

function articleFixture(
  options: {
    statusHref?: string;
    text?: string;
    authorHref?: string;
    authorName?: string;
    publishedAt?: string;
    showMore?: boolean;
    media?: FakeElement[];
    videos?: FakeElement[];
  } = {},
): FakeElement {
  const profileLink = new FakeElement('', {
    href: options.authorHref ?? '/alice',
  });
  const authorName = new FakeElement(options.authorName ?? 'Alice Research');
  const author = new FakeElement(
    `${options.authorName ?? 'Alice Research'} @alice`,
    {},
    { '[dir="ltr"] span': authorName },
    { 'a[href]': [profileLink] },
  );
  const tweetText =
    options.text === undefined ? new FakeElement('hello from X') : new FakeElement(options.text);
  const first: SelectorMap = {
    '[data-testid="tweetText"]': tweetText,
    '[data-testid="User-Name"]': author,
    'time[datetime]': new FakeElement('', {
      datetime: options.publishedAt ?? '2026-07-18T00:00:00Z',
    }),
    ...(options.showMore ? { [SHOW_MORE_SELECTOR]: new FakeElement('Show more') } : {}),
  };
  return new FakeElement(options.text ?? 'hello from X', {}, first, {
    'a[href]': [
      new FakeElement('', {
        href: options.statusHref ?? '/alice/status/123456789',
      }),
    ],
    '[data-testid="tweetText"]': [tweetText],
    [MEDIA_SELECTOR]: options.media ?? [
      new FakeElement('', {
        src: 'https://pbs.twimg.com/media/example.jpg#fragment',
        alt: 'sample image',
      }),
    ],
    video: options.videos ?? [],
  });
}

function request(url = 'https://x.com/alice/status/123456789') {
  const identity = canonicalizeXStatusUrl(url)!;
  return {
    protocol: X_SINGLE_EXTRACT_PROTOCOL,
    version: X_SINGLE_VERSION,
    type: 'xSingle:extract' as const,
    requestId: 'xsingle:test-request',
    canonicalUrl: identity.canonicalUrl,
    sourceItemId: identity.sourceItemId,
  };
}

describe('X single-item content extractor', () => {
  it('binds one exact article and emits a canonical strict envelope', () => {
    const result = extractXSingleEnvelope(
      new FakeDocument([articleFixture()]) as unknown as Document,
      'https://x.com/Alice/status/123456789?utm_source=test#reply',
    );

    expect(result).toMatchObject({
      protocol: 'shuhai-x-single-item',
      version: 1,
      routeFamily: 'x/status',
      sourceItemId: '123456789',
      canonicalUrl: 'https://x.com/alice/status/123456789',
      title: 'Alice Research - hello from X',
      text: 'hello from X',
      author: {
        displayName: 'Alice Research',
        handle: 'alice',
      },
      publishedAt: '2026-07-18T00:00:00.000Z',
      contentKind: 'post',
    });
    expect(result.media).toEqual([
      {
        type: 'image',
        url: 'https://pbs.twimg.com/media/example.jpg',
        alt: 'sample image',
      },
    ]);
  });

  it('rejects a non-status route', () => {
    expect(() =>
      extractXSingleEnvelope(
        new FakeDocument([articleFixture()]) as unknown as Document,
        'https://x.com/alice',
      ),
    ).toThrow(
      expect.objectContaining<Partial<XSingleExtractionError>>({
        reason: 'route_invalid',
      }),
    );
  });

  it('rejects ambiguous and mismatched status articles', () => {
    expect(() =>
      extractXSingleEnvelope(
        new FakeDocument([articleFixture(), articleFixture()]) as unknown as Document,
        'https://x.com/alice/status/123456789',
      ),
    ).toThrow(
      expect.objectContaining<Partial<XSingleExtractionError>>({
        reason: 'article_ambiguous',
      }),
    );

    expect(() =>
      extractXSingleEnvelope(
        new FakeDocument([
          articleFixture({ statusHref: '/alice/status/987654321' }),
        ]) as unknown as Document,
        'https://x.com/alice/status/123456789',
      ),
    ).toThrow(
      expect.objectContaining<Partial<XSingleExtractionError>>({
        reason: 'permalink_mismatch',
      }),
    );
  });

  it('fails closed for missing, expandable and oversized text', () => {
    for (const [article, reason] of [
      [articleFixture({ text: '' }), 'content_missing'],
      [articleFixture({ showMore: true }), 'expansion_uncertain'],
      [articleFixture({ text: 'x'.repeat(8 * 1_024 + 1) }), 'payload_oversize'],
    ] as const) {
      expect(() =>
        extractXSingleEnvelope(
          new FakeDocument([article]) as unknown as Document,
          'https://x.com/alice/status/123456789',
        ),
      ).toThrow(
        expect.objectContaining<Partial<XSingleExtractionError>>({
          reason,
        }),
      );
    }
  });

  it('fails closed when media exceeds the single-item budget', () => {
    const media = Array.from(
      { length: 13 },
      (_, index) =>
        new FakeElement('', {
          src: `https://pbs.twimg.com/media/${index}.jpg`,
        }),
    );

    expect(() =>
      extractXSingleEnvelope(
        new FakeDocument([articleFixture({ media })]) as unknown as Document,
        'https://x.com/alice/status/123456789',
      ),
    ).toThrow(
      expect.objectContaining<Partial<XSingleExtractionError>>({
        reason: 'payload_oversize',
      }),
    );
  });

  it('echoes only the validated request nonce and returns fixed diagnostics', () => {
    const success = handleXSingleExtractRequest(
      new FakeDocument([articleFixture()]) as unknown as Document,
      'https://x.com/alice/status/123456789',
      request(),
    );
    expect(success).toMatchObject({
      requestId: 'xsingle:test-request',
      ok: true,
      item: { sourceItemId: '123456789' },
    });

    const mismatch = handleXSingleExtractRequest(
      new FakeDocument([articleFixture()]) as unknown as Document,
      'https://x.com/alice/status/987654321',
      request(),
    );
    expect(mismatch).toMatchObject({
      requestId: 'xsingle:test-request',
      ok: false,
      diagnostic: {
        version: 1,
        platform: 'x',
        routeFamily: 'x/status',
        errorCode: 'route_invalid',
      },
    });
    expect(JSON.stringify(mismatch)).not.toContain('987654321');
  });

  it('rejects request accessors and unknown fields before extraction', () => {
    const unsafe = request() as Record<string, unknown>;
    Object.defineProperty(unsafe, 'canonicalUrl', {
      enumerable: true,
      get() {
        throw new Error('must not run');
      },
    });
    expect(() =>
      handleXSingleExtractRequest(
        new FakeDocument([articleFixture()]) as unknown as Document,
        'https://x.com/alice/status/123456789',
        unsafe,
      ),
    ).toThrow();
    expect(() =>
      handleXSingleExtractRequest(
        new FakeDocument([articleFixture()]) as unknown as Document,
        'https://x.com/alice/status/123456789',
        { ...request(), extra: true },
      ),
    ).toThrow();
  });
});
