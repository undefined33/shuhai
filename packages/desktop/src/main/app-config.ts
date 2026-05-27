import { app, safeStorage, type Rectangle } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AIConfig } from '@shuhai/shared';
import { createLogger } from './logger.js';

export interface AppConfig {
  vaultPath: string;
  chromeProfile: string;
  ai: AIConfig;
  firstRunComplete: boolean;
  syncIntervalMinutes: number;
  windowBounds?: Pick<Rectangle, 'x' | 'y' | 'width' | 'height'>;
}

type StoredAIConfig = Omit<Partial<AIConfig>, 'apiKey'> & {
  apiKey?: string;
};

type AppConfigInput = Partial<Omit<AppConfig, 'ai'>> & {
  ai?: Partial<AIConfig>;
};

interface StoredAppConfig extends Partial<Omit<AppConfig, 'ai'>> {
  ai?: StoredAIConfig;
  aiKeyEncrypted?: string;
  aiKeyPlaintextFallback?: string;
}

export const AI_KEY_PLACEHOLDER = '********';
const logger = createLogger('app-config');

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

function normalizeConfig(input: AppConfigInput): AppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    ...input,
    ai: {
      ...DEFAULT_APP_CONFIG.ai,
      ...input.ai,
    },
  };
}

function normalizeStoredConfig(input: StoredAppConfig): AppConfig {
  const safeAi = { ...(input.ai ?? {}) };
  delete safeAi.apiKey;
  return normalizeConfig({
    ...input,
    ai: safeAi,
  });
}

export async function loadConfig(): Promise<AppConfig> {
  const stored = await readStoredConfig();
  if (!stored) {
    return DEFAULT_APP_CONFIG;
  }

  const config = normalizeStoredConfig(stored);
  const aiKey = decryptStoredAiKey(stored);
  if (aiKey) {
    config.ai.apiKey = aiKey;
  }

  if (stored.ai?.apiKey) {
    await saveConfig(config);
  }

  return config;
}

export async function loadPublicConfig(): Promise<AppConfig> {
  return redactConfig(await loadConfig());
}

async function readStoredConfig(): Promise<StoredAppConfig | null> {
  try {
    const raw = await readFile(getConfigPath(), 'utf-8');
    return JSON.parse(raw) as StoredAppConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(toStoredConfig(config), null, 2), 'utf-8');
}

export async function updateConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig();
  const partialAi = normalizePartialAi(partial.ai);
  const next = normalizeConfig({
    ...current,
    ...partial,
    ai: partialAi ? { ...current.ai, ...partialAi } : current.ai,
  });
  await saveConfig(next);
  return next;
}

export async function updatePublicConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  return redactConfig(await updateConfig(partial));
}

function normalizePartialAi(ai: Partial<AIConfig> | undefined): Partial<AIConfig> | undefined {
  if (!ai) {
    return undefined;
  }

  if (ai.apiKey === AI_KEY_PLACEHOLDER) {
    const rest = { ...ai };
    delete rest.apiKey;
    return rest;
  }

  return ai;
}

function toStoredConfig(config: AppConfig): StoredAppConfig {
  const { apiKey, ...safeAi } = config.ai;
  const stored: StoredAppConfig = {
    ...config,
    ai: safeAi,
  };

  if (!apiKey || apiKey === AI_KEY_PLACEHOLDER) {
    return stored;
  }

  const encryptedKey = encryptAiKey(apiKey);
  if (encryptedKey) {
    stored.aiKeyEncrypted = encryptedKey;
    return stored;
  }

  logger.warn('safeStorage is unavailable; storing AI key with plaintext fallback.');
  stored.aiKeyPlaintextFallback = apiKey;
  return stored;
}

function redactConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    ai: {
      ...config.ai,
      apiKey: config.ai.apiKey ? AI_KEY_PLACEHOLDER : undefined,
    },
  };
}

function encryptAiKey(apiKey: string): string | null {
  if (!isSafeStorageAvailable()) {
    return null;
  }

  return safeStorage.encryptString(apiKey).toString('base64');
}

function decryptStoredAiKey(stored: StoredAppConfig): string | undefined {
  if (stored.aiKeyEncrypted) {
    if (!isSafeStorageAvailable()) {
      return undefined;
    }

    try {
      return safeStorage.decryptString(Buffer.from(stored.aiKeyEncrypted, 'base64'));
    } catch {
      return undefined;
    }
  }

  return stored.ai?.apiKey ?? stored.aiKeyPlaintextFallback;
}

function isSafeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}
