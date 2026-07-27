import { z } from 'zod';
import type {
  AiProviderConfig,
  AiProviderSecret,
  AiProviderSecretsEnvelope,
  AiProviderTemplate,
  AiProviderType,
  BookmarkTaskSettings,
} from './bookmark-types.js';
import { PROVIDER_TEMPLATES } from './bookmark-types.js';

export const DEFAULT_PROVIDER_IDS: Record<AiProviderType, string> = {
  deepseek: 'deepseek-default',
  kimi: 'kimi-default',
  glm: 'glm-default',
};

export const DEFAULT_ACTIVE_PROVIDER_ID = DEFAULT_PROVIDER_IDS.deepseek;
export const AI_PROVIDER_SECRETS_VERSION = 1 as const;
export const AI_PROVIDER_SECRETS_MAX_BYTES = 16 * 1024;
export const AI_PROVIDER_KEY_MAX_LENGTH = 4_096;
export const AI_MODEL_MAX_BYTES = 128;
export const AI_PROVIDER_TYPES = ['deepseek', 'kimi', 'glm'] as const;

const AI_MODEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const API_KEY_PATTERN = /^[\x21-\x7e]{1,4096}$/;

export const AiProviderTypeSchema = z.enum(AI_PROVIDER_TYPES);

const secretSchema = z
  .strictObject({
    provider: AiProviderTypeSchema,
    origin: z.string().max(128),
    apiKey: z.string().min(1).max(AI_PROVIDER_KEY_MAX_LENGTH).regex(API_KEY_PATTERN),
  })
  .superRefine((value, context) => {
    if (value.origin !== providerTemplate(value.provider).origin) {
      context.addIssue({ code: 'custom', message: 'Provider secret origin mismatch' });
    }
  });

export const AiProviderSecretsEnvelopeSchema: z.ZodType<AiProviderSecretsEnvelope> = z
  .strictObject({
    version: z.literal(AI_PROVIDER_SECRETS_VERSION),
    providers: z.array(secretSchema).max(AI_PROVIDER_TYPES.length),
  })
  .superRefine((value, context) => {
    const providers = new Set<AiProviderType>();
    for (const secret of value.providers) {
      if (providers.has(secret.provider)) {
        context.addIssue({ code: 'custom', message: 'Duplicate Provider secret' });
      }
      providers.add(secret.provider);
    }

    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength > AI_PROVIDER_SECRETS_MAX_BYTES
    ) {
      context.addIssue({ code: 'custom', message: 'Provider secret envelope is too large' });
    }
  });

export function isAiProviderType(value: unknown): value is AiProviderType {
  return AiProviderTypeSchema.safeParse(value).success;
}

export function providerTemplate(type: AiProviderType): AiProviderTemplate {
  const template = PROVIDER_TEMPLATES.find((candidate) => candidate.provider === type);
  if (!template) {
    throw new Error('unknown_ai_provider');
  }
  return template;
}

export function createProviderFromTemplate(
  template: AiProviderTemplate,
  overrides: Partial<AiProviderConfig> = {},
): AiProviderConfig {
  return {
    id: DEFAULT_PROVIDER_IDS[template.provider],
    name: template.name,
    provider: template.provider,
    enabled: overrides.enabled ?? true,
    model: overrides.model ?? template.defaultModel,
    hasApiKey: overrides.hasApiKey ?? false,
  };
}

export function createDefaultAiProviders(): AiProviderConfig[] {
  return PROVIDER_TEMPLATES.map((template) => createProviderFromTemplate(template));
}

export function getActiveProvider(
  settings: Pick<BookmarkTaskSettings, 'activeProviderId' | 'aiProviders'>,
): AiProviderConfig | undefined {
  return settings.aiProviders.find(
    (provider) => provider.id === settings.activeProviderId && provider.enabled,
  );
}

export function upsertProvider(
  providers: AiProviderConfig[],
  nextProvider: AiProviderConfig,
): AiProviderConfig[] {
  const normalized = createProviderFromTemplate(providerTemplate(nextProvider.provider), {
    enabled: nextProvider.enabled,
    model: nextProvider.model,
    hasApiKey: nextProvider.hasApiKey,
  });

  return AI_PROVIDER_TYPES.map((type) =>
    type === normalized.provider
      ? normalized
      : (providers.find((provider) => provider.provider === type) ??
        createProviderFromTemplate(providerTemplate(type))),
  );
}

export function isValidAiModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('..') || !AI_MODEL_PATTERN.test(value)) {
    return false;
  }
  return new TextEncoder().encode(value).byteLength <= AI_MODEL_MAX_BYTES;
}

export function providerEndpoint(provider: AiProviderType): string {
  return providerTemplate(provider).endpoint;
}

export function providerOrigin(provider: AiProviderType): string {
  return providerTemplate(provider).origin;
}

export function providerPermission(provider: AiProviderType): string {
  return providerTemplate(provider).permission;
}

export function createAiProviderSecret(
  provider: AiProviderType,
  apiKey: string,
): AiProviderSecret | undefined {
  const parsed = secretSchema.safeParse({
    provider,
    origin: providerOrigin(provider),
    apiKey,
  });
  return parsed.success ? parsed.data : undefined;
}

export function parseAiProviderSecrets(value: unknown): AiProviderSecretsEnvelope | undefined {
  const parsed = AiProviderSecretsEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function emptyAiProviderSecrets(): AiProviderSecretsEnvelope {
  return {
    version: AI_PROVIDER_SECRETS_VERSION,
    providers: [],
  };
}

export function getAiProviderSecret(
  envelope: AiProviderSecretsEnvelope,
  provider: AiProviderType,
): AiProviderSecret | undefined {
  return envelope.providers.find((candidate) => candidate.provider === provider);
}

export function upsertAiProviderSecret(
  envelope: AiProviderSecretsEnvelope,
  secret: AiProviderSecret,
): AiProviderSecretsEnvelope | undefined {
  const next = {
    version: AI_PROVIDER_SECRETS_VERSION,
    providers: [
      ...envelope.providers.filter((candidate) => candidate.provider !== secret.provider),
      secret,
    ].sort((a, b) => a.provider.localeCompare(b.provider)),
  } satisfies AiProviderSecretsEnvelope;
  return parseAiProviderSecrets(next);
}

export function removeAiProviderSecret(
  envelope: AiProviderSecretsEnvelope,
  provider: AiProviderType,
): AiProviderSecretsEnvelope {
  return {
    version: AI_PROVIDER_SECRETS_VERSION,
    providers: envelope.providers.filter((candidate) => candidate.provider !== provider),
  };
}
