import { describe, expect, it } from 'vitest';
import {
  createVirtualizedFixture,
  maliciousFixtureItem,
  scanFixturePages,
  type SpikePage,
  type SpikeSource,
} from './fixtures/social-sync-spike.js';

describe.each<SpikeSource>(['x', 'weibo'])('%s social sync feasibility fixture', (source) => {
  it('collects 50 stable items from overlapping virtual-list batches without duplicates', () => {
    const result = scanFixturePages(createVirtualizedFixture(source));

    expect(result.status).toBe('complete');
    expect(result.items).toHaveLength(50);
    expect(new Set(result.items.map((item) => item.sourceItemId))).toHaveLength(50);
    expect(result.checkpoint.seenIds).toHaveLength(50);
    expect(result.metrics.observedNodes).toBeGreaterThan(50);
    expect(result.metrics.observedNodes).toBeLessThanOrEqual(200);
  });

  it('resumes from a durable checkpoint instead of starting over', () => {
    const pages = createVirtualizedFixture(source);
    const firstRun = scanFixturePages(pages, { pauseAfterPages: 3 });
    const serializedCheckpoint = JSON.stringify(firstRun.checkpoint);
    const resumed = scanFixturePages(pages, {
      checkpoint: JSON.parse(serializedCheckpoint) as typeof firstRun.checkpoint,
    });

    expect(firstRun.status).toBe('paused');
    expect(firstRun.stopReason).toBe('user_paused');
    expect(resumed.status).toBe('complete');
    expect([...firstRun.items, ...resumed.items]).toHaveLength(50);
    expect(resumed.checkpoint.seenIds).toHaveLength(50);
    expect(resumed.metrics.observedNodes).toBeGreaterThan(50);
  });

  it.each([['login_required'], ['rate_limited'], ['structure_changed']] as const)(
    'fails closed for %s',
    (stopReason) => {
      const result = scanFixturePages([{ items: [], stopReason }]);

      expect(result.status).toBe('paused');
      expect(result.stopReason).toBe(stopReason);
      expect(result.items).toEqual([]);
    },
  );
});

describe('social sync spike safety budgets', () => {
  it('pauses before exceeding observed-node and time budgets', () => {
    const pages = createVirtualizedFixture('x');
    const nodeLimited = scanFixturePages(pages, { budget: { maxObservedNodes: 15 } });
    const timeLimited = scanFixturePages(pages, {
      budget: { maxElapsedMs: 15 },
      simulatedPageCostMs: 10,
    });

    expect(nodeLimited.stopReason).toBe('budget_exceeded');
    expect(nodeLimited.metrics.observedNodes).toBe(10);
    expect(timeLimited.stopReason).toBe('budget_exceeded');
    expect(timeLimited.metrics.elapsedMs).toBe(10);
  });

  it('enforces item, page and total-byte budgets without accepting an over-budget item', () => {
    const pages = createVirtualizedFixture('x');
    const itemLimited = scanFixturePages(pages, { budget: { maxItems: 10 } });
    const pageLimited = scanFixturePages(pages, { budget: { maxPages: 2 } });
    const byteLimited = scanFixturePages(pages, { budget: { maxTotalBytes: 256 } });

    expect(itemLimited.stopReason).toBe('budget_exceeded');
    expect(itemLimited.checkpoint.seenIds).toHaveLength(10);
    expect(pageLimited.stopReason).toBe('budget_exceeded');
    expect(pageLimited.metrics.pages).toBe(2);
    expect(byteLimited.stopReason).toBe('budget_exceeded');
    expect(byteLimited.checkpoint.acceptedBytes).toBeLessThanOrEqual(256);
  });

  it('clamps caller-provided budgets to immutable ceilings and rejects invalid values', () => {
    const clamped = scanFixturePages(createVirtualizedFixture('x', 60), {
      budget: {
        maxItems: 1_000,
        maxPages: 1_000,
        maxObservedNodes: 1_000,
        maxElapsedMs: 1_000_000,
        maxTextBytes: 1_000_000,
        maxMedia: 1_000,
        maxTotalBytes: 100_000_000,
      },
    });
    const invalid = scanFixturePages(createVirtualizedFixture('x'), {
      budget: { maxItems: Number.POSITIVE_INFINITY },
    });

    expect(clamped.stopReason).toBe('budget_exceeded');
    expect(clamped.checkpoint.seenIds).toHaveLength(50);
    expect(invalid.stopReason).toBe('structure_changed');
  });

  it('checks wall-clock time before reading the next untrusted item', () => {
    const ticks = [0, 0, 16, 16];
    const result = scanFixturePages(createVirtualizedFixture('x'), {
      budget: { maxElapsedMs: 15 },
      now: () => ticks.shift() ?? 16,
    });

    expect(result.stopReason).toBe('budget_exceeded');
    expect(result.items).toEqual([]);
    expect(result.metrics.elapsedMs).toBe(16);
  });

  it('checks wall-clock time again after item normalization', () => {
    const ticks = [0, 0, 0, 0, 16, 16];
    const result = scanFixturePages(createVirtualizedFixture('x'), {
      budget: { maxElapsedMs: 15 },
      now: () => ticks.shift() ?? 16,
    });

    expect(result.stopReason).toBe('budget_exceeded');
    expect(result.items).toEqual([]);
    expect(result.metrics.elapsedMs).toBe(16);
  });

  it('uses one terminal time snapshot for the completion decision and metrics', () => {
    const ticks = [0, 0, 0, 0, 0, 16, 16];
    const result = scanFixturePages([{ items: [maliciousFixtureItem('x')], terminal: true }], {
      budget: { maxElapsedMs: 15 },
      now: () => ticks.shift() ?? 16,
    });

    expect(result.stopReason).toBe('budget_exceeded');
    expect(result.status).toBe('paused');
  });

  it('rejects malformed identity and URL combinations', () => {
    const page: SpikePage = {
      items: [
        {
          ...maliciousFixtureItem('x'),
          canonicalUrl: 'https://evil.invalid/shuhai_fixture/status/90000000000000999',
        },
      ],
      terminal: true,
    };

    const result = scanFixturePages([page]);

    expect(result.status).toBe('paused');
    expect(result.stopReason).toBe('structure_changed');
    expect(result.items).toEqual([]);
  });

  it('keeps hostile content inert and filters unsafe media references', () => {
    const result = scanFixturePages([
      {
        items: [maliciousFixtureItem('x')],
        terminal: true,
      },
    ]);

    expect(result.status).toBe('complete');
    expect(result.items[0]?.text).toContain('Remove-Item');
    expect(result.items[0]?.text).toContain('<iframe');
    expect(result.items[0]?.mediaCount).toBe(1);
  });

  it('bounds media work before validating URLs', () => {
    const raw = maliciousFixtureItem('x');
    raw.mediaUrls = Array.from({ length: 100_000 }, (_, index) =>
      index < 12 ? `https://media.invalid/${index}.jpg` : 'javascript:alert(1)',
    );
    const result = scanFixturePages([{ items: [raw], terminal: true }]);

    expect(result.status).toBe('complete');
    expect(result.items[0]?.mediaCount).toBe(12);
  });

  it('downgrades truncated complete content to summary_only', () => {
    const raw = maliciousFixtureItem('weibo');
    raw.text = 'A'.repeat(12_000);
    const result = scanFixturePages([{ items: [raw], terminal: true }], {
      budget: { maxTextBytes: 128 },
    });

    expect(result.items[0]?.text).toHaveLength(128);
    expect(result.items[0]?.completeness).toBe('summary_only');
  });

  it('enforces the default 8 KiB text limit', () => {
    const raw = maliciousFixtureItem('x');
    raw.text = 'A'.repeat(12_000);
    const result = scanFixturePages([{ items: [raw], terminal: true }]);

    expect(result.items[0]?.text).toHaveLength(8 * 1024);
    expect(result.items[0]?.completeness).toBe('summary_only');
  });

  it.each([
    ['https://x.com/shuhai_fixture/status/1', '1', 'x', true],
    ['https://x.com/shuhai_fixture/status/1234567890123456789', '1234567890123456789', 'x', true],
    [
      'https://x.com/shuhai_fixture/status/12345678901234567890',
      '12345678901234567890',
      'x',
      false,
    ],
    ['https://x.com/shuhai_fixture/status/1?query=bad', '1', 'x', false],
    ['https://x.com/shuhai_fixture/status/1#bad', '1', 'x', false],
    ['https://user:pass@x.com/shuhai_fixture/status/1', '1', 'x', false],
    ['https://x.com:444/shuhai_fixture/status/1', '1', 'x', false],
    ['https://weibo.com/detail/ABC123', 'ABC123', 'weibo', true],
    ['https://weibo.com/detail/ABC12', 'ABC12', 'weibo', false],
    [
      'https://weibo.com/detail/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      'weibo',
      true,
    ],
    [
      'https://weibo.com/detail/ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
      'weibo',
      false,
    ],
  ] as const)('validates identity boundary for %s', (canonicalUrl, sourceItemId, source, valid) => {
    const result = scanFixturePages([
      {
        items: [
          {
            source,
            sourceItemId,
            canonicalUrl,
            completeness: 'metadata_only',
          },
        ],
        terminal: true,
      },
    ]);

    expect(result.status === 'complete').toBe(valid);
  });

  it('rejects oversized or duplicate serialized checkpoints', () => {
    const oversized = scanFixturePages(createVirtualizedFixture('x'), {
      checkpoint: {
        seenIds: Array.from({ length: 51 }, (_, index) => `x:${index}`),
        acceptedBytes: 0,
      },
    });
    const duplicate = scanFixturePages(createVirtualizedFixture('x'), {
      checkpoint: { seenIds: ['x:1', 'x:1'], acceptedBytes: 0 },
    });

    expect(oversized.stopReason).toBe('structure_changed');
    expect(duplicate.stopReason).toBe('structure_changed');
  });

  it('rejects malformed, non-finite and oversized checkpoint data', () => {
    const malformed = scanFixturePages(createVirtualizedFixture('x'), {
      checkpoint: { seenIds: ['other:1'], acceptedBytes: 0 },
    });
    const nonFinite = scanFixturePages(createVirtualizedFixture('x'), {
      checkpoint: { seenIds: [], acceptedBytes: Number.POSITIVE_INFINITY },
    });
    const oversizedJsonCheckpoint = {
      seenIds: ['x:1'],
      acceptedBytes: 0,
      untrustedExtra: 'A'.repeat(70 * 1024),
    } as unknown as { seenIds: string[]; acceptedBytes: number };
    const oversizedJson = scanFixturePages(createVirtualizedFixture('x'), {
      checkpoint: oversizedJsonCheckpoint,
    });

    expect(malformed.stopReason).toBe('structure_changed');
    expect(nonFinite.stopReason).toBe('structure_changed');
    expect(oversizedJson.stopReason).toBe('structure_changed');
  });
});
