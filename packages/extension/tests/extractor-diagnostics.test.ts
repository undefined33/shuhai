import { describe, expect, it } from 'vitest';

import type { SelectorProbe } from '../src/shared/bookmark-types.js';
import { createXSingleDiagnostic } from '../src/social/x-single-item.js';
import {
  EXTRACTOR_DIAGNOSTICS_KEY,
  MAX_EXTRACTOR_DIAGNOSTICS,
  createDiagnosticReport,
  getExtractorDiagnostics,
  missingRequiredProbeNames,
  saveExtractorDiagnostic,
} from '../src/utils/extractor-diagnostics.js';
import { getStorageMocks, getStorageSnapshot, setStorageSnapshot } from './setup.js';

const probes: SelectorProbe[] = [
  { name: 'text', selector: '.text', required: true, description: '正文' },
  { name: 'author', selector: '.author', required: true, description: '作者' },
  { name: 'time', selector: 'time', required: false, description: '时间' },
];

function diagnostic(errorCode: 'content_missing' | 'structure_changed' = 'content_missing') {
  return createXSingleDiagnostic(errorCode, [
    { name: 'primary_article', found: true },
    { name: 'status_permalink', found: true },
    { name: 'tweet_text', found: false },
    { name: 'author', found: true },
    { name: 'timestamp', found: false },
  ]);
}

describe('extractor diagnostics', () => {
  it('keeps the unreachable legacy report free of URLs, selectors, and raw errors', () => {
    const report = createDiagnosticReport({
      platform: 'twitter',
      url: 'https://x.com/private-user/status/123?token=secret',
      probes,
      probeResults: [
        { name: 'text', selector: '.private-text', found: false },
        { name: 'author', selector: '.private-author', found: true },
      ],
      error: 'private raw extraction error',
      now: new Date('2026-05-29T00:00:00.000Z'),
    });

    expect(report.url).toBe('twitter');
    expect(report.error).toBe('legacy_extractor_failed');
    expect(JSON.stringify(report)).not.toContain('private-user');
    expect(JSON.stringify(report)).not.toContain('token=secret');
    expect(missingRequiredProbeNames(probes, report.probeResults)).toEqual(['text']);
  });

  it('stores only the strict X diagnostic with a background-generated canonical timestamp', async () => {
    const entry = await saveExtractorDiagnostic(diagnostic(), new Date('2026-07-18T06:00:00.000Z'));

    expect(entry).toEqual({
      ...diagnostic(),
      timestamp: '2026-07-18T06:00:00.000Z',
    });
    await expect(getExtractorDiagnostics()).resolves.toEqual([entry]);
    expect(JSON.stringify(getStorageSnapshot())).not.toMatch(
      /private|selector|https?:|status\/\d|raw error/iu,
    );
  });

  it('retains only the newest bounded diagnostic entries', async () => {
    for (let index = 0; index < MAX_EXTRACTOR_DIAGNOSTICS + 2; index += 1) {
      await saveExtractorDiagnostic(
        diagnostic(index % 2 === 0 ? 'content_missing' : 'structure_changed'),
        new Date(index * 1_000),
      );
    }

    const entries = await getExtractorDiagnostics();
    expect(entries).toHaveLength(MAX_EXTRACTOR_DIAGNOSTICS);
    expect(entries[0]?.timestamp).toBe(
      new Date((MAX_EXTRACTOR_DIAGNOSTICS + 1) * 1_000).toISOString(),
    );
  });

  it.each([
    { ...diagnostic(), version: 2 },
    { ...diagnostic(), routeFamily: 'x/bookmarks' },
    { ...diagnostic(), errorCode: 'private_error' },
    {
      ...diagnostic(),
      probes: [{ name: 'private_selector', found: true }],
    },
    { ...diagnostic(), timestamp: '2026-07-18T06:00:00.000Z' },
    { ...diagnostic(), privateUrl: 'https://x.com/private/status/1' },
  ])('rejects untrusted diagnostic shape before storage write', async (input) => {
    await expect(saveExtractorDiagnostic(input as never)).rejects.toThrow();
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('rejects malformed or non-canonical stored values without rewriting them', async () => {
    const raw = [
      {
        ...diagnostic(),
        timestamp: '2026-07-18T06:00:00Z',
      },
    ];
    setStorageSnapshot({ [EXTRACTOR_DIAGNOSTICS_KEY]: raw });

    await expect(getExtractorDiagnostics()).rejects.toThrow('extractor_diagnostics_invalid');
    expect(getStorageSnapshot()).toEqual({ [EXTRACTOR_DIAGNOSTICS_KEY]: raw });
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('rejects accessor-bearing input without reading or persisting it', async () => {
    const input = { ...diagnostic() } as Record<string, unknown>;
    Object.defineProperty(input, 'privateUrl', {
      enumerable: true,
      get: () => {
        throw new Error('private getter executed');
      },
    });

    await expect(saveExtractorDiagnostic(input as never)).rejects.toThrow();
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });
});
