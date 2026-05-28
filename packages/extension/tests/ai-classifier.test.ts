import { AI_BATCH_SIZE } from '@shuhai/shared';
import { describe, expect, it, vi } from 'vitest';
import type {
  AppSettings,
  BookmarkItem,
  FolderItem,
} from '../src/shared/bookmark-types.js';
import {
  classifyAllWithDeepSeek,
  classifyWithDeepSeek,
  type FetchLike,
} from '../src/shared/ai-classifier.js';

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

const settings: AppSettings = {
  deepSeekApiKey: 'test-key',
  deepSeekModel: 'deepseek-chat',
  useAi: true,
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
    const result = await classifyWithDeepSeek(
      [bookmark('b1')],
      {
        ...settings,
        useAi: false,
      },
      fetchImpl,
    );

    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses DeepSeek JSON suggestions and sanitizes target folders', async () => {
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

    const result = await classifyWithDeepSeek([bookmark('b1')], settings, fetchImpl);

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

    await classifyWithDeepSeek([bookmark('b1')], settings, {
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

    const result = await classifyAllWithDeepSeek(bookmarks, settings, {
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

    const result = await classifyAllWithDeepSeek(bookmarks, settings, {
      fetchImpl,
      folders,
      mode: 'full',
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(AI_BATCH_SIZE);
  });
});
