import type {
  DiagnosticReport,
  ExtractorPlatform,
  ProbeResult,
  SelectorProbe,
} from '../shared/bookmark-types.js';
import { getLocalValue, setLocalValues } from './storage.js';

export const EXTRACTOR_DIAGNOSTICS_KEY = 'extractorDiagnostics';
export const MAX_EXTRACTOR_DIAGNOSTICS = 20;

type QueryableRoot = Pick<ParentNode, 'querySelector'>;

export function sanitizeDiagnosticUrl(platform: ExtractorPlatform, url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean).slice(0, 2);
    return [parsed.hostname, ...segments].join('/');
  } catch {
    return platform;
  }
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
    url: sanitizeDiagnosticUrl(options.platform, options.url),
    probeResults: options.probeResults,
    structureValid: hasValidStructure(options.probes, options.probeResults),
    fallbacksUsed: [...(options.fallbacksUsed ?? [])],
    ...(options.error ? { error: options.error } : {}),
  };
}

export function shouldPersistDiagnostic(report: DiagnosticReport): boolean {
  return !report.structureValid || report.fallbacksUsed.length > 0 || Boolean(report.error);
}

export function structureErrorMessage(platform: ExtractorPlatform, missingNames: string[]): string {
  const label = platform === 'twitter' ? 'Twitter' : 'Weibo';

  if (missingNames.length >= 2) {
    return `${label} 页面结构已变化（${missingNames.join('、')} 均未找到）。可能是平台改版，请检查扩展是否有新版本。`;
  }

  if (missingNames.length === 1) {
    return `${label} 页面可能未完全加载或结构已变化：未找到 ${missingNames[0]}。请等待内容显示后重试。`;
  }

  return `${label} 页面可能未完全加载，请等待内容显示后重试。`;
}

export function fallbackMessage(platform: ExtractorPlatform, fallbacksUsed: string[]): string {
  const label = platform === 'twitter' ? 'Twitter' : 'Weibo';

  return `${label} 内容已通过备选选择器提取：${fallbacksUsed.join('、')}`;
}

export function trimDiagnosticReports(reports: DiagnosticReport[]): DiagnosticReport[] {
  return [...reports]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_EXTRACTOR_DIAGNOSTICS);
}

export async function getExtractorDiagnostics(): Promise<DiagnosticReport[]> {
  return trimDiagnosticReports(
    await getLocalValue<DiagnosticReport[]>(EXTRACTOR_DIAGNOSTICS_KEY, []),
  );
}

export async function saveExtractorDiagnostic(report: DiagnosticReport): Promise<void> {
  if (!shouldPersistDiagnostic(report)) {
    return;
  }

  const existing = await getExtractorDiagnostics();
  await setLocalValues({
    [EXTRACTOR_DIAGNOSTICS_KEY]: trimDiagnosticReports([report, ...existing]),
  });
}
