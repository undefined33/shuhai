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
  X_BOOKMARKS_LAYOUT_TRAVERSAL_CEILING,
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
  readonly primaryColumn: FakeElement;
  readonly card: FakeElement;
  readonly time: FakeElement;
  readonly textRoot: FakeElement;
  readonly image: FakeElement;
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
  return { document, primaryColumn, card, time, textRoot, image };
}

function defineMatches(element: object, selectors: readonly string[]): void {
  Object.defineProperty(element, 'matches', {
    value: (selector: string) => selectors.includes(selector),
  });
}

function installFixtureTreeWalker(
  fixture: FixtureDom,
  primaryLayoutNoise: number,
  cardLayoutNoise: number,
): readonly number[] {
  defineMatches(fixture.card, ['article[data-testid="tweet"]']);
  defineMatches(fixture.time, ['time[datetime]']);
  defineMatches(fixture.textRoot, ['[data-testid="tweetText"]']);
  defineMatches(fixture.image, ['img[src]']);

  const visitsPerWalker: number[] = [];
  const unrelatedNode = { matches: () => false };
  const ownerDocument = {
    createTreeWalker(root: unknown) {
      const nodes =
        root === fixture.primaryColumn
          ? [...Array.from({ length: primaryLayoutNoise }, () => unrelatedNode), fixture.card]
          : root === fixture.card
            ? [
                ...Array.from({ length: cardLayoutNoise }, () => unrelatedNode),
                fixture.time,
                fixture.textRoot,
                fixture.image,
              ]
            : [];
      const walkerIndex = visitsPerWalker.push(0) - 1;
      let index = 0;
      return {
        nextNode: () => {
          const node = nodes[index++] ?? null;
          if (node) {
            visitsPerWalker[walkerIndex] = (visitsPerWalker[walkerIndex] ?? 0) + 1;
          }
          return node;
        },
      };
    },
  };
  Object.defineProperty(fixture.primaryColumn, 'ownerDocument', { value: ownerDocument });
  Object.defineProperty(fixture.card, 'ownerDocument', { value: ownerDocument });
  return visitsPerWalker;
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
    candidateSourceItemIds: [],
    knownFrontierSourceItemIds: [],
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

  it('supports a caller disabling media extraction without treating images as an error', () => {
    const fixture = cardFixture();
    const observation = readXBookmarksDom(
      fixture.document as unknown as Document,
      'https://x.com/i/bookmarks',
      { maxMedia: 0 },
    );

    expect(observation.signal).toEqual({ kind: 'items' });
    expect(observation.entries).toHaveLength(1);
    expect(observation.entries[0]?.media).toEqual([]);
  });

  it('does not spend the content budget on unrelated X layout descendants', () => {
    const fixture = cardFixture();
    const primaryColumn = fixture.document.querySelector('[data-testid="primaryColumn"]');
    if (!primaryColumn) {
      throw new Error('Fixture must expose the X primary column');
    }
    Object.defineProperty(fixture.card, 'matches', {
      value: (selector: string) => selector === 'article[data-testid="tweet"]',
    });
    const createTreeWalker = vi.fn(() => {
      let remainingLayoutNodes = X_BOOKMARKS_CONTENT_CEILINGS.maxObservedNodes + 1;
      let returnedCard = false;
      return {
        nextNode: () => {
          if (remainingLayoutNodes-- > 0) {
            return { matches: () => false };
          }
          if (!returnedCard) {
            returnedCard = true;
            return fixture.card;
          }
          return null;
        },
      };
    });
    Object.defineProperty(primaryColumn, 'ownerDocument', {
      value: { createTreeWalker },
    });

    const observation = readXBookmarksDom(
      fixture.document as unknown as Document,
      'https://x.com/i/bookmarks',
    );

    expect(observation.signal).toEqual({ kind: 'items' });
    expect(observation.entries).toHaveLength(1);
    expect(observation.observedNodeCount).toBeLessThanOrEqual(
      X_BOOKMARKS_CONTENT_CEILINGS.maxObservedNodes,
    );
    expect(createTreeWalker).toHaveBeenCalledOnce();
  });

  it('allows the exact shared layout ceiling and fails closed on the next node', () => {
    const acceptedFixture = cardFixture();
    const acceptedVisits = installFixtureTreeWalker(
      acceptedFixture,
      X_BOOKMARKS_LAYOUT_TRAVERSAL_CEILING - 10,
      0,
    );
    const accepted = readXBookmarksDom(
      acceptedFixture.document as unknown as Document,
      'https://x.com/i/bookmarks',
    );

    const rejectedFixture = cardFixture();
    const rejectedVisits = installFixtureTreeWalker(
      rejectedFixture,
      X_BOOKMARKS_LAYOUT_TRAVERSAL_CEILING - 9,
      0,
    );
    const rejected = readXBookmarksDom(
      rejectedFixture.document as unknown as Document,
      'https://x.com/i/bookmarks',
    );

    expect(accepted.signal).toEqual({ kind: 'items' });
    expect(accepted.entries).toHaveLength(1);
    expect(acceptedVisits.reduce((total, value) => total + value, 0)).toBe(
      X_BOOKMARKS_LAYOUT_TRAVERSAL_CEILING,
    );
    expect(rejected).toMatchObject({
      signal: { kind: 'structure_changed' },
      observedNodeCount: X_BOOKMARKS_CONTENT_CEILINGS.maxObservedNodes,
      entries: [],
    });
    expect(rejectedVisits.reduce((total, value) => total + value, 0)).toBe(
      X_BOOKMARKS_LAYOUT_TRAVERSAL_CEILING + 1,
    );
  });

  it('shares the layout traversal budget across all selector queries', () => {
    const fixture = cardFixture();
    const visits = installFixtureTreeWalker(fixture, 2_999, 2_497);

    const observation = readXBookmarksDom(
      fixture.document as unknown as Document,
      'https://x.com/i/bookmarks',
    );

    expect(observation).toMatchObject({
      signal: { kind: 'structure_changed' },
      observedNodeCount: X_BOOKMARKS_CONTENT_CEILINGS.maxObservedNodes,
      entries: [],
    });
    expect(visits).toHaveLength(4);
    expect(Math.max(...visits)).toBeLessThan(5_000);
    expect(visits.reduce((total, value) => total + value, 0)).toBe(
      X_BOOKMARKS_LAYOUT_TRAVERSAL_CEILING + 1,
    );
  });

  it('fails closed when TreeWalker traversal or selector matching throws', () => {
    const traversalFixture = cardFixture();
    Object.defineProperty(traversalFixture.primaryColumn, 'ownerDocument', {
      value: {
        createTreeWalker: () => ({
          nextNode: () => {
            throw new Error('hostile TreeWalker');
          },
        }),
      },
    });
    const matchFixture = cardFixture();
    let returnedHostileNode = false;
    Object.defineProperty(matchFixture.primaryColumn, 'ownerDocument', {
      value: {
        createTreeWalker: () => ({
          nextNode: () => {
            if (returnedHostileNode) {
              return null;
            }
            returnedHostileNode = true;
            return {
              matches: () => {
                throw new Error('hostile matches');
              },
            };
          },
        }),
      },
    });

    expect(
      readXBookmarksDom(
        traversalFixture.document as unknown as Document,
        'https://x.com/i/bookmarks',
      ),
    ).toMatchObject({ signal: { kind: 'structure_changed' }, entries: [] });
    expect(
      readXBookmarksDom(matchFixture.document as unknown as Document, 'https://x.com/i/bookmarks'),
    ).toMatchObject({ signal: { kind: 'structure_changed' }, entries: [] });
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

  it('fails closed when a fifth status permalink would otherwise be silently truncated', () => {
    const fixtureWithFivePermalinks = () => {
      const fixture = cardFixture();
      const duplicateTimes = Array.from({ length: 3 }, (_, index) => {
        const anchor = new FakeElement('a', '', {
          href: '/researcher/status/1234567890123456789',
        });
        return new FakeElement('time', '', {
          datetime: `2026-07-14T00:00:0${index + 1}.000Z`,
        })
          .setClosest('a[href]', anchor)
          .setClosest('[data-testid="quoteTweet"]', null);
      });
      const conflictingAnchor = new FakeElement('a', '', { href: '/other/status/999' });
      const conflictingTime = new FakeElement('time', '', {
        datetime: '2026-07-14T00:00:04.000Z',
      })
        .setClosest('a[href]', conflictingAnchor)
        .setClosest('[data-testid="quoteTweet"]', null);
      const times = [fixture.time, ...duplicateTimes, conflictingTime];
      fixture.card.setAll('time[datetime]', times);
      return { fixture, times };
    };

    const fallbackFixture = fixtureWithFivePermalinks();
    const treeWalkerFixture = fixtureWithFivePermalinks();
    for (const time of treeWalkerFixture.times) {
      defineMatches(time, ['time[datetime]']);
    }
    Object.defineProperty(treeWalkerFixture.fixture.card, 'ownerDocument', {
      value: {
        createTreeWalker: () => {
          let index = 0;
          return { nextNode: () => treeWalkerFixture.times[index++] ?? null };
        },
      },
    });

    expect(
      readXBookmarksDom(
        fallbackFixture.fixture.document as unknown as Document,
        'https://x.com/i/bookmarks',
      ),
    ).toMatchObject({ signal: { kind: 'structure_changed' }, entries: [] });
    expect(
      readXBookmarksDom(
        treeWalkerFixture.fixture.document as unknown as Document,
        'https://x.com/i/bookmarks',
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

  it('keeps the latest candidate replay barrier while reading a later new card', async () => {
    const first = cardFixture('Known one', '/researcher/status/1000000000000000001');
    const second = cardFixture('Known two', '/researcher/status/1000000000000000002');
    const third = cardFixture('New item', '/researcher/status/1000000000000000003');
    first.primaryColumn.setAll('article[data-testid="tweet"]', [
      first.card,
      second.card,
      third.card,
    ]);
    const target = environment(first);

    const response = await handleXBookmarksContentRequest(
      target.value,
      request({
        candidateSourceItemIds: ['1000000000000000001', '1000000000000000002'],
        limits: { ...request().limits, remainingCandidateSlots: 1 },
      }),
    );

    expect(response).toMatchObject({
      type: 'batch-result',
      result: {
        items: [{ sourceItemId: '1000000000000000002' }, { sourceItemId: '1000000000000000003' }],
      },
    });
  });

  it('returns bounded replay evidence when every rendered card is already known', async () => {
    const fixture = cardFixture('Known item', '/researcher/status/1000000000000000001');
    const target = environment(fixture);

    const response = await handleXBookmarksContentRequest(
      target.value,
      request({
        candidateSourceItemIds: ['1000000000000000001'],
        limits: { ...request().limits, remainingCandidateSlots: 1 },
      }),
    );

    expect(response).toMatchObject({
      type: 'batch-result',
      result: {
        items: [{ sourceItemId: '1000000000000000001' }],
      },
    });
  });

  it('finds the 51st card without returning all 50 known candidate replays', async () => {
    const sourceItemIds = Array.from(
      { length: 51 },
      (_, index) => `1000000000000000${String(index + 1).padStart(3, '0')}`,
    );
    const fixtures = sourceItemIds.map((sourceItemId, index) =>
      cardFixture(`Item ${index + 1}`, `/researcher/status/${sourceItemId}`),
    );
    const first = fixtures[0]!;
    first.primaryColumn.setAll(
      'article[data-testid="tweet"]',
      fixtures.map((fixture) => fixture.card),
    );
    const candidateSourceItemIds = sourceItemIds.slice(0, 50);

    const response = await handleXBookmarksContentRequest(
      environment(first).value,
      request({
        candidateSourceItemIds,
        limits: { ...request().limits, remainingCandidateSlots: 1 },
      }),
    );

    expect(response).toMatchObject({
      type: 'batch-result',
      result: {
        items: [{ sourceItemId: candidateSourceItemIds[49] }, { sourceItemId: sourceItemIds[50] }],
      },
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
