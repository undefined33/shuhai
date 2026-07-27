import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OptionsApp, { loadOptionsBootstrap } from '../src/options/OptionsApp.js';
import {
  isSafeHistoricalHealthUrl,
  openHistoricalHealthUrl,
} from '../src/options/HistoricalHealthRecords.js';
import { createOptionsClient, OPTIONS_REQUEST_TYPES } from '../src/options/options-client.js';
import { AI_PROVIDER_CONNECTION_RESULTS } from '../src/shared/extension-messages.js';
import { DEFAULT_SETTINGS } from '../src/utils/storage.js';

const optionsSource = readFileSync(
  new URL('../src/options/OptionsApp.tsx', import.meta.url),
  'utf8',
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('independent Options shell', () => {
  it('renders a bounded loading shell without executing mount-time effects during SSR', () => {
    const markup = renderToStaticMarkup(<OptionsApp />);

    expect(markup).toContain('正在读取本地设置');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('bootstraps only settings, Vault state, and the explicit X permission', async () => {
    const getBootstrapStatus = vi.fn(async () => ({ ready: true }));
    const getSettings = vi.fn(async () => DEFAULT_SETTINGS);
    const readVault = vi.fn(async () => ({ kind: 'absent' as const }));
    const containsXPermission = vi.fn(async () => false);

    await expect(
      loadOptionsBootstrap({
        getBootstrapStatus,
        getSettings,
        readVault,
        containsXPermission,
      }),
    ).resolves.toEqual({
      settings: DEFAULT_SETTINGS,
      vault: { kind: 'absent' },
      xPermission: false,
    });

    expect(getBootstrapStatus).toHaveBeenCalledOnce();
    expect(getSettings).toHaveBeenCalledOnce();
    expect(readVault).toHaveBeenCalledOnce();
    expect(containsXPermission).toHaveBeenCalledOnce();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps the production request vocabulary on the exact contract whitelist', () => {
    expect(OPTIONS_REQUEST_TYPES).toEqual([
      'security:getBootstrapStatus',
      'settings:get',
      'settings:set',
      'ai:secret:set',
      'ai:secret:clear',
      'ai:legacy:discard',
      'ai:testConnection',
      'legacyPending:inspect',
      'legacyPending:clear',
      'backups:listSummaries',
      'backups:get',
      'health:listRecords',
      'health:clearRecords',
    ]);
  });

  it('keeps maintenance reads behind disclosure handlers and never queries the active tab', () => {
    expect(optionsSource).toContain("name === 'backups'");
    expect(optionsSource).toContain("name === 'health'");
    expect(optionsSource).toContain("name === 'legacy'");
    expect(optionsSource).not.toContain('chrome.tabs.query');
    expect(optionsSource).not.toContain('state:get');
    expect(optionsSource).not.toContain('operations:getRecent');
    expect(optionsSource).not.toContain('plan:create');
    expect(optionsSource).not.toContain('xSync:');
    expect(optionsSource).not.toContain('surface:');
    expect(optionsSource).not.toContain('<Card');
  });

  it('sends only explicit allowlisted request shapes', async () => {
    const requests: unknown[] = [];
    const sendRaw = vi.fn(async (request: unknown) => {
      requests.push(request);
      const type = (request as { type?: string }).type;
      if (type === 'security:getBootstrapStatus') {
        return { ok: true, data: { ready: true } };
      }
      if (
        type === 'settings:get' ||
        type === 'settings:set' ||
        type === 'ai:secret:set' ||
        type === 'ai:secret:clear' ||
        type === 'ai:legacy:discard'
      ) {
        return { ok: true, data: DEFAULT_SETTINGS };
      }
      if (type === 'ai:testConnection') {
        return {
          ok: true,
          data: AI_PROVIDER_CONNECTION_RESULTS.connection_ok,
        };
      }
      if (type === 'legacyPending:inspect') {
        return {
          ok: true,
          data: {
            present: false,
            count: null,
            approximateBytes: 0,
            state: 'absent',
          },
        };
      }
      if (type === 'legacyPending:clear') {
        return { ok: true, data: { cleared: true } };
      }
      if (type === 'backups:listSummaries') {
        return { ok: true, data: { backups: [] } };
      }
      if (type === 'backups:get') {
        return { ok: true, data: { backup: null } };
      }
      if (type === 'health:listRecords') {
        return { ok: true, data: { records: [] } };
      }
      if (type === 'health:clearRecords') {
        return { ok: true, data: { cleared: true } };
      }
      throw new Error('unexpected request');
    });
    const client = createOptionsClient(sendRaw);

    await client.getBootstrapStatus();
    await client.getSettings();
    await client.saveSettings(DEFAULT_SETTINGS);
    await client.setProviderSecret('deepseek', 'test-key');
    await client.clearProviderSecret('deepseek');
    await client.discardLegacyAi();
    await client.testProvider('deepseek');
    await client.inspectLegacyPending();
    await client.clearLegacyPending();
    await client.listBackupSummaries();
    await client.getBackup('backup_123');
    await client.listHealthRecords();
    await client.clearHealthRecords();

    expect(requests.map((request) => (request as { type: string }).type)).toEqual(
      OPTIONS_REQUEST_TYPES,
    );
    expect(requests.at(4)).toEqual({
      type: 'ai:secret:clear',
      provider: 'deepseek',
      confirmed: true,
    });
    expect(requests.at(10)).toEqual({ type: 'backups:get', key: 'backup_123' });
    expect(requests.at(12)).toEqual({ type: 'health:clearRecords', confirmed: true });
  });
});

describe('historical health record actions', () => {
  it.each([
    ['javascript:alert(1)', false],
    ['data:text/html,unsafe', false],
    ['file:///C:/secret.txt', false],
    ['https://user:password@example.com/', false],
    ['https://example.com/\nunsafe', false],
    [' https://example.com/article', false],
    ['https:\\\\example.com\\article', false],
    ['https://example.com/article', true],
  ])('validates %s without navigation side effects', (url, expected) => {
    expect(isSafeHistoricalHealthUrl(url)).toBe(expected);
  });

  it('opens a validated URL only in a non-active tab', async () => {
    Object.defineProperty(chrome, 'tabs', {
      configurable: true,
      value: {
        create: vi.fn(
          (_options: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) =>
            callback?.({} as chrome.tabs.Tab),
        ),
      },
    });

    await expect(openHistoricalHealthUrl('https://example.com/article')).resolves.toBe(true);
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      {
        active: false,
        url: 'https://example.com/article',
      },
      expect.any(Function),
    );
  });
});
