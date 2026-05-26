import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
import { getDatabase } from './db/index.js';

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
  const database = getDatabase();
  const source = getChromeSource(config);
  const reader = new ChromeFileReader(config.chromeProfile);

  if (!reader.exists()) {
    return getActiveBookmarks(database.getAllBookmarks({ source }));
  }

  const raw = await reader.read();
  const classifier = new RuleClassifier();
  const seen = new Set<string>();
  const activeIds = new Set<string>();

  const bookmarks = raw.reduce<ProcessedBookmark[]>((items, bookmark) => {
    const normalizedUrl = normalizeUrl(bookmark.url);
    if (seen.has(normalizedUrl)) {
      return items;
    }
    seen.add(normalizedUrl);

    const existing = database.getBookmarkByNormalizedUrl(normalizedUrl);
    const classification = classifier.classify(bookmark);
    const processed = mergeBookmarkState(
      toProcessedBookmark(
        {
          ...bookmark,
          source,
        },
        normalizedUrl,
        {
          ...classification,
          aiClassified: false,
        },
      ),
      existing,
    );

    activeIds.add(processed.id);
    items.push(processed);
    return items;
  }, []);

  database.upsertBookmarks(bookmarks);
  database.markMissingBookmarksRemoved(source, activeIds);
  database.updateSyncState(source, {
    lastSyncAt: new Date().toISOString(),
    bookmarkCount: bookmarks.length,
    checksum: checksumBookmarks(raw),
  });

  return getActiveBookmarks(database.getAllBookmarks({ source }));
}

export async function classifyBookmarks(
  urls: string[],
  config: AppConfig,
): Promise<Map<string, BookmarkClassification>> {
  const requestedUrls = new Set(urls);
  let bookmarks = getDatabase()
    .getAllBookmarks({ source: getChromeSource(config) })
    .filter((bookmark) => requestedUrls.has(bookmark.url));

  if (bookmarks.length === 0 && requestedUrls.size > 0) {
    bookmarks = (await getBookmarkSnapshot(config)).filter((bookmark) => requestedUrls.has(bookmark.url));
  }

  const classifier = new AIClassifier(config.ai);
  const classifications = await classifier.batchClassify(bookmarks);
  const database = getDatabase();

  database.upsertBookmarks(
    bookmarks.map((bookmark) => {
      const classification = classifications.get(bookmark.url);
      return classification ? applyClassification(bookmark, classification) : bookmark;
    }),
  );

  return classifications;
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
      getDatabase().upsertBookmark({
        ...bookmark,
        exportedAt: new Date(),
      });
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
  const bookmarks = (await getBookmarkSnapshot(config)).filter(isActiveBookmark);

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

function mergeBookmarkState(
  bookmark: ProcessedBookmark,
  existing: ProcessedBookmark | null,
): ProcessedBookmark {
  if (!existing) {
    return bookmark;
  }

  return {
    ...bookmark,
    id: existing.id,
    category: existing.category,
    tags: existing.tags,
    aiTags: existing.aiTags,
    confidence: existing.confidence,
    status: (existing.status as string) === 'removed' ? 'unchecked' : existing.status,
    exportedAt: existing.exportedAt,
    metadata: existing.metadata,
  };
}

function getChromeSource(config: AppConfig): string {
  return `chrome:${config.chromeProfile || 'Default'}`;
}

function checksumBookmarks(bookmarks: RawBookmark[]): string {
  return createHash('sha256')
    .update(JSON.stringify(bookmarks.map((bookmark) => [bookmark.url, bookmark.title, bookmark.createdAt])))
    .digest('hex');
}

function getActiveBookmarks(bookmarks: ProcessedBookmark[]): ProcessedBookmark[] {
  return bookmarks.filter(isActiveBookmark);
}

function isActiveBookmark(bookmark: ProcessedBookmark): boolean {
  return (bookmark.status as string) !== 'removed';
}
