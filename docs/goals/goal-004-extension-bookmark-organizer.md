# Goal 004: 路线切换 + Chrome Extension 书签智能整理 MVP

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

产品形态从 Electron 桌面应用转向 Chrome Extension 优先。
本 Goal 交付一个可用的 Chrome 扩展：读取书签 → AI/规则分类 → 预览整理方案 → 用户确认后移动书签。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过
2. pnpm --filter @shuhai/extension run build 生成可加载的 Chrome 扩展（dist/ 目录）
3. 在 Chrome 中加载扩展后，能读取并展示完整书签树
4. 点击"整理书签"后，AI/规则分类生成文件夹移动方案
5. 用户能预览 diff（"将 X 从 A 移动到 B"），确认后执行移动
6. 移动前自动导出书签备份（JSON），支持一键撤销（恢复到整理前状态）
7. 所有新代码有对应的单元测试
8. 不写 Obsidian、不抓网页正文、不做 Twitter/Weibo

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/chrome-extension（从 main 创建新分支）
Monorepo 结构变化：

- packages/shared — 共享类型（需要去除 Node.js 依赖，改为平台无关）
- packages/desktop — Electron 桌面应用（冻结，不再开发新功能）
- packages/extension — 新增，Chrome Extension（本 Goal 主要工作区）

已完成：Goal 001-003（Electron 桌面应用，保留在 feat/electron-gui 分支）
产品转向原因：书签在浏览器中产生和使用，Chrome Extension 有原生 bookmarks API，
比 Electron 读 JSON 文件更安全、更自然、不与 Chrome Sync 冲突。

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 0. [Setup] 路线切换准备

### 0.1 创建新分支

- 从 main 创建 `feat/chrome-extension` 分支
- feat/electron-gui 保持不动（已有 PR #1）

### 0.2 packages/shared 去 Node.js 依赖

当前 `packages/shared/src/constants.ts` 依赖 `node:os` 和 `node:path`。
Chrome Extension 环境没有 Node.js API。

修复方案：

- 将 `getChromeBookmarksPath()` 和 `getDataDir()` 移到 `packages/desktop`
- `packages/shared` 只保留平台无关的类型定义、接口、常量值
- 确保 shared 的 `tsconfig.json` 不引用 Node.js 类型

### 0.3 新建 packages/extension

目录结构：

```
packages/extension/
├── package.json
├── tsconfig.json
├── vite.config.ts          # 构建 popup + background + content scripts
├── manifest.json           # Manifest V3
├── src/
│   ├── background/
│   │   └── service-worker.ts   # Background Service Worker
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx            # React 入口
│   │   ├── App.tsx
│   │   └── pages/
│   │       ├── BookmarkTree.tsx
│   │       ├── ClassifyPreview.tsx
│   │       └── Settings.tsx
│   ├── shared/
│   │   ├── classifier.ts      # 规则分类（从 desktop 移植，去 Node 依赖）
│   │   ├── ai-classifier.ts   # DeepSeek AI 分类
│   │   └── bookmark-types.ts  # Chrome bookmark 相关类型
│   └── utils/
│       ├── chrome-bookmarks.ts # chrome.bookmarks API 封装
│       ├── backup.ts           # 书签备份/恢复
│       └── storage.ts          # chrome.storage 封装
├── tests/
│   ├── classifier.test.ts
│   ├── backup.test.ts
│   └── chrome-bookmarks.test.ts
└── public/
    └── icons/                  # 扩展图标 16/48/128
```

## 1. [Critical] Manifest V3 配置

```json
{
  "manifest_version": 3,
  "name": "ShuHai - 书签智能整理",
  "version": "0.1.0",
  "description": "AI 驱动的 Chrome 书签自动分类和整理工具",
  "permissions": ["bookmarks", "storage", "contextMenus"],
  "action": {
    "default_popup": "popup/index.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

权限说明：

- `bookmarks` — 读取和修改书签（核心功能）
- `storage` — 保存分类规则、AI 配置、备份数据
- `contextMenus` — 右键菜单（后续 Goal 使用，本 Goal 可选）
- **不需要** `<all_urls>`、`activeTab`、`tabs`（本 Goal 不访问网页内容）

## 2. [Critical] 书签树读取与展示

### 2.1 chrome.bookmarks API 封装

新建 `src/utils/chrome-bookmarks.ts`：

```typescript
interface BookmarkNode {
  id: string;
  title: string;
  url?: string; // 有 url = 书签，无 url = 文件夹
  parentId?: string;
  children?: BookmarkNode[];
  dateAdded?: number;
  folderPath: string; // 计算属性："书签栏/开发/前端"
}

// 核心 API：
async function getFullTree(): Promise<BookmarkNode[]>;
async function moveBookmark(
  id: string,
  destination: { parentId: string; index?: number },
): Promise<void>;
async function createFolder(title: string, parentId: string): Promise<BookmarkNode>;
async function searchBookmarks(query: string): Promise<BookmarkNode[]>;
```

### 2.2 Popup UI — 书签树展示

React 组件 `BookmarkTree.tsx`：

- 树形展示所有书签和文件夹
- 显示每个文件夹的书签数量
- 搜索过滤
- 折叠/展开文件夹
- 标记"未分类"书签（直接在书签栏根目录或"其他书签"根目录的链接）

UI 风格：

- 紧凑，适合 popup 宽度（400px）和 side panel
- 中文界面
- 浅色/深色跟随系统

## 3. [Critical] 规则分类引擎

从 `packages/desktop/src/main/pipeline/classifier.ts` 移植，去除 Node.js 依赖。

### 3.1 规则分类

复用现有 14 条默认规则 + 三层策略：

1. Chrome 文件夹路径 → 直接映射
2. 域名匹配 → 分类
3. 标题关键词 → 分类

新增安全研究相关规则（用户是安全研究员）：

```typescript
{ type: 'domain', pattern: 'exploit-db.com', category: '安全/漏洞', tags: ['exploit'], priority: 1 },
{ type: 'domain', pattern: 'cve.mitre.org', category: '安全/CVE', tags: ['CVE'], priority: 1 },
{ type: 'domain', pattern: 'virustotal.com', category: '安全/分析', tags: ['malware'], priority: 1 },
{ type: 'title-keyword', pattern: 'CVE-\\d{4}|exploit|payload|reverse.shell', category: '安全/研究', tags: ['安全'], priority: 2 },
{ type: 'title-keyword', pattern: 'CTF|writeup|flag\\{', category: '安全/CTF', tags: ['CTF'], priority: 2 },
```

### 3.2 AI 分类（可选，需要 API Key）

- 用户在 Settings 页面配置 DeepSeek API Key
- 存储在 `chrome.storage.local`（加密方案：本 Goal 先明文存储，Goal 006 Local Companion 再做 safeStorage）
- AI 分类逻辑复用现有 `DeepSeekProvider` 的 prompt 设计
- 如果没有 API Key，只用规则分类
- 批量分类：每次最多 50 个书签发给 AI

### 3.3 分类结果

```typescript
interface ClassificationPlan {
  moves: Array<{
    bookmarkId: string;
    bookmarkTitle: string;
    bookmarkUrl: string;
    currentFolder: string; // "其他书签"
    targetFolder: string; // "开发/前端"
    confidence: number; // 0-1
    reason: 'rule' | 'ai';
  }>;
  newFolders: string[]; // 需要创建的新文件夹
  unchanged: number; // 不需要移动的书签数
}
```

## 4. [Critical] 整理方案预览 + 确认

### 4.1 ClassifyPreview 页面

用户点击"整理书签"后：

1. 扫描所有书签
2. 运行分类引擎
3. 生成 ClassificationPlan
4. 展示 diff 预览：

```
┌─────────────────────────────────────────────┐
│  整理方案预览                    [全部应用] [取消] │
├─────────────────────────────────────────────┤
│  将创建 3 个新文件夹：                         │
│  ✓ 开发/前端                                  │
│  ✓ 安全/研究                                  │
│  ✓ 安全/CTF                                   │
├─────────────────────────────────────────────┤
│  将移动 12 个书签：                            │
│                                               │
│  ☑ "React Hooks 教程"                         │
│    其他书签 → 开发/前端  (规则: domain)         │
│                                               │
│  ☑ "CVE-2024-1234 分析"                       │
│    书签栏 → 安全/研究  (AI, 置信度: 0.92)      │
│                                               │
│  ☐ "某个不确定的链接"                          │
│    其他书签 → 工具  (AI, 置信度: 0.45)         │
│    [手动选择文件夹 ▾]                          │
│                                               │
├─────────────────────────────────────────────┤
│  不移动: 85 个书签（已在正确文件夹）            │
│                                               │
│  [导出备份] [应用选中的移动]                    │
└─────────────────────────────────────────────┘
```

### 4.2 用户交互

- 每条移动可以单独勾选/取消
- 低置信度（<0.6）的默认不勾选，需要用户手动确认
- 可以手动修改目标文件夹（下拉选择现有文件夹或输入新文件夹名）
- "全部应用"按钮一键执行所有勾选的移动
- "取消"返回书签树页面

## 5. [Critical] 执行移动 + 备份/撤销

### 5.1 备份机制

执行移动前：

- 导出当前完整书签树为 JSON（`chrome.bookmarks.getTree()`）
- 存储到 `chrome.storage.local`（key: `backup_${timestamp}`）
- 保留最近 5 次备份
- 提供"导出备份文件"按钮（下载为 .json 文件）

### 5.2 执行移动

```typescript
async function applyPlan(plan: ClassificationPlan, selectedIds: Set<string>): Promise<ApplyResult> {
  // 1. 创建需要的新文件夹
  for (const folder of plan.newFolders) {
    await createFolderPath(folder); // 递归创建 "安全/研究" → 先创建"安全"再创建"研究"
  }

  // 2. 逐个移动书签
  const results: MoveResult[] = [];
  for (const move of plan.moves) {
    if (!selectedIds.has(move.bookmarkId)) continue;
    try {
      await chrome.bookmarks.move(move.bookmarkId, { parentId: targetFolderId });
      results.push({ id: move.bookmarkId, success: true });
    } catch (error) {
      results.push({ id: move.bookmarkId, success: false, error: String(error) });
    }
  }

  return {
    moved: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success),
  };
}
```

### 5.3 撤销

- 整理完成后显示"撤销"按钮（30 秒内高亮显示）
- 撤销 = 读取最近一次备份，对比当前状态，把移动过的书签移回原位
- 不是"恢复整个书签树"（那样会丢失用户在整理后手动做的其他修改）
- 而是"逆向执行本次移动操作"

```typescript
interface MoveRecord {
  bookmarkId: string;
  fromParentId: string;
  fromIndex: number;
  toParentId: string;
}

async function undoLastPlan(records: MoveRecord[]): Promise<void> {
  for (const record of records.reverse()) {
    await chrome.bookmarks.move(record.bookmarkId, {
      parentId: record.fromParentId,
      index: record.fromIndex,
    });
  }
}
```

## 6. [Major] Settings 页面

Popup 中的设置页：

- DeepSeek API Key 输入（可选）
- AI 模型选择（deepseek-chat / deepseek-reasoner）
- 自定义分类规则（JSON 编辑器或简单表单）
- 备份管理（查看/下载/删除历史备份）
- "关于"信息

## 7. [Major] 构建配置

### 7.1 Vite 构建

使用 Vite 构建扩展：

- popup 入口：`src/popup/main.tsx` → `dist/popup/`
- background 入口：`src/background/service-worker.ts` → `dist/background/`
- 静态资源：`manifest.json`、`icons/` → `dist/`
- 可以使用 `@crxjs/vite-plugin` 或手动多入口配置

### 7.2 package.json scripts

```json
{
  "name": "@shuhai/extension",
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "test": "vitest run",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  }
}
```

### 7.3 依赖

- `react`、`react-dom` — UI
- `@anthropic-ai/sdk` 或直接用 `fetch` 调 DeepSeek — AI 分类
- `@shuhai/shared` — 共享类型
- `@types/chrome` — Chrome Extension API 类型
- `vite`、`@vitejs/plugin-react` — 构建
- `vitest` — 测试

注意：不需要 `better-sqlite3`、`electron`、`p-limit` 等 Node.js 依赖。

## 8. [Minor] 测试策略

Chrome Extension API 在测试环境中不可用，需要 mock：

```typescript
// tests/setup.ts — mock chrome.bookmarks API
globalThis.chrome = {
  bookmarks: {
    getTree: vi.fn(),
    move: vi.fn(),
    create: vi.fn(),
    search: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
} as any;
```

测试覆盖：

- 规则分类引擎（纯逻辑，不需要 mock）
- 分类方案生成（mock chrome.bookmarks.getTree 返回测试数据）
- 备份/恢复逻辑
- 移动执行和撤销
- AI 分类（mock fetch 响应）

═══════════════════════════════════════════
强制约束：
═══════════════════════════════════════════

【网络与代理】

- 所有 git push/pull/fetch 必须加代理：
  git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 push

【供应链安全】

- 安装任何新依赖前必须确认：
  a) 包名拼写正确
  b) 使用精确版本号
  c) 该版本发布时间超过 7 天
  d) 维护者是已知活跃开发者
  e) 不是单人维护 + 创建不足 6 个月的包
- 本 Goal 需要安装的依赖：
  - `@types/chrome` — DefinitelyTyped 官方，Chrome API 类型
  - `react`、`react-dom` — 已有（复用 workspace 版本）
  - `@vitejs/plugin-react` — 已有
  - `vite` — 已有
  - 可能需要 `@crxjs/vite-plugin`（Chrome Extension Vite 插件）— 需确认版本和维护状态

【代码规范】

- TypeScript strict 模式
- 单引号，尾逗号，100 字符行宽
- 不要引入 React import（react-jsx transform）
- 不用的变量用 \_ 前缀
- 不使用 Node.js API（no `node:` imports in extension code）
- 相对导入用 .js 后缀（如果用 ESM）或无后缀（如果 bundler 处理）

【安全】

- API Key 存储在 chrome.storage.local（本 Goal 接受明文，后续 Goal 006 加密）
- 不请求 `<all_urls>` 权限
- 不注入 content script（本 Goal 不需要）
- 不访问任何网页内容
- 分类规则中的正则表达式不能来自用户输入（防止 ReDoS）

【产品边界 — 本 Goal 不做的事】

- 不写 Obsidian
- 不抓网页正文
- 不做 Twitter/Weibo 内容提取
- 不做死链检测（需要网络请求，留给后续 Goal）
- 不做 Native Messaging / Local Companion

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 每完成一个功能后运行：pnpm lint && pnpm typecheck && pnpm test
- 测试失败 → 先修复再继续
- 每个功能一个 commit，commit message 格式：feat: xxx 或 fix: xxx
- push 到远程后继续下一个功能
- 优先级：先做 Setup（0）→ 书签读取（2）→ 分类引擎（3）→ 预览+执行（4-5）→ Settings（6）→ 构建（7）→ 测试（8）

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- @crxjs/vite-plugin 不兼容 Manifest V3 → 手动配置 Vite 多入口
- chrome.bookmarks API mock 困难 → 用 vitest 的 vi.fn() 手动 mock
- packages/shared 去 Node 依赖后 desktop 包编译失败 → desktop 自己 import node:os/node:path
- AI 分类因为没有 API Key 无法测试 → 用 mock 响应，规则分类优先保证可用
- 网络不可用无法 push → 本地 commit，记录待 push

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. 扩展是否能在 Chrome 中成功加载
5. 需要人工介入的事项
