import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  handleXBookmarksContentRequest,
  installXBookmarksContentReader,
  parseXBookmarksContentRequest,
  readXBookmarksDom,
  X_BOOKMARKS_CONTENT_CEILINGS,
  X_BOOKMARKS_CONTENT_PROTOCOL,
  X_BOOKMARKS_CONTENT_WAIT_MS,
  type XBookmarksContentEnvironment,
  type XBookmarksContentRequest,
} from '../x-bookmarks.js';

type ReadBatchRequest = Extract<XBookmarksContentRequest, { readonly type: 'read-batch' }>;

class FakeTextNode {
  readonly nodeType = 3;

  constructor(readonly nodeValue: string) {}
}

class FakeElement {
  readonly nodeType = 1;
  readonly childNodes: Array<FakeElement | FakeTextNode>;
  private readonly firstBySelector = new Map<string, FakeElement>();
  private readonly allBySelector = new Map<string, FakeElement[]>();
  private readonly closestBySelector = new Map<string, FakeElement | null>();

  constructor(
    readonly tagName: string,
    text = '',
    private readonly attributes: Record<string, string> = {},
  ) {
    this.childNodes = text ? [new FakeTextNode(text)] : [];
  }

  setFirst(selector: string, element: FakeElement): this {
    this.firstBySelector.set(selector, element);
    return this;
  }

  setAll(selector: string, elements: FakeElement[]): this {
    this.allBySelector.set(selector, elements);
    return this;
  }

  setClosest(selector: string, element: FakeElement | null): this {
    this.closestBySelector.set(selector, element);
    return this;
  }

  querySelector(selector: string): FakeElement | null {
    return this.firstBySelector.get(selector) ?? this.allBySelector.get(selector)?.[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.allBySelector.get(selector) ?? [];
  }

  closest(selector: string): FakeElement | null {
    return this.closestBySelector.get(selector) ?? null;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
}

class FakeDocument {
  private readonly firstBySelector = new Map<string, FakeElement>();
  private readonly allBySelector = new Map<string, FakeElement[]>();

  setFirst(selector: string, element: FakeElement): this {
    this.firstBySelector.set(selector, element);
    return this;
  }

  setAll(selector: string, elements: FakeElement[]): this {
    this.allBySelector.set(selector, elements);
    return this;
  }

  querySelector(selector: string): FakeElement | null {
    return this.firstBySelector.get(selector) ?? this.allBySelector.get(selector)?.[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.allBySelector.get(selector) ?? [];
  }
}

interface FixtureDom {
  readonly document: FakeDocument;
  readonly card: FakeElement;
  readonly textRoot: FakeElement;
}

function cardFixture(
  text = 'A bounded bookmark summary',
  permalink = '/researcher/status/1234567890123456789?s=20',
): FixtureDom {
  const document = new FakeDocument();
  const primaryColumn = new FakeElement('div');
  const card = new FakeElement('article');
  const anchor = new FakeElement('a', '', { href: permalink });
  const time = new FakeElement('time', '', { datetime: '2026-07-14T00:00:00.000Z' })
    .setClosest('a[href]', anchor)
    .setClosest('[data-testid="quoteTweet"]', null);
  const textRoot = new FakeElement('div', text)
    .setClosest('[data-testid="quoteTweet"]', null)
    .setClosest('article[data-testid="tweet"]', card);
  const authorRoot = new FakeElement('div');
  const displayName = new FakeElement('span', 'Security Researcher');
  authorRoot.setFirst('[dir="ltr"] span', displayName);
  const image = new FakeElement('img', '', {
    src: 'https://pbs.twimg.com/media/fixture.jpg?format=jpg&name=small#ignored',
    alt: 'fixture image',
  })
    .setClosest('[data-testid="quoteTweet"]', null)
    .setClosest('article[data-testid="tweet"]', card);

  card
    .setAll('time[datetime]', [time])
    .setAll('[data-testid="tweetText"]', [textRoot])
    .setFirst('[data-testid="User-Name"]', authorRoot)
    .setAll('img[src]', [image]);
  primaryColumn.setAll('article[data-testid="tweet"]', [card]);
  document.setFirst('[data-testid="primaryColumn"]', primaryColumn);
  return { document, card, textRoot };
}

function request(overrides: Partial<ReadBatchRequest> = {}): ReadBatchRequest {
  return {
    protocol: X_BOOKMARKS_CONTENT_PROTOCOL,
    type: 'read-batch',
    jobId: 'fixture-job',
    scanRevision: 1,
    adapterVersion: 1,
    step: 0,
    nonce: 'abcdefghijklmnopqrstuvwxyzABCDEF',
    mode: 'incremental',
    limits: {
      remainingCandidateSlots: 50,
      maxObservedNodes: X_BOOKMARKS_CONTENT_CEILINGS.maxObservedNodes,
      maxElapsedMs: 15_000,
      maxTextBytes: X_BOOKMARKS_CONTENT_CEILINGS.maxTextBytes,
      maxMedia: X_BOOKMARKS_CONTENT_CEILINGS.maxMedia,
      maxTotalBytes: 16 * 1024 * 1024,
      maxScrollActionsRemaining: 5,
      allowScroll: false,
    },
    ...overrides,
  };
}

function environment(fixture: FixtureDom) {
  const scrollBy = vi.fn();
  const scrollTo = vi.fn();
  const wait = vi.fn(async () => undefined);
  const listeners: Array<
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean | void
  > = [];
  const windowRef = {
    innerHeight: 1_000,
    scrollBy,
    scrollTo,
  };
  const value: XBookmarksContentEnvironment = {
    document: fixture.document as unknown as Document,
    location: { href: 'https://x.com/i/bookmarks' },
    window: windowRef as unknown as XBookmarksContentEnvironment['window'],
    runtime: {
      id: 'extension-id',
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
    wait,
  };
  return { value, listeners, scrollBy, scrollTo, wait };
}

describe('X bookmarks content DOM reader', () => {
  it('reads only a rendered tweet card into a bounded observation', () => {
    const fixture = cardFixture();
    const observation = readXBookmarksDom(
      fixture.document as unknown as Document,
      'https://x.com/i/bookmarks',
    );

    expect(observation.signal).toEqual({ kind: 'items' });
    expect(observation.entries).toEqual([
      {
        permalink: 'https://x.com/researcher/status/1234567890123456789',
        text: 'A bounded bookmark summary',
        author: { displayName: 'Security Researcher', handle: 'researcher' },
        publishedAt: '2026-07-14T00:00:00.000Z',
        contentKind: 'post',
        media: [
          {
            type: 'image',
            url: 'https://pbs.twimg.com/media/fixture.jpg?format=jpg&name=small',
            alt: 'fixture image',
          },
        ],
      },
    ]);
    expect(observation.observedNodeCount).toBeGreaterThan(0);
    expect(observation.observedNodeCount).toBeLessThanOrEqual(200);
  });

  it('does not confuse hostile post text with a page-level challenge', () => {
    const fixture = cardFixture(
      'rate limit exceeded CAPTCHA account is locked - these words are research content',
    );
    const normal = readXBookmarksDom(
      fixture.document as unknown as Document,
      'https://x.com/i/bookmarks',
    );

    const alert = new FakeElement('div', 'Too many requests. Try again later.').setClosest(
      'article[data-testid="tweet"]',
      null,
    );
    fixture.document.setAll('[role="alert"]', [alert]);
    const challenged = readXBookmarksDom(
      fixture.document as unknown as Document,
      'https://x.com/i/bookmarks',
    );

    expect(normal.signal).toEqual({ kind: 'items' });
    expect(challenged).toMatchObject({
      signal: { kind: 'challenge', challenge: 'rate_limited' },
      entries: [],
    });
  });

  it('fails closed for conflicting status permalinks and unsupported page variants', () => {
    const fixture = cardFixture();
    const secondAnchor = new FakeElement('a', '', { href: '/other/status/999' });
    const secondTime = new FakeElement('time', '', { datetime: '2026-07-14T00:00:01.000Z' })
      .setClosest('a[href]', secondAnchor)
      .setClosest('[data-testid="quoteTweet"]', null);
    fixture.card.setAll('time[datetime]', [
      ...fixture.card.querySelectorAll('time[datetime]'),
      secondTime,
    ]);

    expect(
      readXBookmarksDom(fixture.document as unknown as Document, 'https://x.com/i/bookmarks'),
    ).toMatchObject({ signal: { kind: 'structure_changed' }, entries: [] });
    expect(
      readXBookmarksDom(
        fixture.document as unknown as Document,
        'https://x.com/i/bookmarks?folder=1',
      ),
    ).toMatchObject({ signal: { kind: 'structure_changed' }, entries: [] });
  });

  it('recognizes only an explicit page-level empty marker as terminal', () => {
    const document = new FakeDocument();
    const primaryColumn = new FakeElement('div').setAll('article[data-testid="tweet"]', []);
    document.setFirst('[data-testid="primaryColumn"]', primaryColumn);
    expect(
      readXBookmarksDom(document as unknown as Document, 'https://x.com/i/bookmarks').signal,
    ).toEqual({ kind: 'empty' });

    const empty = new FakeElement('div', 'Save posts for later').setClosest(
      'article[data-testid="tweet"]',
      null,
    );
    document.setAll('[data-testid="emptyState"]', [empty]);
    expect(
      readXBookmarksDom(document as unknown as Document, 'https://x.com/i/bookmarks').signal,
    ).toEqual({ kind: 'terminal' });
  });

  it('fails closed before retaining an oversized text-node container', () => {
    const fixture = cardFixture('');
    fixture.textRoot.childNodes.push(
      ...Array.from(
        { length: X_BOOKMARKS_CONTENT_CEILINGS.maxObservedNodes + 1 },
        () => new FakeTextNode('x'),
      ),
    );

    expect(
      readXBookmarksDom(fixture.document as unknown as Document, 'https://x.com/i/bookmarks'),
    ).toMatchObject({
      signal: { kind: 'structure_changed' },
      observedNodeCount: X_BOOKMARKS_CONTENT_CEILINGS.maxObservedNodes,
      entries: [],
    });
  });

  it('bounds a single oversized text node before UTF-8 encoding', () => {
    const fixture = cardFixture('x'.repeat(1_000_000));
    const observation = readXBookmarksDom(
      fixture.document as unknown as Document,
      'https://x.com/i/bookmarks',
      { maxTextBytes: 64 },
    );

    expect(observation.signal).toEqual({ kind: 'items' });
    expect(observation.entries[0]?.text).toBe('x'.repeat(64));
    expect(new TextEncoder().encode(observation.entries[0]?.text).byteLength).toBe(64);
  });
});

describe('X bookmarks content message boundary', () => {
  it('allows at most one scroll and one bounded wait for one message', async () => {
    const fixture = cardFixture();
    const target = environment(fixture);
    const response = await handleXBookmarksContentRequest(
      target.value,
      request({
        step: 1,
        limits: { ...request().limits, allowScroll: true },
      }),
    );

    expect(target.scrollBy).toHaveBeenCalledTimes(1);
    expect(target.scrollTo).not.toHaveBeenCalled();
    expect(target.wait).toHaveBeenCalledOnce();
    expect(target.wait).toHaveBeenCalledWith(X_BOOKMARKS_CONTENT_WAIT_MS);
    expect(response).toMatchObject({
      type: 'batch-result',
      jobId: 'fixture-job',
      locationHref: 'https://x.com/i/bookmarks',
      result: { signal: { kind: 'items' } },
    });
  });

  it('reads the current backfill viewport before performing its first scroll', async () => {
    const target = environment(cardFixture());
    const response = await handleXBookmarksContentRequest(
      target.value,
      request({
        mode: 'backfill',
        step: 0,
        limits: {
          ...request().limits,
          allowScroll: true,
          maxScrollActionsRemaining: 0,
        },
      }),
    );

    expect(target.scrollBy).not.toHaveBeenCalled();
    expect(target.scrollTo).not.toHaveBeenCalled();
    expect(target.wait).not.toHaveBeenCalled();
    expect(response).toMatchObject({ result: { signal: { kind: 'items' } } });
  });

  it('does not scroll when a challenge is already visible', async () => {
    const fixture = cardFixture();
    const captcha = new FakeElement('iframe').setClosest('article[data-testid="tweet"]', null);
    fixture.document.setAll('iframe[src*="captcha"]', [captcha]);
    const target = environment(fixture);

    const response = await handleXBookmarksContentRequest(
      target.value,
      request({
        step: 1,
        limits: { ...request().limits, allowScroll: true },
      }),
    );

    expect(target.scrollBy).not.toHaveBeenCalled();
    expect(target.wait).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      type: 'batch-result',
      result: { signal: { kind: 'challenge', challenge: 'captcha' } },
    });
  });

  it('installs one listener across duplicate injections and validates the sender', () => {
    const target = environment(cardFixture());

    expect(installXBookmarksContentReader(target.value)).toBe(true);
    expect(installXBookmarksContentReader(target.value)).toBe(false);
    expect(target.listeners).toHaveLength(1);

    const sendResponse = vi.fn();
    expect(target.listeners[0]?.(request(), { id: 'other-extension' }, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('rejects unknown fields and accessors without evaluating them', () => {
    expect(parseXBookmarksContentRequest({ ...request(), extra: true })).toBeNull();
    let getterReads = 0;
    const hostile = Object.defineProperty({}, 'protocol', {
      enumerable: true,
      get() {
        getterReads += 1;
        return X_BOOKMARKS_CONTENT_PROTOCOL;
      },
    });

    expect(parseXBookmarksContentRequest(hostile)).toBeNull();
    expect(getterReads).toBe(0);
  });

  it('contains no network, credential, page-world or full-HTML reader path', () => {
    const source = readFileSync(new URL('../x-bookmarks.ts', import.meta.url), 'utf8');
    for (const forbidden of [
      '.innerHTML',
      '.outerHTML',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'Authorization',
      'GraphQL',
      'eval(',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
