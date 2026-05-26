---
version: 1
assignee: codex
status: ready
issue: "#3"
---

# SQLite 持久化层

## 目标

为 ShuHai 添加 SQLite 数据库，持久化书签状态、URL 检测历史和同步记录，使应用重启后不丢失数据。

## Prior Context

- 已完成: Chrome 书签读取 (`packages/desktop/src/main/readers/chrome-file-reader.ts`)
- 已完成: 规则分类 (`packages/desktop/src/main/pipeline/classifier.ts`)
- 已完成: AI 分类 (`packages/desktop/src/main/ai/`)
- 已完成: Markdown 导出 (`packages/desktop/src/main/exporters/markdown-exporter.ts`)
- 已完成: Electron GUI (`packages/desktop/src/main/index.ts` + renderer)
- 当前状态: 每次启动都从 Chrome 文件重新读取，无持久化

## 技术方案

使用 `better-sqlite3`（同步 API，Electron 友好）+ WAL 模式。

数据库文件位置: `~/.shuhai/data.db`（通过 `getDataDir()` from `@shuhai/shared` 获取）

### 核心表结构

```sql
-- 书签主表（去重后的权威数据）
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,              -- urlHash(url) 6位
  url TEXT NOT NULL UNIQUE,
  normalized_url TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'chrome',
  content_type TEXT NOT NULL DEFAULT 'article',
  category TEXT NOT NULL DEFAULT '未分类',
  tags TEXT DEFAULT '[]',           -- JSON array
  ai_tags TEXT DEFAULT '[]',        -- JSON array
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'unchecked',  -- alive|dead|redirect|unchecked|error
  chrome_folder TEXT,               -- Chrome 原始文件夹路径
  created_at TEXT NOT NULL,         -- ISO 8601
  updated_at TEXT NOT NULL,
  exported_at TEXT,                 -- 上次导出时间
  metadata TEXT DEFAULT '{}'        -- JSON object, 扩展字段
);

-- URL 检测历史
CREATE TABLE url_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bookmark_id TEXT NOT NULL REFERENCES bookmarks(id),
  checked_at TEXT NOT NULL,
  status_code INTEGER,
  final_url TEXT,                   -- 重定向后的最终 URL
  error_message TEXT,
  duration_ms INTEGER
);

-- 同步状态
CREATE TABLE sync_state (
  source TEXT PRIMARY KEY,          -- 'chrome:Default', 'chrome:Profile 1', etc.
  last_sync_at TEXT NOT NULL,
  bookmark_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT                     -- 文件内容 hash，判断是否有变化
);

-- 索引
CREATE INDEX idx_bookmarks_status ON bookmarks(status);
CREATE INDEX idx_bookmarks_category ON bookmarks(category);
CREATE INDEX idx_bookmarks_source ON bookmarks(source);
CREATE INDEX idx_url_checks_bookmark ON url_checks(bookmark_id);
```

### Database 类设计

```typescript
// packages/desktop/src/main/db/database.ts

import Database from 'better-sqlite3';

export class ShuHaiDatabase {
  private db: Database.Database;

  constructor(dbPath?: string);  // 默认 ~/.shuhai/data.db
  close(): void;

  // 书签 CRUD
  upsertBookmark(bookmark: ProcessedBookmark): void;
  upsertBookmarks(bookmarks: ProcessedBookmark[]): void;  // 事务批量
  getBookmark(id: string): ProcessedBookmark | null;
  getAllBookmarks(filter?: BookmarkFilter): ProcessedBookmark[];
  updateBookmarkStatus(id: string, status: UrlStatus): void;
  deleteBookmark(id: string): void;

  // URL 检测
  recordUrlCheck(check: UrlCheckRecord): void;
  getLastCheck(bookmarkId: string): UrlCheckRecord | null;
  getBookmarksNeedingCheck(olderThanDays: number): ProcessedBookmark[];

  // 同步状态
  getSyncState(source: string): SyncState | null;
  updateSyncState(source: string, state: Partial<SyncState>): void;

  // 统计
  getStats(): { total: number; alive: number; dead: number; unchecked: number };
}

interface BookmarkFilter {
  status?: UrlStatus;
  category?: string;
  source?: string;
  query?: string;  // 搜索标题/URL
  limit?: number;
  offset?: number;
}

interface UrlCheckRecord {
  bookmarkId: string;
  checkedAt: string;
  statusCode?: number;
  finalUrl?: string;
  errorMessage?: string;
  durationMs?: number;
}

interface SyncState {
  source: string;
  lastSyncAt: string;
  bookmarkCount: number;
  checksum?: string;
}
```

### Schema 迁移机制

```typescript
// packages/desktop/src/main/db/migrations.ts

interface Migration {
  version: number;
  description: string;
  up: string;  // SQL
}

const MIGRATIONS: Migration[] = [
  { version: 1, description: 'initial schema', up: '...' },
  // 后续版本在此追加
];

// 启动时自动执行未应用的 migration
export function migrateDatabase(db: Database.Database): void;
```

### 集成到现有架构

修改 `bookmark-service.ts`，在读取 Chrome 书签后写入数据库：

```typescript
// 改造 getBookmarkSnapshot:
// 1. 读取 Chrome 文件
// 2. 与数据库对比（通过 normalized_url 去重）
// 3. 新书签 → insert
// 4. 已有书签 → 保留数据库中的 status/category/tags（不覆盖）
// 5. Chrome 中已删除的 → 标记 status = 'removed'
// 6. 返回数据库中的完整列表
```

修改 IPC handler，使 `bookmarks:get` 从数据库读取而非每次重新解析 Chrome 文件。

## 文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| 新建 | `packages/desktop/src/main/db/database.ts` | 数据库核心类 |
| 新建 | `packages/desktop/src/main/db/migrations.ts` | Schema 迁移 |
| 新建 | `packages/desktop/src/main/db/index.ts` | 导出入口 |
| 修改 | `packages/desktop/src/main/bookmark-service.ts` | 集成数据库 |
| 修改 | `packages/desktop/src/main/index.ts` | 启动时初始化 DB |
| 新建 | `packages/desktop/tests/database.test.ts` | 单元测试 |
| 修改 | `packages/desktop/package.json` | 添加 better-sqlite3 依赖 |

## 依赖安装

```bash
# better-sqlite3 需要通过供应链检查
# 版本: 11.9.1 (2025-04-28 发布，已超过 7 天)
# 维护者: JoshuaWise (活跃 7+ 年，2000+ stars)
# 无 typosquatting 风险
pnpm add better-sqlite3@11.9.1 --filter @shuhai/desktop
pnpm add -D @types/better-sqlite3@7.6.14 --filter @shuhai/desktop
```

## 验收标准

- [ ] 数据库文件创建在 `~/.shuhai/data.db`
- [ ] 启动时自动执行 migration
- [ ] WAL 模式已启用
- [ ] `upsertBookmarks` 使用事务，5000 条书签 < 1 秒
- [ ] Chrome 书签同步后，数据库中有完整记录
- [ ] 重启应用后，书签列表从数据库加载（不依赖 Chrome 文件）
- [ ] 已删除的书签标记为 removed，不从数据库删除
- [ ] `getBookmarksNeedingCheck` 正确返回超过 N 天未检测的书签
- [ ] 所有测试通过 (`pnpm test`)
- [ ] lint + typecheck 无错误

## 注意事项

- MUST: 使用 WAL 模式 (`PRAGMA journal_mode=WAL`)
- MUST: 批量操作用事务包裹
- MUST: 数据库路径用 `getDataDir()` 获取，不硬编码
- MUST: 测试使用 `:memory:` 数据库，不写真实文件
- SHOULD: 启动时备份 `data.db` → `data.db.bak`（保留最近 3 份）
- SHOULD: 关闭时调用 `db.close()` 确保 WAL checkpoint
- 不要修改 renderer 代码，IPC 接口保持不变（返回类型不变）
