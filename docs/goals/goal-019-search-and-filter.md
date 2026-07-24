# Goal 019: 书签搜索与过滤

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

## 背景

用户有上千个书签。当前分类预览、健康检测结果、待处理队列都是纯列表，数据一多就变成"能用但累"。BookmarkTree 浏览视图有一个搜索输入框（`[data-shuhai-search]`），但分类预览和健康检测没有。

## 目标

在三个关键列表中添加搜索/过滤能力：分类预览、健康检测结果、待处理捕获队列。

## 改动范围

| 文件                                  | 改动                       |
| ------------------------------------- | -------------------------- |
| `src/components/SearchInput.tsx`      | 新增：可复用的搜索输入组件 |
| `src/popup/pages/ClassifyPreview.tsx` | 改：添加搜索过滤           |
| `src/popup/pages/HealthPage.tsx`      | 改：添加搜索过滤           |
| `src/popup/pages/CollectionPage.tsx`  | 改：添加搜索过滤           |

## 具体设计

### 1. SearchInput 组件

```tsx
interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}
```

- 带搜索图标（Search from lucide）的 Input
- 右侧有清除按钮（X icon，当 value 非空时显示）
- 支持 `Ctrl+F` / `Cmd+F` 快捷键聚焦（在扩展 popup 内）
- debounce 300ms（在组件外部处理，组件本身是受控的）

### 2. 分类预览搜索

在 ClassifyPreview 顶部（排序按钮旁边）添加 SearchInput。

搜索范围：

- 书签标题（`bookmarkTitle`）
- 书签 URL（`bookmarkUrl`）
- 目标文件夹名（`targetFolder`）

过滤逻辑：

```typescript
const searchLower = search.toLowerCase();
const filteredPlan = plan.moves.filter(
  (move) =>
    move.bookmarkTitle.toLowerCase().includes(searchLower) ||
    move.bookmarkUrl.toLowerCase().includes(searchLower) ||
    move.targetFolder.toLowerCase().includes(searchLower),
);
```

搜索时保持现有排序逻辑不变，只是在排序后的结果上再过滤。

显示搜索结果计数：`显示 {filtered.length} / {total.length} 条`

### 3. 健康检测搜索

在 HealthPage 的筛选 tabs 下方添加 SearchInput。

搜索范围：

- 书签标题（`bookmarkTitle`）
- 书签 URL（`bookmarkUrl`）
- 跳转 URL（`finalUrl`）
- 错误信息（`error`）

搜索与筛选 tabs 是叠加关系：先按 tab 筛选，再按搜索词过滤。

### 4. 待处理队列搜索

在 CollectionPage 的待处理列表上方添加 SearchInput。

搜索范围：

- 标题（`title`）
- URL（`url`）
- 作者（`author`）
- 正文前 200 字符（`text.slice(0, 200)`）

### 5. 搜索状态管理

搜索词是页面级 local state（`useState`），不持久化。切换 tab 或刷新后重置。

使用 `useDeferredValue` 或 `useMemo` 确保大列表搜索不卡 UI：

```typescript
const [search, setSearch] = useState('');
const deferredSearch = useDeferredValue(search);
const filtered = useMemo(() => {
  if (!deferredSearch) return items;
  const lower = deferredSearch.toLowerCase();
  return items.filter(item => /* ... */);
}, [items, deferredSearch]);
```

### 6. 空搜索结果状态

搜索无结果时显示：

```
🔍 未找到匹配「{searchTerm}」的结果
```

带"清除搜索"按钮。

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

新增测试：

- SearchInput 组件基本行为（可选）
- 各页面的过滤逻辑（给定搜索词，输出正确的过滤结果）
