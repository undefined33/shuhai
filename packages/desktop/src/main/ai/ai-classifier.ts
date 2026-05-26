import type { LLMProvider, RawBookmark, AIConfig } from '@shuhai/shared';
import { DeepSeekProvider } from './deepseek-provider.js';
import { RuleClassifier, type ClassificationResult } from '../pipeline/classifier.js';

/**
 * AI-enhanced classification stage.
 * Falls back to rule-based classification when AI is unavailable.
 */
export class AIClassifier {
  private provider: LLMProvider | null = null;
  private ruleClassifier: RuleClassifier;
  private tokenUsage = 0;

  constructor(config: AIConfig) {
    this.ruleClassifier = new RuleClassifier();

    if (config.provider !== 'none' && config.apiKey) {
      switch (config.provider) {
        case 'deepseek':
          this.provider = new DeepSeekProvider(config.apiKey, {
            model: config.model,
            baseUrl: config.baseUrl,
          });
          break;
        // Future: case 'openai', case 'ollama'
      }
    }
  }

  /** Check if AI provider is available */
  hasAI(): boolean {
    return this.provider !== null;
  }

  /**
   * Classify a single bookmark.
   * Uses AI if available, falls back to rules.
   */
  async classify(
    bookmark: RawBookmark,
    existingCategories: string[],
  ): Promise<ClassificationResult & { confidence?: number; aiClassified: boolean }> {
    // Try AI first
    if (this.provider) {
      try {
        const result = await this.provider.classify(
          bookmark.title,
          bookmark.url,
          existingCategories,
        );
        const tags = await this.provider.generateTags(bookmark.title, bookmark.url);

        return {
          category: result.category,
          tags,
          confidence: result.confidence,
          aiClassified: true,
        };
      } catch {
        // AI failed, fall back to rules
      }
    }

    // Fallback: rule-based classification
    const ruleResult = this.ruleClassifier.classify(bookmark);
    return { ...ruleResult, aiClassified: false };
  }

  /**
   * Batch classify bookmarks using AI.
   * Falls back to rule-based for each bookmark if AI fails.
   */
  async batchClassify(
    bookmarks: RawBookmark[],
  ): Promise<Map<string, ClassificationResult & { aiClassified: boolean }>> {
    const results = new Map<string, ClassificationResult & { aiClassified: boolean }>();

    if (this.provider) {
      try {
        const aiResults = await this.provider.batchClassify(bookmarks);
        for (const bookmark of bookmarks) {
          const category = aiResults.get(bookmark.url);
          if (category) {
            results.set(bookmark.url, { category, tags: [], aiClassified: true });
          } else {
            const rule = this.ruleClassifier.classify(bookmark);
            results.set(bookmark.url, { ...rule, aiClassified: false });
          }
        }
        return results;
      } catch {
        // AI batch failed, fall back entirely
      }
    }

    // Full fallback
    for (const bookmark of bookmarks) {
      const rule = this.ruleClassifier.classify(bookmark);
      results.set(bookmark.url, { ...rule, aiClassified: false });
    }
    return results;
  }

  /** Get approximate token usage this session */
  getTokenUsage(): number {
    return this.tokenUsage;
  }
}
