export interface SQLiteDatabase {
  exec(sql: string): void;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  transaction<TArgs extends unknown[]>(fn: (...args: TArgs) => void): (...args: TArgs) => void;
}

interface Migration {
  version: number;
  description: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'initial schema',
    up: `
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        normalized_url TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'chrome',
        content_type TEXT NOT NULL DEFAULT 'article',
        category TEXT NOT NULL DEFAULT '未分类',
        tags TEXT DEFAULT '[]',
        ai_tags TEXT DEFAULT '[]',
        confidence REAL,
        status TEXT NOT NULL DEFAULT 'unchecked',
        chrome_folder TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        exported_at TEXT,
        metadata TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS url_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bookmark_id TEXT NOT NULL REFERENCES bookmarks(id),
        checked_at TEXT NOT NULL,
        status_code INTEGER,
        final_url TEXT,
        error_message TEXT,
        duration_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        source TEXT PRIMARY KEY,
        last_sync_at TEXT NOT NULL,
        bookmark_count INTEGER NOT NULL DEFAULT 0,
        checksum TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_source ON bookmarks(source);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_normalized_url ON bookmarks(normalized_url);
      CREATE INDEX IF NOT EXISTS idx_url_checks_bookmark ON url_checks(bookmark_id);
    `,
  },
  {
    version: 2,
    description: 'dead link review metadata',
    up: `
      ALTER TABLE bookmarks ADD COLUMN reviewed_at TEXT;
    `,
  },
];

export function migrateDatabase(db: SQLiteDatabase): void {
  const currentVersion = Number(db.pragma('user_version', { simple: true }) ?? 0);
  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion);
  if (pending.length === 0) {
    return;
  }

  const applyMigrations = db.transaction((migrations: Migration[]) => {
    for (const migration of migrations) {
      db.exec(migration.up);
      db.pragma(`user_version = ${migration.version}`);
    }
  });

  applyMigrations(pending);
}
