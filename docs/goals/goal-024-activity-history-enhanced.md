# Goal 024: 活动历史增强

> **历史 Goal，不得直接执行。** 当前操作日志语义见 Goal 032。

## 背景

Goal 020 建立了基础的活动日志系统（50 条 FIFO，按日期分组的时间线）。但实际使用中：

- 50 条很快就满了（一次分类 + 导出就占 2 条，活跃用户一周就满）
- 无法按类型筛选（"我只想看导出记录"）
- 无法搜索（"上周那个 GitHub 书签整理到哪了"）
- 无法导出历史（换设备后丢失）

## 目标

让活动历史从"能看"升级到"能用"：支持筛选、搜索、导出，容量扩大到覆盖一个月的正常使用。

## 改动范围

| 文件                               | 改动                                    |
| ---------------------------------- | --------------------------------------- |
| `src/utils/activity-log.ts`        | 扩容 + 筛选/搜索接口                    |
| `src/popup/pages/ActivityPage.tsx` | 搜索框 + 类型筛选 + 日期分组增强 + 统计 |
| `src/shared/bookmark-types.ts`     | 新增导出相关类型                        |
| `src/utils/vault-writer.ts`        | 小改：支持写入活动日志 Markdown         |

## 具体设计

### 1. 扩容

- `MAX_ACTIVITY_ENTRIES`: 50 → **200**
- 存储预估：200 条 × ~2KB ≈ 400KB，仍在 chrome.storage.local 5MB 限制内
- `MAX_ACTIVITY_DETAILS` 保持 20 不变

### 2. 筛选接口

```typescript
// src/utils/activity-log.ts 新增

interface ActivityFilter {
  types?: ActivityType[]; // 多选，空 = 全部
  keyword?: string; // 匹配 summary + details.label
  dateFrom?: string; // ISO date，如 "2026-05-20"
  dateTo?: string; // ISO date
}

function filterActivityLog(entries: ActivityEntry[], filter: ActivityFilter): ActivityEntry[];
```

筛选在前端内存中执行（200 条数据量不需要后端索引）。

### 3. 日期分组增强

当前：按日期分组（每天一组）。

改为智能分组：

- **今天** — 今天的记录
- **昨天** — 昨天的记录
- **本周** — 本周其余天（周一到前天）
- **上周** — 上周
- **更早** — 其余

分组标题显示该组的记录数。

### 4. 搜索和筛选 UI

ActivityPage 顶部新增：

```
┌─────────────────────────────────────────────┐
│ [🔍 搜索书签标题或操作摘要...              ] │
│ [全部] [分类] [导出] [健康] [收藏] [备份]   │
├─────────────────────────────────────────────┤
│ 📊 本周: 12 次操作 · 分类 5 · 导出 3       │
├─────────────────────────────────────────────┤
│ 今天 (3)                                    │
│ ...                                         │
└─────────────────────────────────────────────┘
```

- 搜索框：实时过滤（debounce 200ms）
- 类型筛选：chip 按钮组，多选，映射到 ActivityType
- 统计摘要：本周操作总数 + 各类型分布

### 5. 统计摘要

页面顶部显示简要统计：

```typescript
interface ActivityStats {
  thisWeek: number;
  thisMonth: number;
  byType: Record<ActivityType, number>; // 本周各类型计数
}
```

计算在前端完成，不额外存储。

### 6. 活动日志导出

"导出历史"按钮，两种格式：

**JSON 导出**（下载为文件）：

- 完整的 `ActivityEntry[]` 数组
- 文件名：`shuhai-activity-YYYY-MM-DD.json`

**Markdown 导出**（写入 Vault）：

- 写入 `{exportDirectory}/_activity/activity-log.md`
- 格式：按日期分组的表格，每条记录一行
- 写入前过消毒（summary 和 details 中可能含用户输入的书签标题）

### 7. 清空确认

当前"清空历史"按钮直接执行。改为：

- 点击后弹出确认 dialog："确定清空所有操作历史？此操作不可撤销。"
- 提供"导出后清空"选项（先导出 JSON，再清空）

## 安全考量

- 搜索关键词不存储、不上报
- 导出的 Markdown 过消毒（书签标题可能含恶意内容）
- JSON 导出为本地下载，不经过网络

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

新增测试：

- `filterActivityLog` 各筛选条件组合
- 日期分组逻辑（今天/昨天/本周/上周/更早）
- 统计计算
- 导出 Markdown 消毒
