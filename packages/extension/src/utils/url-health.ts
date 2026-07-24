import type { BookmarkItem, UrlHealthRecord, UrlHealthSummary } from '../shared/bookmark-types.js';

export interface UrlHealthProgress {
  done: number;
  total: number;
  elapsedMs: number;
  remainingMs?: number;
  currentUrl?: string;
  summary: UrlHealthSummary;
}

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

export interface UrlHealthBatchCheckOptions extends UrlHealthCheckOptions {
  concurrency?: number;
  hostIntervalMs?: number;
  initialRecords?: UrlHealthRecord[];
  onProgress?: (progress: UrlHealthProgress, records: UrlHealthRecord[]) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  nowMs?: () => number;
  totalCount?: number;
}

export const URL_HEALTH_UNAVAILABLE = 'url_health_unavailable';

export class UrlHealthUnavailableError extends Error {
  readonly code = URL_HEALTH_UNAVAILABLE;

  constructor() {
    super(URL_HEALTH_UNAVAILABLE);
    this.name = 'UrlHealthUnavailableError';
  }
}

export const EMPTY_HEALTH_SUMMARY: UrlHealthSummary = {
  alive: 0,
  redirected: 0,
  dead: 0,
  error: 0,
  skipped: 0,
};

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
  _bookmark: BookmarkItem,
  _options: UrlHealthCheckOptions = {},
): Promise<UrlHealthRecord> {
  throw new UrlHealthUnavailableError();
}

export async function checkBookmarkUrls(
  _bookmarks: BookmarkItem[],
  _options: UrlHealthBatchCheckOptions = {},
): Promise<{ records: UrlHealthRecord[]; progress: UrlHealthProgress }> {
  throw new UrlHealthUnavailableError();
}
