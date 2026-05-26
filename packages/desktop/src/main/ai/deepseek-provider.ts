import OpenAI from 'openai';
import type { LLMProvider, RawBookmark } from '@shuhai/shared';
import { AI_BATCH_SIZE } from '@shuhai/shared';

/**
 * DeepSeek LLM Provider.
 * Uses OpenAI-compatible API format.
 * Primary AI engine for ShuHai: cheap, fast, strong at Chinese.
 */
export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';
  readonly model: string;
  private client: OpenAI;

  constructor(apiKey: string, options?: { model?: string; baseUrl?: string }) {
    this.model = options?.model || 'deepseek-chat';
    this.client = new OpenAI({
      apiKey,
      baseURL: options?.baseUrl || 'https://api.deepseek.com/v1',
    });
  }

  async classify(
    title: string,
    url: string,
    existingCategories: string[],
  ): Promise<{ category: string; confidence: number }> {
    const categoriesHint = existingCategories.length > 0
      ? `已有分类: ${existingCategories.join(', ')}\n优先使用已有分类，必要时可创建新分类。`
      : '请根据内容创建合适的分类路径（如 "开发/前端"、"知识/科学"）。';

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `你是一个书签分类助手。根据书签标题和URL，返回最合适的分类。
${categoriesHint}
只返回JSON格式: {"category": "分类路径", "confidence": 0.0-1.0}`,
        },
        {
          role: 'user',
          content: `标题: ${title}\nURL: ${url}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 100,
    });

    return this.parseJSON(response.choices[0]?.message?.content || '', {
      category: '未分类',
      confidence: 0,
    });
  }

  async summarize(content: string, maxLength = 200): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `用中文简洁总结以下内容，不超过${maxLength}字。直接输出摘要，不要加前缀。`,
        },
        { role: 'user', content },
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    return response.choices[0]?.message?.content?.trim() || '';
  }

  async generateTags(title: string, url: string, content?: string): Promise<string[]> {
    const input = content ? `标题: ${title}\nURL: ${url}\n内容: ${content}` : `标题: ${title}\nURL: ${url}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: '为这个书签生成3-5个中文标签。只返回JSON数组格式: ["标签1", "标签2", ...]',
        },
        { role: 'user', content: input },
      ],
      temperature: 0.2,
      max_tokens: 100,
    });

    return this.parseJSON(response.choices[0]?.message?.content || '', []);
  }

  async findRelations(
    bookmark: RawBookmark,
    candidates: RawBookmark[],
  ): Promise<{ relatedTo: string[]; reason: string }> {
    if (candidates.length === 0) {
      return { relatedTo: [], reason: '' };
    }

    const candidateList = candidates
      .slice(0, 20)
      .map((c, i) => `${i + 1}. [${c.title}](${c.url})`)
      .join('\n');

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `找出与目标书签内容相关的书签。返回JSON: {"relatedTo": ["url1", "url2"], "reason": "关联原因"}`,
        },
        {
          role: 'user',
          content: `目标: [${bookmark.title}](${bookmark.url})\n\n候选:\n${candidateList}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 200,
    });

    return this.parseJSON(response.choices[0]?.message?.content || '', {
      relatedTo: [],
      reason: '',
    });
  }

  async batchClassify(bookmarks: RawBookmark[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    // Process in batches
    for (let i = 0; i < bookmarks.length; i += AI_BATCH_SIZE) {
      const batch = bookmarks.slice(i, i + AI_BATCH_SIZE);
      const list = batch.map((b, idx) => `${idx + 1}. ${b.title} | ${b.url}`).join('\n');

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `为以下书签列表分类。每个书签返回一个分类路径。
返回JSON对象，key为序号，value为分类路径。
示例: {"1": "开发/前端", "2": "视频", "3": "知识/科学"}`,
          },
          { role: 'user', content: list },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      });

      const parsed = this.parseJSON<Record<string, string>>(
        response.choices[0]?.message?.content || '',
        {},
      );

      for (const [idx, category] of Object.entries(parsed)) {
        const bookmark = batch[parseInt(idx) - 1];
        if (bookmark) {
          result.set(bookmark.url, category);
        }
      }
    }

    return result;
  }

  /**
   * Parse JSON from LLM response, with fallback.
   * Handles markdown code blocks and malformed JSON gracefully.
   */
  private parseJSON<T>(text: string, fallback: T): T {
    // Strip markdown code blocks if present
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
        } catch {
          return fallback;
        }
      }
      return fallback;
    }
  }
}

