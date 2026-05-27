import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getDataDir } from '@shuhai/shared';
import { ShuHaiDatabase } from './database.js';

let database: ShuHaiDatabase | null = null;

export function initializeDatabase(dbPath?: string): ShuHaiDatabase {
  database?.close();
  database = new ShuHaiDatabase(dbPath);
  return database;
}

export function getDatabase(): ShuHaiDatabase {
  database ??= new ShuHaiDatabase();
  return database;
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}

export function getDefaultDatabasePath(): string {
  return join(getDataDir(), 'data.db');
}

export async function resetDatabaseFiles(dbPath = getDefaultDatabasePath()): Promise<void> {
  closeDatabase();
  await Promise.all([
    rm(dbPath, { force: true }),
    rm(`${dbPath}-wal`, { force: true }),
    rm(`${dbPath}-shm`, { force: true }),
  ]);
}

export {
  ShuHaiDatabase,
  type BookmarkFilter,
  type BookmarkStats,
  type AiUsageRecord,
  type AiUsageOperation,
  type AiUsageSummary,
  type DeadLinkReviewItem,
  type SyncState,
  type UrlCheckRecord,
} from './database.js';
export { migrateDatabase, type SQLiteDatabase } from './migrations.js';
