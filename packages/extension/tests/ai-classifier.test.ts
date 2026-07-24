import { describe, expect, it, vi } from 'vitest';

import {
  AI_FOLDER_TARGET_LIMIT,
  AI_REQUEST_BATCH_SIZE,
  AI_RESPONSE_MAX_BYTES,
  AiRequestError,
  classifyAllWithAi,
  inspectAiClassificationCandidates,
  testAiProviderConnection,
  type FetchLike,
  type FetchRequestInit,
  type FetchResponse,
} from '../src/shared/ai-classifier.js';
import {
  createAiProviderSecret,
  createDefaultAiProviders,
  providerEndpoint,
  providerPermission,
  providerTemplate,
} from '../src/shared/ai-providers.js';
import type {
  AiProviderConfig,
  AiProviderType,
  AppSettings,
  BookmarkItem,
  FolderItem,
} from '../src/shared/bookmark-types.js';
import { DEFAULT_SETTINGS } from '../src/utils/storage.js';

const encoder = new TextEncoder();

function bookmark(id: string, overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id,
    title: `Miscellaneous note ${id}`,
    url: `https://example.com/private/${id}?token=not-for-ai#fragment`,
    parentId: 'root',
    parentTitle: 'Bookmarks Bar',
    parentPath: 'Bookmarks Bar',
    index: 0,
    ...overrides,
  };
}

function folder(id: string, title: string, path = `Bookmarks Bar/${title}`): FolderItem {
  return {
    id,
    title,
    path,
    parentId: 'root',
    bookmarkCount: 0,
  };
}

function providerSettings(providerType: AiProviderType = 'deepseek'): {
  provider: AiProviderConfig;
  secret: NonNullable<ReturnType<typeof createAiProviderSecret>>;
  settings: AppSettings;
} {
  const providers = createDefaultAiProviders().map((provider) => ({
    ...provider,
    enabled: provider.provider === providerType,
    hasApiKey: provider.provider === providerType,
  }));
  const provider = providers.find((candidate) => candidate.provider === providerType)!;
  return {
    provider,
    secret: createAiProviderSecret(providerType, `${providerType}-test-key`)!,
    settings: {
      ...DEFAULT_SETTINGS,
      useAi: true,
      activeProviderId: provider.id,
      aiProviders: providers,
      customRules: [],
    },
  };
}

function streamResponse(
  payload: unknown,
  options: {
    status?: number;
    contentType?: string;
    contentLength?: string | null;
    bytes?: Uint8Array;
    chunks?: Uint8Array[];
  } = {},
): FetchResponse {
  const status = options.status ?? 200;
  const bytes =
    options.bytes ??
    encoder.encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const chunks = options.chunks ?? [bytes];
  const contentLength =
    options.contentLength === undefined ? String(bytes.byteLength) : options.contentLength;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        const lower = name.toLowerCase();
        if (lower === 'content-type') {
          return options.contentType ?? 'application/json; charset=utf-8';
        }
        return lower === 'content-length' ? contentLength : null;
      },
    },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
  };
}

function chatResponse(content: string): FetchResponse {
  return streamResponse({
    choices: [{ message: { content } }],
  });
}

interface PromptBookmark {
  bookmarkToken: string;
  title: string;
  hostname: string;
  currentLabel: string;
}

interface PromptTarget {
  targetToken: string;
  label: string;
}

function promptEnvelope(init: FetchRequestInit): {
  bookmarks: PromptBookmark[];
  targets: PromptTarget[];
} {
  const body = JSON.parse(init.body) as {
    messages: Array<{ role: string; content: string }>;
  };
  return JSON.parse(body.messages[1]!.content) as {
    bookmarks: PromptBookmark[];
    targets: PromptTarget[];
  };
}

function advisoryFetch(): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>().mockImplementation(async (_input, init) => {
    const envelope = promptEnvelope(init);
    const target = envelope.targets[0];
    return chatResponse(
      JSON.stringify({
        version: 1,
        suggestions: target
          ? envelope.bookmarks.map((candidate) => ({
              bookmarkToken: candidate.bookmarkToken,
              targetToken: target.targetToken,
            }))
          : [],
      }),
    );
  });
}

const allowPermission = vi.fn(async () => true);

describe('AI classifier privacy boundary', () => {
  it('keeps rule-only classification local when AI is disabled or unconfigured', async () => {
    const { settings } = providerSettings();
    const fetchImpl = advisoryFetch();

    await expect(
      classifyAllWithAi([bookmark('disabled')], { ...settings, useAi: false }, { fetchImpl }),
    ).resolves.toEqual([]);
    await expect(
      classifyAllWithAi([bookmark('no-secret')], settings, { fetchImpl }),
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts absent Chrome optional fields represented as enumerable undefined data properties', async () => {
    const { settings, secret } = providerSettings();
    const fetchImpl = advisoryFetch();

    await expect(
      classifyAllWithAi([bookmark('chrome-optional', { dateAdded: undefined })], settings, {
        secret,
        folders: [
          {
            ...folder('research', 'Research'),
            parentId: undefined,
          },
        ],
        fetchImpl,
        permissionChecker: allowPermission,
      }),
    ).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('sends only fallback root bookmarks and never sends deterministic local matches', async () => {
    const { settings, secret } = providerSettings();
    const fetchImpl = advisoryFetch();
    const candidates = [
      bookmark('fallback'),
      bookmark('github', {
        title: 'GitHub repository',
        url: 'https://github.com/openai/example',
      }),
      bookmark('existing-folder', {
        parentId: 'security',
        parentTitle: 'Security',
        parentPath: 'Bookmarks Bar/Security',
      }),
      bookmark('non-http', { url: 'file:///C:/private.txt' }),
    ];

    const result = await classifyAllWithAi(candidates, settings, {
      secret,
      folders: [folder('research', 'Research')],
      fetchImpl,
      permissionChecker: allowPermission,
    });

    expect(result.map((suggestion) => suggestion.bookmarkId)).toEqual(['fallback']);
    const sent = promptEnvelope(fetchImpl.mock.calls[0]![1]).bookmarks;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      title: 'Miscellaneous note fallback',
      hostname: 'example.com',
      currentLabel: '未分类',
    });
  });

  it('previews the exact rules-first candidate count without a network request', () => {
    const { settings } = providerSettings();
    const candidates = [
      bookmark('fallback'),
      bookmark('github', {
        title: 'GitHub repository',
        url: 'https://github.com/openai/example',
      }),
      bookmark('existing-folder', {
        parentId: 'security',
        parentTitle: 'Security',
        parentPath: 'Bookmarks Bar/Security',
      }),
      bookmark('non-http', { url: 'file:///C:/private.txt' }),
    ];

    expect(
      inspectAiClassificationCandidates(candidates, settings, {
        folders: [folder('research', 'Research')],
      }),
    ).toEqual({ count: 1 });
    expect(inspectAiClassificationCandidates(candidates, settings, { folders: [] })).toEqual({
      count: 0,
    });
    expect(
      inspectAiClassificationCandidates(
        candidates,
        {
          ...settings,
          aiLegacySummary: {
            ...settings.aiLegacySummary,
            builtInConflicts: ['deepseek'],
          },
        },
        { folders: [folder('research', 'Research')] },
      ),
    ).toEqual({ count: 0 });
    expect(
      inspectAiClassificationCandidates(candidates, settings, {
        folders: Array.from({ length: AI_FOLDER_TARGET_LIMIT + 1 }, (_, index) =>
          folder(`folder-${index}`, `Folder ${index}`),
        ),
      }),
    ).toEqual({ count: 0, errorCode: 'request_invalid' });

    const disabledFolder = folder('disabled-getter', 'Disabled');
    const folderGetter = vi.fn(() => 'must-not-run');
    Object.defineProperty(disabledFolder, 'path', {
      configurable: true,
      enumerable: true,
      get: folderGetter,
    });
    expect(
      inspectAiClassificationCandidates(
        candidates,
        { ...settings, useAi: false },
        { folders: [disabledFolder] },
      ),
    ).toEqual({ count: 0 });
    expect(folderGetter).not.toHaveBeenCalled();
  });

  it('uses opaque tokens and omits URL path, query, fragment, IDs and folder paths', async () => {
    const { settings, secret } = providerSettings();
    const fetchImpl = advisoryFetch();

    await classifyAllWithAi([bookmark('private-bookmark-id')], settings, {
      secret,
      folders: [folder('private-folder-id', 'Research', 'Bookmarks Bar/Research')],
      fetchImpl,
      permissionChecker: allowPermission,
    });

    const init = fetchImpl.mock.calls[0]![1];
    const body = JSON.parse(init.body) as {
      messages: Array<{ role: string; content: string }>;
    };
    const envelope = promptEnvelope(init);
    expect(envelope.bookmarks[0]).toEqual({
      bookmarkToken: expect.stringMatching(/^[a-f0-9]{32}$/u),
      title: 'Miscellaneous note private-bookmark-id',
      hostname: 'example.com',
      currentLabel: '未分类',
    });
    expect(envelope.targets[0]).toEqual({
      targetToken: expect.stringMatching(/^[a-f0-9]{32}$/u),
      label: 'Research',
    });
    expect(body.messages[0]!.content).toContain('untrusted data');
    expect(init.body).not.toContain('/private/private-bookmark-id');
    expect(init.body).not.toContain('token=not-for-ai');
    expect(init.body).not.toContain('#fragment');
    expect(init.body).not.toContain('private-folder-id');
    expect(init.body).not.toContain('Bookmarks Bar/Research');
  });

  it('returns only fixed low-confidence advisory fields', async () => {
    const { settings, secret } = providerSettings();

    await expect(
      classifyAllWithAi([bookmark('fixed')], settings, {
        secret,
        folders: [folder('research', 'Research')],
        fetchImpl: advisoryFetch(),
        permissionChecker: allowPermission,
      }),
    ).resolves.toEqual([
      {
        bookmarkId: 'fixed',
        targetFolder: 'Research',
        confidence: 0.5,
        reason: 'ai',
        ruleName: 'ai',
        tags: [],
      },
    ]);
  });

  it('uses goal-local batches of at most twenty candidates', async () => {
    const { settings, secret } = providerSettings();
    const fetchImpl = advisoryFetch();
    const progress: Array<[number, number, number, number]> = [];
    const bookmarks = Array.from({ length: AI_REQUEST_BATCH_SIZE + 1 }, (_, index) =>
      bookmark(`batch-${index}`),
    );

    const result = await classifyAllWithAi(bookmarks, settings, {
      secret,
      folders: [folder('research', 'Research')],
      fetchImpl,
      permissionChecker: allowPermission,
      onProgress(done, total, batch, totalBatches) {
        progress.push([done, total, batch, totalBatches]);
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map((call) => promptEnvelope(call[1]).bookmarks.length)).toEqual([
      AI_REQUEST_BATCH_SIZE,
      1,
    ]);
    expect(result).toHaveLength(AI_REQUEST_BATCH_SIZE + 1);
    expect(progress).toEqual([
      [AI_REQUEST_BATCH_SIZE, AI_REQUEST_BATCH_SIZE + 1, 1, 2],
      [AI_REQUEST_BATCH_SIZE + 1, AI_REQUEST_BATCH_SIZE + 1, 2, 2],
    ]);
  });

  it.each([
    ['bare array', '[]'],
    ['markdown fence', '```json\n{"version":1,"suggestions":[]}\n```'],
    ['unknown field', '{"version":1,"suggestions":[],"explanation":"unsafe"}'],
  ])('rejects a non-contract whole-document response: %s', async (_name, content) => {
    const { settings, secret } = providerSettings();
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(chatResponse(content));

    await expect(
      classifyAllWithAi([bookmark('strict')], settings, {
        secret,
        folders: [folder('research', 'Research')],
        fetchImpl,
        permissionChecker: allowPermission,
      }),
    ).rejects.toMatchObject({ code: 'response_invalid' });
  });

  it.each(['duplicate', 'wrong-target', 'extra-field'] as const)(
    'rejects invalid opaque-token output: %s',
    async (variant) => {
      const { settings, secret } = providerSettings();
      const fetchImpl = vi.fn<FetchLike>().mockImplementation(async (_input, init) => {
        const envelope = promptEnvelope(init);
        const bookmarkToken = envelope.bookmarks[0]!.bookmarkToken;
        const targetToken = envelope.targets[0]!.targetToken;
        const base = { bookmarkToken, targetToken };
        const suggestions =
          variant === 'duplicate'
            ? [base, base]
            : variant === 'wrong-target'
              ? [{ ...base, targetToken: '0'.repeat(32) }]
              : [{ ...base, confidence: 1 }];
        return chatResponse(JSON.stringify({ version: 1, suggestions }));
      });

      await expect(
        classifyAllWithAi([bookmark('tokens')], settings, {
          secret,
          folders: [folder('research', 'Research')],
          fetchImpl,
          permissionChecker: allowPermission,
        }),
      ).rejects.toMatchObject({ code: 'response_invalid' });
    },
  );

  it('rejects bookmark and folder accessors before any fetch', async () => {
    const { settings, secret } = providerSettings();
    const fetchImpl = advisoryFetch();
    const unsafeBookmark = { ...bookmark('getter') };
    Object.defineProperty(unsafeBookmark, 'title', {
      enumerable: true,
      get() {
        throw new Error('must not run');
      },
    });
    const unsafeFolder = { ...folder('getter-folder', 'Research') };
    Object.defineProperty(unsafeFolder, 'title', {
      enumerable: true,
      get() {
        throw new Error('must not run');
      },
    });

    await expect(
      classifyAllWithAi([unsafeBookmark], settings, {
        secret,
        folders: [folder('research', 'Research')],
        fetchImpl,
        permissionChecker: allowPermission,
      }),
    ).rejects.toThrow();
    await expect(
      classifyAllWithAi([bookmark('safe')], settings, {
        secret,
        folders: [unsafeFolder],
        fetchImpl,
        permissionChecker: allowPermission,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['deepseek', 'kimi', 'glm'] as const)(
    'binds %s to its fixed endpoint, permission and fetch policy',
    async (providerType) => {
      const { settings, secret } = providerSettings(providerType);
      const permissionChecker = vi.fn(async () => true);
      const fetchImpl = advisoryFetch();

      await classifyAllWithAi([bookmark(providerType)], settings, {
        secret,
        folders: [folder('research', 'Research')],
        fetchImpl,
        permissionChecker,
      });

      expect(fetchImpl.mock.calls[0]![0]).toBe(providerEndpoint(providerType));
      expect(permissionChecker).toHaveBeenCalledWith(providerPermission(providerType));
      expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      const request = JSON.parse(fetchImpl.mock.calls[0]![1].body) as {
        model: string;
        temperature: number;
        max_tokens: number;
        stream: boolean;
      };
      expect(request).toMatchObject({
        model: providerTemplate(providerType).defaultModel,
        temperature: 0,
        max_tokens: 1_024,
        stream: false,
      });
    },
  );

  it('rejects stored endpoint-like provider mutations before fetch', async () => {
    const { settings, secret } = providerSettings();
    const fetchImpl = advisoryFetch();
    const activeIndex = settings.aiProviders.findIndex(
      (provider) => provider.provider === 'deepseek',
    );
    const providers = [...settings.aiProviders] as Array<AiProviderConfig & { baseUrl?: string }>;
    providers[activeIndex] = {
      ...providers[activeIndex]!,
      baseUrl: 'https://attacker.invalid',
    };

    await expect(
      classifyAllWithAi(
        [bookmark('endpoint')],
        { ...settings, aiProviders: providers },
        {
          secret,
          folders: [folder('research', 'Research')],
          fetchImpl,
          permissionChecker: allowPermission,
        },
      ),
    ).rejects.toMatchObject({ code: 'request_invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires the exact optional permission before fetch', async () => {
    const { settings, secret } = providerSettings();
    const fetchImpl = advisoryFetch();

    await expect(
      classifyAllWithAi([bookmark('permission')], settings, {
        secret,
        folders: [folder('research', 'Research')],
        fetchImpl,
        permissionChecker: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'permission_required' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [503, 'provider_unavailable'],
    [302, 'request_invalid'],
  ] as const)('maps HTTP %i to %s without reading an error body', async (status, code) => {
    const { settings, secret } = providerSettings();
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(streamResponse('private provider body', { status }));

    await expect(
      classifyAllWithAi([bookmark(`status-${status}`)], settings, {
        secret,
        folders: [folder('research', 'Research')],
        fetchImpl,
        permissionChecker: allowPermission,
      }),
    ).rejects.toMatchObject({ code });
  });

  it('enforces response content type, declared size and fatal UTF-8 decoding', async () => {
    const { settings, secret } = providerSettings();
    const run = (response: FetchResponse) =>
      classifyAllWithAi([bookmark('response')], settings, {
        secret,
        folders: [folder('research', 'Research')],
        fetchImpl: vi.fn<FetchLike>().mockResolvedValue(response),
        permissionChecker: allowPermission,
      });

    await expect(run(streamResponse('{}', { contentType: 'text/html' }))).rejects.toMatchObject({
      code: 'content_type_invalid',
    });
    await expect(
      run(streamResponse('{}', { contentType: 'application/jsonp' })),
    ).rejects.toMatchObject({ code: 'content_type_invalid' });
    await expect(
      run(streamResponse('{}', { contentType: 'application/json-evil' })),
    ).rejects.toMatchObject({ code: 'content_type_invalid' });
    await expect(
      run(
        streamResponse('{}', {
          contentLength: String(AI_RESPONSE_MAX_BYTES + 1),
        }),
      ),
    ).rejects.toMatchObject({ code: 'response_too_large' });
    await expect(
      run(
        streamResponse('', {
          bytes: Uint8Array.from([0xc3, 0x28]),
          contentLength: '2',
        }),
      ),
    ).rejects.toMatchObject({ code: 'response_encoding_invalid' });
  });

  it('tests a provider connection with a fixed minimal body and redacted result', async () => {
    const { provider, secret } = providerSettings();
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(chatResponse('ok'));

    const result = await testAiProviderConnection(provider, secret, {
      fetchImpl,
      permissionChecker: allowPermission,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body) as {
      messages: Array<{ content: string }>;
      max_tokens: number;
    };

    expect(result).toEqual({
      success: true,
      code: 'connection_ok',
      message: '连接成功，模型可用',
    });
    expect(JSON.parse(body.messages[1]!.content)).toEqual({
      version: 1,
      task: 'connection_test',
    });
    expect(body.max_tokens).toBe(8);
    expect(JSON.stringify(result)).not.toContain(secret.apiKey);
  });

  it('returns fixed connection errors without provider body or secret leakage', async () => {
    const { provider, secret } = providerSettings();
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(streamResponse(`private body ${secret.apiKey}`, { status: 401 }));

    const result = await testAiProviderConnection(provider, secret, {
      fetchImpl,
      permissionChecker: allowPermission,
    });

    expect(result).toEqual({
      success: false,
      code: 'unauthorized',
      message: 'API Key 无效',
    });
    expect(JSON.stringify(result)).not.toContain(secret.apiKey);
    expect(JSON.stringify(result)).not.toContain('private body');
  });

  it('distinguishes external aborts from generic network failures', async () => {
    const { settings, secret } = providerSettings();
    const controller = new AbortController();
    controller.abort();
    const abortedFetch = vi.fn<FetchLike>().mockRejectedValue(new Error('private abort detail'));

    await expect(
      classifyAllWithAi([bookmark('abort')], settings, {
        secret,
        folders: [folder('research', 'Research')],
        fetchImpl: abortedFetch,
        permissionChecker: allowPermission,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'aborted' } satisfies Partial<AiRequestError>);

    const failedFetch = vi.fn<FetchLike>().mockRejectedValue(new Error('redirect or DNS detail'));
    await expect(
      classifyAllWithAi([bookmark('network')], settings, {
        secret,
        folders: [folder('research', 'Research')],
        fetchImpl: failedFetch,
        permissionChecker: allowPermission,
      }),
    ).rejects.toMatchObject({ code: 'network_failed' } satisfies Partial<AiRequestError>);
    expect(failedFetch.mock.calls[0]![1].redirect).toBe('error');
  });

  it('keeps final response validation inside the external request deadline', async () => {
    const { settings, secret } = providerSettings();
    const controller = new AbortController();
    const originalParse = JSON.parse;
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      const parsed = originalParse(text, reviver);
      if (text.includes('"suggestions"')) {
        controller.abort();
      }
      return parsed;
    });

    try {
      await expect(
        classifyAllWithAi([bookmark('validation-deadline')], settings, {
          secret,
          folders: [folder('research', 'Research')],
          fetchImpl: advisoryFetch(),
          permissionChecker: allowPermission,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: 'aborted' } satisfies Partial<AiRequestError>);
    } finally {
      parseSpy.mockRestore();
    }
  });
});
