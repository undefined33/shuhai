# Goal 008: 当前页面文章保存 + 导出文案修正

> **历史 Goal，不得直接执行。** 当前保存流程方向见 [`../product-roadmap-v3.md`](../product-roadmap-v3.md)。

实现"用户正在看的文章 → 一键提取正文 → 保存为 Markdown 到 Obsidian"。
同时修正导出页面的文案，明确区分"书签索引导出"和"文章内容保存"。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过（测试数不能减少，当前 54）
2. pnpm --filter @shuhai/extension run build 成功
3. 用户在任意文章页面右键"保存此文章到知识库"，能提取正文并写入 vault
4. 导出页面文案明确区分"书签索引"和"文章内容"两种导出
5. 提取的文章内容经过完整的 Obsidian 安全消毒
6. 远程图片不使用 `![]()` 语法（防止 IP 泄露）
7. 所有新代码有对应的单元测试

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/chrome-extension
当前状态：

- Goal 004-007 已完成
- Twitter/Weibo Content Script 已能提取社交内容
- 但普通网页文章正文提取还没有
- 用户体验反馈：以为"导出"是导出文章全文，实际只是书签链接索引
- 需要明确两种能力的区别

用户身份：安全研究员，浏览的页面可能包含恶意内容。

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 1. [Critical] 导出页面文案修正

当前问题：导出页写着"导出到 Obsidian Vault"，用户误以为是全文导出。

修改：

- 标题改为："导出书签索引到 Obsidian"
- 副标题说明："为每个书签生成一个 .md 索引文件（标题、链接、分类、标签），不抓取网页正文。"
- 在导出按钮旁添加 tooltip："只导出书签元数据，不访问网页内容"
- 新增一个独立区域："保存文章内容"，引导用户使用右键菜单保存当前页面

## 2. [Critical] 通用网页文章正文提取

### 2.1 新建 Content Script

新建 `src/content/article.ts`：

这个 Content Script 注入到所有页面（但只在用户主动触发时执行），
从当前页面 DOM 提取文章正文。

提取策略（不引入外部依赖，纯 DOM 操作）：

```typescript
function extractArticle(doc: Document): ArticleContent {
  // 策略 1: <article> 标签
  const article = doc.querySelector('article');
  if (article) return extractFromElement(article);

  // 策略 2: role="main" 或 id="content" / class="content"
  const main = doc.querySelector(
    '[role="main"], main, #content, .content, .post-content, .article-content, .entry-content',
  );
  if (main) return extractFromElement(main);

  // 策略 3: 最大文本密度的 div（简化版 Readability）
  return extractByTextDensity(doc.body);
}

function extractFromElement(element: Element): ArticleContent {
  // 移除 script, style, nav, header, footer, aside, iframe
  // 保留 p, h1-h6, ul, ol, li, blockquote, pre, code, table, a, img
  // 转换为 Markdown
}
```

### 2.2 DOM → Markdown 转换（纯 JS，无外部依赖）

不引入 turndown/readability 等外部库（供应链安全 + 扩展体积考虑）。
自己实现轻量 DOM → Markdown 转换：

````typescript
function domToMarkdown(element: Element, baseUrl: string): string {
  // 递归遍历 DOM 节点
  // <h1> → #
  // <h2> → ##
  // <p> → 段落 + 空行
  // <a href="..."> → [text](url)
  // <img src="..."> → [图片: alt](url)  ← 不用 ![]() 语法
  // <pre><code> → ```\n...\n```
  // <ul><li> → - item
  // <ol><li> → 1. item
  // <blockquote> → > text
  // <table> → GFM 表格
  // <strong> → **text**
  // <em> → *text*
  // 其他 → textContent
}
````

关键安全规则：

- `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>` → 完全跳过
- `<img>` → `[图片: alt](url)` 纯文本链接，不用 `![]()`
- `<a href="javascript:...">` → 移除 href
- 相对 URL → 转为绝对 URL（基于 `baseUrl`）
- `data:` URI → 跳过
- `file://` → 跳过

### 2.3 manifest.json 更新

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["content/article.js"],
    "run_at": "document_idle",
    "match_about_blank": false
  },
  // ... 现有 twitter/weibo scripts
]
```

注意：虽然声明 `<all_urls>`，但 Content Script 只在收到消息时才执行提取。
不会自动在每个页面运行提取逻辑。

或者更保守的方案：不用 `<all_urls>`，改用 `activeTab` 权限 + `chrome.scripting.executeScript()` 动态注入：

```json
"permissions": ["bookmarks", "storage", "contextMenus", "sidePanel", "activeTab", "scripting"]
```

这样不需要声明 host_permissions 对所有网站，只在用户点击时临时获取当前 tab 权限。
**推荐这个方案**，权限更小。

### 2.4 右键菜单

添加通用的"保存此文章"右键菜单项：

```typescript
chrome.contextMenus.create({
  id: 'shuhai-save-article',
  title: '保存此文章到知识库',
  contexts: ['page'],
  // 不限制 documentUrlPatterns，任何页面都可以
});
```

触发流程：

1. 用户在文章页面右键 → "保存此文章到知识库"
2. Background 用 `chrome.scripting.executeScript()` 注入提取脚本到当前 tab
3. 脚本提取正文 → 返回 `CapturedContent`
4. 存入 `pendingCapture`
5. 打开 side panel 或 popup 的导出页，显示预览
6. 用户确认 → 写入 vault

### 2.5 提取结果格式

```typescript
interface CapturedContent {
  id: string;
  source: 'twitter' | 'weibo' | 'article'; // 新增 'article'
  title: string;
  url: string;
  author?: string;
  handle?: string;
  created?: string;
  text: string; // Markdown 格式的正文
  media: CapturedMedia[];
  tags: string[];
  capturedAt: string;
  siteName?: string; // 新增：网站名称（从 meta 提取）
  description?: string; // 新增：文章摘要（从 meta 提取）
  wordCount?: number; // 新增：字数统计
}
```

## 3. [Critical] 文章保存的 Markdown 输出格式

````markdown
---
title: '深入理解 Linux eBPF'
url: 'https://example.com/ebpf-deep-dive'
source: article
site: 'Example Blog'
author: '张三'
created: 2026-05-15
saved: 2026-05-28
tags: [Linux, eBPF, 安全]
word_count: 3500
shuhai_format: 2
---

# 深入理解 Linux eBPF

> 来源: [Example Blog](https://example.com/ebpf-deep-dive)
> 作者: 张三 · 保存时间: 2026-05-28

---

（提取的文章正文，Markdown 格式）

## 第一节标题

正文内容...

代码示例：

```c
int main() { ... }
```
````

[图片: eBPF 架构图](https://example.com/images/ebpf.png)

---

## 笔记

````

## 4. [Critical] 安全消毒（文章内容）

文章正文比书签标题复杂得多，消毒必须更严格。

### 4.1 DOM 提取阶段消毒

在 `extractFromElement` 中：
- 完全移除：`<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, `<button>`, `<applet>`, `<link>`, `<meta>`
- 移除所有 `on*` 事件属性
- 移除 `<base>` 标签
- `<a href="javascript:...">` → 移除 href
- `<a href="data:...">` → 移除 href
- `<svg>` 中的 `<script>` 和事件属性 → 移除

### 4.2 Markdown 生成后消毒

复用现有 `sanitize.ts` 逻辑，额外处理：
- `<% %>` Templater → 转义为 `\<% %\>`
- `{{ }}` → 转义为 `\{\{ \}\}`
- ` ```dataview ` / ` ```dataviewjs ` → 改为 ` ```text `
- `obsidian://` → `obsidian-disabled://`
- `![[` → `\!\[\[`
- 未闭合的代码块 → 强制闭合
- 代码块语言标记 `dataview`/`dataviewjs`/`templater` → `text`
- 超长单行（>10000 字符无换行）→ 截断

### 4.3 图片处理

- 所有 `<img>` → `[图片: alt-text](absolute-url)` 纯文本链接
- 不使用 `![]()` 语法（Obsidian 会自动加载远程图片，泄露 IP）
- `data:` URI 图片 → 跳过（可能含 SVG XSS）
- `file://` 图片 → 跳过
- 只保留 `http://` 和 `https://` 协议

### 4.4 内容大小限制

- 单篇文章最大 500KB Markdown（超过截断并标注"内容已截断"）
- 单个代码块最大 50KB（超过截断）
- 图片引用最多 50 个

## 5. [Major] 导出页面 UI 重构

将导出页面分为两个明确的区域：

````

┌─────────────────────────────────────────┐
│ 知识库管理 │
├─────────────────────────────────────────┤
│ │
│ 📂 Vault: /path/to/obsidian [更换] │
│ │
│ ┌─────────────────────────────────┐ │
│ │ 📑 导出书签索引 │ │
│ │ 为每个书签生成 .md 索引文件 │ │
│ │ （标题、链接、分类，不抓网页） │ │
│ │ │ │
│ │ [导出全部] [导出选中分类] │ │
│ └─────────────────────────────────┘ │
│ │
│ ┌─────────────────────────────────┐ │
│ │ 📄 已保存的文章 (3) │ │
│ │ │ │
│ │ • 深入理解 eBPF (article) │ │
│ │ • @hacker - APT分析 (twitter) │ │
│ │ • 微博安全研究 (weibo) │ │
│ │ │ │
│ │ [写入 Vault] [预览] [清除] │ │
│ └─────────────────────────────────┘ │
│ │
│ 💡 在任意网页右键"保存此文章"可提取正文 │
│ │
└─────────────────────────────────────────┘

````

### 5.1 两种导出明确分开

- **书签索引导出**：批量操作，为书签生成元数据 .md
- **文章内容保存**：单篇操作，保存用户主动提取的文章正文

### 5.2 待保存队列

- 用户可以连续在多个页面右键"保存"
- 每次保存的内容进入 `pendingCaptures` 队列（复数）
- 导出页显示队列列表
- 用户可以预览、编辑标签、选择性写入 vault
- 写入后从队列移除

修改 `ExtensionState`：
```typescript
interface ExtensionState {
  // ...
  pendingCaptures: CapturedContent[];  // 改为数组（之前是单个 pendingCapture）
}
````

## 6. [Major] 文章提取质量优化

### 6.1 Meta 信息提取

从页面 `<head>` 提取辅助信息：

```typescript
function extractMeta(doc: Document): ArticleMeta {
  return {
    title:
      doc.querySelector('meta[property="og:title"]')?.content ??
      doc.querySelector('title')?.textContent ??
      '',
    author:
      doc.querySelector('meta[name="author"]')?.content ??
      doc.querySelector('meta[property="article:author"]')?.content,
    siteName: doc.querySelector('meta[property="og:site_name"]')?.content,
    description:
      doc.querySelector('meta[name="description"]')?.content ??
      doc.querySelector('meta[property="og:description"]')?.content,
    publishedTime: doc.querySelector('meta[property="article:published_time"]')?.content,
  };
}
```

### 6.2 文本密度算法（简化版 Readability）

当没有明确的 `<article>` 或 `main` 标签时，用文本密度找正文区域：

```typescript
function extractByTextDensity(body: Element): ArticleContent {
  // 1. 遍历所有 block 级元素
  // 2. 计算每个元素的 textContent.length / innerHTML.length 比值
  // 3. 找到文本密度最高且文本量足够的连续区域
  // 4. 合并为正文
}
```

这不需要完美——大多数博客/文章页面有 `<article>` 标签。
文本密度只是 fallback。

### 6.3 特殊站点适配

对常见技术博客做简单适配（通过 URL 判断）：

- `medium.com` → `article` 标签
- `dev.to` → `.crayons-article__body`
- `zhihu.com` → `.RichContent`
- `github.com` → `.markdown-body`（README/Issue）
- `notion.site` → `.notion-page-content`

这些只是 CSS 选择器提示，不是硬编码依赖。如果选择器失效，fallback 到通用策略。

## 7. [Minor] 保存确认预览

用户右键保存后，在 side panel 显示预览：

```
┌─────────────────────────────────────────┐
│  已提取文章内容                           │
├─────────────────────────────────────────┤
│  标题: 深入理解 Linux eBPF               │
│  来源: example.com                       │
│  字数: ~3500                             │
│  图片: 5 个（纯链接，不自动加载）         │
│                                          │
│  预览：                                  │
│  ┌─────────────────────────────────┐    │
│  │ # 深入理解 Linux eBPF            │    │
│  │                                   │    │
│  │ eBPF 是 Linux 内核中的...         │    │
│  │ ...                               │    │
│  └─────────────────────────────────┘    │
│                                          │
│  标签: [Linux] [eBPF] [+添加]           │
│  保存到: Bookmarks/文章/                 │
│                                          │
│  [保存到 Vault] [放弃]                   │
└─────────────────────────────────────────┘
```

═══════════════════════════════════════════
强制约束：
═══════════════════════════════════════════

【网络与代理】

- 所有 git push/pull/fetch 必须加代理：
  git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 push

【供应链安全】

- 本 Goal 不引入新 npm 依赖
- DOM → Markdown 转换自己实现（不用 turndown/readability）
- 原因：减少供应链风险 + 扩展体积 + 我们只需要轻量转换

【代码规范】

- TypeScript strict 模式
- 单引号，尾逗号，100 字符行宽
- 不要引入 React import
- Tailwind 类名按逻辑分组

【安全 — 本 Goal 最高优先级】

- Content Script 只在用户主动触发时执行（右键菜单 / 按钮点击）
- 只读 DOM textContent 和安全属性，不执行页面 JS
- 提取的内容写入 vault 前必须经过完整消毒
- 图片不用 `![]()` 语法
- 所有 Obsidian 可执行语法必须中和
- 代码块中的内容保留原样（代码块内安全）但确保正确闭合
- 不访问任何外部 URL（只读当前已加载的 DOM）
- 使用 `activeTab` + `scripting` 权限动态注入，不声明 `<all_urls>`

【产品边界】

- 只保存用户当前正在看的页面（不批量抓取）
- 不做后台自动保存
- 不做"保存所有书签对应的网页"
- 每次保存都需要用户主动触发 + 确认

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 优先级：文案修正（1）→ 文章提取（2-3）→ 安全消毒（4）→ UI 重构（5）→ 质量优化（6）→ 预览（7）
- 每完成一个功能后运行：pnpm lint && pnpm typecheck && pnpm test
- 每个功能一个 commit
- push 到远程后继续

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- `chrome.scripting.executeScript` 权限问题 → 改用声明式 content_scripts + message 触发
- 某些页面 DOM 结构特殊导致提取失败 → 优雅降级为只保存标题+URL+页面前 500 字
- 文本密度算法效果不好 → 先只支持有 `<article>` 标签的页面，其他页面提示"无法提取正文"
- 网络不可用无法 push → 本地 commit

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. 文章提取在哪些类型的页面上测试通过
5. 需要人工介入的事项
