import { AI_BATCH_SIZE } from '@shuhai/shared';
import { describe, expect, it, vi } from 'vitest';
import type {
  AiProviderConfig,
  AppSettings,
  BookmarkItem,
  FolderItem,
} from '../src/shared/bookmark-types.js';
import {
  classifyAllWithAi,
  classifyWithAi,
  testAiProviderConnection,
  type FetchLike,
} from '../src/shared/ai-classifier.js';
import { createProviderFromTemplate, providerTemplate } from '../src/shared/ai-providers.js';
import { DEFAULT_SETTINGS } from '../src/utils/storage.js';

function bookmark(id: string): BookmarkItem {
  return {
    id,
    title: 'Advanced payload writeup',
    url: `https://example.com/${id}`,
    parentId: '1',
    parentTitle: 'Bookmarks Bar',
    parentPath: 'Bookmarks Bar/APT',
    index: 0,
  };
}

const deepseekProvider = createProviderFromTemplate(providerTemplate('deepseek'), {
  apiKey: 'test-key',
});

const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  useAi: true,
  activeProviderId: deepseekProvider.id,
  aiProviders: [deepseekProvider],
  customRules: [],
  defaultClassifyMode: 'safe',
  exportDirectory: 'Bookmarks',
};

const folders: FolderItem[] = [
  {
    id: 'apt',
    title: 'APT',
    path: 'Bookmarks Bar/APT',
    bookmarkCount: 23,
  },
];

describe('ai classifier', () => {
  it('does not call fetch when AI is disabled or no API key exists', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const disabledResult = await classifyAllWithAi(
      [bookmark('b1')],
      {
        ...settings,
        useAi: false,
      },
      { fetchImpl },
    );
    const noKeyResult = await classifyWithAi(
      [bookmark('b2')],
      { ...deepseekProvider, apiKey: '' },
      fetchImpl,
    );

    expect(disabledResult).toEqual([]);
    expect(noKeyResult).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses OpenAI-compatible JSON suggestions and sanitizes target folders', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '```json\n[{"bookmarkId":"b1","targetFolder":"安全/../研究","confidence":1.2,"reason":"payload","tags":["安全"]}]\n```',
            },
          },
        ],
      }),
    });

    const result = await classifyWithAi([bookmark('b1')], deepseekProvider, fetchImpl);

    expect(result).toEqual([
      {
        bookmarkId: 'b1',
        targetFolder: '安全/研究',
        confidence: 1,
        reason: 'ai',
        ruleName: 'payload',
        tags: ['安全'],
      },
    ]);
  });

  it('adds full-reclassification instructions and folder context to the prompt', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{ message: { content: '[]' } }],
      }),
    });

    await classifyWithAi([bookmark('b1')], deepseekProvider, {
      fetchImpl,
      folders,
      mode: 'full',
    });

    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1].body ?? '{}') as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0]?.content).toContain('重新审视');
    expect(body.messages[0]?.content).toContain('APT (23)');
  });

  it('classifies all bookmarks across batches', async () => {
    const bookmarks = Array.from({ length: AI_BATCH_SIZE + 1 }, (_, index) =>
      bookmark(`b${index}`),
    );
    const progress: Array<[number, number]> = [];
    const detailedProgress: Array<[number, number, number, number]> = [];
    const fetchImpl = vi.fn<FetchLike>().mockImplementation(async (_input, init) => {
      const body = JSON.parse(init.body) as { messages: Array<{ content: string }> };
      const ids = Array.from(body.messages[0]?.content.matchAll(/"bookmarkId":"([^"]+)"/g) ?? [])
        .map((match) => match[1])
        .filter((id): id is string => Boolean(id) && id !== '...');

      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  ids.map((id) => ({
                    bookmarkId: id,
                    targetFolder: '安全/漏洞研究',
                    confidence: 0.9,
                    reason: 'batch',
                    tags: ['安全'],
                  })),
                ),
              },
            },
          ],
        }),
      };
    });

    const result = await classifyAllWithAi(bookmarks, settings, {
      fetchImpl,
      folders,
      mode: 'full',
      onProgress: (done, total, batch, totalBatches) => {
        progress.push([done, total]);
        detailedProgress.push([done, total, batch, totalBatches]);
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(AI_BATCH_SIZE + 1);
    expect(progress).toEqual([
      [AI_BATCH_SIZE, AI_BATCH_SIZE + 1],
      [AI_BATCH_SIZE + 1, AI_BATCH_SIZE + 1],
    ]);
    expect(detailedProgress).toEqual([
      [AI_BATCH_SIZE, AI_BATCH_SIZE + 1, 1, 2],
      [AI_BATCH_SIZE + 1, AI_BATCH_SIZE + 1, 2, 2],
    ]);
  });

  it('returns completed AI batches when cancellation is requested', async () => {
    const bookmarks = Array.from({ length: AI_BATCH_SIZE + 1 }, (_, index) =>
      bookmark(`cancel-${index}`),
    );
    const controller = new AbortController();
    const fetchImpl = vi.fn<FetchLike>().mockImplementation(async (_input, init) => {
      const body = JSON.parse(init.body) as { messages: Array<{ content: string }> };
      const ids = Array.from(body.messages[0]?.content.matchAll(/"bookmarkId":"([^"]+)"/g) ?? [])
        .map((match) => match[1])
        .filter((id): id is string => Boolean(id) && id !== '...');

      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  ids.map((id) => ({
                    bookmarkId: id,
                    targetFolder: '安全/漏洞研究',
                    confidence: 0.9,
                    reason: 'batch',
                    tags: ['安全'],
                  })),
                ),
              },
            },
          ],
        }),
      };
    });

    const result = await classifyAllWithAi(bookmarks, settings, {
      fetchImpl,
      folders,
      mode: 'full',
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(AI_BATCH_SIZE);
  });

  it('uses the active provider base URL and model', async () => {
    const kimiProvider: AiProviderConfig = createProviderFromTemplate(providerTemplate('kimi'), {
      apiKey: 'kimi-key',
    });
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{ message: { content: '[]' } }],
      }),
    });

    await classifyAllWithAi(
      [bookmark('kimi')],
      {
        ...settings,
        activeProviderId: kimiProvider.id,
        aiProviders: [deepseekProvider, kimiProvider],
      },
      { fetchImpl },
    );

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1].body ?? '{}')).toMatchObject({
      model: 'moonshot-v1-8k',
    });
  });

  it('tests provider connections with minimal payload and readable failures', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '',
      json: async () => ({ choices: [] }),
    });

    const result = await testAiProviderConnection(deepseekProvider, fetchImpl);
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1].body ?? '{}') as {
      messages: Array<{ content: string }>;
      max_tokens: number;
    };

    expect(result).toEqual({ success: false, message: 'API Key 无效', status: 401 });
    expect(body.messages[0]?.content).toBe('请回复"ok"');
    expect(body.max_tokens).toBe(5);
  });

  it('validates provider connection input and model URL failures', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '',
      json: async () => ({ choices: [] }),
    });

    await expect(
      testAiProviderConnection({ ...deepseekProvider, baseUrl: '' }, fetchImpl),
    ).resolves.toEqual({ success: false, message: '请先填写 API 地址' });
    await expect(testAiProviderConnection(deepseekProvider, fetchImpl)).resolves.toEqual({
      success: false,
      message: '模型不存在或 API 地址错误',
      status: 404,
    });
  });
});
