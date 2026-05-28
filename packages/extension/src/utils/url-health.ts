import type {
  BookmarkItem,
  UrlHealthRecord,
  UrlHealthStatus,
  UrlHealthSummary,
} from '../shared/bookmark-types.js';

type HealthFetchResponse = Pick<Response, 'redirected' | 'status' | 'type' | 'url'>;
export type HealthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<HealthFetchResponse>;

export interface UrlHealthCheckOptions {
  fetchImpl?: HealthFetch;
  now?: () => Date;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const EMPTY_HEALTH_SUMMARY: UrlHealthSummary = {
  alive: 0,
  redirected: 0,
  dead: 0,
  error: 0,
  skipped: 0,
};

function makeRecord(
  bookmark: BookmarkItem,
  status: UrlHealthStatus,
  startedAt: number,
  checkedAt: string,
  details: Partial<UrlHealthRecord> = {},
): UrlHealthRecord {
  return {
    bookmarkId: bookmark.id,
    bookmarkTitle: bookmark.title || bookmark.url,
    bookmarkUrl: bookmark.url,
    parentPath: bookmark.parentPath,
    status,
    checkedAt,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...details,
  };
}

function isIpv4Private(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first = 0, second = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function skipReasonForUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `跳过非 HTTP 链接: ${url.protocol}`;
    }

    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host === '[::1]' ||
      host === '::1' ||
      isIpv4Private(host)
    ) {
      return '跳过本地或内网地址，避免主动扫描本机/内网服务';
    }

    return undefined;
  } catch {
    return 'URL 格式无效';
  }
}

function normalizeForCompare(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return rawUrl;
  }
}

function classifyStatus(response: HealthFetchResponse, originalUrl: string): UrlHealthStatus {
  const status = response.status;

  if (status === 404 || status === 410 || status === 451) {
    return 'dead';
  }

  if (status >= 500 || status === 0) {
    return 'error';
  }

  const finalUrl = response.url || originalUrl;
  const redirected =
    response.redirected || normalizeForCompare(finalUrl) !== normalizeForCompare(originalUrl);

  if (redirected) {
    return 'redirected';
  }

  if ((status >= 200 && status < 400) || status === 401 || status === 403 || status === 429) {
    return 'alive';
  }

  return status >= 400 ? 'dead' : 'alive';
}

function abortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function fetchWithTimeout(
  fetchImpl: HealthFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<HealthFetchResponse> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();

  parentSignal?.addEventListener('abort', abort, { once: true });

  try {
    return await fetchImpl(url, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      ...init,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abort);
  }
}

async function requestUrl(
  url: string,
  options: Required<Pick<UrlHealthCheckOptions, 'fetchImpl' | 'timeoutMs'>> & {
    signal?: AbortSignal;
  },
): Promise<HealthFetchResponse> {
  const head = await fetchWithTimeout(
    options.fetchImpl,
    url,
    { method: 'HEAD' },
    options.timeoutMs,
    options.signal,
  );

  if (head.status !== 405 && head.status !== 501) {
    return head;
  }

  return fetchWithTimeout(
    options.fetchImpl,
    url,
    {
      headers: {
        Range: 'bytes=0-0',
      },
      method: 'GET',
    },
    options.timeoutMs,
    options.signal,
  );
}

export function summarizeHealthRecords(records: UrlHealthRecord[]): UrlHealthSummary {
  return records.reduce<UrlHealthSummary>(
    (summary, record) => ({
      ...summary,
      [record.status]: summary[record.status] + 1,
    }),
    { ...EMPTY_HEALTH_SUMMARY },
  );
}

export async function checkBookmarkUrl(
  bookmark: BookmarkItem,
  options: UrlHealthCheckOptions = {},
): Promise<UrlHealthRecord> {
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const startedAt = Date.now();
  const skipReason = skipReasonForUrl(bookmark.url);

  if (skipReason) {
    return makeRecord(bookmark, 'skipped', startedAt, checkedAt, { error: skipReason });
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;

  try {
    const response = await requestUrl(bookmark.url, {
      fetchImpl,
      signal: options.signal,
      timeoutMs,
    });
    const status = classifyStatus(response, bookmark.url);
    const finalUrl =
      response.url && normalizeForCompare(response.url) !== normalizeForCompare(bookmark.url)
        ? response.url
        : undefined;

    return makeRecord(bookmark, status, startedAt, checkedAt, {
      finalUrl,
      httpStatus: response.status || undefined,
      error: status === 'error' ? `HTTP ${response.status || '未知状态'}` : undefined,
    });
  } catch (error) {
    if (abortError(error) && options.signal?.aborted) {
      throw error;
    }

    return makeRecord(bookmark, 'error', startedAt, checkedAt, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
