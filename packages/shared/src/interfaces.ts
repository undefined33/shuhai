import type { RawBookmark, MediaAttachment } from './models.js';
import type { PlatformCapabilities } from './types.js';

/**
 * Bookmark source adapter interface.
 * Implement this to add support for a new platform.
 */
export interface BookmarkSource {
  readonly name: string;
  readonly platformId: string;
  readonly capabilities: PlatformCapabilities;

  fetch(): Promise<RawBookmark[]>;
  supportsIncremental(): boolean;
  fetchSince?(lastSync: Date): Promise<RawBookmark[]>;
  extractContent?(bookmark: RawBookmark): Promise<string>;
  extractMedia?(bookmark: RawBookmark): Promise<MediaAttachment[]>;
}

/**
 * LLM Provider interface for AI classification/summarization.
 * Implement this to add support for a new AI model.
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;

  classify(
    title: string,
    url: string,
    existingCategories: string[],
  ): Promise<{ category: string; confidence: number }>;

  summarize(content: string, maxLength?: number): Promise<string>;

  generateTags(title: string, url: string, content?: string): Promise<string[]>;

  findRelations(
    bookmark: RawBookmark,
    candidates: RawBookmark[],
  ): Promise<{ relatedTo: string[]; reason: string }>;

  batchClassify(bookmarks: RawBookmark[]): Promise<Map<string, string>>;
}
