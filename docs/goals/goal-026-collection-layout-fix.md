# Goal 026: CollectionPage 布局溢出与导出历史信息模型修复

> **历史 Goal，不得直接执行。** 当前保存流程和 UI 方向见 v3 路线。

## 背景

CollectionPage 存在两个叠加的 UI/信息模型问题：

1. **布局溢出**：`待保存内容` 卡片内部内容（列表 + 预览 + 按钮）无高度约束，超出后"最近保存"卡片被推到视口外或视觉上压入预览区域。
2. **导出历史混淆**：`最近保存` 区域直接渲染全局 `exportManifests`，包含书签索引导出（bookmarkCount=1469）和内容保存（1 篇文章）。`ExportManifest` 缺少 `type` 字段，UI 无法区分，用户会误以为 1469 跟当前文章有关。

次要问题：预览区同时显示 `created`（原内容发布时间）、`capturedAt`（ShuHai 捕获时间）、`exportedAt`（写入 Vault 时间），三种时间标签不够清晰。

## 目标

1. 待保存内容卡片内部可滚动，"最近保存"始终可见且不侵入预览区。
2. "最近保存"按类型过滤，在收藏页只显示内容保存记录，并明确标注类型和数量。
3. 时间标签语义清晰。

## 改动范围

| 文件                                           | 改动                              |
| ---------------------------------------------- | --------------------------------- |
| `src/shared/bookmark-types.ts`                 | `ExportManifest` 新增 `type` 字段 |
| `src/utils/vault-writer.ts`                    | 创建 manifest 时设置 `type`       |
| `src/popup/pages/CollectionPage.tsx`           | 布局修复 + 按类型过滤 + 时间标签  |
| `src/popup/pages/ExportPage.tsx`               | 创建 manifest 时设置 `type`       |
| `src/popup/pages/BookmarkIndexExportPanel.tsx` | 同上                              |
| `src/popup/pages/Settings.tsx`                 | "最近写入"区域也显示类型标签      |

## 具体设计

### 1. 布局修复

**当前结构**（简化）：

```
<section flex h-full min-h-0 flex-col>
  <Card>Vault 配置</Card>
  <Card min-h-0 flex-1>          ← 问题：Card 不是 flex 容器
    <CardContent flex min-h-0 flex-col>
      <div flex min-h-0 flex-1 flex-col>  ← 无 overflow，内容无限增长
        列表 + 预览 + 按钮
      </div>
    </CardContent>
  </Card>
  <Card>最近保存</Card>          ← 被推出视口或压入预览
</section>
```

**修复后**：

```
<section flex h-full min-h-0 flex-col>
  <Card>Vault 配置</Card>
  <Card flex min-h-0 flex-1 flex-col>    ← Card 加 flex flex-col
    <CardHeader />
    <CardContent flex min-h-0 flex-1 flex-col>
      <div min-h-0 flex-1 overflow-y-auto>  ← 加 overflow-y-auto
        列表 + 预览 + 按钮
      </div>
    </CardContent>
  </Card>
  <Card>最近保存</Card>          ← 始终可见，不受内容高度影响
</section>
```

关键改动：

- `Card` 加 `flex flex-col` 使其成为 flex 容器
- 内部列表+预览区域的容器加 `overflow-y-auto`
- "全部保存"和"清空队列"按钮放在滚动区域外（固定在卡片底部）

### 2. ExportManifest 类型字段

```typescript
// src/shared/bookmark-types.ts

export type ExportManifestType = 'bookmark-index' | 'capture' | 'activity';

export interface ExportManifest {
  id: string;
  exportedAt: string;
  vaultPath: string;
  files: string[];
  bookmarkCount: number;
  type?: ExportManifestType; // 可选，向后兼容旧记录
  sourceLabel?: string; // 人类可读标签，如"书签索引"、"Twitter 推文"
}
```

### 3. 创建 manifest 时设置 type

**vault-writer.ts**（内容保存）：

```typescript
manifest.type = 'capture';
manifest.sourceLabel = sourceLabel(capture.source); // "文章"/"Twitter/X"/"微博"
```

**ExportPage / BookmarkIndexExportPanel**（书签索引导出）：

```typescript
manifest.type = 'bookmark-index';
manifest.sourceLabel = '书签索引';
```

**activity-log.ts**（活动日志导出，Goal 024）：

```typescript
manifest.type = 'activity';
manifest.sourceLabel = '操作历史';
```

### 4. CollectionPage 按类型过滤

```typescript
const captureManifests = exportManifests.filter(
  (m) => m.type === 'capture' || (!m.type && m.bookmarkCount <= 5),
);
```

对于旧记录（无 `type` 字段），用 `bookmarkCount <= 5` 作为启发式判断（内容保存通常是 1 篇，书签索引通常几十到几千）。

显示格式改为：

```
最近写入 Vault
· 2026-05-29 14:30  Twitter 推文  1 篇
· 2026-05-28 22:15  文章         1 篇
```

### 5. 时间标签清晰化

预览区三种时间改为明确标签：

| 当前显示                              | 改为                     |
| ------------------------------------- | ------------------------ |
| `selectedCapture.created`（无标签）   | `发布: 2026-05-28`       |
| `捕获：2026-05-29 10:30`              | `收藏: 2026-05-29 10:30` |
| `manifest.exportedAt`（在最近保存区） | `写入: 2026-05-29 14:30` |

"捕获"改为"收藏"更贴近用户心智模型（用户点的是"保存"按钮，不是"捕获"）。

### 6. Settings 页面同步

Settings 中的"最近写入"区域也加上类型标签：

```
· 2026-05-29 14:30  [书签索引] 1469 条
· 2026-05-29 10:30  [推文]     1 篇
```

## 向后兼容

- `ExportManifest.type` 为可选字段，旧记录不受影响
- 旧记录在 UI 中显示为"未分类"或用启发式判断
- 不需要数据迁移

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

重点验证：

- 待保存内容列表超过 5 条时，"最近保存"卡片不被推出视口
- 预览区展开后，滚动条出现在正确位置
- 收藏页"最近保存"只显示 capture 类型记录
- 书签索引导出后，收藏页不出现新记录
- 旧 manifest（无 type）的显示不报错
