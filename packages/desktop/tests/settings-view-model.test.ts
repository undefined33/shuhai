import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/main/app-config.js';
import {
  formatSyncNextRun,
  isSettingsDirty,
} from '../src/renderer/pages/settings-view-model.js';

describe('Settings view model', () => {
  it('detects unsaved user changes while ignoring window bounds', () => {
    const saved = makeConfig();

    expect(isSettingsDirty({ ...saved, windowBounds: { x: 0, y: 0, width: 1, height: 1 } }, saved))
      .toBe(false);
    expect(isSettingsDirty({ ...saved, vaultPath: 'C:\\Vault2' }, saved)).toBe(true);
    expect(isSettingsDirty({
      ...saved,
      ai: { ...saved.ai, apiKey: 'changed' },
    }, saved)).toBe(true);
  });

  it('formats the next automatic sync time', () => {
    expect(formatSyncNextRun(null)).toBe('下次自动同步：等待设置保存后计算');
    expect(formatSyncNextRun('not-a-date')).toBe('下次自动同步：时间暂不可用');
    expect(formatSyncNextRun('2024-02-01T12:30:00.000Z')).toContain('下次自动同步：');
  });
});

function makeConfig(): AppConfig {
  return {
    vaultPath: 'C:\\Vault',
    chromeProfile: 'Default',
    ai: {
      provider: 'deepseek',
      apiKey: 'key',
      batchSize: 50,
      autoClassify: true,
    },
    firstRunComplete: true,
    syncIntervalMinutes: 60,
  };
}
