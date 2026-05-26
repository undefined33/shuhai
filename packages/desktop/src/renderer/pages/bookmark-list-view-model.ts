import type { UrlCheckProgress } from '../../main/health/index.js';
import type { SyncResult } from '../../main/sync/index.js';

export function formatSyncMessage(result: SyncResult): string {
  return `书签已同步：新增 ${result.added}，更新 ${result.updated}，移除 ${result.removed}`;
}

export function formatUrlCheckProgress(progress: UrlCheckProgress): string {
  const parts = [
    `检测中：${progress.completed}/${progress.total}`,
    `有效 ${progress.alive}`,
    `死链 ${progress.dead}`,
    `重定向 ${progress.redirect}`,
    `错误 ${progress.errors}`,
  ];

  return parts.join('，');
}
