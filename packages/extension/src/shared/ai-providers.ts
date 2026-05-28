import type {
  AiProviderConfig,
  AiProviderTemplate,
  AiProviderType,
  AppSettings,
} from './bookmark-types.js';
import { PROVIDER_TEMPLATES } from './bookmark-types.js';

const DEFAULT_PROVIDER_IDS: Record<Exclude<AiProviderType, 'openai-compatible'>, string> = {
  deepseek: 'deepseek-default',
  kimi: 'kimi-default',
  glm: 'glm-default',
};

export const DEFAULT_ACTIVE_PROVIDER_ID = DEFAULT_PROVIDER_IDS.deepseek;

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function providerTemplate(type: AiProviderType): AiProviderTemplate {
  return (
    PROVIDER_TEMPLATES.find((template) => template.provider === type) ??
    PROVIDER_TEMPLATES[PROVIDER_TEMPLATES.length - 1]
  );
}

export function createProviderFromTemplate(
  template: AiProviderTemplate,
  overrides: Partial<AiProviderConfig> = {},
): AiProviderConfig {
  const id =
    overrides.id ??
    (template.provider === 'openai-compatible'
      ? `custom-${crypto.randomUUID()}`
      : DEFAULT_PROVIDER_IDS[template.provider]);

  return {
    id,
    name: overrides.name ?? template.name,
    provider: overrides.provider ?? template.provider,
    enabled: overrides.enabled ?? true,
    apiKey: overrides.apiKey ?? '',
    baseUrl: trimTrailingSlash(overrides.baseUrl ?? template.baseUrl),
    model: overrides.model ?? template.defaultModel,
    temperature: overrides.temperature ?? 0.1,
    maxTokens: overrides.maxTokens,
  };
}

export function createDefaultAiProviders(): AiProviderConfig[] {
  return PROVIDER_TEMPLATES.filter((template) => template.provider !== 'openai-compatible').map(
    (template) => createProviderFromTemplate(template),
  );
}

export function getActiveProvider(settings: AppSettings): AiProviderConfig | undefined {
  return settings.aiProviders.find(
    (provider) => provider.id === settings.activeProviderId && provider.enabled,
  );
}

export function upsertProvider(
  providers: AiProviderConfig[],
  nextProvider: AiProviderConfig,
): AiProviderConfig[] {
  const exists = providers.some((provider) => provider.id === nextProvider.id);
  if (!exists) {
    return [...providers, nextProvider];
  }

  return providers.map((provider) => (provider.id === nextProvider.id ? nextProvider : provider));
}
