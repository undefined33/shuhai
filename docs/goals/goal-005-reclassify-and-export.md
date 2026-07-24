# Goal 005: 智能重分类 + Obsidian Vault 导出

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

解决 Goal 004 MVP 的核心不足（已分类书签不会被重新整理），
并实现通过 File System Access API 将书签/内容导出到 Obsidian vault。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过
2. pnpm --filter @shuhai/extension run build 成功
3. "重新分类全部书签"模式下，对已在文件夹中的书签也能生成移动建议
4. AI 分类能对 1469 个书签生成有意义的整理方案（不再是 0 条建议）
5. 用户能选择 Obsidian vault 目录，扩展能将书签索引写入为 .md 文件
6. 导出的 .md 文件在 Obsidian 中打开安全（无可执行语法）
7. 所有新代码有对应的单元测试

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/chrome-extension（继续在此分支工作）
当前状态：

- Goal 004 已完成，扩展能加载、读取 1469 个书签
- 问题：分类逻辑太保守，已在文件夹中的书签不会被重新分类
- classifier.ts 第 162-170 行：如果书签已有 parentPath 且不是根目录，直接返回当前文件夹

用户书签特征：

- 1469 个书签，106 个文件夹
- 大部分已在 APT/EDR/RedTeam 等文件夹中
- 用户希望 AI 能重新审视整个书签体系，提出更好的分类方案

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 1. [Critical] 分类模式：安全模式 vs 全量重分类

### 1.1 修改 classifier.ts

当前逻辑（第 162-170 行）：

```typescript
// 如果书签已在文件夹中，直接返回当前文件夹，不建议移动
if (existingCategory && !isRootishPath(bookmark.parentPath)) {
  return { targetFolder: existingCategory, confidence: 1, reason: 'folder' };
}
```

改为支持两种模式：

```typescript
type ClassifyMode = 'safe' | 'full';

// safe 模式：只处理根目录/未分类的书签（现有行为）
// full 模式：忽略当前文件夹，对所有书签重新分类
```

- `safe` 模式：保持现有逻辑，只整理未分类书签
- `full` 模式：跳过"已有文件夹就是分类"的逻辑，对所有书签运行规则/AI 分类
  - 如果 AI/规则建议的目标文件夹和当前文件夹相同 → 不生成移动建议
  - 如果不同 → 生成移动建议，让用户决定

### 1.2 修改 generateClassificationPlan

添加 `mode: ClassifyMode` 参数：

```typescript
export function generateClassificationPlan(
  bookmarks: BookmarkItem[],
  folders: FolderItem[],
  customRules: CustomRule[] = [],
  aiSuggestions: ClassificationSuggestion[] = [],
  mode: ClassifyMode = 'safe', // 新增
  now = new Date(),
): ClassificationPlan;
```

`full` 模式下：

- 所有书签都经过规则/AI 分类
- 只有当建议的 targetFolder !== 当前 parentPath 时才生成 move
- 从当前文件夹移出的建议默认 `selected: false`（需要用户手动确认）

### 1.3 修改 AI 分类 prompt

当前 prompt 只发送 bookmarkId/title/url/currentFolder。
`full` 模式下，prompt 应该告诉 AI：

```
你是书签分类专家。请重新审视以下书签的分类是否合理。
如果当前文件夹已经是最佳分类，返回相同的 targetFolder。
如果有更好的分类方案，返回新的 targetFolder。
考虑：合并相似文件夹、拆分过大的文件夹、建立更清晰的层级。
```

### 1.4 UI 模式切换

在 BookmarkTree 页面或 ClassifyPreview 入口添加模式选择：

```
┌─────────────────────────────────────┐
│  整理模式：                          │
│  ○ 仅整理未分类书签（安全模式）       │
│  ● 重新分类全部书签（AI 深度整理）    │
│                                      │
│  [开始整理]                          │
└─────────────────────────────────────┘
```

### 1.5 空结果提示

如果生成 0 条建议，显示原因：

- 安全模式："所有书签已在文件夹中。切换到「全量重分类」模式可重新审视分类。"
- 全量模式："AI 认为当前分类已经合理，无需调整。"

## 2. [Critical] AI 分类增强 — 支持大批量

当前 AI 分类一次只处理 50 个书签（AI_BATCH_SIZE）。用户有 1469 个。

### 2.1 分批处理

```typescript
async function classifyAllWithDeepSeek(
  bookmarks: BookmarkItem[],
  settings: AppSettings,
  onProgress?: (done: number, total: number) => void,
): Promise<ClassificationSuggestion[]> {
  const results: ClassificationSuggestion[] = [];
  const batches = chunk(bookmarks, AI_BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = await classifyWithDeepSeek(batches[i], settings);
    results.push(...batch);
    onProgress?.(results.length, bookmarks.length);
  }

  return results;
}
```

### 2.2 进度显示

ClassifyPreview 页面显示 AI 分类进度：

- "AI 分类中: 150/1469 (批次 3/30)"
- 可以中途取消

### 2.3 AI 上下文增强

给 AI 发送当前文件夹结构作为参考：

```
当前文件夹结构：
- APT (23 个书签)
- EDR (15 个书签)
- RedTeam (42 个书签)
- 安全/研究 (8 个书签)
...

请基于这个结构，为以下书签建议最合适的文件夹。
可以建议新文件夹，也可以建议合并到现有文件夹。
```

## 3. [Critical] Obsidian Vault 导出 — File System Access API

### 3.1 目录授权

新建 `src/utils/vault-writer.ts`：

```typescript
// 存储 directory handle 到 IndexedDB
async function getVaultHandle(): Promise<FileSystemDirectoryHandle | null>;
async function requestVaultAccess(): Promise<FileSystemDirectoryHandle>;
async function checkVaultPermission(handle: FileSystemDirectoryHandle): Promise<boolean>;
```

- 首次使用：用户点击"选择 Obsidian Vault" → `showDirectoryPicker()` → 存 handle 到 IndexedDB
- 后续使用：从 IndexedDB 读取 handle → `queryPermission()` 检查 → 如果过期则 `requestPermission()`
- **必须在有 Window 的页面中调用**（popup/options page），不能在 Service Worker 中

### 3.2 Markdown 生成

新建 `src/utils/markdown-generator.ts`：

书签导出格式：

```markdown
---
title: 'CVE-2024-1234 分析报告'
url: 'https://example.com/cve-report'
source: chrome
folder: '安全/研究'
tags: [安全, CVE]
status: unchecked
created: 2026-03-15
exported: 2026-05-28
shuhai_format: 2
---

# CVE-2024-1234 分析报告

- 来源: Chrome 书签 > 安全 > 研究
- 链接: [打开](https://example.com/cve-report)
- 分类置信度: 0.92 (AI)

## 笔记
```

### 3.3 安全消毒

新建 `src/utils/sanitize.ts`（从 desktop 包移植核心逻辑）：

导出前必须消毒的内容：

- 书签标题 → YAML frontmatter 安全（转义引号、控制字符）
- 书签标题 → 文件名安全（去除 `/\:*?"<>|`，限长，NFC 规范化）
- URL → 只允许 http/https/mailto
- 文件夹路径 → 防路径遍历（`..` 检测，`isWithinDirectory` 验证）
- 所有文本 → 中和 Obsidian 可执行语法：
  - `<% %>` → 转义
  - `{{ }}` → 转义
  - ` ```dataview ` / ` ```dataviewjs ` → 改为 ` ```text `
  - `obsidian://` → `obsidian-disabled://`
  - `![[` → `\!\[\[`

### 3.4 导出流程 UI

在 popup 中添加"导出到 Obsidian"页面：

```
┌─────────────────────────────────────────┐
│  导出到 Obsidian                         │
├─────────────────────────────────────────┤
│  Vault 目录: /Users/xxx/ObsidianVault   │
│  [更换目录]                              │
│                                          │
│  导出范围：                              │
│  ○ 全部书签 (1469)                       │
│  ● 当前分类方案中的书签                   │
│  ○ 选中的书签                            │
│                                          │
│  导出目录: Bookmarks/                    │
│  文件命名: {category}/{title}.md         │
│                                          │
│  [预览] [导出]                           │
├─────────────────────────────────────────┤
│  预览：                                  │
│  将创建 1469 个 .md 文件                 │
│  目录结构：                              │
│    Bookmarks/安全/研究/ (45 个文件)       │
│    Bookmarks/安全/CTF/ (12 个文件)        │
│    Bookmarks/开发/前端/ (89 个文件)       │
│    ...                                   │
│                                          │
│  ⚠️ 3 个文件已存在，将跳过               │
│                                          │
│  [确认导出]                              │
└─────────────────────────────────────────┘
```

### 3.5 导出执行

```typescript
async function exportToVault(
  handle: FileSystemDirectoryHandle,
  bookmarks: BookmarkItem[],
  options: ExportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const results: ExportResult = { exported: 0, skipped: 0, errors: [] };

  for (const bookmark of bookmarks) {
    const relativePath = buildFilePath(bookmark, options); // "安全/研究/CVE-2024-1234.md"
    const content = generateMarkdown(bookmark);

    // 创建子目录
    const dirHandle = await ensureDirectory(handle, dirname(relativePath));

    // 检查文件是否已存在
    const fileName = basename(relativePath);
    if (await fileExists(dirHandle, fileName)) {
      results.skipped++;
      continue;
    }

    // 写入文件
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    results.exported++;
    onProgress?.(results.exported + results.skipped, bookmarks.length);
  }

  return results;
}
```

### 3.6 导出记录

每次导出后保存 manifest 到 `chrome.storage.local`：

```typescript
interface ExportManifest {
  id: string;
  exportedAt: string;
  vaultPath: string; // 仅用于显示，不用于文件操作
  files: string[]; // 导出的文件相对路径列表
  bookmarkCount: number;
}
```

用于：

- 显示历史导出记录
- 避免重复导出（检查文件是否已存在）
- 未来可能的"撤销导出"（删除本次导出的文件）

## 4. [Major] 当前页面内容保存（Twitter/Weibo）

### 4.1 Content Script 注册

manifest.json 添加：

```json
"content_scripts": [
  {
    "matches": ["https://x.com/*", "https://twitter.com/*"],
    "js": ["content/twitter.js"],
    "run_at": "document_idle"
  },
  {
    "matches": ["https://weibo.com/*", "https://m.weibo.cn/*"],
    "js": ["content/weibo.js"],
    "run_at": "document_idle"
  }
]
```

需要新增权限：

```json
"host_permissions": ["https://x.com/*", "https://twitter.com/*", "https://weibo.com/*", "https://m.weibo.cn/*"]
```

### 4.2 Twitter/X 内容提取

新建 `src/content/twitter.ts`：

- 监听用户点击扩展的右键菜单或页面内注入的"保存"按钮
- 从 DOM 提取当前推文：
  - 推文正文（`[data-testid="tweetText"]`）
  - 作者名和 handle
  - 发布时间（`<time>` 元素）
  - 媒体链接（图片/视频 URL）
  - 互动数据（点赞/转发/回复数）
  - 如果是 thread，提取整个线程
- 发送到 background service worker

注意：

- DOM 选择器可能随 Twitter 改版失效，用 `data-testid` 属性比 class 名更稳定
- 只在用户主动触发时提取（不自动后台抓取）
- 只读 `textContent`，不执行页面 JS

### 4.3 Weibo 内容提取

新建 `src/content/weibo.ts`：

- 提取微博正文
- 作者信息
- 发布时间
- 图片 URL 列表
- 转发内容（如果有）

### 4.4 社交内容导出格式

```markdown
---
title: '@author_handle - 推文摘要前30字...'
url: 'https://x.com/user/status/123456'
source: twitter
author: '@handle'
created: 2026-05-20
exported: 2026-05-28
tags: [安全, APT]
shuhai_format: 2
---

# @author_handle

> 推文正文内容...
> 可能有多行

## 媒体

- [图片: alt-text](https://pbs.twimg.com/media/xxx.jpg)
- [图片: ](https://pbs.twimg.com/media/yyy.jpg)

## 笔记
```

**关键安全规则**：

- 图片不用 `![]()` 语法（防止 Obsidian 自动加载远程图片泄露 IP）
- 使用 `[图片: alt](url)` 纯文本链接格式
- 推文正文做 Obsidian 语法消毒（虽然推文一般不含模板语法，但防御性处理）

## 5. [Major] 右键菜单

### 5.1 Context Menu 注册

```typescript
// background service-worker.ts
chrome.contextMenus.create({
  id: 'shuhai-save-page',
  title: '保存到 ShuHai 知识库',
  contexts: ['page'],
});

chrome.contextMenus.create({
  id: 'shuhai-save-tweet',
  title: '保存此推文',
  contexts: ['page'],
  documentUrlPatterns: ['https://x.com/*', 'https://twitter.com/*'],
});

chrome.contextMenus.create({
  id: 'shuhai-save-weibo',
  title: '保存此微博',
  contexts: ['page'],
  documentUrlPatterns: ['https://weibo.com/*', 'https://m.weibo.cn/*'],
});
```

### 5.2 右键保存流程

1. 用户右键 → "保存此推文"
2. Background 发消息给 Content Script → 提取当前推文
3. Content Script 返回结构化数据
4. Background 通知 popup/side panel 打开确认界面
5. 用户确认 → 生成 Markdown → 写入 vault

## 6. [Minor] Settings 页面增强

- 添加 "Obsidian Vault 目录" 设置项（显示当前授权的目录，可更换）
- 添加 "导出目录前缀" 设置（默认 `Bookmarks/`）
- 添加 "分类模式" 默认值选择
- 添加 "导出历史" 查看

═══════════════════════════════════════════
强制约束：
═══════════════════════════════════════════

【网络与代理】

- 所有 git push/pull/fetch 必须加代理：
  git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 push

【供应链安全】

- 本 Goal 预计不需要新依赖
- 如果需要（如 IndexedDB wrapper），遵守供应链安全规则

【代码规范】

- TypeScript strict 模式
- 单引号，尾逗号，100 字符行宽
- 不要引入 React import（react-jsx transform）
- 不用的变量用 \_ 前缀
- 不使用 Node.js API

【安全 — 导出消毒】

- 所有写入 .md 的内容必须经过 sanitize：
  - YAML frontmatter：转义引号、控制字符
  - 文件名：去危险字符、限长 80、NFC 规范化、防路径遍历
  - Obsidian 语法中和：<% %>、{{ }}、dataview/dataviewjs、obsidian://、![[]]
  - 图片不用 `![]()` 语法，改为 `[图片: alt](url)` 纯文本
  - URL 只允许 http/https/mailto
  - 代码块语言标记消毒：dataview/dataviewjs/templater → text
- Content Script 只读 textContent 和安全属性，不执行页面 JS
- File System Access API 写入前验证路径在 vault 目录内

【产品边界 — 本 Goal 不做的事】

- 不做后台自动监听新收藏（需要用户手动触发）
- 不做全文网页抓取（只提取社交平台结构化内容）
- 不做死链检测
- 不做 Native Messaging / Local Companion

【File System Access API 注意事项】

- showDirectoryPicker() 必须在有 Window 的页面中调用（popup/options page）
- Directory handle 存 IndexedDB，跨会话需要 queryPermission() 检查
- 如果权限过期，需要 requestPermission()（需要用户交互）
- 产品上要处理"权限过期需要重新授权"的 case

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 每完成一个功能后运行：pnpm lint && pnpm typecheck && pnpm test
- 测试失败 → 先修复再继续
- 每个功能一个 commit，commit message 格式：feat: xxx 或 fix: xxx
- push 到远程后继续下一个功能
- 优先级：先做分类增强（1-2）→ 再做 Obsidian 导出（3）→ 最后做内容保存（4-5）

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- File System Access API 在某些 Chrome 版本不可用 → 降级为 chrome.downloads 下载 .md
- Twitter DOM 选择器失效 → 用多个 fallback 选择器，如果全部失败则提示用户手动复制
- AI 分类 1469 个书签 token 消耗过大 → 分批处理，允许用户选择只分类某个文件夹
- IndexedDB 存储 directory handle 失败 → 每次手动选择（体验降级但功能可用）
- 网络不可用无法 push → 本地 commit，记录待 push

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. 分类模式是否能对已有书签生成建议
5. Obsidian 导出是否成功写入文件
6. 需要人工介入的事项
