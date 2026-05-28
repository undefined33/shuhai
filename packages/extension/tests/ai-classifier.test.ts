import { describe, expect, it, vi } from 'vitest';
import type { AppSettings, BookmarkItem } from '../src/shared/bookmark-types.js';
import { classifyWithDeepSeek, type FetchLike } from '../src/shared/ai-classifier.js';

const bookmark: BookmarkItem = {
  id: 'b1',
  title: 'Advanced payload writeup',
  url: 'https://example.com/payload',
  parentId: '1',
  parentTitle: 'Bookmarks Bar',
  parentPath: 'Bookmarks Bar',
  index: 0,
};

const settings: AppSettings = {
  deepSeekApiKey: 'test-key',
  deepSeekModel: 'deepseek-chat',
  useAi: true,
  customRules: [],
};

describe('ai classifier', () => {
  it('does not call fetch when AI is disabled or no API key exists', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const result = await classifyWithDeepSeek(
      [bookmark],
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

    const result = await classifyWithDeepSeek([bookmark], settings, fetchImpl);

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
});
