import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { getChromeBookmarksPath, type ExportResult, type ProcessedBookmark } from '@shuhai/shared';
import type { RawBookmark } from '@shuhai/shared';
import { ChromeFileReader } from './readers/chrome-file-reader.js';
import { RuleClassifier, type ClassificationResult } from './pipeline/classifier.js';
import { normalizeUrl, urlHash } from './pipeline/normalize-url.js';
import { AIClassifier } from './ai/ai-classifier.js';
import { MarkdownExporter } from './exporters/markdown-exporter.js';
import type { AppConfig } from './app-config.js';

export type BookmarkClassification = ClassificationResult & {
  confidence?: number;
  aiClassified: boolean;
};

export async function detectChromeProfiles(): Promise<string[]> {
  try {
    const userDataDir = dirname(dirname(getChromeBookmarksPath('Default')));
    const entries = await readdir(userDataDir, { withFileTypes: true });
    const profiles = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(userDataDir, name, 'Bookmarks')))
      .sort((a, b) => {
        if (a === 'Default') return -1;
        if (b === 'Default') return 1;
        return a.localeCompare(b);
      });

    return profiles.length > 0 ? profiles : ['Default'];
  } catch {
    return ['Default'];
  }
}

export async function readBookmarks(config: AppConfig): Promise<RawBookmark[]> {
  const reader = new ChromeFileReader(config.chromeProfile);
  if (!reader.exists()) {
    return [];
  }
  return reader.read();
}

export async function getBookmarkSnapshot(config: AppConfig): Promise<ProcessedBookmark[]> {
  const raw = await readBookmarks(config);
  const classifier = new RuleClassifier();
  const seen = new Set<string>();

  return raw.reduce<ProcessedBookmark[]>((bookmarks, bookmark) => {
    const normalizedUrl = normalizeUrl(bookmark.url);
    if (seen.has(normalizedUrl)) {
      return bookmarks;
    }
    seen.add(normalizedUrl);

    const classification = classifier.classify(bookmark);
    bookmarks.push(toProcessedBookmark(bookmark, normalizedUrl, {
      ...classification,
      aiClassified: false,
    }));
    return bookmarks;
  }, []);
}

export async function classifyBookmarks(
  urls: string[],
  config: AppConfig,
): Promise<Map<string, BookmarkClassification>> {
  const requestedUrls = new Set(urls);
  const bookmarks = (await readBookmarks(config)).filter((bookmark) => requestedUrls.has(bookmark.url));
  const classifier = new AIClassifier(config.ai);
  return classifier.batchClassify(bookmarks);
}

export async function exportProcessedBookmarks(
  bookmarks: ProcessedBookmark[],
  config: AppConfig,
): Promise<ExportResult> {
  if (!config.vaultPath) {
    return {
      exported: 0,
      skipped: bookmarks.length,
      errors: [{ url: '', error: '未配置 Obsidian Vault 路径' }],
    };
  }

  const exporter = new MarkdownExporter(config.vaultPath);
  const errors: ExportResult['errors'] = [];
  let exported = 0;

  for (const bookmark of bookmarks) {
    try {
      await exporter.exportOne(bookmark);
      exported++;
    } catch (error) {
      errors.push({
        url: bookmark.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    exported,
    skipped: bookmarks.length - exported,
    errors,
  };
}

export async function syncAllBookmarks(config: AppConfig): Promise<ExportResult> {
  const bookmarks = await getBookmarkSnapshot(config);

  if (config.ai.provider !== 'none' && config.ai.apiKey && config.ai.autoClassify) {
    const classifications = await classifyBookmarks(bookmarks.map((bookmark) => bookmark.url), config);
    return exportProcessedBookmarks(
      bookmarks.map((bookmark) => {
        const classification = classifications.get(bookmark.url);
        return classification ? applyClassification(bookmark, classification) : bookmark;
      }),
      config,
    );
  }

  return exportProcessedBookmarks(bookmarks, config);
}

export function applyClassification(
  bookmark: ProcessedBookmark,
  classification: BookmarkClassification,
): ProcessedBookmark {
  return {
    ...bookmark,
    category: classification.category,
    aiTags: classification.tags,
    confidence: classification.confidence,
  };
}

function toProcessedBookmark(
  bookmark: RawBookmark,
  normalizedUrl: string,
  classification: BookmarkClassification,
): ProcessedBookmark {
  return {
    ...bookmark,
    id: urlHash(bookmark.url),
    normalizedUrl,
    category: classification.category,
    aiTags: classification.tags,
    confidence: classification.confidence,
    status: 'unchecked',
  };
}
