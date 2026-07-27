import { z } from 'zod';
import type {
  AiProviderConfig,
  AiProviderErrorCode,
  AiProviderTestResult,
  AiProviderType,
  AppSettings,
  BackupRecord,
  BackupSummary,
  CustomRule,
  MarkdownTemplate,
  UrlHealthRecord,
} from '../shared/bookmark-types.js';
import {
  AI_PROVIDER_TYPES,
  DEFAULT_PROVIDER_IDS,
  isValidAiModel,
  providerTemplate,
} from '../shared/ai-providers.js';

export const OPTIONS_REQUEST_TYPES = [
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
] as const;

export interface LegacyPendingSummary {
  present: boolean;
  count: number | null;
  approximateBytes: number;
  state: 'absent' | 'valid' | 'invalid' | 'oversize' | 'unavailable';
}

type RawMessageSender = (request: unknown) => Promise<unknown>;
const textEncoder = new TextEncoder();
const boundedText = (maximumBytes: number, minimumLength = 0) =>
  z
    .string()
    .min(minimumLength)
    .refine((value) => textEncoder.encode(value).byteLength <= maximumBytes);
const nonNegativeInteger = z.number().int().nonnegative().safe();
const aiProviderTypeSchema = z.enum(AI_PROVIDER_TYPES);
const aiProviderSchema: z.ZodType<AiProviderConfig> = z
  .strictObject({
    id: boundedText(128, 1),
    name: boundedText(256, 1),
    provider: aiProviderTypeSchema,
    enabled: z.boolean(),
    model: boundedText(128, 1).refine(isValidAiModel),
    hasApiKey: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      value.id !== DEFAULT_PROVIDER_IDS[value.provider] ||
      value.name !== providerTemplate(value.provider).name
    ) {
      context.addIssue({ code: 'custom', message: 'Provider identity mismatch' });
    }
  });
const providerListSchema = z
  .array(aiProviderSchema)
  .length(AI_PROVIDER_TYPES.length)
  .superRefine((providers, context) => {
    const types = new Set(providers.map((provider) => provider.provider));
    if (
      types.size !== AI_PROVIDER_TYPES.length ||
      AI_PROVIDER_TYPES.some((provider) => !types.has(provider))
    ) {
      context.addIssue({ code: 'custom', message: 'Provider set mismatch' });
    }
  });
const customRuleSchema: z.ZodType<CustomRule> = z.strictObject({
  id: boundedText(256).optional(),
  type: z.enum(['domain', 'title-keyword', 'url-pattern', 'combined']),
  pattern: boundedText(4_096),
  urlPattern: boundedText(4_096).optional(),
  titlePattern: boundedText(4_096).optional(),
  category: boundedText(1_024),
  tags: z.array(boundedText(512)).max(256),
  priority: z.number().finite().optional(),
  enabled: z.boolean().optional(),
});
const markdownTemplateSchema: z.ZodType<MarkdownTemplate> = z.strictObject({
  id: boundedText(256, 1),
  name: boundedText(512, 1),
  scope: z.enum(['bookmark', 'twitter', 'weibo', 'article']),
  frontmatter: boundedText(256 * 1_024),
  body: boundedText(2 * 1_024 * 1_024),
});
const appSettingsSchema: z.ZodType<AppSettings> = z.strictObject({
  useAi: z.boolean(),
  activeProviderId: boundedText(128, 1),
  aiProviders: providerListSchema,
  aiLegacySummary: z.strictObject({
    builtInConflicts: z.array(aiProviderTypeSchema).max(AI_PROVIDER_TYPES.length),
    customState: z.enum(['absent', 'disabled_no_key', 'conflict_has_key']),
  }),
  customRules: z.array(customRuleSchema).max(10_000),
  templates: z.array(markdownTemplateSchema).max(128),
  activeTemplateIds: z.strictObject({
    bookmark: boundedText(256).optional(),
    twitter: boundedText(256).optional(),
    weibo: boundedText(256).optional(),
    article: boundedText(256).optional(),
  }),
  defaultClassifyMode: z.enum(['safe', 'full']),
  exportDirectory: boundedText(4_096, 1),
});
const bookmarkNodeSchema: z.ZodType<BackupRecord['tree'][number]> = z.lazy(() =>
  z.strictObject({
    id: boundedText(512, 1),
    title: boundedText(8_192),
    url: boundedText(16_384).optional(),
    parentId: boundedText(512).optional(),
    index: nonNegativeInteger.optional(),
    dateAdded: z.number().finite().optional(),
    children: z.array(bookmarkNodeSchema).max(100_000).optional(),
    folderPath: boundedText(16_384),
    bookmarkCount: nonNegativeInteger,
  }),
);
const backupKeySchema = z.string().regex(/^backup_[0-9]{1,16}$/u);
const backupSummarySchema: z.ZodType<BackupSummary> = z.strictObject({
  key: backupKeySchema,
  createdAt: boundedText(64, 1),
  bookmarkCount: nonNegativeInteger,
});
const backupRecordSchema: z.ZodType<BackupRecord> = z.strictObject({
  key: backupKeySchema,
  createdAt: boundedText(64, 1),
  bookmarkCount: nonNegativeInteger,
  tree: z.array(bookmarkNodeSchema).max(100_000),
});
const healthRecordSchema: z.ZodType<UrlHealthRecord> = z.strictObject({
  bookmarkId: boundedText(512, 1),
  bookmarkTitle: boundedText(4 * 1_024),
  bookmarkUrl: boundedText(8 * 1_024, 1),
  parentPath: boundedText(8 * 1_024),
  status: z.enum(['alive', 'redirected', 'dead', 'error', 'skipped']),
  checkedAt: boundedText(64, 1),
  durationMs: nonNegativeInteger,
  httpStatus: z.number().int().min(0).max(999).optional(),
  finalUrl: boundedText(8 * 1_024).optional(),
  error: boundedText(4 * 1_024).optional(),
});
const legacyPendingSchema: z.ZodType<LegacyPendingSummary> = z.strictObject({
  present: z.boolean(),
  count: z.number().int().min(0).max(20).nullable(),
  approximateBytes: nonNegativeInteger,
  state: z.enum(['absent', 'valid', 'invalid', 'oversize', 'unavailable']),
});

const AI_RESULTS = {
  connection_ok: { success: true, message: '连接成功，模型可用' },
  permission_required: { success: false, message: '需要先允许访问当前 AI 服务' },
  permission_denied: { success: false, message: '未获得当前 AI 服务权限' },
  secret_unavailable: { success: false, message: 'API Key 不可用，请重新配置' },
  legacy_ai_config_conflict: { success: false, message: '旧 AI 配置存在冲突，请先在设置中处理' },
  request_invalid: { success: false, message: 'AI 请求配置无效' },
  unauthorized: { success: false, message: 'API Key 无效' },
  forbidden: { success: false, message: 'AI 服务拒绝了请求' },
  rate_limited: { success: false, message: 'AI 服务请求过于频繁，请稍后重试' },
  provider_unavailable: { success: false, message: 'AI 服务暂时不可用' },
  timeout: { success: false, message: 'AI 请求超时' },
  aborted: { success: false, message: 'AI 请求已取消' },
  response_too_large: { success: false, message: 'AI 响应超过安全上限' },
  content_type_invalid: { success: false, message: 'AI 响应格式不受支持' },
  response_encoding_invalid: { success: false, message: 'AI 响应编码无效' },
  response_invalid: { success: false, message: 'AI 响应未通过安全校验' },
  network_failed: { success: false, message: 'AI 网络连接失败' },
} as const satisfies Record<
  'connection_ok' | AiProviderErrorCode,
  { success: boolean; message: string }
>;
const aiResultCodeSchema = z.enum(Object.keys(AI_RESULTS) as Array<keyof typeof AI_RESULTS>);
const aiResultSchema: z.ZodType<AiProviderTestResult> = z
  .strictObject({
    success: z.boolean(),
    code: aiResultCodeSchema,
    message: boundedText(128, 1),
  })
  .superRefine((value, context) => {
    const expected = AI_RESULTS[value.code];
    if (value.success !== expected.success || value.message !== expected.message) {
      context.addIssue({ code: 'custom', message: 'AI result mismatch' });
    }
  });

const ERROR_MESSAGES = {
  invalid_request: 'Extension request rejected',
  forbidden_sender: 'Extension request rejected',
  response_invalid: 'Extension response rejected',
  storage_unavailable: 'ShuHai secure storage is unavailable',
  security_bootstrap_failed: 'ShuHai security initialization failed',
  operation_failed: 'ShuHai request failed',
} as const;
const errorCodeSchema = z.enum(Object.keys(ERROR_MESSAGES) as Array<keyof typeof ERROR_MESSAGES>);
const errorEnvelopeSchema = z
  .strictObject({
    ok: z.literal(false),
    error: boundedText(128, 1),
    errorCode: errorCodeSchema,
  })
  .superRefine((value, context) => {
    if (value.error !== ERROR_MESSAGES[value.errorCode]) {
      context.addIssue({ code: 'custom', message: 'Options error mismatch' });
    }
  });

export class OptionsClientError extends Error {
  constructor(readonly code: string) {
    super('options_request_failed');
    this.name = 'OptionsClientError';
  }
}

function createRequestId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new OptionsClientError('request_id_unavailable');
  return `options:${id}`;
}

function sendRawRuntimeMessage(request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: unknown) => {
      if (chrome.runtime.lastError?.message) {
        reject(new OptionsClientError('runtime_unavailable'));
        return;
      }
      if (response === undefined) {
        reject(new OptionsClientError('response_missing'));
        return;
      }
      resolve(response);
    });
  });
}

async function sendOptions<T>(
  sendRaw: RawMessageSender,
  request: unknown,
  dataSchema: z.ZodType<T>,
): Promise<T> {
  const raw = await sendRaw(request).catch(() => {
    throw new OptionsClientError('runtime_unavailable');
  });
  const error = errorEnvelopeSchema.safeParse(raw);
  if (error.success) throw new OptionsClientError(error.data.errorCode);
  const response = z.strictObject({ ok: z.literal(true), data: dataSchema }).safeParse(raw);
  if (!response.success) throw new OptionsClientError('response_invalid');
  return response.data.data;
}

export interface OptionsClient {
  getBootstrapStatus(): Promise<{ ready: true }>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  setProviderSecret(provider: AiProviderType, apiKey: string): Promise<AppSettings>;
  clearProviderSecret(provider: AiProviderType): Promise<AppSettings>;
  discardLegacyAi(): Promise<AppSettings>;
  testProvider(provider: AiProviderType): Promise<AiProviderTestResult>;
  inspectLegacyPending(): Promise<LegacyPendingSummary>;
  clearLegacyPending(): Promise<void>;
  listBackupSummaries(): Promise<BackupSummary[]>;
  getBackup(key: string): Promise<BackupRecord | null>;
  listHealthRecords(): Promise<UrlHealthRecord[]>;
  clearHealthRecords(): Promise<boolean>;
}

export function createOptionsClient(
  sendRaw: RawMessageSender = sendRawRuntimeMessage,
): OptionsClient {
  return {
    getBootstrapStatus: () =>
      sendOptions(
        sendRaw,
        { type: 'security:getBootstrapStatus' },
        z.strictObject({ ready: z.literal(true) }),
      ),
    getSettings: () => sendOptions(sendRaw, { type: 'settings:get' }, appSettingsSchema),
    saveSettings: (settings) =>
      sendOptions(sendRaw, { type: 'settings:set', settings }, appSettingsSchema),
    setProviderSecret: (provider, apiKey) =>
      sendOptions(sendRaw, { type: 'ai:secret:set', provider, apiKey }, appSettingsSchema),
    clearProviderSecret: (provider) =>
      sendOptions(
        sendRaw,
        { type: 'ai:secret:clear', provider, confirmed: true },
        appSettingsSchema,
      ),
    discardLegacyAi: () =>
      sendOptions(sendRaw, { type: 'ai:legacy:discard', confirmed: true }, appSettingsSchema),
    testProvider: (provider) =>
      sendOptions(sendRaw, { type: 'ai:testConnection', provider }, aiResultSchema),
    inspectLegacyPending: () =>
      sendOptions(
        sendRaw,
        { type: 'legacyPending:inspect', requestId: createRequestId() },
        legacyPendingSchema,
      ),
    clearLegacyPending: async () => {
      await sendOptions(
        sendRaw,
        {
          type: 'legacyPending:clear',
          requestId: createRequestId(),
          confirmed: true,
        },
        z.strictObject({ cleared: z.literal(true) }),
      );
    },
    listBackupSummaries: async () =>
      (
        await sendOptions(
          sendRaw,
          { type: 'backups:listSummaries' },
          z.strictObject({ backups: z.array(backupSummarySchema).max(5) }),
        )
      ).backups,
    getBackup: async (key) => {
      const parsedKey = backupKeySchema.safeParse(key);
      if (!parsedKey.success) throw new OptionsClientError('backup_key_invalid');
      return (
        await sendOptions(
          sendRaw,
          { type: 'backups:get', key: parsedKey.data },
          z.strictObject({ backup: backupRecordSchema.nullable() }),
        )
      ).backup;
    },
    listHealthRecords: async () =>
      (
        await sendOptions(
          sendRaw,
          { type: 'health:listRecords' },
          z.strictObject({ records: z.array(healthRecordSchema).max(10_000) }),
        )
      ).records,
    clearHealthRecords: async () =>
      (
        await sendOptions(
          sendRaw,
          { type: 'health:clearRecords', confirmed: true },
          z.strictObject({ cleared: z.literal(true) }),
        )
      ).cleared,
  };
}

export const optionsClient = createOptionsClient();
