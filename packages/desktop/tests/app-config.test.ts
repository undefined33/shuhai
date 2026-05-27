import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  userDataDir: '',
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString('utf-8').replace(/^encrypted:/, '')),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userDataDir),
  },
  safeStorage: {
    isEncryptionAvailable: electronMock.isEncryptionAvailable,
    encryptString: electronMock.encryptString,
    decryptString: electronMock.decryptString,
  },
}));

const {
  AI_KEY_PLACEHOLDER,
  loadConfig,
  loadPublicConfig,
  saveConfig,
  updateConfig,
} = await import('../src/main/app-config.js');

describe('app config secure AI key storage', () => {
  beforeEach(async () => {
    electronMock.userDataDir = join(tmpdir(), `shuhai-config-${crypto.randomUUID()}`);
    electronMock.isEncryptionAvailable.mockReturnValue(true);
    electronMock.encryptString.mockImplementation((value: string) => {
      return Buffer.from(`encrypted:${value}`);
    });
    electronMock.decryptString.mockImplementation((value: Buffer) => {
      return value.toString('utf-8').replace(/^encrypted:/, '');
    });
    await mkdir(electronMock.userDataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(electronMock.userDataDir, { recursive: true, force: true });
  });

  it('encrypts API keys before writing config.json', async () => {
    await saveConfig(makeConfig({ apiKey: 'sk-secret' }));

    const stored = JSON.parse(await readFile(configPath(), 'utf-8')) as Record<string, unknown>;

    expect(stored).toMatchObject({
      aiKeyEncrypted: Buffer.from('encrypted:sk-secret').toString('base64'),
    });
    expect(JSON.stringify(stored)).not.toContain('sk-secret');
    expect(stored).not.toHaveProperty('ai.apiKey');
  });

  it('decrypts for main process and redacts for renderer config', async () => {
    await saveConfig(makeConfig({ apiKey: 'sk-secret' }));

    await expect(loadConfig()).resolves.toMatchObject({
      ai: { apiKey: 'sk-secret' },
    });
    await expect(loadPublicConfig()).resolves.toMatchObject({
      ai: { apiKey: AI_KEY_PLACEHOLDER },
    });
  });

  it('migrates legacy plaintext apiKey on load', async () => {
    await writeFile(configPath(), JSON.stringify(makeConfig({ apiKey: 'legacy-key' })), 'utf-8');

    await expect(loadConfig()).resolves.toMatchObject({
      ai: { apiKey: 'legacy-key' },
    });
    const migrated = await readFile(configPath(), 'utf-8');
    expect(migrated).toContain('aiKeyEncrypted');
    expect(migrated).not.toContain('legacy-key');
  });

  it('preserves an existing key when renderer sends the placeholder back', async () => {
    await saveConfig(makeConfig({ apiKey: 'sk-secret' }));

    const updated = await updateConfig({
      ai: {
        provider: 'deepseek',
        apiKey: AI_KEY_PLACEHOLDER,
        batchSize: 10,
        autoClassify: true,
      },
    });

    expect(updated.ai.apiKey).toBe('sk-secret');
    expect(updated.ai.batchSize).toBe(10);
  });
});

function configPath(): string {
  return join(electronMock.userDataDir, 'config.json');
}

function makeConfig({ apiKey }: { apiKey?: string }) {
  return {
    vaultPath: 'C:\\Vault',
    chromeProfile: 'Default',
    ai: {
      provider: 'deepseek' as const,
      apiKey,
      batchSize: 50,
      autoClassify: true,
    },
    firstRunComplete: true,
    syncIntervalMinutes: 60,
  };
}
