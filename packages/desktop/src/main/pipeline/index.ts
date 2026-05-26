import type { ProcessedBookmark, AIConfig } from '@shuhai/shared';
import { ChromeFileReader } from '../readers/chrome-file-reader.js';
import { normalizeUrl, urlHash } from './normalize-url.js';
import { AIClassifier } from '../ai/ai-classifier.js';
import { MarkdownExporter } from '../exporters/markdown-exporter.js';

export interface PipelineOptions {
  vaultPath: string;
  chromeProfile?: string;
  ai?: AIConfig;
}

/**
 * Data pipeline:
 * Chrome read → normalize → classify (AI or rules) → export
 */
export class BookmarkPipeline {
  private reader: ChromeFileReader;
  private aiClassifier: AIClassifier;
  private exporter: MarkdownExporter;

  constructor(options: PipelineOptions) {
    this.reader = new ChromeFileReader(options.chromeProfile);
    this.aiClassifier = new AIClassifier(options.ai || { provider: 'none', batchSize: 50, autoClassify: false });
    this.exporter = new MarkdownExporter(options.vaultPath);
  }

  /** Run the full pipeline */
  async run(): Promise<{ exported: number; skipped: number; aiClassified: number }> {
    const raw = await this.reader.read();
    const seen = new Set<string>();
    const existingCategories: string[] = [];
    let exported = 0;
    let skipped = 0;
    let aiClassified = 0;

    for (const bookmark of raw) {
      const normalized = normalizeUrl(bookmark.url);

      // Deduplicate by normalized URL
      if (seen.has(normalized)) {
        skipped++;
        continue;
      }
      seen.add(normalized);

      // Classify (AI with rule fallback)
      const classification = await this.aiClassifier.classify(bookmark, existingCategories);
      if (classification.aiClassified) aiClassified++;

      // Track categories for AI context
      if (!existingCategories.includes(classification.category)) {
        existingCategories.push(classification.category);
      }

      const processed: ProcessedBookmark = {
        ...bookmark,
        id: urlHash(bookmark.url),
        normalizedUrl: normalized,
        category: classification.category,
        aiTags: classification.tags,
        confidence: classification.confidence,
        status: 'unchecked',
      };

      await this.exporter.exportOne(processed);
      exported++;
    }

    return { exported, skipped, aiClassified };
  }
}
