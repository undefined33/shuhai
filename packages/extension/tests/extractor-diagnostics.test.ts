import { describe, expect, it } from 'vitest';
import type { SelectorProbe } from '../src/shared/bookmark-types.js';
import {
  createDiagnosticReport,
  missingRequiredProbeNames,
  sanitizeDiagnosticUrl,
  shouldPersistDiagnostic,
  trimDiagnosticReports,
} from '../src/utils/extractor-diagnostics.js';

const probes: SelectorProbe[] = [
  { name: 'text', selector: '.text', required: true, description: '正文' },
  { name: 'author', selector: '.author', required: true, description: '作者' },
  { name: 'time', selector: 'time', required: false, description: '时间' },
];

describe('extractor diagnostics', () => {
  it('sanitizes diagnostic URLs to host and first two path segments', () => {
    expect(sanitizeDiagnosticUrl('twitter', 'https://x.com/user/status/123?token=secret')).toBe(
      'x.com/user/status',
    );
  });

  it('detects missing required probes and creates structured reports', () => {
    const probeResults = [
      { name: 'text', selector: '.text', found: true },
      { name: 'author', selector: '.author', found: false },
      { name: 'time', selector: 'time', found: false },
    ];
    const report = createDiagnosticReport({
      platform: 'twitter',
      url: 'https://x.com/user/status/123',
      probes,
      probeResults,
      fallbacksUsed: ['Twitter 正文: article [lang]'],
      now: new Date('2026-05-29T00:00:00Z'),
    });

    expect(missingRequiredProbeNames(probes, probeResults)).toEqual(['author']);
    expect(report.structureValid).toBe(false);
    expect(report.url).toBe('x.com/user/status');
    expect(shouldPersistDiagnostic(report)).toBe(true);
  });

  it('trims diagnostic reports newest first', () => {
    const reports = Array.from({ length: 25 }, (_, index) =>
      createDiagnosticReport({
        platform: 'weibo',
        url: `https://weibo.com/detail/${index}`,
        probes,
        probeResults: probes.map((probe) => ({
          name: probe.name,
          selector: probe.selector,
          found: true,
        })),
        error: `error-${index}`,
        now: new Date(index * 1000),
      }),
    );

    const trimmed = trimDiagnosticReports(reports);

    expect(trimmed).toHaveLength(20);
    expect(trimmed[0].error).toBe('error-24');
  });
});
