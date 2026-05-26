import { app, type Rectangle } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AIConfig } from '@shuhai/shared';

export interface AppConfig {
  vaultPath: string;
  chromeProfile: string;
  ai: AIConfig;
  firstRunComplete: boolean;
  syncIntervalMinutes: number;
  windowBounds?: Pick<Rectangle, 'x' | 'y' | 'width' | 'height'>;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  vaultPath: '',
  chromeProfile: 'Default',
  ai: {
    provider: 'none',
    batchSize: 50,
    autoClassify: false,
  },
  firstRunComplete: false,
  syncIntervalMinutes: 60,
};

function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

function normalizeConfig(input: Partial<AppConfig>): AppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    ...input,
    ai: {
      ...DEFAULT_APP_CONFIG.ai,
      ...input.ai,
    },
  };
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(getConfigPath(), 'utf-8');
    return normalizeConfig(JSON.parse(raw) as Partial<AppConfig>);
  } catch {
    return DEFAULT_APP_CONFIG;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function updateConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig();
  const next = normalizeConfig({
    ...current,
    ...partial,
    ai: partial.ai ? { ...current.ai, ...partial.ai } : current.ai,
  });
  await saveConfig(next);
  return next;
}
