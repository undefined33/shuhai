import { getLocalValue, setLocalValues } from './storage.js';

export type ActivityType =
  | 'classify_apply'
  | 'classify_undo'
  | 'health_delete'
  | 'health_update'
  | 'capture_save'
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

export const ACTIVITY_LOG_KEY = 'activityLog';
export const MAX_ACTIVITY_ENTRIES = 50;
export const MAX_ACTIVITY_DETAILS = 20;

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `activity_${Date.now()}_${Math.random()}`;
}

export function normalizeActivityEntry(input: ActivityInput): ActivityEntry {
  const details = input.details?.slice(0, MAX_ACTIVITY_DETAILS);

  return {
    id: createId(),
    type: input.type,
    timestamp: input.timestamp ?? new Date().toISOString(),
    summary: input.summary,
    ...(details && details.length > 0 ? { details } : {}),
  };
}

export function trimActivityLog(entries: ActivityEntry[]): ActivityEntry[] {
  return [...entries]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_ACTIVITY_ENTRIES);
}

export async function getActivityLog(): Promise<ActivityEntry[]> {
  return trimActivityLog(await getLocalValue<ActivityEntry[]>(ACTIVITY_LOG_KEY, []));
}

export async function addActivityEntry(input: ActivityInput): Promise<ActivityEntry> {
  const entry = normalizeActivityEntry(input);
  const existing = await getActivityLog();
  await setLocalValues({
    [ACTIVITY_LOG_KEY]: trimActivityLog([entry, ...existing]),
  });

  return entry;
}

export function clearActivityLog(): Promise<void> {
  return setLocalValues({ [ACTIVITY_LOG_KEY]: [] });
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
