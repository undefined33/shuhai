import { describe, expect, it, vi } from 'vitest';
import {
  adaptXBookmarksDom,
  detectXBookmarksCapability,
  resolveXBookmarksLimits,
  X_BOOKMARKS_CEILINGS,
  type XBookmarkDomEntryObservation,
  type XBookmarksAdapterOptions,
  type XBookmarksDomReadPort,
} from '../src/social/adapters/x-bookmarks.js';
import {
  createXBookmarkFixtureEntries,
  createXBookmarkFixtureEntry,
  createXBookmarksFixtureObservation,
  createXBookmarksFixturePort,
  FIXTURE_CAPTURE_OPTIONS,
  fixtureSourceItemId,
  hostileXBookmarkFixtureEntry,
  type XBookmarksFixtureObservation,
} from './fixtures/x-bookmarks.js';

const textEncoder = new TextEncoder();

async function adapt(
  observation: XBookmarksFixtureObservation,
  options: XBookmarksAdapterOptions = FIXTURE_CAPTURE_OPTIONS,
) {
  return adaptXBookmarksDom(createXBookmarksFixturePort(observation), options);
}

async function digest(value: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('X bookmarks capability', () => {
  it('supports only the exact official bookmarks page', () => {
    expect(detectXBookmarksCapability('https://x.com/i/bookmarks')).toEqual({
      kind: 'collection_scan',
      source: 'x',
      adapterVersion: 1,
    });

    for (const pageUrl of [
      'http://x.com/i/bookmarks',
      'https://x.com/i/bookmarks/',
      'https://x.com/i/bookmarks?folder=1',
      'https://x.com/i/bookmarks#fragment',
      'https://www.x.com/i/bookmarks',
      'https://twitter.com/i/bookmarks',
      'https://x.com:444/i/bookmarks',
      'https://user:pass@x.com/i/bookmarks',
      new String('https://x.com/i/bookmarks'),
      null,
    ]) {
      expect(detectXBookmarksCapability(pageUrl)).toEqual({ kind: 'unsupported' });
    }
  });

  it('does not inspect entries after navigation leaves the supported page', async () => {
    let entryReads = 0;
    const port: XBookmarksDomReadPort = {
      readPageUrl: () => 'https://x.com/home',
      readSignal: () => {
        throw new Error('must not be read');
      },
      readObservedNodeCount: () => {
        throw new Error('must not be read');
      },
      readEntryCount: () => {
        throw new Error('must not be read');
      },
      readEntry: () => {
        entryReads += 1;
        return undefined;
      },
    };

    const result = await adaptXBookmarksDom(port, FIXTURE_CAPTURE_OPTIONS);

    expect(result.signal).toEqual({ kind: 'unsupported' });
    expect(result.items).toEqual([]);
    expect(entryReads).toBe(0);
  });

  it('discards a batch when navigation changes while an entry is being normalized', async () => {
    const fixture = createXBookmarksFixtureObservation(1);
    const basePort = createXBookmarksFixturePort(fixture);
    let pageUrl = 'https://x.com/i/bookmarks';
    const port: XBookmarksDomReadPort = {
      ...basePort,
      readPageUrl: () => pageUrl,
      readEntry: (index) => {
        const entry = basePort.readEntry(index);
        pageUrl = 'https://x.com/home';
        return entry;
      },
    };

    const result = await adaptXBookmarksDom(port, FIXTURE_CAPTURE_OPTIONS);

    expect(result.capability).toEqual({ kind: 'unsupported' });
    expect(result.signal).toEqual({ kind: 'unsupported' });
    expect(result.items).toEqual([]);
  });
});

describe('X bookmarks fixture adapter', () => {
  it('normalizes 50 unique terminal items without overstating list completeness', async () => {
    const result = await adapt(createXBookmarksFixtureObservation());

    expect(result.signal).toEqual({ kind: 'terminal' });
    expect(result.items).toHaveLength(50);
    expect(new Set(result.items.map((item) => item.sourceItemId))).toHaveLength(50);
    expect(result.items.every((item) => item.completeness === 'summary_only')).toBe(true);
    expect(result.items.every((item) => item.source === 'x')).toBe(true);
    expect(result.metrics).toMatchObject({ observedNodes: 150, acceptedItems: 50 });
    expect(result.metrics.acceptedBytes).toBeGreaterThan(0);
    expect(result.metrics.acceptedBytes).toBeLessThanOrEqual(X_BOOKMARKS_CEILINGS.maxTotalBytes);
    expect(result.items[1]?.canonicalUrl).toBe(
      `https://x.com/fixture_3/status/${fixtureSourceItemId(2)}`,
    );
    expect(result.items[1]?.canonicalUrl).not.toContain('?');
    expect(result.items[1]?.canonicalUrl).not.toContain('#');
  });

  it.each([
    ['https://x.com/a/status/1', true],
    ['https://x.com/abcdefghijklmno/status/1234567890123456789', true],
    ['https://x.com/abcdefghijklmnop/status/1', false],
    ['https://x.com/a/status/12345678901234567890', false],
    ['https://x.com/a/status/not-digits', false],
    ['https://www.x.com/a/status/1', false],
    ['https://twitter.com/a/status/1', false],
    ['https://x.com:444/a/status/1', false],
    ['https://user:pass@x.com/a/status/1', false],
    ['https://x.com/a/status/1/extra', false],
    ['https://x.com/%61/status/1', false],
  ] as const)('validates the permalink identity boundary for %s', async (permalink, valid) => {
    const observation: XBookmarksFixtureObservation = {
      pageUrl: 'https://x.com/i/bookmarks',
      signal: { kind: 'terminal' },
      observedNodeCount: 1,
      entries: [
        {
          permalink,
          text: 'summary',
        },
      ],
    };

    const result = await adapt(observation);

    expect(result.signal.kind === 'terminal').toBe(valid);
    expect(result.items).toHaveLength(valid ? 1 : 0);
    if (!valid) {
      expect(result.signal).toEqual({
        kind: 'structure_changed',
        stopReason: 'structure_changed',
      });
    }
  });

  it('deduplicates an identical status but rejects one ID with conflicting content', async () => {
    const entry = createXBookmarkFixtureEntry(1);
    const duplicate = {
      ...entry,
      permalink: `${entry.permalink.split(/[?#]/u)[0]}?different=noise#ignored`,
      media: [...(entry.media ?? [])].reverse(),
    };
    const duplicateResult = await adapt({
      pageUrl: 'https://x.com/i/bookmarks',
      signal: { kind: 'terminal' },
      observedNodeCount: 2,
      entries: [entry, duplicate],
    });
    const conflictingResult = await adapt({
      pageUrl: 'https://x.com/i/bookmarks',
      signal: { kind: 'terminal' },
      observedNodeCount: 2,
      entries: [entry, { ...entry, text: 'conflicting text for the same stable ID' }],
    });

    expect(duplicateResult.signal.kind).toBe('terminal');
    expect(duplicateResult.items).toHaveLength(1);
    expect(conflictingResult.signal).toEqual({
      kind: 'structure_changed',
      stopReason: 'structure_changed',
    });
    expect(conflictingResult.items).toEqual([]);
  });

  it('uses NFC/LF and fixed key-order SHA-256 independent of capture time and media order', async () => {
    const entry: XBookmarkDomEntryObservation = {
      permalink: 'https://x.com/Stable_1/status/1234567890123456789?noise=1#ignored',
      title: 'Cafe\u0301',
      text: 'line one\r\nline two\rline three',
      author: { displayName: 'Jose\u0301', handle: '@stable_1' },
      publishedAt: '2026-07-13T08:00:00+08:00',
      media: [
        { type: 'video', url: 'https://media.invalid/z#fragment', alt: 'Z' },
        { type: 'image', url: 'https://media.invalid/a', alt: 'A' },
        { type: 'image', url: 'https://media.invalid/a', alt: 'A' },
      ],
    };
    const observation: XBookmarksFixtureObservation = {
      pageUrl: 'https://x.com/i/bookmarks',
      signal: { kind: 'terminal' },
      observedNodeCount: 1,
      entries: [entry],
    };
    const first = await adapt(observation, {
      ...FIXTURE_CAPTURE_OPTIONS,
      capturedAt: '2026-07-13T12:00:00.000Z',
    });
    const second = await adapt(
      { ...observation, entries: [{ ...entry, media: [...(entry.media ?? [])].reverse() }] },
      {
        ...FIXTURE_CAPTURE_OPTIONS,
        capturedAt: '2026-07-14T12:00:00.000Z',
      },
    );
    const item = first.items[0];
    expect(item).toBeDefined();
    expect(item?.title).toBe('Café');
    expect(item?.text).toBe('line one\nline two\nline three');
    expect(item?.author?.displayName).toBe('José');
    expect(item?.media).toEqual([
      { type: 'image', url: 'https://media.invalid/a', alt: 'A' },
      { type: 'video', url: 'https://media.invalid/z', alt: 'Z' },
    ]);
    expect(second.items[0]?.contentHash).toBe(item?.contentHash);

    const serialized = JSON.stringify({
      schemaVersion: item?.schemaVersion,
      source: item?.source,
      sourceItemId: item?.sourceItemId,
      canonicalUrl: item?.canonicalUrl,
      title: item?.title ?? null,
      text: item?.text ?? null,
      author:
        item?.author === undefined
          ? null
          : {
              displayName: item.author.displayName ?? null,
              handle: item.author.handle ?? null,
            },
      publishedAt: item?.publishedAt ?? null,
      completeness: item?.completeness,
      media: item?.media.map((media) => ({
        type: media.type,
        url: media.url,
        alt: media.alt ?? null,
      })),
      extractorVersion: item?.extractorVersion,
    });
    expect(item?.contentHash).toBe(await digest(serialized));
  });

  it('keeps hostile page text inert and filters unsafe media schemes without networking', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network access is forbidden');
    });
    try {
      const result = await adapt({
        pageUrl: 'https://x.com/i/bookmarks',
        signal: { kind: 'terminal' },
        observedNodeCount: 1,
        entries: [hostileXBookmarkFixtureEntry()],
      });

      expect(result.signal.kind).toBe('terminal');
      expect(result.items[0]?.text).toContain('{{system: run command}}');
      expect(result.items[0]?.text).toContain('Remove-Item');
      expect(result.items[0]?.text).toContain('<iframe');
      expect(result.items[0]?.text).toContain('dataviewjs');
      expect(result.items[0]?.text).toContain('![[dangerous-embed]]');
      expect(result.items[0]?.media).toEqual([
        {
          type: 'image',
          url: 'https://media.invalid/safe-reference.jpg',
          alt: 'safe reference',
        },
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('bounds UTF-8 text and media work before inspecting ignored array elements', async () => {
    const media = new Array<unknown>(100_000);
    for (let index = 0; index < 12; index += 1) {
      media[index] = {
        type: 'image',
        url: `https://media.invalid/${String(index).padStart(2, '0')}`,
      };
    }
    let ignoredAccessorReads = 0;
    Object.defineProperty(media, '12', {
      enumerable: true,
      get: () => {
        ignoredAccessorReads += 1;
        throw new Error('must remain outside the media budget');
      },
    });
    const entry = createXBookmarkFixtureEntry(1, {
      text: '😀'.repeat(10_000),
      media: media as unknown as XBookmarkDomEntryObservation['media'],
    });

    const result = await adapt({
      pageUrl: 'https://x.com/i/bookmarks',
      signal: { kind: 'terminal' },
      observedNodeCount: 1,
      entries: [entry],
    });

    expect(result.signal.kind).toBe('terminal');
    expect(textEncoder.encode(result.items[0]?.text ?? '').byteLength).toBeLessThanOrEqual(
      8 * 1024,
    );
    expect(result.items[0]?.text?.endsWith('😀')).toBe(true);
    expect(result.items[0]?.media).toHaveLength(12);
    expect(ignoredAccessorReads).toBe(0);
  });

  it('marks missing text as metadata_only and explicit unsupported content as unsupported', async () => {
    const result = await adapt({
      pageUrl: 'https://x.com/i/bookmarks',
      signal: { kind: 'terminal' },
      observedNodeCount: 2,
      entries: [
        createXBookmarkFixtureEntry(1, { text: undefined }),
        createXBookmarkFixtureEntry(2, { contentKind: 'unsupported' }),
      ],
    });

    expect(result.items.map((item) => item.completeness)).toEqual(['metadata_only', 'unsupported']);
  });

  it('marks only an exact identity-only observation for catalog-safe classification', async () => {
    const sourceItemId = fixtureSourceItemId(1);
    const result = await adapt({
      pageUrl: 'https://x.com/i/bookmarks',
      signal: { kind: 'items' },
      observedNodeCount: 2,
      entries: [
        {
          permalink: `https://x.com/example/status/${sourceItemId}`,
          observationMode: 'identity_only',
          author: { handle: 'example' },
          media: [],
        },
      ],
    });

    expect(result).toMatchObject({
      identityOnlySourceItemIds: [sourceItemId],
      items: [{ sourceItemId, completeness: 'metadata_only' }],
    });

    const overstated = await adapt({
      pageUrl: 'https://x.com/i/bookmarks',
      signal: { kind: 'items' },
      observedNodeCount: 2,
      entries: [
        {
          permalink: `https://x.com/example/status/${sourceItemId}`,
          observationMode: 'identity_only',
          text: 'must not be hidden behind an identity-only hint',
          author: { handle: 'example' },
          media: [],
        },
      ],
    });
    expect(overstated.signal).toEqual({
      kind: 'structure_changed',
      stopReason: 'structure_changed',
    });
  });
});

describe('X bookmarks typed signals and immutable budgets', () => {
  it.each([
    [{ kind: 'empty' }, { kind: 'empty' }],
    [{ kind: 'terminal' }, { kind: 'terminal' }],
    [
      { kind: 'challenge', challenge: 'login_required' },
      { kind: 'challenge', challenge: 'login_required', stopReason: 'login_required' },
    ],
    [
      { kind: 'challenge', challenge: 'captcha' },
      { kind: 'challenge', challenge: 'captcha', stopReason: 'login_required' },
    ],
    [
      { kind: 'challenge', challenge: 'rate_limited' },
      { kind: 'challenge', challenge: 'rate_limited', stopReason: 'rate_limited' },
    ],
    [{ kind: 'structure_changed' }, { kind: 'structure_changed', stopReason: 'structure_changed' }],
  ] as const)('returns a typed %s signal', async (signal, expected) => {
    const result = await adapt({
      pageUrl: 'https://x.com/i/bookmarks',
      signal,
      observedNodeCount: 0,
      entries: [],
    });

    expect(result.signal).toEqual(expected);
    expect(result.items).toEqual([]);
  });

  it('clamps caller limits and pauses at 50 items unless an explicit terminal was observed', async () => {
    const oversizedLimits = Object.fromEntries(
      Object.entries(X_BOOKMARKS_CEILINGS).map(([key, value]) => [key, value * 100]),
    );
    const clamped = resolveXBookmarksLimits(oversizedLimits);
    const noEnd = await adapt(createXBookmarksFixtureObservation(50, { kind: 'items' }), {
      ...FIXTURE_CAPTURE_OPTIONS,
      limits: oversizedLimits,
    });
    const overLimit = await adapt(createXBookmarksFixtureObservation(51), {
      ...FIXTURE_CAPTURE_OPTIONS,
      limits: oversizedLimits,
    });
    const lowered = await adapt(createXBookmarksFixtureObservation(3), {
      ...FIXTURE_CAPTURE_OPTIONS,
      limits: { maxItems: 2 },
    });

    expect(clamped).toEqual(X_BOOKMARKS_CEILINGS);
    expect(noEnd.signal).toMatchObject({ kind: 'budget_exceeded', budget: 'candidate_items' });
    expect(noEnd.items).toHaveLength(50);
    expect(overLimit.signal).toMatchObject({ kind: 'budget_exceeded', budget: 'candidate_items' });
    expect(overLimit.items).toHaveLength(50);
    expect(lowered.signal).toMatchObject({ kind: 'budget_exceeded', budget: 'candidate_items' });
    expect(lowered.items).toHaveLength(2);
  });

  it('bounds one raw batch by remaining candidate slots without guessing catalog identity', async () => {
    const replayBatch = await adapt(createXBookmarksFixtureObservation(10), {
      ...FIXTURE_CAPTURE_OPTIONS,
      remainingCandidateSlots: 24,
    });
    const alreadyFull = await adapt(createXBookmarksFixtureObservation(1), {
      ...FIXTURE_CAPTURE_OPTIONS,
      remainingCandidateSlots: 0,
    });

    expect(replayBatch.signal).toEqual({ kind: 'terminal' });
    expect(replayBatch.items).toHaveLength(10);
    expect(alreadyFull.signal).toMatchObject({
      kind: 'budget_exceeded',
      budget: 'candidate_items',
    });
    expect(alreadyFull.items).toEqual([]);
  });

  it('keeps stable replays while only unseen IDs consume remaining candidate slots', async () => {
    const knownSourceItemIds = [fixtureSourceItemId(1), fixtureSourceItemId(2)];
    const result = await adapt(createXBookmarksFixtureObservation(3, { kind: 'items' }), {
      ...FIXTURE_CAPTURE_OPTIONS,
      remainingCandidateSlots: 1,
      knownSourceItemIds,
    });

    expect(result.items.map((item) => item.sourceItemId)).toEqual([
      ...knownSourceItemIds,
      fixtureSourceItemId(3),
    ]);
    expect(result.signal).toMatchObject({ kind: 'budget_exceeded', budget: 'candidate_items' });
    expect(result.metrics.acceptedItems).toBe(3);
  });

  it('allows a later batch to reuse candidate slots after catalog-existing observations', async () => {
    const first = await adapt(createXBookmarksFixtureObservation(3, { kind: 'items' }), {
      ...FIXTURE_CAPTURE_OPTIONS,
      remainingCandidateSlots: 3,
    });
    const second = await adapt(createXBookmarksFixtureObservation(3, { kind: 'terminal' }), {
      ...FIXTURE_CAPTURE_OPTIONS,
      remainingCandidateSlots: 3,
    });

    expect(first.items).toHaveLength(3);
    expect(first.signal).toMatchObject({ kind: 'budget_exceeded', budget: 'candidate_items' });
    expect(second.items).toHaveLength(3);
    expect(second.signal).toEqual({ kind: 'terminal' });
  });

  it('enforces observed-node, elapsed-time and cumulative-byte ceilings', async () => {
    const nodeLimited = await adapt({
      ...createXBookmarksFixtureObservation(1),
      observedNodeCount: 201,
    });
    let tick = 0;
    const timeLimited = await adapt(createXBookmarksFixtureObservation(1), {
      ...FIXTURE_CAPTURE_OPTIONS,
      limits: { maxElapsedMs: 1 },
      now: () => {
        const current = tick;
        tick += 2;
        return current;
      },
    });
    const byteLimited = await adapt(createXBookmarksFixtureObservation(1), {
      ...FIXTURE_CAPTURE_OPTIONS,
      acceptedBytesBefore: X_BOOKMARKS_CEILINGS.maxTotalBytes - 1,
    });

    expect(nodeLimited.signal).toMatchObject({ kind: 'budget_exceeded', budget: 'observed_nodes' });
    expect(timeLimited.signal).toMatchObject({ kind: 'budget_exceeded', budget: 'elapsed_time' });
    expect(byteLimited.signal).toMatchObject({ kind: 'budget_exceeded', budget: 'accepted_bytes' });
    expect(byteLimited.items).toEqual([]);
  });

  it('rejects invalid, non-finite and unknown budget fields', async () => {
    for (const limits of [
      { maxItems: 0 },
      { maxItems: Number.POSITIVE_INFINITY },
      { maxItems: 1.5 },
      { unknownBudget: 1 },
    ]) {
      const result = await adapt(createXBookmarksFixtureObservation(1), {
        ...FIXTURE_CAPTURE_OPTIONS,
        limits: limits as Partial<typeof X_BOOKMARKS_CEILINGS>,
      });
      expect(result.signal).toEqual({
        kind: 'structure_changed',
        stopReason: 'structure_changed',
      });
    }
  });
});

describe('X bookmarks untrusted input handling', () => {
  it('rejects accessors without evaluating them', async () => {
    let getterReads = 0;
    const entry = createXBookmarkFixtureEntry(1) as unknown as Record<string, unknown>;
    Object.defineProperty(entry, 'text', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return 'must not be read';
      },
    });

    const result = await adapt({
      pageUrl: 'https://x.com/i/bookmarks',
      signal: { kind: 'terminal' },
      observedNodeCount: 1,
      entries: [entry],
    });

    expect(result.signal.kind).toBe('structure_changed');
    expect(result.items).toEqual([]);
    expect(getterReads).toBe(0);
  });

  it('fails closed for throwing proxies and prototype mutation keys', async () => {
    const proxy = new Proxy(createXBookmarkFixtureEntry(1), {
      ownKeys: () => {
        throw new Error('hostile proxy');
      },
    });
    const polluted = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(polluted, {
      permalink: {
        value: `https://x.com/a/status/${fixtureSourceItemId(2)}`,
        enumerable: true,
      },
      text: { value: 'summary', enumerable: true },
    });
    Object.defineProperty(polluted, '__proto__', {
      value: { polluted: true },
      enumerable: true,
    });

    for (const entry of [proxy, polluted]) {
      const result = await adapt({
        pageUrl: 'https://x.com/i/bookmarks',
        signal: { kind: 'terminal' },
        observedNodeCount: 1,
        entries: [entry],
      });
      expect(result.signal.kind).toBe('structure_changed');
      expect(result.items).toEqual([]);
    }
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects malformed signal, sparse entry sources and author/permalink identity conflicts', async () => {
    const sparseEntries = createXBookmarkFixtureEntries(2) as Array<unknown>;
    sparseEntries.length = 3;
    const cases: XBookmarksFixtureObservation[] = [
      {
        pageUrl: 'https://x.com/i/bookmarks',
        signal: { kind: 'challenge', challenge: 'unknown' },
        observedNodeCount: 0,
        entries: [],
      },
      {
        pageUrl: 'https://x.com/i/bookmarks',
        signal: { kind: 'terminal' },
        observedNodeCount: 3,
        entries: sparseEntries,
      },
      {
        pageUrl: 'https://x.com/i/bookmarks',
        signal: { kind: 'terminal' },
        observedNodeCount: 1,
        entries: [createXBookmarkFixtureEntry(1, { author: { handle: '@another_user' } })],
      },
    ];

    for (const observation of cases) {
      const result = await adapt(observation);
      expect(result.signal.kind).toBe('structure_changed');
      expect(result.items).toEqual([]);
    }
  });
});
