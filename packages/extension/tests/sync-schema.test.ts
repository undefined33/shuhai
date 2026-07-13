import { describe, expect, it } from 'vitest';
import {
  RelativeMarkdownPathSchema,
  SYNC_LIMITS,
  SocialItemSchema,
  SyncBudgetsSchema,
  SyncCheckpointSchema,
  SyncJobItemRowSchema,
  SyncJobSchema,
  SyncRecordSchema,
  SyncStopRecordSchema,
  WriteIntentSchema,
  WriteOutcomeSchema,
  WeiboSourceItemIdSchema,
  XSourceItemIdSchema,
  makeSyncJobItemKey,
  makeSyncRecordKey,
  type SocialItem,
} from '../src/social/sync-schema.js';

const HASH = 'a'.repeat(64);
const CAPTURED_AT = '2026-07-13T12:00:00+08:00';

function socialItem(overrides: Partial<SocialItem> = {}): SocialItem {
  return {
    schemaVersion: 1,
    source: 'x',
    sourceItemId: '1890000000000000001',
    canonicalUrl: 'https://x.com/example/status/1890000000000000001',
    title: 'A saved post',
    text: 'Structured source text',
    author: { displayName: 'Example', handle: 'example' },
    publishedAt: '2026-07-12T01:02:03.456Z',
    capturedAt: CAPTURED_AT,
    completeness: 'summary_only',
    media: [{ type: 'image', url: 'https://cdn.example.test/image.jpg', alt: 'Image' }],
    contentHash: HASH,
    extractorVersion: 1,
    ...overrides,
  };
}

describe('SocialItemSchema', () => {
  it('parses a bounded strict SocialItem contract', () => {
    expect(SocialItemSchema.parse(socialItem())).toEqual(socialItem());
  });

  it('binds source-specific IDs to canonical platform hosts and paths', () => {
    expect(XSourceItemIdSchema.safeParse('1').success).toBe(true);
    expect(XSourceItemIdSchema.safeParse('1234567890123456789').success).toBe(true);
    expect(WeiboSourceItemIdSchema.safeParse('AbCd1234').success).toBe(true);
    expect(
      SocialItemSchema.safeParse(
        socialItem({
          sourceItemId: '1234567890',
          canonicalUrl: 'https://twitter.com/example/status/1234567890',
        }),
      ).success,
    ).toBe(true);
    expect(
      SocialItemSchema.safeParse(
        socialItem({
          source: 'weibo',
          sourceItemId: 'AbCd1234',
          canonicalUrl: 'https://m.weibo.cn/detail/AbCd1234',
        }),
      ).success,
    ).toBe(true);

    const invalidIdentities: SocialItem[] = [
      socialItem({ sourceItemId: 'item-1', canonicalUrl: 'https://x.com/a/status/item-1' }),
      socialItem({
        sourceItemId: '12345678901234567890',
        canonicalUrl: 'https://x.com/a/status/12345678901234567890',
      }),
      socialItem({
        sourceItemId: '1234567890',
        canonicalUrl: 'https://example.test/a/status/1234567890',
      }),
      socialItem({
        sourceItemId: '1234567890',
        canonicalUrl: 'https://x.com/a/status/9999999999',
      }),
      socialItem({
        source: 'weibo',
        sourceItemId: 'short',
        canonicalUrl: 'https://weibo.com/a/short',
      }),
      socialItem({
        source: 'weibo',
        sourceItemId: 'AbCd_1234',
        canonicalUrl: 'https://weibo.com/a/AbCd_1234',
      }),
      socialItem({
        source: 'weibo',
        sourceItemId: 'AbCd1234',
        canonicalUrl: 'https://weibo.com/a/ZyXw9876',
      }),
    ];
    for (const item of invalidIdentities) {
      expect(SocialItemSchema.safeParse(item).success).toBe(false);
    }
  });

  it('rejects unknown keys at every object boundary and unknown schema versions', () => {
    expect(SocialItemSchema.safeParse({ ...socialItem(), unexpected: true }).success).toBe(false);
    expect(
      SocialItemSchema.safeParse({
        ...socialItem(),
        author: { displayName: 'Example', role: 'admin' },
      }).success,
    ).toBe(false);
    expect(
      SocialItemSchema.safeParse({
        ...socialItem(),
        media: [{ type: 'image', url: 'https://example.test/a.jpg', onerror: 'run()' }],
      }).success,
    ).toBe(false);
    expect(SocialItemSchema.safeParse({ ...socialItem(), schemaVersion: 2 }).success).toBe(false);
  });

  it('fails closed for prototype mutation keys, custom prototypes, and accessors', () => {
    const ownProtoKey = socialItem() as SocialItem & Record<string, unknown>;
    Object.defineProperty(ownProtoKey, '__proto__', {
      value: { polluted: true },
      enumerable: true,
    });
    expect(SocialItemSchema.safeParse(ownProtoKey).success).toBe(false);

    const customPrototype = Object.assign(Object.create({ polluted: true }), socialItem());
    expect(SocialItemSchema.safeParse(customPrototype).success).toBe(false);

    const accessor = socialItem() as SocialItem & Record<string, unknown>;
    Object.defineProperty(accessor, 'hiddenPayload', {
      enumerable: true,
      get: () => 'payload',
    });
    expect(SocialItemSchema.safeParse(accessor).success).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const { proxy, revoke } = Proxy.revocable(socialItem(), {});
    revoke();
    expect(() => SocialItemSchema.safeParse(proxy)).not.toThrow();
    expect(SocialItemSchema.safeParse(proxy).success).toBe(false);

    let descriptorReads = 0;
    const hostileArray = new Proxy(socialItem().media, {
      getOwnPropertyDescriptor(target, property) {
        descriptorReads += 1;
        if (descriptorReads > 1) {
          throw new Error('descriptor trap');
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    expect(() => SocialItemSchema.safeParse(socialItem({ media: hostileArray }))).not.toThrow();
    expect(SocialItemSchema.safeParse(socialItem({ media: hostileArray })).success).toBe(false);
  });

  it.each([
    'http://x.com/example/status/1',
    'javascript:alert(1)',
    'data:text/plain,hello',
    'https://user:secret@example.test/private',
    'https://user%40example.test@example.test/private',
    'https://example.test\\@attacker.test/path',
    'https://evil.x.com/example/status/1890000000000000001',
    'https://x.com:443/example/status/1890000000000000001',
    'https://X.COM/example/status/1890000000000000001',
    'https://x.com/example/status/1890000000000000001/',
    'https://x.com//example/status/1890000000000000001',
    'https://x.com/example/status/1890000000000000001?utm_source=tracker',
    'https://x.com/example/status/1890000000000000001#fragment',
    'not a URL',
  ])('rejects unsafe canonical URL %s', (canonicalUrl) => {
    expect(SocialItemSchema.safeParse(socialItem({ canonicalUrl })).success).toBe(false);
  });

  it('applies the same URL policy to remote media', () => {
    expect(
      SocialItemSchema.safeParse(
        socialItem({ media: [{ type: 'image', url: 'data:image/svg+xml,attack' }] }),
      ).success,
    ).toBe(false);
  });

  it.each([
    '2026-07-13 12:00:00Z',
    '2026-07-13T12:00:00',
    '2024-02-30T12:00:00Z',
    '2026-13-01T12:00:00Z',
    '2026-07-13T25:00:00Z',
    '2026-07-13T12:00:00+24:00',
  ])('rejects malformed timestamp %s', (capturedAt) => {
    expect(SocialItemSchema.safeParse(socialItem({ capturedAt })).success).toBe(false);
  });

  it.each(['a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}g`, 'sha256:a'])(
    'rejects malformed content hash %s',
    (contentHash) => {
      expect(SocialItemSchema.safeParse(socialItem({ contentHash })).success).toBe(false);
    },
  );

  it('enforces UTF-8 string, item, and array budgets', () => {
    expect(
      SocialItemSchema.safeParse(socialItem({ text: 'x'.repeat(SYNC_LIMITS.textBytes) })).success,
    ).toBe(true);
    expect(
      SocialItemSchema.safeParse(socialItem({ text: 'x'.repeat(SYNC_LIMITS.textBytes + 1) }))
        .success,
    ).toBe(false);
    expect(SocialItemSchema.safeParse(socialItem({ title: '界'.repeat(400) })).success).toBe(false);
    expect(
      SocialItemSchema.safeParse(
        socialItem({
          media: Array.from({ length: SYNC_LIMITS.mediaItems + 1 }, (_, index) => ({
            type: 'link' as const,
            url: `https://example.test/media/${index}`,
          })),
        }),
      ).success,
    ).toBe(false);
    expect(
      SocialItemSchema.safeParse(
        socialItem({ sourceItemId: 'x'.repeat(SYNC_LIMITS.sourceItemIdBytes + 1) }),
      ).success,
    ).toBe(false);
  });
});

describe('persisted sync schemas', () => {
  it('keeps stop records typed, minimal, and free of page diagnostics', () => {
    const stopRecord = {
      code: 'worker_interrupted',
      stoppedAt: '2026-07-13T00:00:01Z',
      phase: 'scanning',
      scanRevision: 2,
      scannedCount: 10,
      acceptedCount: 8,
    };
    expect(SyncStopRecordSchema.safeParse(stopRecord).success).toBe(true);
    expect(SyncStopRecordSchema.safeParse({ ...stopRecord, code: 'captcha_bypass' }).success).toBe(
      false,
    );
    expect(
      SyncStopRecordSchema.safeParse({
        ...stopRecord,
        rawError: 'https://x.com/private/status/123 token=secret',
      }).success,
    ).toBe(false);
  });

  it('keeps job objects strict and enforces complete summary invariants', () => {
    const job = {
      schemaVersion: 1,
      id: 'job-1',
      source: 'x',
      status: 'complete',
      adapterVersion: 1,
      scanRevision: 1,
      reviewRevision: 1,
      authorizedReviewRevision: 1,
      createdAt: '2026-07-13T00:00:00Z',
      updatedAt: '2026-07-13T00:00:01Z',
      writeAuthorizedAt: '2026-07-13T00:00:01Z',
      checkpoint: {
        schemaVersion: 1,
        adapterVersion: 1,
        scanRevision: 1,
        scannedCount: 1,
        acceptedCount: 1,
        acceptedBytes: 100,
        consecutiveKnownIds: 0,
        updatedAt: '2026-07-13T00:00:01Z',
      },
      budgets: {
        maxItems: 100,
        maxPages: 10,
        maxDurationMs: 60_000,
        maxItemBytes: SYNC_LIMITS.socialItemBytes,
        maxMediaPerItem: SYNC_LIMITS.mediaItems,
      },
      summary: {
        scannedCount: 1,
        uniqueItemCount: 1,
        pendingReviewCount: 0,
        classificationErrorCount: 0,
        unreviewedCount: 0,
        selectedCount: 1,
        excludedCount: 0,
        writePendingCount: 0,
        createdCount: 1,
        alreadyExistsCount: 0,
        skippedCount: 0,
        writeErrorCount: 0,
      },
    };

    expect(SyncJobSchema.safeParse(job).success).toBe(true);
    expect(SyncJobSchema.safeParse({ ...job, writeAuthorizedAt: undefined }).success).toBe(false);
    expect(
      SyncJobSchema.safeParse({
        ...job,
        status: 'ready_for_review',
        summary: { ...job.summary, createdCount: 0 },
      }).success,
    ).toBe(false);
    expect(SyncJobSchema.safeParse({ ...job, activeSource: 'x' }).success).toBe(false);
    expect(
      SyncJobSchema.safeParse({
        ...job,
        summary: { ...job.summary, writePendingCount: 1, createdCount: 0 },
      }).success,
    ).toBe(false);
    expect(
      SyncJobSchema.safeParse({
        ...job,
        summary: { ...job.summary, createdCount: 0 },
      }).success,
    ).toBe(false);
  });

  it('validates record identity, path, time order, and intent identity', () => {
    const sourceItemId = '1234567890';
    const key = makeSyncRecordKey('x', sourceItemId);
    const record = {
      schemaVersion: 1,
      key,
      source: 'x',
      sourceItemId,
      canonicalUrl: `https://x.com/example/status/${sourceItemId}`,
      contentHash: HASH,
      relativePath: 'Social/X/item-1.md',
      completeness: 'summary_only',
      extractorVersion: 1,
      importedAt: '2026-07-13T00:00:01Z',
      lastSeenAt: '2026-07-13T00:00:02Z',
    };
    expect(SyncRecordSchema.safeParse(record).success).toBe(true);
    expect(SyncRecordSchema.safeParse({ ...record, key: 'x:other' }).success).toBe(false);
    expect(
      SyncRecordSchema.safeParse({
        ...record,
        canonicalUrl: 'https://x.com/example/status/9999999999',
      }).success,
    ).toBe(false);
    expect(
      SyncRecordSchema.safeParse({
        ...record,
        lastSeenAt: '2026-07-13T00:00:00Z',
      }).success,
    ).toBe(false);

    const intent = {
      schemaVersion: 1,
      id: 'intent-1',
      jobId: 'job-1',
      itemKey: makeSyncJobItemKey('job-1', sourceItemId),
      recordKey: key,
      source: 'x',
      sourceItemId,
      canonicalUrl: record.canonicalUrl,
      contentHash: HASH,
      relativePath: record.relativePath,
      completeness: 'summary_only',
      extractorVersion: 1,
      reviewRevision: 1,
      createdAt: record.importedAt,
    };
    expect(WriteIntentSchema.safeParse(intent).success).toBe(true);
    expect(WriteIntentSchema.safeParse({ ...intent, id: 'intent:unsafe' }).success).toBe(false);
    expect(WriteIntentSchema.safeParse({ ...intent, recordKey: 'x:other' }).success).toBe(false);
    expect(WriteIntentSchema.safeParse({ ...intent, itemKey: 'wrong:item:key' }).success).toBe(
      false,
    );
    expect(
      WriteIntentSchema.safeParse({
        ...intent,
        canonicalUrl: 'https://twitter.com/example/status/9999999999',
      }).success,
    ).toBe(false);

    const row = {
      key: makeSyncJobItemKey('job-1', sourceItemId),
      schemaVersion: 1,
      jobId: 'job-1',
      sourceItemId,
      item: socialItem({ sourceItemId, canonicalUrl: record.canonicalUrl }),
      classification: 'new',
      reviewDecision: 'unreviewed',
      reviewRevision: 0,
      writeStatus: 'not_requested',
      discoveredAt: record.importedAt,
      updatedAt: record.importedAt,
    };
    expect(SyncJobItemRowSchema.safeParse(row).success).toBe(true);
    expect(
      SyncJobItemRowSchema.safeParse({
        ...row,
        reviewDecision: 'selected',
        reviewRevision: 1,
      }).success,
    ).toBe(true);
    expect(
      SyncJobItemRowSchema.safeParse({
        ...row,
        reviewDecision: 'excluded',
        reviewRevision: 1,
        writeStatus: 'pending',
      }).success,
    ).toBe(false);
    expect(SyncJobItemRowSchema.safeParse({ ...row, key: 'wrong:item:key' }).success).toBe(false);
    expect(
      SyncJobItemRowSchema.safeParse({
        ...row,
        classification: 'error',
        writeStatus: 'error',
        outcome: { status: 'error', relativePath: record.relativePath, code: 'invalid_item' },
      }).success,
    ).toBe(false);
  });

  it('preflights direct operation inputs without invoking accessors or custom prototypes', () => {
    let accessorInvoked = false;
    const hostileBudgets: Record<string, unknown> = {
      maxPages: 10,
      maxDurationMs: 60_000,
      maxItemBytes: SYNC_LIMITS.socialItemBytes,
      maxMediaPerItem: SYNC_LIMITS.mediaItems,
    };
    Object.defineProperty(hostileBudgets, 'maxItems', {
      enumerable: true,
      get: () => {
        accessorInvoked = true;
        return 100;
      },
    });
    const hostileCheckpoint = Object.assign(Object.create({ inherited: true }), {
      schemaVersion: 1,
      adapterVersion: 1,
      scanRevision: 1,
      scannedCount: 1,
      acceptedCount: 1,
      acceptedBytes: 100,
      consecutiveKnownIds: 0,
      updatedAt: '2026-07-13T00:00:01Z',
    });
    const hostileOutcome = new Proxy(
      { status: 'error', relativePath: 'Social/x/item.md', code: 'denied' },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('descriptor trap');
        },
      },
    );

    expect(SyncBudgetsSchema.safeParse(hostileBudgets).success).toBe(false);
    expect(accessorInvoked).toBe(false);
    expect(SyncCheckpointSchema.safeParse(hostileCheckpoint).success).toBe(false);
    expect(() => WriteOutcomeSchema.safeParse(hostileOutcome)).not.toThrow();
    expect(WriteOutcomeSchema.safeParse(hostileOutcome).success).toBe(false);
  });

  it.each([
    '../escape.md',
    '/absolute.md',
    'Social\\item.md',
    'Social/CON.md',
    'Social/CLOCK$.md',
    'Social/trailing. /item.md',
    'Social/control\u0085.md',
    'Social/item.txt',
  ])('rejects unsafe relative Markdown path %s', (path) => {
    expect(RelativeMarkdownPathSchema.safeParse(path).success).toBe(false);
  });

  it('uses the same UTF-8 segment and total path budgets as the Vault writer', () => {
    expect(RelativeMarkdownPathSchema.safeParse(`${'a'.repeat(117)}.md`).success).toBe(true);
    expect(RelativeMarkdownPathSchema.safeParse(`${'a'.repeat(118)}.md`).success).toBe(false);
    expect(RelativeMarkdownPathSchema.safeParse(`${'界'.repeat(40)}/item.md`).success).toBe(true);
    expect(RelativeMarkdownPathSchema.safeParse(`${'界'.repeat(41)}/item.md`).success).toBe(false);
    expect(
      RelativeMarkdownPathSchema.safeParse(
        `${'a'.repeat(120)}/${'b'.repeat(120)}/${'c'.repeat(120)}/${'d'.repeat(120)}/${'e'.repeat(26)}.md`,
      ).success,
    ).toBe(false);
  });
});
