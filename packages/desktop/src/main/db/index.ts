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

export {
  ShuHaiDatabase,
  type BookmarkFilter,
  type BookmarkStats,
  type SyncState,
  type UrlCheckRecord,
} from './database.js';
export { migrateDatabase, type SQLiteDatabase } from './migrations.js';
