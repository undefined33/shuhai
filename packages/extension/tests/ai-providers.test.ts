import { describe, expect, it } from 'vitest';
import {
  createDefaultAiProviders,
  createProviderFromTemplate,
  getActiveProvider,
  providerTemplate,
  trimTrailingSlash,
  upsertProvider,
} from '../src/shared/ai-providers.js';
import type { AppSettings } from '../src/shared/bookmark-types.js';
import { DEFAULT_SETTINGS } from '../src/utils/storage.js';

describe('AI providers', () => {
  it('creates the built-in providers from templates', () => {
    const providers = createDefaultAiProviders();

    expect(providers.map((provider) => provider.provider)).toEqual(['deepseek', 'kimi', 'glm']);
    expect(providers[0]).toMatchObject({
      id: 'deepseek-default',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
  });

  it('returns only enabled active providers', () => {
    const provider = createProviderFromTemplate(providerTemplate('glm'), {
      apiKey: 'glm-key',
    });
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      useAi: true,
      activeProviderId: provider.id,
      aiProviders: [{ ...provider, enabled: false }],
      customRules: [],
      defaultClassifyMode: 'safe',
      exportDirectory: 'Bookmarks',
    };

    expect(getActiveProvider(settings)).toBeUndefined();
    expect(
      getActiveProvider({
        ...settings,
        aiProviders: [provider],
      }),
    ).toEqual(provider);
  });

  it('upserts providers and normalizes trailing slashes', () => {
    const provider = createProviderFromTemplate(providerTemplate('kimi'), {
      apiKey: 'kimi-key',
      baseUrl: 'https://api.moonshot.cn/v1///',
    });

    expect(trimTrailingSlash(provider.baseUrl)).toBe('https://api.moonshot.cn/v1');
    expect(upsertProvider([], provider)).toEqual([provider]);
    expect(upsertProvider([provider], { ...provider, model: 'moonshot-v1-32k' })).toEqual([
      { ...provider, model: 'moonshot-v1-32k' },
    ]);
  });
});
