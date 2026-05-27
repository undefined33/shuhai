import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { getDataDir, type ProcessedBookmark, type UrlStatus } from '@shuhai/shared';
import { migrateDatabase, type SQLiteDatabase } from './migrations.js';

export type StoredBookmarkStatus = UrlStatus | 'removed';
type SqliteValue = string | number | null;
type SqliteBindParameters = Record<string, SqliteValue>;

interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface SQLiteStatement<TRow = unknown> {
  run(parameters?: SqliteBindParameters): SqliteRunResult;
  get(parameters?: SqliteBindParameters): TRow | undefined;
  all(parameters?: SqliteBindParameters): TRow[];
}

interface BetterSqlite3Constructor {
  new (filename: string): SQLiteDatabase & {
    prepare<TRow = unknown>(sql: string): SQLiteStatement<TRow>;
    close(): void;
    open: boolean;
  };
}

interface BookmarkRow {
  id: string;
  url: string;
  normalized_url: string;
  title: string;
  source: string;
  content_type: string;
  category: string;
  tags: string | null;
  ai_tags: string | null;
  confidence: number | null;
  status: string;
  chrome_folder: string | null;
  created_at: string;
  updated_at: string;
  exported_at: string | null;
  reviewed_at: string | null;
  metadata: string | null;
}

interface UrlCheckRow {
  bookmark_id: string;
  checked_at: string;
  status_code: number | null;
  final_url: string | null;
  error_message: string | null;
  duration_ms: number | null;
}

interface SyncStateRow {
  source: string;
  last_sync_at: string;
  bookmark_count: number;
  checksum: string | null;
}

interface DeadLinkReviewRow extends BookmarkRow {
  check_checked_at: string | null;
  check_status_code: number | null;
  check_final_url: string | null;
  check_error_message: string | null;
  check_duration_ms: number | null;
}

export interface BookmarkFilter {
  status?: StoredBookmarkStatus;
  category?: string;
  source?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface UrlCheckRecord {
  bookmarkId: string;
  checkedAt: string;
  statusCode?: number;
  finalUrl?: string;
  errorMessage?: string;
  durationMs?: number;
}

export interface SyncState {
  source: string;
  lastSyncAt: string;
  bookmarkCount: number;
  checksum?: string;
}

export interface BookmarkStats {
  total: number;
  alive: number;
  dead: number;
  unchecked: number;
}

export interface DeadLinkReviewItem {
  bookmark: ProcessedBookmark;
  lastCheck: UrlCheckRecord | null;
}

const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3') as BetterSqlite3Constructor;

const UPSERT_BOOKMARK_SQL = `
  INSERT INTO bookmarks (
    id,
    url,
    normalized_url,
    title,
    source,
    content_type,
    category,
    tags,
    ai_tags,
    confidence,
    status,
    chrome_folder,
    created_at,
    updated_at,
    exported_at,
    reviewed_at,
    metadata
  ) VALUES (
    @id,
    @url,
    @normalizedUrl,
    @title,
    @source,
    @contentType,
    @category,
    @tags,
    @aiTags,
    @confidence,
    @status,
    @chromeFolder,
    @createdAt,
    @updatedAt,
    @exportedAt,
    @reviewedAt,
    @metadata
  )
  ON CONFLICT(id) DO UPDATE SET
    url = excluded.url,
    normalized_url = excluded.normalized_url,
    title = excluded.title,
    source = excluded.source,
    content_type = excluded.content_type,
    category = excluded.category,
    tags = excluded.tags,
    ai_tags = excluded.ai_tags,
    confidence = excluded.confidence,
    status = excluded.status,
    chrome_folder = excluded.chrome_folder,
    updated_at = excluded.updated_at,
    exported_at = excluded.exported_at,
    reviewed_at = COALESCE(excluded.reviewed_at, bookmarks.reviewed_at),
    metadata = excluded.metadata
`;

export class ShuHaiDatabase {
  private readonly db: BetterSqlite3Constructor extends new (
    filename: string,
  ) => infer TConnection
    ? TConnection
    : never;
  private readonly upsertBookmarkStatement: SQLiteStatement;
  private readonly upsertBookmarksTransaction: (bookmarks: ProcessedBookmark[]) => void;

  constructor(dbPath = join(getDataDir(), 'data.db')) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
      backupExistingDatabase(dbPath);
    }

    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    migrateDatabase(this.db);

    this.upsertBookmarkStatement = this.db.prepare(UPSERT_BOOKMARK_SQL);
    this.upsertBookmarksTransaction = this.db.transaction((bookmarks: ProcessedBookmark[]) => {
      for (const bookmark of bookmarks) {
        this.upsertBookmarkStatement.run(bookmarkToParameters(bookmark));
      }
    });
  }

  close(): void {
    if (!this.db.open) {
      return;
    }

    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.close();
  }

  upsertBookmark(bookmark: ProcessedBookmark): void {
    this.upsertBookmarkStatement.run(bookmarkToParameters(bookmark));
  }

  upsertBookmarks(bookmarks: ProcessedBookmark[]): void {
    this.upsertBookmarksTransaction(bookmarks);
  }

  getBookmark(id: string): ProcessedBookmark | null {
    const row = this.db
      .prepare<BookmarkRow>('SELECT * FROM bookmarks WHERE id = @id')
      .get({ id });
    return row ? rowToBookmark(row) : null;
  }

  getBookmarkByNormalizedUrl(normalizedUrl: string): ProcessedBookmark | null {
    const row = this.db
      .prepare<BookmarkRow>('SELECT * FROM bookmarks WHERE normalized_url = @normalizedUrl LIMIT 1')
      .get({ normalizedUrl });
    return row ? rowToBookmark(row) : null;
  }

  getAllBookmarks(filter: BookmarkFilter = {}): ProcessedBookmark[] {
    const where: string[] = [];
    const parameters: SqliteBindParameters = {};

    if (filter.status) {
      where.push('status = @status');
      parameters.status = filter.status;
    }

    if (filter.category) {
      where.push('category = @category');
      parameters.category = filter.category;
    }

    if (filter.source) {
      where.push('source = @source');
      parameters.source = filter.source;
    }

    if (filter.query) {
      where.push('(title LIKE @query OR url LIKE @query)');
      parameters.query = `%${filter.query}%`;
    }

    let sql = 'SELECT * FROM bookmarks';
    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }
    sql += ' ORDER BY updated_at DESC, title COLLATE NOCASE ASC';

    if (filter.limit !== undefined) {
      sql += ' LIMIT @limit';
      parameters.limit = Math.max(0, Math.trunc(filter.limit));
    }

    if (filter.offset !== undefined) {
      if (filter.limit === undefined) {
        sql += ' LIMIT -1';
      }
      sql += ' OFFSET @offset';
      parameters.offset = Math.max(0, Math.trunc(filter.offset));
    }

    return this.db.prepare<BookmarkRow>(sql).all(parameters).map(rowToBookmark);
  }

  updateBookmarkStatus(id: string, status: UrlStatus): void {
    this.db.prepare(`
      UPDATE bookmarks
      SET status = @status, updated_at = @updatedAt
      WHERE id = @id
    `).run({ id, status, updatedAt: new Date().toISOString() });
  }

  markMissingBookmarksRemoved(source: string, activeIds: Set<string>): void {
    const rows = this.db
      .prepare<{ id: string }>('SELECT id FROM bookmarks WHERE source = @source')
      .all({ source });
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      UPDATE bookmarks
      SET status = 'removed', updated_at = @updatedAt
      WHERE id = @id
    `);
    const markRemoved = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        statement.run({ id, updatedAt: now });
      }
    });

    markRemoved(rows.map((row) => row.id).filter((id) => !activeIds.has(id)));
  }

  deleteBookmark(id: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = @id').run({ id });
  }

  markBookmarksReviewed(ids: string[]): void {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      UPDATE bookmarks
      SET reviewed_at = @reviewedAt, updated_at = @updatedAt
      WHERE id = @id
    `);
    const markReviewed = this.db.transaction((bookmarkIds: string[]) => {
      for (const id of bookmarkIds) {
        statement.run({ id, reviewedAt: now, updatedAt: now });
      }
    });
    markReviewed(ids);
  }

  markBookmarksRemoved(ids: string[]): void {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      UPDATE bookmarks
      SET status = 'removed', reviewed_at = @reviewedAt, updated_at = @updatedAt
      WHERE id = @id
    `);
    const markRemoved = this.db.transaction((bookmarkIds: string[]) => {
      for (const id of bookmarkIds) {
        statement.run({ id, reviewedAt: now, updatedAt: now });
      }
    });
    markRemoved(ids);
  }

  updateBookmarkUrl(
    id: string,
    next: { id: string; url: string; normalizedUrl: string },
  ): ProcessedBookmark | null {
    const current = this.getBookmark(id);
    if (!current) {
      return null;
    }

    const now = new Date().toISOString();
    const metadata = {
      ...current.metadata,
      originalUrl: current.metadata?.originalUrl ?? current.url,
      reviewAction: 'replaced',
    };

    const updateUrl = this.db.transaction(() => {
      this.db.prepare('DELETE FROM url_checks WHERE bookmark_id = @id').run({ id });
      this.db.prepare(`
        UPDATE bookmarks
        SET id = @nextId,
            url = @url,
            normalized_url = @normalizedUrl,
            status = 'unchecked',
            reviewed_at = @reviewedAt,
            updated_at = @updatedAt,
            metadata = @metadata
        WHERE id = @id
      `).run({
        id,
        nextId: next.id,
        url: next.url,
        normalizedUrl: next.normalizedUrl,
        reviewedAt: now,
        updatedAt: now,
        metadata: JSON.stringify(metadata),
      });
    });

    updateUrl();
    return this.getBookmark(next.id);
  }

  recordUrlCheck(check: UrlCheckRecord): void {
    this.db.prepare(`
      INSERT INTO url_checks (
        bookmark_id,
        checked_at,
        status_code,
        final_url,
        error_message,
        duration_ms
      ) VALUES (
        @bookmarkId,
        @checkedAt,
        @statusCode,
        @finalUrl,
        @errorMessage,
        @durationMs
      )
    `).run({
      bookmarkId: check.bookmarkId,
      checkedAt: check.checkedAt,
      statusCode: check.statusCode ?? null,
      finalUrl: check.finalUrl ?? null,
      errorMessage: check.errorMessage ?? null,
      durationMs: check.durationMs ?? null,
    });
  }

  getLastCheck(bookmarkId: string): UrlCheckRecord | null {
    const row = this.db.prepare<UrlCheckRow>(`
      SELECT *
      FROM url_checks
      WHERE bookmark_id = @bookmarkId
      ORDER BY checked_at DESC, id DESC
      LIMIT 1
    `).get({ bookmarkId });
    return row ? rowToUrlCheck(row) : null;
  }

  getDeadLinkReviewItems(): DeadLinkReviewItem[] {
    return this.db.prepare<DeadLinkReviewRow>(`
      SELECT
        b.*,
        c.checked_at AS check_checked_at,
        c.status_code AS check_status_code,
        c.final_url AS check_final_url,
        c.error_message AS check_error_message,
        c.duration_ms AS check_duration_ms
      FROM bookmarks b
      LEFT JOIN url_checks c
        ON c.id = (
          SELECT id
          FROM url_checks
          WHERE bookmark_id = b.id
          ORDER BY checked_at DESC, id DESC
          LIMIT 1
        )
      WHERE b.status IN ('dead', 'error')
      ORDER BY b.reviewed_at IS NOT NULL, c.checked_at DESC, b.updated_at DESC
    `).all().map(rowToDeadLinkReviewItem);
  }

  getBookmarksNeedingCheck(olderThanDays: number): ProcessedBookmark[] {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    return this.db.prepare<BookmarkRow>(`
      SELECT b.*
      FROM bookmarks b
      LEFT JOIN (
        SELECT bookmark_id, MAX(checked_at) AS last_checked_at
        FROM url_checks
        GROUP BY bookmark_id
      ) last_check ON last_check.bookmark_id = b.id
      WHERE b.status != 'removed'
        AND (last_check.last_checked_at IS NULL OR last_check.last_checked_at < @cutoff)
      ORDER BY b.updated_at DESC
    `).all({ cutoff }).map(rowToBookmark);
  }

  getSyncState(source: string): SyncState | null {
    const row = this.db
      .prepare<SyncStateRow>('SELECT * FROM sync_state WHERE source = @source')
      .get({ source });
    return row ? rowToSyncState(row) : null;
  }

  updateSyncState(source: string, state: Partial<SyncState>): void {
    const current = this.getSyncState(source);
    const next: SyncState = {
      source,
      lastSyncAt: state.lastSyncAt ?? current?.lastSyncAt ?? new Date().toISOString(),
      bookmarkCount: state.bookmarkCount ?? current?.bookmarkCount ?? 0,
      checksum: state.checksum ?? current?.checksum,
    };

    this.db.prepare(`
      INSERT INTO sync_state (
        source,
        last_sync_at,
        bookmark_count,
        checksum
      ) VALUES (
        @source,
        @lastSyncAt,
        @bookmarkCount,
        @checksum
      )
      ON CONFLICT(source) DO UPDATE SET
        last_sync_at = excluded.last_sync_at,
        bookmark_count = excluded.bookmark_count,
        checksum = excluded.checksum
    `).run({
      source: next.source,
      lastSyncAt: next.lastSyncAt,
      bookmarkCount: next.bookmarkCount,
      checksum: next.checksum ?? null,
    });
  }

  getStats(): BookmarkStats {
    const row = this.db.prepare<BookmarkStats>(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'alive' THEN 1 ELSE 0 END), 0) AS alive,
        COALESCE(SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END), 0) AS dead,
        COALESCE(SUM(CASE WHEN status = 'unchecked' THEN 1 ELSE 0 END), 0) AS unchecked
      FROM bookmarks
      WHERE status != 'removed'
    `).get();

    return row ?? { total: 0, alive: 0, dead: 0, unchecked: 0 };
  }
}

function getChromeFolder(bookmark: ProcessedBookmark): string | null {
  return bookmark.categories && bookmark.categories.length > 0
    ? bookmark.categories.join('/')
    : null;
}

function bookmarkToParameters(bookmark: ProcessedBookmark): SqliteBindParameters {
  const now = new Date().toISOString();

  return {
    id: bookmark.id,
    url: bookmark.url,
    normalizedUrl: bookmark.normalizedUrl,
    title: bookmark.title,
    source: bookmark.source,
    contentType: bookmark.contentType,
    category: bookmark.category,
    tags: JSON.stringify(bookmark.tags ?? []),
    aiTags: JSON.stringify(bookmark.aiTags ?? []),
    confidence: bookmark.confidence ?? null,
    status: bookmark.status,
    chromeFolder: getChromeFolder(bookmark),
    createdAt: bookmark.createdAt.toISOString(),
    updatedAt: now,
    exportedAt: bookmark.exportedAt?.toISOString() ?? null,
    reviewedAt: bookmark.reviewedAt?.toISOString() ?? null,
    metadata: JSON.stringify(bookmark.metadata ?? {}),
  };
}

function rowToBookmark(row: BookmarkRow): ProcessedBookmark {
  return {
    id: row.id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    title: row.title,
    source: row.source,
    contentType: row.content_type as ProcessedBookmark['contentType'],
    category: row.category,
    tags: parseStringArray(row.tags),
    aiTags: parseStringArray(row.ai_tags),
    confidence: row.confidence ?? undefined,
    status: row.status as UrlStatus,
    categories: row.chrome_folder ? row.chrome_folder.split('/') : undefined,
    createdAt: new Date(row.created_at),
    exportedAt: row.exported_at ? new Date(row.exported_at) : undefined,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
    metadata: parseJsonObject(row.metadata),
  };
}

function rowToUrlCheck(row: UrlCheckRow): UrlCheckRecord {
  return {
    bookmarkId: row.bookmark_id,
    checkedAt: row.checked_at,
    statusCode: row.status_code ?? undefined,
    finalUrl: row.final_url ?? undefined,
    errorMessage: row.error_message ?? undefined,
    durationMs: row.duration_ms ?? undefined,
  };
}

function rowToDeadLinkReviewItem(row: DeadLinkReviewRow): DeadLinkReviewItem {
  const lastCheck = row.check_checked_at
    ? {
        bookmarkId: row.id,
        checkedAt: row.check_checked_at,
        statusCode: row.check_status_code ?? undefined,
        finalUrl: row.check_final_url ?? undefined,
        errorMessage: row.check_error_message ?? undefined,
        durationMs: row.check_duration_ms ?? undefined,
      }
    : null;

  return {
    bookmark: rowToBookmark(row),
    lastCheck,
  };
}

function rowToSyncState(row: SyncStateRow): SyncState {
  return {
    source: row.source,
    lastSyncAt: row.last_sync_at,
    bookmarkCount: row.bookmark_count,
    checksum: row.checksum ?? undefined,
  };
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function backupExistingDatabase(dbPath: string): void {
  if (!existsSync(dbPath)) {
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.bak.${timestamp}`;
  copyFileSync(dbPath, backupPath);

  const dbDirectory = dirname(dbPath);
  const dbFilename = basename(dbPath);
  const backups = readdirSync(dbDirectory)
    .filter((file) => file.startsWith(`${dbFilename}.bak.`))
    .map((file) => join(dbDirectory, file))
    .sort((left, right) => right.localeCompare(left));

  for (const staleBackup of backups.slice(3)) {
    unlinkSync(staleBackup);
  }
}
