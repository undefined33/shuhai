import type { AppConfig } from '../../main/app-config.js';

export const UNSAVED_SETTINGS_MESSAGE = '设置尚未保存，确认离开吗？';

export function isSettingsDirty(draft: AppConfig, saved: AppConfig): boolean {
  return normalizeConfigForComparison(draft) !== normalizeConfigForComparison(saved);
}

export function formatSyncNextRun(nextRunAt: string | null | undefined): string {
  if (!nextRunAt) {
    return '下次自动同步：等待设置保存后计算';
  }

  const date = new Date(nextRunAt);
  if (Number.isNaN(date.getTime())) {
    return '下次自动同步：时间暂不可用';
  }

  return `下次自动同步：${date.toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function normalizeConfigForComparison(config: AppConfig): string {
  return JSON.stringify({
    vaultPath: config.vaultPath,
    chromeProfile: config.chromeProfile,
    ai: {
      provider: config.ai.provider,
      apiKey: config.ai.apiKey ?? '',
      model: config.ai.model ?? '',
      baseUrl: config.ai.baseUrl ?? '',
      batchSize: config.ai.batchSize,
      autoClassify: config.ai.autoClassify,
      monthlyBudget: config.ai.monthlyBudget ?? null,
    },
    firstRunComplete: config.firstRunComplete,
    syncIntervalMinutes: config.syncIntervalMinutes,
  });
}
