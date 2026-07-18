import { z } from 'zod';

import type {
  DiagnosticReport,
  ExtractorPlatform,
  ProbeResult,
  SelectorProbe,
} from '../shared/bookmark-types.js';
import { cloneBoundedStructuredValue } from '../shared/extension-messages.js';
import {
  X_SINGLE_DIAGNOSTIC_CODES,
  X_SINGLE_PROBE_NAMES,
  X_SINGLE_VERSION,
  parseXSingleDiagnostic,
  type XSingleDiagnostic,
} from '../social/x-single-item.js';
import { getLocalValue, setLocalValues } from './storage.js';

export const EXTRACTOR_DIAGNOSTICS_KEY = 'extractorDiagnostics';
export const MAX_EXTRACTOR_DIAGNOSTICS = 20;
export const MAX_EXTRACTOR_DIAGNOSTIC_BYTES = 64 * 1_024;

type QueryableRoot = Pick<ParentNode, 'querySelector'>;

export interface StoredExtractorDiagnostic extends XSingleDiagnostic {
  readonly timestamp: string;
}

const probeSchema = z.strictObject({
  name: z.enum(X_SINGLE_PROBE_NAMES),
  found: z.boolean(),
});

const storedDiagnosticSchema: z.ZodType<StoredExtractorDiagnostic> = z
  .strictObject({
    version: z.literal(X_SINGLE_VERSION),
    platform: z.literal('x'),
    routeFamily: z.literal('x/status'),
    timestamp: z
      .string()
      .max(35)
      .refine((value) => {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
      }),
    errorCode: z.enum(X_SINGLE_DIAGNOSTIC_CODES),
    probes: z.array(probeSchema).max(X_SINGLE_PROBE_NAMES.length),
    usedFallback: z.boolean(),
  })
  .superRefine((value, context) => {
    const names = value.probes.map((probe) => probe.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: 'custom', path: ['probes'], message: 'Duplicate probe' });
    }
  });

const storedDiagnosticsSchema = z.array(storedDiagnosticSchema).max(MAX_EXTRACTOR_DIAGNOSTICS);

function parseStoredDiagnostics(value: unknown): StoredExtractorDiagnostic[] {
  const clone = cloneBoundedStructuredValue(value, {
    maxBytes: MAX_EXTRACTOR_DIAGNOSTIC_BYTES,
    maxDepth: 6,
    maxNodes: 512,
    maxStringBytes: 1_024,
  });
  const parsed = storedDiagnosticsSchema.safeParse(clone);
  if (!parsed.success) {
    throw new Error('extractor_diagnostics_invalid');
  }
  return parsed.data;
}

export function runSelectorProbes(root: QueryableRoot, probes: SelectorProbe[]): ProbeResult[] {
  return probes.map((probe) => ({
    name: probe.name,
    selector: probe.selector,
    found: Boolean(root.querySelector(probe.selector)),
  }));
}

export function hasValidStructure(probes: SelectorProbe[], results: ProbeResult[]): boolean {
  const resultByName = new Map(results.map((result) => [result.name, result]));
  return probes.every((probe) => !probe.required || resultByName.get(probe.name)?.found === true);
}

export function missingRequiredProbeNames(
  probes: SelectorProbe[],
  results: ProbeResult[],
): string[] {
  const resultByName = new Map(results.map((result) => [result.name, result]));
  return probes
    .filter((probe) => probe.required && resultByName.get(probe.name)?.found !== true)
    .map((probe) => probe.name);
}

/**
 * Kept only for the unreachable legacy Weibo extractor. New X diagnostics never include this shape.
 */
export function createDiagnosticReport(options: {
  platform: ExtractorPlatform;
  url: string;
  probes: SelectorProbe[];
  probeResults: ProbeResult[];
  fallbacksUsed?: string[];
  error?: string;
  now?: Date;
}): DiagnosticReport {
  return {
    platform: options.platform,
    timestamp: (options.now ?? new Date()).toISOString(),
    url: options.platform,
    probeResults: options.probeResults,
    structureValid: hasValidStructure(options.probes, options.probeResults),
    fallbacksUsed: [...(options.fallbacksUsed ?? [])],
    ...(options.error ? { error: 'legacy_extractor_failed' } : {}),
  };
}

export function structureErrorMessage(platform: ExtractorPlatform, missingNames: string[]): string {
  const label = platform === 'twitter' ? 'Twitter' : 'Weibo';
  return missingNames.length > 0
    ? `${label} 页面结构已变化，请稍后重试。`
    : `${label} 页面可能未完全加载，请稍后重试。`;
}

export function fallbackMessage(platform: ExtractorPlatform): string {
  return `${platform === 'twitter' ? 'Twitter' : 'Weibo'} 内容使用了兼容提取路径。`;
}

export async function getExtractorDiagnostics(): Promise<StoredExtractorDiagnostic[]> {
  const raw = await getLocalValue<unknown>(EXTRACTOR_DIAGNOSTICS_KEY, []);
  return parseStoredDiagnostics(raw);
}

export async function saveExtractorDiagnostic(
  diagnosticInput: XSingleDiagnostic,
  now = new Date(),
): Promise<StoredExtractorDiagnostic> {
  const diagnostic = parseXSingleDiagnostic(diagnosticInput);
  const timestamp = now.toISOString();
  const entry = storedDiagnosticSchema.parse({ ...diagnostic, timestamp });
  const existing = await getExtractorDiagnostics();
  const next = parseStoredDiagnostics(
    [entry, ...existing]
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, MAX_EXTRACTOR_DIAGNOSTICS),
  );
  await setLocalValues({ [EXTRACTOR_DIAGNOSTICS_KEY]: next });
  return entry;
}
