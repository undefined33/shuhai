import pLimit from 'p-limit';
import {
  DOMAIN_RATE_LIMIT_MS,
  URL_CHECK_CONCURRENCY,
  type ProcessedBookmark,
  type UrlStatus,
} from '@shuhai/shared';
import type { ShuHaiDatabase } from '../db/index.js';
import { DomainScheduler } from './domain-scheduler.js';
import { type DnsLookup, resolveSafeUrl } from './ssrf-guard.js';

export interface UrlCheckProgress {
  total: number;
  completed: number;
  alive: number;
  dead: number;
  redirect: number;
  errors: number;
  currentUrl?: string;
}

export interface UrlCheckOptions {
  concurrency?: number;
  domainRateLimitMs?: number;
  timeoutMs?: number;
  olderThanDays?: number;
  onProgress?: (progress: UrlCheckProgress) => void;
  signal?: AbortSignal;
  dnsLookup?: DnsLookup;
}

interface CheckResult {
  status: UrlStatus;
  statusCode?: number;
  finalUrl?: string;
  errorMessage?: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_OLDER_THAN_DAYS = 7;
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const FALLBACK_TO_GET_STATUSES = new Set([403, 405]);

export class UrlHealthChecker {
  private readonly abortController = new AbortController();
  private readonly scheduler: DomainScheduler;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly olderThanDays: number;
  private readonly dnsLookup?: DnsLookup;

  constructor(
    private readonly db: ShuHaiDatabase,
    private readonly options: UrlCheckOptions = {},
  ) {
    this.concurrency = Math.max(1, options.concurrency ?? URL_CHECK_CONCURRENCY);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.olderThanDays = options.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
    this.scheduler = new DomainScheduler(options.domainRateLimitMs ?? DOMAIN_RATE_LIMIT_MS);
    this.dnsLookup = options.dnsLookup;

    if (options.signal?.aborted) {
      this.abort();
    } else {
      options.signal?.addEventListener('abort', () => this.abort(), { once: true });
    }
  }

  async runAll(): Promise<UrlCheckProgress> {
    const bookmarks = this.db.getBookmarksNeedingCheck(this.olderThanDays);
    const byId = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
    const queue = DomainScheduler.interleaveByDomain(
      bookmarks.map((bookmark) => ({ id: bookmark.id, url: bookmark.url })),
    );
    const progress = createProgress(queue.length);
    const limit = pLimit(this.concurrency);

    this.reportProgress(progress);

    const tasks = queue.map((item) => limit(async () => {
      if (this.abortController.signal.aborted) {
        return;
      }

      const bookmark = byId.get(item.id);
      if (!bookmark) {
        return;
      }

      progress.currentUrl = bookmark.url;
      this.reportProgress(progress);

      try {
        const status = await this.checkBookmark(bookmark);
        progress.completed++;
        incrementProgress(progress, status);
        progress.currentUrl = bookmark.url;
        this.reportProgress(progress);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

        progress.completed++;
        progress.errors++;
        progress.currentUrl = bookmark.url;
        this.reportProgress(progress);
      }
    }));

    await Promise.all(tasks);
    delete progress.currentUrl;
    this.reportProgress(progress);
    return progress;
  }

  async checkOne(bookmarkId: string): Promise<UrlStatus> {
    const bookmark = this.db.getBookmark(bookmarkId);
    if (!bookmark) {
      throw new Error(`Bookmark not found: ${bookmarkId}`);
    }

    return this.checkBookmark(bookmark);
  }

  abort(): void {
    this.abortController.abort();
  }

  private async checkBookmark(bookmark: ProcessedBookmark): Promise<UrlStatus> {
    const result = await this.checkUrl(bookmark);
    this.db.recordUrlCheck({
      bookmarkId: bookmark.id,
      checkedAt: new Date().toISOString(),
      statusCode: result.statusCode,
      finalUrl: result.finalUrl,
      errorMessage: result.errorMessage,
      durationMs: result.durationMs,
    });
    this.db.updateBookmarkStatus(bookmark.id, result.status);
    return result.status;
  }

  private async checkUrl(bookmark: ProcessedBookmark): Promise<CheckResult> {
    throwIfAborted(this.abortController.signal);

    const startedAt = Date.now();
    let isSafe = false;
    try {
      isSafe = await resolveSafeUrl(bookmark.url, this.dnsLookup);
    } catch (error) {
      return {
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    }

    if (!isSafe) {
      return {
        status: 'error',
        errorMessage: 'Blocked unsafe URL',
        durationMs: Date.now() - startedAt,
      };
    }

    const domain = new URL(bookmark.url).hostname.toLowerCase();
    const delayMs = this.scheduler.getDelay(domain);
    this.scheduler.recordRequest(domain);
    await sleep(delayMs, this.abortController.signal);

    try {
      const response = await this.fetchWithFallback(bookmark.url);
      await response.body?.cancel();
      return responseToResult(bookmark.url, response, Date.now() - startedAt);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      return {
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private async fetchWithFallback(url: string): Promise<Response> {
    const headResponse = await this.fetchWithTimeout(url, 'HEAD');
    if (!FALLBACK_TO_GET_STATUSES.has(headResponse.status)) {
      return headResponse;
    }

    await headResponse.body?.cancel();
    return this.fetchWithTimeout(url, 'GET');
  }

  private async fetchWithTimeout(url: string, method: 'GET' | 'HEAD'): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();

    if (this.abortController.signal.aborted) {
      controller.abort();
    } else {
      this.abortController.signal.addEventListener('abort', abort, { once: true });
    }
    try {
      return await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
      this.abortController.signal.removeEventListener('abort', abort);
    }
  }

  private reportProgress(progress: UrlCheckProgress): void {
    this.options.onProgress?.({ ...progress });
  }
}

function createProgress(total: number): UrlCheckProgress {
  return {
    total,
    completed: 0,
    alive: 0,
    dead: 0,
    redirect: 0,
    errors: 0,
  };
}

function incrementProgress(progress: UrlCheckProgress, status: UrlStatus): void {
  if (status === 'alive') {
    progress.alive++;
  } else if (status === 'dead') {
    progress.dead++;
  } else if (status === 'redirect') {
    progress.redirect++;
  } else {
    progress.errors++;
  }
}

function responseToResult(originalUrl: string, response: Response, durationMs: number): CheckResult {
  const finalUrl = getFinalUrl(originalUrl, response);
  const status = getStatus(originalUrl, response);

  return {
    status,
    statusCode: response.status,
    finalUrl,
    errorMessage: status === 'error' ? `HTTP ${response.status}` : undefined,
    durationMs,
  };
}

function getStatus(originalUrl: string, response: Response): UrlStatus {
  if (response.status >= 200 && response.status < 300) {
    return response.redirected || hasFinalUrl(originalUrl, response) ? 'redirect' : 'alive';
  }

  if (REDIRECT_STATUSES.has(response.status)) {
    return 'redirect';
  }

  if (response.status === 404 || response.status === 410) {
    return 'dead';
  }

  return 'error';
}

function getFinalUrl(originalUrl: string, response: Response): string | undefined {
  const location = response.headers.get('location');
  if (location) {
    return new URL(location, originalUrl).toString();
  }

  if (hasFinalUrl(originalUrl, response)) {
    return response.url;
  }

  return undefined;
}

function hasFinalUrl(originalUrl: string, response: Response): boolean {
  return response.url.length > 0 && response.url !== originalUrl;
}

function sleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    };

    signal.addEventListener('abort', abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
