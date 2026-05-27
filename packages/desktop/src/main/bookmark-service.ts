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
import { UrlHealthChecker, type UrlCheckOptions, type UrlCheckProgress } from './health/index.js';
import type { AiUsageSummary, DeadLinkReviewItem, ShuHaiDatabase } from './db/index.js';
import { assertAllowedExternalUrl } from './external-url.js';
import { createLogger } from './logger.js';

export type BookmarkClassification = ClassificationResult & {
  confidence?: number;
  aiClassified: boolean;
};

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export interface ChromeBookmarkReader {
  exists(): boolean;
  getPath(): string;
  read(): Promise<RawBookmark[]>;
}

interface SyncChromeBookmarksOptions {
  profile: string;
  database?: ShuHaiDatabase;
  reader?: ChromeBookmarkReader;
}

let activeUrlHealthChecker: UrlHealthChecker | null = null;
let syncMutex: Promise<void> = Promise.resolve();
const logger = createLogger('bookmark-service');

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

    return profiles;
  } catch {
    return [];
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
  const source = getChromeSource(config);
  const database = getDatabase();
  await syncChromeBookmarks({ profile: config.chromeProfile, database });
  return getActiveBookmarks(database.getAllBookmarks({ source }));
}

export async function syncChromeBookmarks({
  profile,
  database = getDatabase(),
  reader = new ChromeFileReader(profile),
}: SyncChromeBookmarksOptions): Promise<SyncResult> {
  return withSyncMutex(() => performChromeBookmarkSync({ profile, database, reader }));
}

async function performChromeBookmarkSync({
  profile,
  database = getDatabase(),
  reader = new ChromeFileReader(profile),
}: SyncChromeBookmarksOptions): Promise<SyncResult> {
  const source = getChromeSource({ chromeProfile: profile });

  if (!reader.exists()) {
    return { added: 0, updated: 0, removed: 0, total: getActiveBookmarks(database.getAllBookmarks({ source })).length };
  }

  const raw = await reader.read();
  const checksum = checksumBookmarks(raw);
  const previousSync = database.getSyncState(source);
  const existingBookmarks = database.getAllBookmarks({ source });

  if (previousSync?.checksum === checksum) {
    return { added: 0, updated: 0, removed: 0, total: getActiveBookmarks(existingBookmarks).length };
  }

  const existingByNormalizedUrl = new Map(
    existingBookmarks.map((bookmark) => [bookmark.normalizedUrl, bookmark]),
  );
  const classifier = new RuleClassifier();
  const seen = new Set<string>();
  const activeIds = new Set<string>();
  let added = 0;
  let updated = 0;

  const bookmarks = raw.reduce<ProcessedBookmark[]>((items, bookmark) => {
    const normalizedUrl = normalizeUrl(bookmark.url);
    if (seen.has(normalizedUrl)) {
      return items;
    }
    seen.add(normalizedUrl);

    const existing = existingByNormalizedUrl.get(normalizedUrl) ?? null;
    if (!existing) {
      added++;
    } else if (hasBookmarkChanged(bookmark, existing)) {
      updated++;
    }

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

  const removed = existingBookmarks.filter((bookmark) => {
    return !activeIds.has(bookmark.id) && (bookmark.status as string) !== 'removed';
  }).length;

  database.upsertBookmarks(bookmarks);
  database.markMissingBookmarksRemoved(source, activeIds);
  database.updateSyncState(source, {
    lastSyncAt: new Date().toISOString(),
    bookmarkCount: bookmarks.length,
    checksum,
  });

  return {
    added,
    updated,
    removed,
    total: bookmarks.length,
  };
}

async function withSyncMutex<T>(operation: () => Promise<T>): Promise<T> {
  const previous = syncMutex;
  let releaseCurrent: () => void = () => {};
  syncMutex = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  await previous;

  try {
    return await operation();
  } finally {
    releaseCurrent();
  }
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

  const database = getDatabase();
  const classifier = new AIClassifier(config.ai, {
    onUsage: (usage) => database.recordAiUsage(usage),
  });
  const classifications = await classifier.batchClassify(bookmarks);
  logger.info('AI classification completed', {
    requested: urls.length,
    classified: classifications.size,
    tokenUsage: classifier.getTokenUsage(),
  });
  warnIfAiBudgetExceeded(database.getAiUsageSummary(), config);

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
  logger.info('Bookmark export started', { count: bookmarks.length });
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

  const result = {
    exported,
    skipped: bookmarks.length - exported,
    errors,
  };
  logger.info('Bookmark export completed', {
    exported: result.exported,
    skipped: result.skipped,
    errors: result.errors.length,
  });
  return result;
}

export function getDeadLinkReviewItems(): DeadLinkReviewItem[] {
  return getDatabase().getDeadLinkReviewItems();
}

export function getAiUsageSummary(config: AppConfig): AiUsageSummary & { monthlyBudget?: number } {
  return {
    ...getDatabase().getAiUsageSummary(),
    monthlyBudget: config.ai.monthlyBudget,
  };
}

export function markBookmarksReviewed(ids: string[]): void {
  getDatabase().markBookmarksReviewed(ids);
}

export function removeBookmarksFromShuHai(ids: string[]): void {
  getDatabase().markBookmarksRemoved(ids);
}

export async function updateBookmarkUrl(
  id: string,
  nextUrl: string,
): Promise<ProcessedBookmark | null> {
  assertAllowedExternalUrl(nextUrl);
  const database = getDatabase();
  const updated = database.updateBookmarkUrl(id, {
    id: urlHash(nextUrl),
    url: nextUrl,
    normalizedUrl: normalizeUrl(nextUrl),
  });

  if (!updated) {
    return null;
  }

  const checker = new UrlHealthChecker(database, { olderThanDays: 0 });
  await checker.checkOne(updated.id);
  return database.getBookmark(updated.id);
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

export async function runUrlHealthCheck(
  options: UrlCheckOptions = {},
): Promise<UrlCheckProgress> {
  if (activeUrlHealthChecker) {
    throw new Error('URL health check is already running');
  }

  const checker = new UrlHealthChecker(getDatabase(), options);
  activeUrlHealthChecker = checker;
  try {
    logger.info('URL health check started');
    const progress = await checker.runAll();
    logger.info('URL health check completed', { progress });
    return progress;
  } finally {
    if (activeUrlHealthChecker === checker) {
      activeUrlHealthChecker = null;
    }
  }
}

export function abortUrlHealthCheck(): void {
  activeUrlHealthChecker?.abort();
  activeUrlHealthChecker = null;
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
    reviewedAt: existing.reviewedAt,
    metadata: existing.metadata,
  };
}

function getChromeSource(config: Pick<AppConfig, 'chromeProfile'>): string {
  return `chrome:${config.chromeProfile || 'Default'}`;
}

export function checksumBookmarks(bookmarks: RawBookmark[]): string {
  return createHash('sha256')
    .update(JSON.stringify(bookmarks.map((bookmark) => [bookmark.url, bookmark.title, bookmark.createdAt])))
    .digest('hex');
}

function hasBookmarkChanged(bookmark: RawBookmark, existing: ProcessedBookmark): boolean {
  return bookmark.title !== existing.title || (existing.status as string) === 'removed';
}

function getActiveBookmarks(bookmarks: ProcessedBookmark[]): ProcessedBookmark[] {
  return bookmarks.filter(isActiveBookmark);
}

function isActiveBookmark(bookmark: ProcessedBookmark): boolean {
  return (bookmark.status as string) !== 'removed';
}

function warnIfAiBudgetExceeded(summary: AiUsageSummary, config: AppConfig): void {
  const budget = config.ai.monthlyBudget;
  if (!budget || summary.totalTokens <= budget) {
    return;
  }

  logger.warn('AI monthly token usage exceeded configured budget', {
    totalTokens: summary.totalTokens,
    monthlyBudget: budget,
  });
}
