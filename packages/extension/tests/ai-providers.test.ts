import { describe, expect, it } from 'vitest';

import {
  AI_PROVIDER_SECRETS_MAX_BYTES,
  AI_PROVIDER_TYPES,
  DEFAULT_PROVIDER_IDS,
  AiProviderSecretsEnvelopeSchema,
  createAiProviderSecret,
  createDefaultAiProviders,
  createProviderFromTemplate,
  emptyAiProviderSecrets,
  getAiProviderSecret,
  isValidAiModel,
  parseAiProviderSecrets,
  providerEndpoint,
  providerOrigin,
  providerPermission,
  providerTemplate,
  removeAiProviderSecret,
  upsertAiProviderSecret,
  upsertProvider,
} from '../src/shared/ai-providers.js';

describe('AI provider contract', () => {
  it('exposes exactly three fixed public providers without endpoint or key fields', () => {
    const providers = createDefaultAiProviders();

    expect(providers.map((provider) => provider.provider)).toEqual(AI_PROVIDER_TYPES);
    expect(providers.map((provider) => provider.id)).toEqual([
      DEFAULT_PROVIDER_IDS.deepseek,
      DEFAULT_PROVIDER_IDS.kimi,
      DEFAULT_PROVIDER_IDS.glm,
    ]);
    for (const provider of providers) {
      expect(Object.keys(provider).sort()).toEqual([
        'enabled',
        'hasApiKey',
        'id',
        'model',
        'name',
        'provider',
      ]);
      expect(provider).not.toHaveProperty('apiKey');
      expect(provider).not.toHaveProperty('baseUrl');
    }
  });

  it('binds each provider to one official endpoint, origin and permission', () => {
    expect(providerEndpoint('deepseek')).toBe('https://api.deepseek.com/chat/completions');
    expect(providerEndpoint('kimi')).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(providerEndpoint('glm')).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    for (const provider of AI_PROVIDER_TYPES) {
      const template = providerTemplate(provider);
      expect(providerOrigin(provider)).toBe(new URL(template.endpoint).origin);
      expect(providerPermission(provider)).toBe(`${providerOrigin(provider)}/*`);
    }
  });

  it('normalizes attempted public identity and endpoint-like mutations', () => {
    const provider = createProviderFromTemplate(providerTemplate('deepseek'), {
      id: 'attacker',
      name: 'Changed',
      model: 'deepseek-v4-flash',
      hasApiKey: true,
    } as never);
    const providers = upsertProvider(createDefaultAiProviders(), {
      ...provider,
      id: 'changed',
      name: 'Changed',
    });

    expect(provider.id).toBe(DEFAULT_PROVIDER_IDS.deepseek);
    expect(provider.name).toBe(providerTemplate('deepseek').name);
    expect(providers.find((item) => item.provider === 'deepseek')).toMatchObject({
      id: DEFAULT_PROVIDER_IDS.deepseek,
      name: providerTemplate('deepseek').name,
      hasApiKey: true,
    });
  });

  it('accepts only bounded model tokens that cannot affect URL or headers', () => {
    expect(isValidAiModel('glm-5.2')).toBe(true);
    expect(isValidAiModel('kimi_k3.preview')).toBe(true);
    for (const invalid of [
      '',
      ' model',
      'model ',
      'a/b',
      'a\\b',
      'a:b',
      '..',
      'model..preview',
      'model\npreview',
      'a'.repeat(129),
    ]) {
      expect(isValidAiModel(invalid)).toBe(false);
    }
  });

  it('stores secrets in a provider/origin-bound strict envelope', () => {
    const deepseek = createAiProviderSecret('deepseek', 'sk-test');
    expect(deepseek).toEqual({
      provider: 'deepseek',
      origin: 'https://api.deepseek.com',
      apiKey: 'sk-test',
    });
    expect(createAiProviderSecret('deepseek', 'bad key')).toBeUndefined();

    const first = upsertAiProviderSecret(emptyAiProviderSecrets(), deepseek!);
    const kimi = createAiProviderSecret('kimi', 'kimi-key')!;
    const second = upsertAiProviderSecret(first!, kimi)!;
    expect(getAiProviderSecret(second, 'deepseek')?.apiKey).toBe('sk-test');
    expect(removeAiProviderSecret(second, 'deepseek').providers).toEqual([kimi]);
  });

  it('rejects duplicate, wrong-origin and unknown-field secret envelopes', () => {
    const secret = createAiProviderSecret('deepseek', 'sk-test')!;
    expect(parseAiProviderSecrets({ version: 1, providers: [secret, secret] })).toBeUndefined();
    expect(
      parseAiProviderSecrets({
        version: 1,
        providers: [{ ...secret, origin: 'https://evil.example' }],
      }),
    ).toBeUndefined();
    expect(
      parseAiProviderSecrets({
        version: 1,
        providers: [{ ...secret, extra: true }],
      }),
    ).toBeUndefined();
    const bounded = {
      version: 1,
      providers: [
        createAiProviderSecret('deepseek', `a${'b'.repeat(4_000)}`),
        createAiProviderSecret('kimi', `c${'d'.repeat(4_000)}`),
        createAiProviderSecret('glm', `e${'f'.repeat(4_000)}`),
      ],
    };
    expect(JSON.stringify(bounded).length).toBeLessThan(AI_PROVIDER_SECRETS_MAX_BYTES);
    expect(AiProviderSecretsEnvelopeSchema.safeParse(bounded).success).toBe(true);
  });
});
