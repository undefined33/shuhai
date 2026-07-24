# Goal 027: 收藏流程文案与反馈清晰化

> **历史 Goal，不得直接执行。** 当前保存流程固定在 Popup，正常单条保存不经过队列。

## 背景

用户在 Twitter 页面右键看到"保存此推文"时，会和 Twitter 自带书签按钮混淆。点击后内容进入 ShuHai 待保存队列，但用户不知道发生了什么、保存到了哪里。最终写入 Vault 后，toast 只显示目录级别信息，不显示完整文件路径，用户无法在 Obsidian 中找到文件。

核心问题：**用户不理解 ShuHai 右键保存和平台原生书签的区别，也看不到操作结果的具体位置。**

## 目标

1. 右键菜单文案明确传达"提取正文到本地知识库"的语义
2. 保存成功后显示完整文件路径，支持复制
3. "最近写入 Vault"显示文件名而非仅时间+数量
4. 入队成功的 toast 说明下一步操作

## 改动范围

| 文件                                 | 改动                                               |
| ------------------------------------ | -------------------------------------------------- |
| `src/background/service-worker.ts`   | 右键菜单文案修改                                   |
| `src/popup/pages/CollectionPage.tsx` | toast 显示完整路径 + 复制按钮 + 最近写入显示文件名 |
| `src/content/toast.ts`               | Content Script 入队 toast 文案修改                 |
| `src/shared/bookmark-types.ts`       | ExportManifest 可选加 `fileLabels`                 |

## 具体设计

### 1. 右键菜单文案

**当前**：

```
保存此推文
保存此微博
保存此文章到知识库
```

**改为**：

```
提取推文正文到 ShuHai
提取微博正文到 ShuHai
提取文章正文到 ShuHai
```

"提取...到 ShuHai" 明确了三件事：

- 动作是"提取正文"，不是"加书签"
- 目标是 ShuHai，不是 Twitter/Chrome
- 暗示了内容会被处理（不是简单收藏链接）

### 2. 入队成功反馈

右键提取成功后，Content Script 的 toast 当前显示类似"已加入待保存队列"。

**改为**：

```
已提取到 ShuHai · 打开侧边栏写入 Vault →
```

让用户知道：(1) 提取成功了 (2) 还需要一步才能写入 Obsidian。

### 3. 写入成功 toast 显示完整路径

**当前** (`CollectionPage.tsx:275-276`)：

```typescript
toast({
  kind: 'success',
  message: result.files[0]
    ? `已写入「${selectedCapture.title}」到 ${directoryPrefix}/`
    : `「${selectedCapture.title}」已存在，未重复写入。`,
});
```

**改为**：

```typescript
const filePath = result.files[0] ?? '';
toast({
  kind: 'success',
  message: filePath ? `已写入：${filePath}` : `「${selectedCapture.title}」已存在，未重复写入。`,
  action: filePath ? { label: '复制路径', onClick: () => copyToClipboard(filePath) } : undefined,
});
```

Toast 组件需要支持 `action` 按钮（如果当前不支持，新增一个可选的 action slot）。

### 4. "最近写入 Vault" 显示文件名

**当前**：

```
写入：2026-05-29 14:30    [推文]  1 篇
```

**改为**：

```
ShuHai/twitter/作者名 - 推文前40字.md
  推文 · 2026-05-29 14:30
```

实现：`ExportManifest.files` 已经存了完整路径列表，直接取 `files[0]` 显示。如果 files 有多条（批量保存），显示第一条 + "等 N 个文件"。

### 5. Toast action 支持

检查当前 Toast 组件是否支持 action 按钮。如果不支持，新增：

```typescript
interface ToastAction {
  label: string;
  onClick: () => void;
}

// toast({ kind, message, action?: ToastAction })
```

渲染为 toast 右侧的小按钮。

### 6. 复制路径工具函数

```typescript
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback: 创建临时 textarea
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}
```

## 不改的

- 两步流程本身（先入队再写入）不变 — 这是有意设计，让用户确认标签后再写入
- 批量保存的 toast 保持当前格式（`已写入 N 个文件到 prefix/`）
- 不加"一键保存"跳过队列（违反用户手动确认原则）

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

重点验证：

- 右键菜单在 Twitter/Weibo/普通页面分别显示正确文案
- 单条保存成功后 toast 显示完整路径（如 `ShuHai/twitter/xxx.md`）
- 点击"复制路径"后剪贴板内容正确
- "最近写入"区域显示文件名而非仅数量
- 批量保存仍显示汇总信息
