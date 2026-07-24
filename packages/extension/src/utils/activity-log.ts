import { z } from 'zod';

import { cloneBoundedStructuredValue } from '../shared/extension-messages.js';
import { getLocalValue, setLocalValues } from './storage.js';
import { sanitizeArticleMarkdown, sanitizeText } from './sanitize.js';

export type ActivityType =
  | 'classify_apply'
  | 'classify_undo'
  | 'health_delete'
  | 'health_update'
  | 'capture_save'
  | 'x_item_review'
  | 'vault_export'
  | 'backup_create';

export interface ActivityDetail {
  label: string;
  meta?: string;
}

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  timestamp: string;
  summary: string;
  details?: ActivityDetail[];
}

export interface ActivityInput {
  type: ActivityType;
  summary: string;
  details?: ActivityDetail[];
  timestamp?: string;
}

export type XItemActivityClassification = 'new' | 'existing' | 'changed' | 'incomplete' | 'error';

export interface ActivityFilter {
  types?: ActivityType[];
  keyword?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ActivityStats {
  thisWeek: number;
  thisMonth: number;
  byType: Partial<Record<ActivityType, number>>;
}

export interface ActivityGroup {
  label: string;
  entries: ActivityEntry[];
}

export const ACTIVITY_LOG_KEY = 'activityLog';
export const MAX_ACTIVITY_ENTRIES = 200;
export const MAX_ACTIVITY_DETAILS = 20;
const ACTIVITY_LOG_MAX_BYTES = 256 * 1_024;
const ACTIVITY_TYPES = [
  'classify_apply',
  'classify_undo',
  'health_delete',
  'health_update',
  'capture_save',
  'x_item_review',
  'vault_export',
  'backup_create',
] as const;

const activityDetailSchema: z.ZodType<ActivityDetail> = z.strictObject({
  label: z.string().max(512),
  meta: z.string().max(2_048).optional(),
});

const timestampSchema = z
  .string()
  .max(35)
  .refine((value) => {
    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  });

const activityEntrySchema: z.ZodType<ActivityEntry> = z.strictObject({
  id: z.string().min(1).max(256),
  type: z.enum(ACTIVITY_TYPES),
  timestamp: timestampSchema,
  summary: z.string().max(4_096),
  details: z.array(activityDetailSchema).max(MAX_ACTIVITY_DETAILS).optional(),
});

const activityInputSchema: z.ZodType<ActivityInput> = z.strictObject({
  type: z.enum(ACTIVITY_TYPES),
  summary: z.string().max(4_096),
  details: z
    .array(activityDetailSchema)
    .max(MAX_ACTIVITY_DETAILS * 2)
    .optional(),
  timestamp: timestampSchema.optional(),
});

const activityLogSchema = z.array(activityEntrySchema).max(MAX_ACTIVITY_ENTRIES);

function parseActivityInput(input: unknown): ActivityInput {
  const cloned = cloneBoundedStructuredValue(input, {
    maxBytes: 64 * 1_024,
    maxDepth: 6,
    maxNodes: 512,
    maxStringBytes: 4_096,
  });
  const parsed = activityInputSchema.safeParse(cloned);
  if (!parsed.success) {
    throw new Error('activity_input_invalid');
  }
  return parsed.data;
}

function xReviewFields(details: ActivityDetail[] | undefined): {
  classification: XItemActivityClassification;
  outcome: 'review_ready' | 'no_write';
} {
  const list = details ?? [];
  const values = new Map(list.map((detail) => [detail.label, detail.meta]));
  const classification = values.get('classification');
  const outcome = values.get('outcome');
  if (
    list.length !== 3 ||
    values.size !== 3 ||
    values.get('source') !== 'x' ||
    !['new', 'existing', 'changed', 'incomplete', 'error'].includes(classification ?? '') ||
    (outcome !== 'review_ready' && outcome !== 'no_write')
  ) {
    throw new Error('activity_log_invalid');
  }
  return {
    classification: classification as XItemActivityClassification,
    outcome,
  };
}

function normalizeStoredEntry(entry: ActivityEntry): ActivityEntry {
  if (entry.type === 'capture_save') {
    return {
      id: entry.id,
      type: entry.type,
      timestamp: entry.timestamp,
      summary: '旧内容保存记录',
    };
  }
  if (entry.type === 'x_item_review') {
    const { classification, outcome } = xReviewFields(entry.details);
    return {
      id: entry.id,
      type: entry.type,
      timestamp: entry.timestamp,
      summary: outcome === 'no_write' ? 'X 收藏已存在，无需写入' : 'X 收藏已进入复核',
      details: [
        { label: 'source', meta: 'x' },
        { label: 'classification', meta: classification },
        { label: 'outcome', meta: outcome },
      ],
    };
  }
  return entry;
}

function parseActivityLog(value: unknown): ActivityEntry[] {
  const cloned = cloneBoundedStructuredValue(value, {
    maxBytes: ACTIVITY_LOG_MAX_BYTES,
    maxDepth: 6,
    maxNodes: 4_096,
    maxStringBytes: 4_096,
  });
  const parsed = activityLogSchema.safeParse(cloned);
  if (!parsed.success) {
    throw new Error('activity_log_invalid');
  }
  return parsed.data.map(normalizeStoredEntry);
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `activity_${Date.now()}_${Math.random()}`;
}

export function normalizeActivityEntry(input: ActivityInput): ActivityEntry {
  const parsed = parseActivityInput(input);
  const legacyCapture = parsed.type === 'capture_save';
  const details = legacyCapture ? undefined : parsed.details?.slice(0, MAX_ACTIVITY_DETAILS);

  return normalizeStoredEntry({
    id: createId(),
    type: parsed.type,
    timestamp: parsed.timestamp ?? new Date().toISOString(),
    summary: legacyCapture ? '旧内容保存记录' : parsed.summary,
    ...(details && details.length > 0 ? { details } : {}),
  });
}

export function trimActivityLog(entries: ActivityEntry[]): ActivityEntry[] {
  return [...entries]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_ACTIVITY_ENTRIES);
}

export async function getActivityLog(): Promise<ActivityEntry[]> {
  const entries = await getLocalValue<unknown>(ACTIVITY_LOG_KEY, []);
  return trimActivityLog(parseActivityLog(entries));
}

export async function addActivityEntry(input: ActivityInput): Promise<ActivityEntry> {
  const entry = normalizeActivityEntry(input);
  const existing = await getActivityLog();
  await setLocalValues({
    [ACTIVITY_LOG_KEY]: trimActivityLog([entry, ...existing]),
  });

  return entry;
}

export function addXItemReviewActivity(
  classification: XItemActivityClassification,
  outcome: 'review_ready' | 'no_write',
): Promise<ActivityEntry> {
  return addActivityEntry({
    type: 'x_item_review',
    summary: outcome === 'no_write' ? 'X 收藏已存在，无需写入' : 'X 收藏已进入复核',
    details: [
      { label: 'source', meta: 'x' },
      { label: 'classification', meta: classification },
      { label: 'outcome', meta: outcome },
    ],
  });
}

export function clearActivityLog(): Promise<void> {
  return setLocalValues({ [ACTIVITY_LOG_KEY]: [] });
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfWeek(value: Date): Date {
  const date = startOfDay(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export function filterActivityLog(
  entries: ActivityEntry[],
  filter: ActivityFilter,
): ActivityEntry[] {
  const types = new Set(filter.types ?? []);
  const keyword = sanitizeText(filter.keyword ?? '').toLowerCase();
  const from = filter.dateFrom ? Date.parse(`${filter.dateFrom}T00:00:00`) : Number.NaN;
  const to = filter.dateTo ? Date.parse(`${filter.dateTo}T23:59:59.999`) : Number.NaN;

  return entries.filter((entry) => {
    if (types.size > 0 && !types.has(entry.type)) {
      return false;
    }

    const timestamp = Date.parse(entry.timestamp);
    if (Number.isFinite(from) && timestamp < from) {
      return false;
    }

    if (Number.isFinite(to) && timestamp > to) {
      return false;
    }

    if (keyword) {
      const haystack = [
        entry.summary,
        ...(entry.details ?? []).flatMap((detail) => [detail.label, detail.meta ?? '']),
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(keyword)) {
        return false;
      }
    }

    return true;
  });
}

export function groupActivityEntries(entries: ActivityEntry[], now = new Date()): ActivityGroup[] {
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = startOfWeek(now);
  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const groups = new Map<string, ActivityEntry[]>();

  for (const entry of entries) {
    const entryDate = startOfDay(new Date(entry.timestamp));
    let label = '更早';

    if (entryDate.getTime() === today.getTime()) {
      label = '今天';
    } else if (entryDate.getTime() === yesterday.getTime()) {
      label = '昨天';
    } else if (entryDate >= thisWeek && entryDate < yesterday) {
      label = '本周';
    } else if (entryDate >= lastWeek && entryDate < thisWeek) {
      label = '上周';
    }

    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }

  return ['今天', '昨天', '本周', '上周', '更早']
    .map((label) => ({ label, entries: groups.get(label) ?? [] }))
    .filter((group) => group.entries.length > 0);
}

export function calculateActivityStats(entries: ActivityEntry[], now = new Date()): ActivityStats {
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const byType: Partial<Record<ActivityType, number>> = {};
  let thisWeek = 0;
  let thisMonth = 0;

  for (const entry of entries) {
    const timestamp = new Date(entry.timestamp);
    if (timestamp >= monthStart) {
      thisMonth += 1;
    }

    if (timestamp >= weekStart) {
      thisWeek += 1;
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    }
  }

  return {
    thisWeek,
    thisMonth,
    byType,
  };
}

export function generateActivityMarkdown(entries: ActivityEntry[], now = new Date()): string {
  const groups = groupActivityEntries(entries, now);
  const lines = ['# ShuHai 历史记录', '', `导出时间: ${now.toISOString()}`, ''];

  for (const group of groups) {
    lines.push(`## ${group.label} (${group.entries.length})`, '');
    lines.push('| 时间 | 类型 | 摘要 | 详情 |');
    lines.push('| --- | --- | --- | --- |');
    for (const entry of group.entries) {
      const details = (entry.details ?? [])
        .map((detail) => `${sanitizeText(detail.label)} ${sanitizeText(detail.meta ?? '')}`.trim())
        .join('<br>');
      lines.push(
        `| ${sanitizeText(entry.timestamp)} | ${sanitizeText(entry.type)} | ${sanitizeText(entry.summary)} | ${details} |`,
      );
    }
    lines.push('');
  }

  return sanitizeArticleMarkdown(lines.join('\n'));
}

export function summarizeClassifyApply(count: number, folderCount: number): string {
  return `整理了 ${count} 个书签到 ${folderCount} 个文件夹`;
}

export function summarizeClassifyUndo(count: number): string {
  return `撤销了 ${count} 个书签的移动`;
}

export function summarizeHealthDelete(count: number): string {
  return `删除了 ${count} 个失效或检查失败书签`;
}

export function summarizeHealthUpdate(count: number): string {
  return `更新了 ${count} 个重定向书签`;
}

export function summarizeVaultExport(count: number, directory: string): string {
  return `写入了 ${count} 个文件到 ${directory || 'Vault'}`;
}
