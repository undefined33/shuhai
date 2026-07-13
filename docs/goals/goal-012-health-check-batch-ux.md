# Goal 012: 健康检测批量操作交互重构

> **历史 Goal，不得直接执行。** 当前破坏性操作先由 Goal 032 修复恢复语义。

## 问题

当前 `HealthPage.tsx` 的筛选器和批量操作是两套独立逻辑硬拼在一起：

1. 筛选 tabs（待处理/全部/死链/错误/重定向/跳过）只负责过滤显示
2. 批量按钮（全选死链/全选重定向/删除选中/更新选中）是固定的，不跟随筛选联动
3. 每条记录底部都有"替换/删除/更新"按钮，和批量操作重复
4. 切到"错误"筛选后没有"全选错误"的入口 — 交互漏洞

## 目标

统一筛选 + 批量操作的心智模型：**筛选负责看哪类，工具栏负责批处理，单条记录负责查看和少量修正。**

## 改动范围

仅修改 `packages/extension/src/popup/pages/HealthPage.tsx`。不涉及 App.tsx handler、类型定义、VirtualList 组件。

## 具体改动

### 1. 批量工具栏：跟随当前筛选

替换现有的固定 4 按钮（全选死链/清空选择/全选重定向/更新选中/删除选中）为统一工具栏：

```
[全选当前 N] [清空选择] [删除选中 N] [更新重定向 N]
```

布局改为 `flex flex-wrap items-center gap-2`（不再是 grid）。

逻辑：

- **全选当前 N**：`setSelectedIds(new Set(visibleRecords.map(r => r.bookmarkId)))`，N 显示 visibleRecords.length
- **清空选择**：`setSelectedIds(new Set())`，disabled 当 selectedIds.size === 0
- **删除选中 N**：`onDeleteMany(selectedRecords)`，disabled 当 selectedRecords.length === 0
- **更新重定向 N**：`onUpdateManyUrls(selectedRedirectedRecords)`，仅当 selectedRedirectedRecords.length > 0 时渲染

这样无论用户在哪个筛选下，"全选当前"都选中当前可见项。"错误"筛选下全选就是全选错误项。

### 2. 删除按钮文案区分

新增 `deleteManyLabel` 派生值：

```tsx
const deleteManyLabel = useMemo(() => {
  if (selectedRecords.length === 0) return '删除选中';
  const allDead = selectedRecords.every((r) => r.status === 'dead');
  const allError = selectedRecords.every((r) => r.status === 'error');
  if (allDead) return `删除选中 ${selectedRecords.length} 条死链`;
  if (allError) return `删除选中 ${selectedRecords.length} 条检查失败书签`;
  return `删除选中 ${selectedRecords.length} 条书签`;
}, [selectedRecords]);
```

理由：`检查失败` 不等于死链，可能是暂停/中断/超时/网络问题，文案不应暗示它们一定无效。

### 3. 切换筛选时清空选择

```tsx
onClick={() => {
  setFilter(value as HealthFilter);
  setSelectedIds(new Set());
}}
```

避免用户在"死链"下全选后切到"全部"，selectedIds 仍包含之前的选择导致困惑。

### 4. 单条记录 action row 简化

当前每条记录底部是 `grid-cols-[1fr_auto_auto]`：输入框 + 替换 + (更新|删除)。

改为：

- 保留：输入框 + "替换"按钮
- 重定向项：保留"更新"按钮（快捷单条更新到 finalUrl，确定性操作）
- 非重定向项：**移除单条"删除"按钮**（走批量工具栏删除）

```tsx
<div className="grid grid-cols-[1fr_auto_auto] gap-2">
  <Input ... />
  <Button ...>替换</Button>
  {record.status === 'redirected' && record.finalUrl ? (
    <Button onClick={() => onUpdateUrl(record, record.finalUrl!)} size="sm">
      更新
    </Button>
  ) : null}
</div>
```

非重定向项只有两列，grid 自然收缩。

### 5. 清理不再需要的派生值

移除 `deadRecords` 和 `redirectedRecords`（原来用于"全选死链"/"全选重定向"按钮，现在不需要了）。

保留 `selectedRedirectedRecords`（工具栏"更新重定向"仍需要）。

## 不改动的部分

- `App.tsx` 中的 handler 逻辑（onDelete/onDeleteMany/onUpdateUrl/onUpdateManyUrls）
- `VirtualList` 组件
- 数据流 / 类型定义 / bookmark-types.ts
- 进度条、统计卡片、开始/暂停按钮
- 分组逻辑（failureGroup / buildRows）

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

全部通过即可。无需新增测试（纯 UI 交互调整，现有测试覆盖 handler 逻辑）。
