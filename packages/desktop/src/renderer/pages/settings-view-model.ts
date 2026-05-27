import type { AppConfig } from '../../main/app-config.js';

export const UNSAVED_SETTINGS_MESSAGE = '设置尚未保存，确认离开吗？';

export function isSettingsDirty(draft: AppConfig, saved: AppConfig): boolean {
  return normalizeConfigForComparison(draft) !== normalizeConfigForComparison(saved);
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
