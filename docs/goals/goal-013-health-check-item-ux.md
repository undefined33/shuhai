# Goal 013: 健康检测列表项交互优化

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

## 背景

Goal 012 修好了批量操作的核心交互，但列表项本身还有改进空间：

- 每条记录都展开"新 URL 输入框"，页面视觉噪音大
- 缺少常用辅助操作：重试检查、打开链接核实、复制 URL
- 这些是 Goal 012 复核时确认的后续改进点

## 目标

让列表项更紧凑、更实用：默认只展示信息和 checkbox，辅助操作通过图标按钮提供，URL 修正输入框按需展开。

## 改动范围

仅修改 `packages/extension/src/popup/pages/HealthPage.tsx`。

## 具体改动

### 1. URL 输入框改为按需展开

当前：每条记录底部始终显示 `<Input placeholder="粘贴新 URL" />` + "替换"按钮。

改为：

- 默认不显示输入框，显示一排紧凑的图标操作按钮
- 点击"修正链接"（铅笔图标）后展开输入框 + 替换按钮
- 用 local state `editingId` (string | null) 追踪当前展开的记录，同时只展开一条

```tsx
const [editingId, setEditingId] = useState<string | null>(null);
```

### 2. 添加辅助操作按钮（图标按钮行）

每条记录底部默认显示一排小图标按钮：

| 按钮       | 图标           | 动作                                                             | 条件                  |
| ---------- | -------------- | ---------------------------------------------------------------- | --------------------- |
| 打开链接   | ExternalLink   | `chrome.tabs.create({ url: record.bookmarkUrl, active: false })` | 始终显示              |
| 复制 URL   | Copy           | `navigator.clipboard.writeText(record.bookmarkUrl)`              | 始终显示              |
| 修正链接   | Pencil         | 展开输入框                                                       | 始终显示              |
| 重试检查   | RotateCw       | `onRetry(record)`                                                | 非 alive/skipped      |
| 更新到跳转 | ArrowRightLeft | `onUpdateUrl(record, record.finalUrl!)`                          | redirected + finalUrl |

图标按钮用 `variant="ghost" size="icon"` 保持紧凑，加 `title` 属性做 tooltip。

### 3. 新增 `onRetry` prop

```tsx
interface HealthPageProps {
  // ... existing props
  onRetry(record: UrlHealthRecord): void;
}
```

`onRetry` 的实现在 `App.tsx` 中：向 background service worker 发送 `health:retryOne` 消息，传入 `record.bookmarkId`。Service worker 对该单条书签重新执行健康检查，完成后更新 records。

### 4. Service Worker 处理 `health:retryOne`

在 `packages/extension/src/background/service-worker.ts` 中添加对 `health:retryOne` 消息的处理：

- 接收 `bookmarkId`
- 从 chrome.bookmarks 获取该书签的 URL
- 执行单条 URL 健康检查（复用现有的 `checkUrlHealth` 函数）
- 更新 storage 中对应的 record
- 回复结果

### 5. 调整 itemHeight

当前 `itemHeight={156}`。输入框折叠后记录更紧凑，调整为：

- 默认行高：`120px`（无输入框）
- 展开行高：`156px`（有输入框）

如果 VirtualList 不支持动态行高，保持 `itemHeight={120}` 并让展开的输入框用 absolute/overlay 方式显示，或者简单保持 156 不变（留白可接受）。优先选择实现简单的方案。

### 6. 复制成功反馈

复制 URL 后，图标短暂变为 CheckCircle2（1.5s 后恢复）。用 local state 实现：

```tsx
const [copiedId, setCopiedId] = useState<string | null>(null);
```

## 不改动的部分

- 批量工具栏（Goal 012 已完成）
- 筛选 tabs
- 进度条、统计卡片
- 分组逻辑

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

如果新增了 `onRetry` 的 service worker 处理逻辑，需要确认现有测试仍通过。如果 `health:retryOne` 消息处理逻辑较简单（复用现有函数），可不新增测试；如果包含新逻辑，需补充单元测试。
