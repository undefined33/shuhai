import 'fake-indexeddb/auto';

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import {
  adaptXBookmarksObservation,
  X_BOOKMARKS_ADAPTER_VERSION,
  type XBookmarksDomObservation,
} from '../src/social/adapters/x-bookmarks.js';
import {
  SYNC_LIMITS,
  makeSyncRecordKey,
  type SocialItem,
  type SyncRecord,
} from '../src/social/sync-schema.js';
import { ActiveSyncJobExistsError, openSyncStore } from '../src/social/sync-store.js';
import {
  X_SINGLE_EXTRACT_PROTOCOL,
  X_SINGLE_PROTOCOL,
  X_SINGLE_RESPONSE_PROTOCOL,
  X_SINGLE_VERSION,
  adaptXSingleEnvelope,
  canonicalizeXStatusUrl,
  createXSingleSyncJob,
  parseXSingleEnvelope,
  parseXSingleExtractRequest,
  parseXSingleExtractResponse,
  type XSingleEnvelope,
} from '../src/social/x-single-item.js';
import { renderSafeSocialMarkdown } from '../src/vault/safe-markdown.js';

const CAPTURED_AT = '2026-07-18T00:00:00.000Z';
const identity = canonicalizeXStatusUrl(
  'https://x.com/Alice/status/123456789?utm_source=test#reply',
)!;

function envelope(overrides: Partial<XSingleEnvelope> = {}): XSingleEnvelope {
  return {
    protocol: X_SINGLE_PROTOCOL,
    version: X_SINGLE_VERSION,
    routeFamily: 'x/status',
    sourceItemId: identity.sourceItemId,
    canonicalUrl: identity.canonicalUrl,
    title: 'Alice Research - hello from X',
    text: 'hello from X',
    author: {
      displayName: 'Alice Research',
      handle: 'alice',
    },
    publishedAt: CAPTURED_AT,
    media: [
      {
        type: 'image',
        url: 'https://pbs.twimg.com/media/example.jpg',
        alt: 'sample image',
      },
    ],
    contentKind: 'post',
    ...overrides,
  };
}

function adapterOptions() {
  return {
    capturedAt: CAPTURED_AT,
    remainingCandidateSlots: 1,
    limits: {
      maxItems: 1,
      maxBatches: 1,
      maxScrollActions: 1,
      maxObservedNodes: 1,
      maxElapsedMs: 30_000,
      maxTextBytes: SYNC_LIMITS.textBytes,
      maxMedia: SYNC_LIMITS.mediaItems,
      maxTotalBytes: SYNC_LIMITS.socialItemBytes,
      maxCheckpointBytes: SYNC_LIMITS.checkpointBytes,
      maxConsecutiveStructureErrors: 1,
    },
  };
}

function directObservation(item: XSingleEnvelope = envelope()): XBookmarksDomObservation {
  return {
    pageUrl: 'https://x.com/i/bookmarks',
    signal: { kind: 'terminal' },
    observedNodeCount: 1,
    entries: [
      {
        permalink: item.canonicalUrl,
        ...(item.title === undefined ? {} : { title: item.title }),
        ...(item.text === undefined ? {} : { text: item.text }),
        author: item.author,
        ...(item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt }),
        media: item.media,
        contentKind: item.contentKind,
      },
    ],
  };
}

function catalogRecord(item: SocialItem): SyncRecord {
  return {
    schemaVersion: 1,
    key: makeSyncRecordKey(item.source, item.sourceItemId),
    source: item.source,
    sourceItemId: item.sourceItemId,
    canonicalUrl: item.canonicalUrl,
    contentHash: item.contentHash,
    relativePath: `ShuHai/x/${item.sourceItemId}.md`,
    completeness: item.completeness,
    extractorVersion: item.extractorVersion,
    importedAt: CAPTURED_AT,
    lastSeenAt: CAPTURED_AT,
  };
}

describe('X single-item identity and envelope', () => {
  it.each([
    [
      'https://x.com/Alice/status/123456789?utm_source=test#reply',
      {
        handle: 'alice',
        sourceItemId: '123456789',
        canonicalUrl: 'https://x.com/alice/status/123456789',
      },
    ],
    ['https://twitter.com/alice/status/123456789', undefined],
    ['https://mobile.x.com/alice/status/123456789', undefined],
    ['http://x.com/alice/status/123456789', undefined],
    ['https://user:pass@x.com/alice/status/123456789', undefined],
    ['https://x.com/alice/status/not-a-number', undefined],
    ['https://x.com/alice/status/123456789/extra', undefined],
    ['https://x.com/i/bookmarks', undefined],
  ])('canonicalizes only an exact X status route: %s', (url, expected) => {
    expect(canonicalizeXStatusUrl(url)).toEqual(expected);
  });

  it('strictly parses and canonicalizes media fragments', () => {
    expect(
      parseXSingleEnvelope(
        envelope({
          media: [
            {
              type: 'image',
              url: 'https://pbs.twimg.com/media/example.jpg#fragment',
            },
          ],
        }),
      ),
    ).toMatchObject({
      canonicalUrl: identity.canonicalUrl,
      media: [{ url: 'https://pbs.twimg.com/media/example.jpg' }],
    });
  });

  it.each([
    ['unknown field', { ...envelope(), unexpected: true }],
    ['wrong item ID', { ...envelope(), sourceItemId: '987654321' }],
    ['wrong author', { ...envelope(), author: { handle: 'mallory' } }],
    [
      'non-HTTPS media',
      { ...envelope(), media: [{ type: 'image', url: 'http://example.com/image.jpg' }] },
    ],
    [
      'duplicate media',
      {
        ...envelope(),
        media: [
          { type: 'image', url: 'https://example.com/image.jpg' },
          { type: 'image', url: 'https://example.com/image.jpg' },
        ],
      },
    ],
    [
      'thirteen media',
      {
        ...envelope(),
        media: Array.from({ length: 13 }, (_, index) => ({
          type: 'image',
          url: `https://example.com/${index}.jpg`,
        })),
      },
    ],
    ['invalid timestamp', { ...envelope(), publishedAt: 'not-a-date' }],
    ['missing post text', { ...envelope(), text: undefined }],
  ])('fails closed for %s', (_name, value) => {
    expect(() => parseXSingleEnvelope(value)).toThrow();
  });

  it('rejects accessors, custom prototypes and cycles without invoking them', () => {
    let accessorInvoked = false;
    const accessor = { ...envelope() };
    Object.defineProperty(accessor, 'text', {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return 'unsafe';
      },
    });
    const customPrototype = Object.assign(Object.create({ inherited: true }), envelope());
    const cyclic = { ...envelope() } as XSingleEnvelope & { self?: unknown };
    cyclic.self = cyclic;

    expect(() => parseXSingleEnvelope(accessor)).toThrow();
    expect(accessorInvoked).toBe(false);
    expect(() => parseXSingleEnvelope(customPrototype)).toThrow();
    expect(() => parseXSingleEnvelope(cyclic)).toThrow();
  });

  it('binds request and response identity to one nonce', () => {
    const request = parseXSingleExtractRequest({
      protocol: X_SINGLE_EXTRACT_PROTOCOL,
      version: X_SINGLE_VERSION,
      type: 'xSingle:extract',
      requestId: 'xsingle:test-request',
      canonicalUrl: 'https://x.com/Alice/status/123456789?source=test',
      sourceItemId: '123456789',
    });
    expect(request.canonicalUrl).toBe(identity.canonicalUrl);
    expect(
      parseXSingleExtractResponse({
        protocol: X_SINGLE_RESPONSE_PROTOCOL,
        version: X_SINGLE_VERSION,
        requestId: request.requestId,
        ok: true,
        item: envelope(),
      }),
    ).toMatchObject({
      requestId: 'xsingle:test-request',
      ok: true,
    });
    expect(() =>
      parseXSingleExtractResponse({
        protocol: X_SINGLE_RESPONSE_PROTOCOL,
        version: X_SINGLE_VERSION,
        requestId: request.requestId,
        ok: true,
        item: envelope(),
        extra: true,
      }),
    ).toThrow();
  });

  it('produces byte-equivalent adapter identity and content metadata', async () => {
    const single = await adaptXSingleEnvelope(envelope(), identity, CAPTURED_AT);
    const batch = await adaptXBookmarksObservation(directObservation(), adapterOptions());

    expect(batch.items).toHaveLength(1);
    expect(single).toEqual(batch.items[0]);
    expect(single).toMatchObject({
      source: 'x',
      sourceItemId: '123456789',
      canonicalUrl: identity.canonicalUrl,
      extractorVersion: X_BOOKMARKS_ADAPTER_VERSION,
    });
  });

  it('keeps dangerous page text inert through the safe Markdown renderer', async () => {
    const item = await adaptXSingleEnvelope(
      envelope({
        text: [
          '---',
          'aliases: [injected]',
          '<script>alert(1)</script>',
          '![[secret.md]]',
          '<% tp.system.exec("calc") %>',
          '```dataviewjs',
          'dv.io.load("https://evil.example")',
          '```',
        ].join('\n'),
      }),
      identity,
      CAPTURED_AT,
    );
    const markdown = renderSafeSocialMarkdown(item);

    expect(markdown).not.toContain('<script>');
    expect(markdown).not.toContain('![[secret.md]]');
    expect(markdown).not.toContain('<% tp.system.exec');
    expect(markdown).not.toContain('```dataviewjs');
    expect(markdown).not.toContain('![](https://pbs.twimg.com');
    expect(markdown).toContain('https://pbs.twimg.com/media/example.jpg');
  });
});

describe('X single-item SyncJob', () => {
  it('creates one persisted review candidate with fixed budgets', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'x-single-new',
    });
    const result = await createXSingleSyncJob(store, envelope(), identity, {
      jobId: 'x-single-new-job',
      now: () => CAPTURED_AT,
    });

    expect(result).toMatchObject({
      classification: 'new',
      noWriteCandidate: false,
      job: {
        id: 'x-single-new-job',
        source: 'x',
        status: 'ready_for_review',
        scanMode: 'incremental',
        scanCompletion: 'trusted_terminal',
        budgets: {
          maxItems: 1,
          maxPages: 1,
          maxDurationMs: 30_000,
          maxItemBytes: SYNC_LIMITS.socialItemBytes,
          maxMediaPerItem: SYNC_LIMITS.mediaItems,
        },
        summary: {
          scannedCount: 1,
          uniqueItemCount: 1,
          pendingReviewCount: 0,
          unreviewedCount: 1,
        },
      },
    });
    await expect(store.listJobItems(result.job.id)).resolves.toHaveLength(1);
    store.close();
  });

  it('finishes an exact catalog hit as revision-zero no-write', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'x-single-existing',
    });
    const item = await adaptXSingleEnvelope(envelope(), identity, CAPTURED_AT);
    await store.putRecord(catalogRecord(item));

    const result = await createXSingleSyncJob(store, envelope(), identity, {
      jobId: 'x-single-existing-job',
      now: () => CAPTURED_AT,
    });

    expect(result).toMatchObject({
      classification: 'existing',
      noWriteCandidate: true,
      job: {
        status: 'ready_for_review',
        reviewRevision: 0,
        summary: {
          scannedCount: 1,
          uniqueItemCount: 0,
          selectedCount: 0,
          createdCount: 0,
          alreadyExistsCount: 0,
        },
      },
    });
    await expect(store.listJobItems(result.job.id)).resolves.toEqual([]);
    await expect(store.listWriteIntents({ jobId: result.job.id })).resolves.toEqual([]);
    store.close();
  });

  it('does not merge with or replace an active X job', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'x-single-active',
    });
    await store.createJob({
      id: 'existing-active-job',
      source: 'x',
      adapterVersion: X_BOOKMARKS_ADAPTER_VERSION,
      scanMode: 'incremental',
      budgets: {
        maxItems: 1,
        maxPages: 1,
        maxDurationMs: 30_000,
        maxItemBytes: SYNC_LIMITS.socialItemBytes,
        maxMediaPerItem: SYNC_LIMITS.mediaItems,
      },
      createdAt: CAPTURED_AT,
    });

    await expect(
      createXSingleSyncJob(store, envelope(), identity, {
        jobId: 'second-active-job',
        now: () => CAPTURED_AT,
      }),
    ).rejects.toBeInstanceOf(ActiveSyncJobExistsError);
    await expect(store.listJobs({ source: 'x' })).resolves.toHaveLength(1);
    store.close();
  });

  it('keeps same-title items with different stable IDs distinct', async () => {
    const first = await adaptXSingleEnvelope(envelope(), identity, CAPTURED_AT);
    const secondIdentity = canonicalizeXStatusUrl('https://x.com/alice/status/987654321')!;
    const second = await adaptXSingleEnvelope(
      envelope({
        sourceItemId: secondIdentity.sourceItemId,
        canonicalUrl: secondIdentity.canonicalUrl,
      }),
      secondIdentity,
      CAPTURED_AT,
    );

    expect(first.title).toBe(second.title);
    expect(first.sourceItemId).not.toBe(second.sourceItemId);
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it('fails before creating a job when the explicit job ID is invalid', async () => {
    const store = await openSyncStore({
      indexedDB: new IDBFactory(),
      dbName: 'x-single-invalid-id',
    });

    await expect(
      createXSingleSyncJob(store, envelope(), identity, {
        jobId: 'bad id',
        now: () => CAPTURED_AT,
      }),
    ).rejects.toThrow('x_single_job_id_unavailable');
    await expect(store.listJobs()).resolves.toEqual([]);
    store.close();
  });
});
