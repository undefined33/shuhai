---
version: 1
assignee: codex
status: ready
issue: "#6"
---

# Chrome 书签增量同步

## 目标

监听 Chrome Bookmarks 文件变化，自动检测新增/删除/修改的书签并同步到数据库，无需用户手动刷新。通过 IPC 通知 renderer 更新 UI。

## Prior Context

- 已完成: Chrome 文件读取 (`packages/desktop/src/main/readers/chrome-file-reader.ts`)
- 已完成: SQLite 持久化 (`packages/desktop/src/main/db/`)
- 已完成: `bookmark-service.ts` 中 `getBookmarkSnapshot` 已实现全量同步逻辑
- 已完成: `ShuHaiDatabase.updateSyncState` 记录 checksum
- 常量: `getChromeBookmarksPath(profile)` 返回 Bookmarks 文件路径

## 技术方案

### 文件监听

```
Chrome 每次修改书签时会重写整个 Bookmarks 文件（原子写入）。
监听策略:
  1. fs.watch 监听 Bookmarks 文件
  2. 收到 change 事件后 debounce 2 秒（Chrome 可能连续写入多次）
  3. 读取文件，计算 checksum
  4. 与 sync_state 表中的 checksum 对比
  5. 不同 → 执行增量同步
  6. 相同 → 忽略（避免重复处理）
```

### 增量对比算法

```typescript
// 不是逐条 diff，而是全量读取后与数据库对比
// 原因: Chrome Bookmarks 文件通常 < 5MB，全量解析很快（< 50ms）

增量同步流程:
  1. 读取 Chrome Bookmarks JSON → RawBookmark[]
  2. 对每个 bookmark 计算 normalizedUrl
  3. 与数据库中 source=chrome:Profile 的记录对比:
     - 新 URL（数据库中不存在）→ INSERT + 分类
     - 已有 URL 但标题变了 → UPDATE title
     - 数据库中有但 Chrome 中没了 → 标记 removed
  4. 更新 sync_state checksum
  5. 通过 IPC 通知 renderer: 'bookmarks:changed'
```

### Watcher 类设计

```typescript
// packages/desktop/src/main/sync/chrome-watcher.ts

export interface ChromeWatcherOptions {
  profile: string;
  debounceMs?: number;  // 默认 2000
  onSync?: (result: SyncResult) => void;
  onError?: (error: Error) => void;
}

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export class ChromeBookmarkWatcher {
  constructor(options: ChromeWatcherOptions);

  // 启动监听
  start(): void;

  // 停止监听
  stop(): void;

  // 手动触发一次同步（用于首次启动或用户点击刷新）
  syncNow(): Promise<SyncResult>;

  // 当前是否在监听
  isWatching(): boolean;
}
```

### 集成到应用生命周期

```typescript
// index.ts bootstrap 中:
// 1. 启动后立即执行一次 syncNow()
// 2. 然后 start() 开始监听
// 3. app quit 时 stop()

// 配置变更时（用户切换 Chrome Profile）:
// 1. stop() 旧 watcher
// 2. 创建新 watcher
// 3. syncNow() + start()
```

### IPC 事件

```typescript
// main → renderer 推送（不需要 renderer 主动请求）
mainWindow.webContents.send('bookmarks:changed', syncResult);

// renderer 监听:
// preload.ts 中添加 onBookmarksChanged 回调注册
```

## 文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| 新建 | `packages/desktop/src/main/sync/chrome-watcher.ts` | 文件监听 + 增量同步 |
| 新建 | `packages/desktop/src/main/sync/index.ts` | 导出入口 |
| 修改 | `packages/desktop/src/main/index.ts` | 启动时创建 watcher |
| 修改 | `packages/desktop/src/main/bookmark-service.ts` | 提取 sync 逻辑供 watcher 调用 |
| 修改 | `packages/desktop/src/main/ipc.ts` | 添加 bookmarks:changed 推送 |
| 修改 | `packages/desktop/src/preload.ts` | 添加 onBookmarksChanged API |
| 新建 | `packages/desktop/tests/chrome-watcher.test.ts` | 单元测试 |

## 依赖

无新依赖。使用 Node.js 内置 `fs.watch`。

## 验收标准

- [ ] 启动时自动执行一次全量同步
- [ ] Chrome 书签文件变化后 2 秒内触发增量同步
- [ ] 新增书签正确写入数据库并分类
- [ ] 删除书签正确标记为 removed
- [ ] 标题修改正确更新数据库
- [ ] checksum 相同时不重复处理
- [ ] 切换 Chrome Profile 时 watcher 正确重建
- [ ] app 退出时 watcher 正确停止（无泄漏）
- [ ] `bookmarks:changed` 事件正确推送到 renderer
- [ ] preload 中 `onBookmarksChanged` 回调可注册
- [ ] 测试中 mock fs.watch，不依赖真实文件系统
- [ ] lint + typecheck + test 全部通过

## 注意事项

- MUST: debounce 至少 2 秒（Chrome 连续写入场景）
- MUST: 对比 checksum 避免重复同步
- MUST: watcher.stop() 必须清理所有资源（clearTimeout + fs.watch close）
- MUST: 文件不存在时不崩溃（用户可能未安装 Chrome）
- SHOULD: 同步过程中如果又收到变更事件，等当前同步完成后再触发下一次
- SHOULD: 错误不中断监听（log + onError 回调，继续 watch）
- 不要修改 renderer 页面组件（UI 响应后续单独做）
- 不要修改 shared 包
