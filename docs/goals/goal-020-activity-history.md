# Goal 020: 操作历史

> **历史 Goal，不得直接执行。** 当前操作日志语义见 Goal 032。

## 背景

当前只保留"最近一次分类移动"（用于 undo）和"导出记录"（最多 10 条）。用户无法回顾：

- 上次整理了哪些书签
- 最近删除了哪些死链
- 最近写入了哪些文件到 Vault

这让用户不敢放心点"应用"和"删除"，因为操作后就看不到了。

## 目标

建立轻量的操作历史系统，让用户能回顾最近的关键操作，建立信任感。

## 改动范围

| 文件                               | 改动                     |
| ---------------------------------- | ------------------------ |
| `src/utils/activity-log.ts`        | 新增：活动日志工具       |
| `src/popup/pages/ActivityPage.tsx` | 新增：活动历史页面       |
| `src/popup/App.tsx`                | 小改：添加活动历史入口   |
| `src/background/service-worker.ts` | 小改：关键操作后写入日志 |
| `src/utils/storage.ts`             | 小改：新增 storage key   |

## 具体设计

### 1. 活动日志数据结构

```typescript
// src/utils/activity-log.ts

type ActivityType =
  | 'classify_apply' // 应用了分类方案
  | 'classify_undo' // 撤销了分类
  | 'health_delete' // 删除了死链/错误书签
  | 'health_update' // 更新了重定向书签
  | 'capture_save' // 保存了内容到待处理
  | 'vault_export' // 写入了文件到 Vault
  | 'backup_create'; // 创建了备份

interface ActivityEntry {
  id: string; // crypto.randomUUID()
  type: ActivityType;
  timestamp: string; // ISO 8601
  summary: string; // 人话摘要，如"整理了 12 个书签到 3 个文件夹"
  details?: ActivityDetail[]; // 可选的详细条目
}

interface ActivityDetail {
  label: string; // 如书签标题、文件名
  meta?: string; // 如"从 未分类 → 技术/前端"
}
```

### 2. 存储策略

- Storage key: `'activityLog'`
- 最多保留 **50 条**记录（FIFO，超出时删除最旧的）
- 每条记录的 `details` 最多保留 **20 条**（避免一次分类 200 个书签撑爆 storage）
- 总大小预估：50 条 × ~2KB ≈ 100KB，在 chrome.storage.local 5MB 限制内很安全

### 3. 日志写入时机

| 操作       | summary 模板                       | details                               |
| ---------- | ---------------------------------- | ------------------------------------- |
| 应用分类   | `整理了 {n} 个书签到 {m} 个文件夹` | 每个移动：`{title}` → `{folder}`      |
| 撤销分类   | `撤销了 {n} 个书签的移动`          | 每个移动：`{title}` → 回到 `{folder}` |
| 删除死链   | `删除了 {n} 个失效书签`            | 每个：`{title} ({url})`               |
| 更新重定向 | `更新了 {n} 个重定向书签`          | 每个：`{title}: {oldUrl} → {newUrl}`  |
| 保存内容   | `保存了「{title}」({source})`      | —                                     |
| 写入 Vault | `写入了 {n} 个文件到 {directory}`  | 每个文件名                            |
| 创建备份   | `创建了书签备份（{n} 个书签）`     | —                                     |

### 4. ActivityPage 页面

入口：在 App.tsx 的 organize tab 中添加一个"历史"图标按钮（Clock icon），点击后显示 ActivityPage。

页面结构：

- 按日期分组的时间线列表
- 每条记录显示：时间 + 类型图标 + summary
- 点击展开显示 details（如果有）
- 底部"清空历史"按钮

不需要搜索（50 条记录量不大，直接浏览即可）。

### 5. 与现有机制的关系

- `lastMoveRecords`（undo 用）保持不变，活动日志是额外的只读记录
- `exportManifests`（导出记录）保持不变，活动日志中的 `vault_export` 是简化版摘要
- 活动日志是只读的，不支持从日志中"恢复"操作（那是 undo 的职责）

### 6. 隐私考量

活动日志存储在 `chrome.storage.local`，不会同步到 Google 账号（不用 `chrome.storage.sync`）。日志中只记录标题和 URL，不记录内容正文。用户可以随时清空。

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

新增测试：

- `activity-log.ts` 的写入、读取、FIFO 淘汰逻辑
- summary 生成函数
