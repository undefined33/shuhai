import type { ProcessedBookmark } from '@shuhai/shared';
import { ChromeFileReader } from '../readers/chrome-file-reader.js';
import { normalizeUrl, urlHash } from './normalize-url.js';
import { RuleClassifier } from './classifier.js';
import { MarkdownExporter } from '../exporters/markdown-exporter.js';

export interface PipelineOptions {
  vaultPath: string;
  chromeProfile?: string;
}

/**
 * Minimal data pipeline:
 * Chrome read → normalize → classify → export
 */
export class BookmarkPipeline {
  private reader: ChromeFileReader;
  private classifier: RuleClassifier;
  private exporter: MarkdownExporter;

  constructor(options: PipelineOptions) {
    this.reader = new ChromeFileReader(options.chromeProfile);
    this.classifier = new RuleClassifier();
    this.exporter = new MarkdownExporter(options.vaultPath);
  }

  /** Run the full pipeline */
  async run(): Promise<{ exported: number; skipped: number }> {
    const raw = await this.reader.read();
    const seen = new Set<string>();
    let exported = 0;
    let skipped = 0;

    for (const bookmark of raw) {
      const normalized = normalizeUrl(bookmark.url);

      // Deduplicate by normalized URL
      if (seen.has(normalized)) {
        skipped++;
        continue;
      }
      seen.add(normalized);

      const { category, tags } = this.classifier.classify(bookmark);

      const processed: ProcessedBookmark = {
        ...bookmark,
        id: urlHash(bookmark.url),
        normalizedUrl: normalized,
        category,
        aiTags: tags,
        status: 'unchecked',
      };

      await this.exporter.exportOne(processed);
      exported++;
    }

    return { exported, skipped };
  }
}
