import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawBookmark } from '@shuhai/shared';

const createCompletionMock = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: createCompletionMock,
      },
    },
  })),
}));

const { DeepSeekProvider } = await import('../src/main/ai/deepseek-provider.js');

describe('DeepSeekProvider usage tracking', () => {
  beforeEach(() => {
    createCompletionMock.mockReset();
  });

  it('captures token usage from batch classification responses', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '{"1":"开发/代码"}' } }],
      usage: {
        prompt_tokens: 123,
        completion_tokens: 45,
      },
    });
    const provider = new DeepSeekProvider('test-key', { model: 'deepseek-chat' });

    await expect(provider.batchClassify([bookmark()])).resolves.toEqual(
      new Map([['https://example.com', '开发/代码']]),
    );

    expect(provider.drainUsageRecords()).toMatchObject([{
      operation: 'classify',
      promptTokens: 123,
      completionTokens: 45,
      model: 'deepseek-chat',
    }]);
    expect(provider.drainUsageRecords()).toEqual([]);
  });
});

function bookmark(): RawBookmark {
  return {
    url: 'https://example.com',
    title: 'Example',
    source: 'chrome',
    contentType: 'article',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };
}
