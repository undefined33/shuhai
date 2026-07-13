# ShuHai Chrome Extension 架构 v4

> 状态：目标架构，尚未实施  
> 生效日期：2026-07-13  
> 产品路线：[`product-roadmap-v4.md`](../product-roadmap-v4.md)  
> 历史架构：[`extension-v3.md`](./extension-v3.md)

## 1. 架构目标

v4 只为两个工作流服务：

1. Chrome 书签整理、复核、应用和恢复。
2. 社交平台收藏的用户主动扫描、增量去重和安全入库。

系统必须保持单个 Chrome Extension 安装包。长任务不能依赖 React 局部状态或 service worker 常驻；平台页面、消息、存储、AI 和 Vault 都是独立信任边界。

## 2. 顶层结构

```text
┌────────────────────────────────────────────────────────────┐
│ Chrome Extension                                           │
│                                                            │
│ Toolbar Popup                                              │
│ detect context -> one primary action                       │
│             │                                              │
│             ▼                                              │
│ Side Panel                                                 │
│ bookmark job OR social sync job                            │
│             │ typed command/query                          │
│             ▼                                              │
│ Background Service Worker                                  │
│ orchestrator, reconciliation, permission checks            │
│      │                   │                  │               │
│      ▼                   ▼                  ▼               │
│ IndexedDB          chrome.bookmarks       Vault writer      │
│ jobs/catalog/logs  explicit mutations    File System Access │
│      ▲                                      │               │
│      │ structured untrusted data            │               │
│ Content Scripts / Platform Adapters                         │
│ X bookmarks, Weibo favorites, single-item adapters          │
└────────────────────────────────────────────────────────────┘

External optional boundaries:
  - X official API via explicit OAuth and cost disclosure
  - user-selected AI provider for bookmark suggestions only
```

没有 Electron、SQLite、Native Messaging、daemon、CDP、Puppeteer 或生产 Playwright 抓取。

## 3. 界面职责

### 3.1 Popup

输入：当前 tab URL、支持能力、未完成任务摘要、Vault 权限摘要。

输出：一个明确命令。

- `start_bookmark_review`
- `start_social_sync(source)`
- `capture_single_item(source)`
- `resume_job(job_id)`

Popup 不读取完整书签树或同步目录，不承载进度列表，也不直接执行长循环。

### 3.2 Side Panel

Side Panel 是 foreground job client：

- 显示当前持久化任务，而不是自己拥有任务。
- 订阅 progress event，但重新打开后以 IndexedDB 状态为准。
- 支持暂停、继续、取消、复核和确认写入。
- 一个时刻只显示一个主工作流，避免管理后台式平级导航。

### 3.3 Options Page

- 请求和检查 Vault handle。
- 管理平台可选权限和 OAuth 状态。
- 管理 AI、目录、冲突策略和数据清理。
- 展示操作日志和诊断，但不承担日常任务。

Options Page 必须作为独立构建入口；当前代码尚未实现真正的 `options_ui`，不能继续让 Popup/Side Panel 共用一个超大 `App.tsx` 伪装完成界面分离。

## 4. 领域模块

### 4.1 Bookmark Organizer

```text
bookmark snapshot
  -> deterministic rules
  -> duplicate analysis
  -> optional AI suggestions
  -> optional health verification
  -> review plan
  -> operation journal
  -> chrome.bookmarks mutations
  -> reconciliation / restore
```

分类、重复和健康结果只是建议。所有 mutation 必须重新读取当前 Chrome 状态，防止应用过期快照。

### 4.2 Platform Adapter

建议契约：

```ts
interface PlatformAdapter {
  readonly source: SocialSource;
  readonly version: number;
  readonly hosts: readonly string[];
  detect(url: URL): AdapterCapability;
  enumerate(context: ScanContext): AsyncIterable<AdapterPage>;
  normalize(raw: unknown): SocialItem;
  captureCurrent?(context: CaptureContext): Promise<SocialItem>;
}
```

`AdapterCapability` 必须区分：

- `collection_scan`
- `single_item`
- `longform`
- `thread`
- `media_links`
- `official_api`

Adapter 不直接写存储、Vault、Chrome 书签或调用 AI。它只把平台输入转换为受预算限制的结构化结果。

### 4.3 Social Sync Engine

```text
detect adapter
  -> create/resume SyncJob
  -> enumerate with budgets
  -> validate + normalize SocialItem
  -> SyncCatalog lookup
  -> classify new/existing/changed/incomplete/error
  -> user review
  -> safe Markdown pipeline
  -> VaultWriter
  -> commit SyncRecord per successful file
  -> persist checkpoint and summary
```

SyncCatalog 只能在对应文件成功落盘后记录 `imported`。不能先标记同步成功再写文件。

### 4.4 Safe Content Pipeline

```text
structured SocialItem
  -> size/count/depth budgets
  -> allowlisted HTML sanitize if HTML exists
  -> Markdown conversion
  -> Markdown AST / Obsidian semantic policy
  -> structured YAML serialization
  -> safe relative path
  -> final preview
```

平台原始响应、完整 DOM 和认证材料不进入笔记或长期存储。

### 4.5 Vault Writer

Vault writer 只接受已经校验的 `WriteIntent`：

```ts
interface WriteIntent {
  relativePath: string;
  markdown: string;
  conflictPolicy: 'skip' | 'rename' | 'replace_generated_region';
  expectedExistingHash?: string;
}
```

返回逐文件结构化结果：

```ts
type WriteOutcome =
  | { status: 'created'; relativePath: string; bytes: number }
  | { status: 'already_exists'; relativePath: string }
  | { status: 'changed'; relativePath: string }
  | { status: 'renamed'; relativePath: string; requestedPath: string }
  | { status: 'skipped'; relativePath: string; reason: string }
  | { status: 'error'; relativePath: string; code: string };
```

MVP 不提供任意覆盖。未来若支持更新，只允许更新 ShuHai 明确管理的 generated region，且要验证旧 hash，不能覆盖用户编辑。

## 5. 持久化数据模型

### 5.1 SyncJob

```ts
interface SyncJob {
  id: string;
  version: number;
  source: SocialSource;
  status:
    | 'prepared'
    | 'scanning'
    | 'paused'
    | 'ready_for_review'
    | 'writing'
    | 'partial'
    | 'complete'
    | 'failed'
    | 'cancelled';
  adapterVersion: number;
  createdAt: string;
  updatedAt: string;
  checkpoint?: AdapterCheckpoint;
  budgets: SyncBudgets;
  summary: SyncSummary;
  items: SyncJobItem[];
}
```

状态变化和每个写入结果立即持久化。service worker 重启后先 reconciliation，再继续任务。

### 5.2 SocialItem

```ts
interface SocialItem {
  source: 'x' | 'weibo';
  sourceItemId: string;
  canonicalUrl: string;
  author?: { id?: string; handle?: string; displayName?: string };
  publishedAt?: string;
  title: string;
  text: string;
  quotedItems: SocialItemReference[];
  media: RemoteMediaReference[];
  completeness: 'complete' | 'summary_only' | 'metadata_only' | 'unsupported';
  contentHash: string;
  extractorVersion: number;
}
```

`sourceItemId`、URL、文本和 media 必须经过运行时 schema、格式和长度校验。不得把平台对象直接透传到 UI 或 writer。

### 5.3 SyncRecord

```ts
interface SyncRecord {
  key: string; // `${source}:${sourceItemId}`
  canonicalUrl: string;
  contentHash: string;
  relativePath: string;
  importedAt: string;
  lastSeenAt: string;
  extractorVersion: number;
  completeness: SocialItem['completeness'];
}
```

IndexedDB 是查询索引，Vault properties 是可重建证据。两者不一致时停止自动覆盖，进入 reconciliation。

### 5.4 BookmarkOperation

Goal 032 已实现的候选 operation journal 不删除。恢复时需重新审计状态机、payload identity、partial 和 conflict 语义，再决定哪些代码进入 v4。

## 6. 去重算法

1. 使用 `source + sourceItemId` 查 SyncCatalog。
2. 若平台 ID 缺失，尝试经过 adapter 规范化的 canonical URL。
3. 只有前两者不可用时才用内容 hash，且标记低置信度。
4. Catalog 命中后核对 Vault 文件是否仍存在。
5. 文件不存在时标记 `catalog_orphan`，不盲目跳过或重建。
6. 文件存在但 hash 变化时标记 `changed`；默认不覆盖。
7. 首次接管旧 Vault 时只扫描配置的 ShuHai 目录，读取受限大小的 frontmatter。

文件名、标题和作者不是身份字段。

## 7. 长任务与 MV3 生命周期

Chrome MV3 service worker 可能在空闲 30 秒、单个活动过长或 fetch 超时后终止，因此：

- 不用全局变量保存 cursor、进度和结果。
- 每页枚举后保存 checkpoint；每条写入后保存 outcome。
- Side Panel 的长连接只用于实时反馈，不作为持久性保证。
- 恢复任务前检查 tab、URL、adapter version、权限和当前页面状态。
- 不能恢复时进入 `paused` 或 `failed`，不能从头静默重跑。
- 同一 source 同时只运行一个 sync job，避免重复写入。

## 8. 平台访问策略

### 8.1 官方 API 模式

只有平台公开、授权和成本可接受时采用：

- OAuth 由平台官方流程完成。
- token 不发送给 AI，也不进入日志、诊断或页面 content script。
- 请求字段最小化，遵循 rate limit 和用量预算。
- 401/403/429 和计费不足是 typed error，不自动降级到私有接口。

### 8.2 用户主动页面扫描模式

- 用户必须位于官方收藏页并主动点击。
- Content script 默认运行在 isolated world。
- 只读取浏览器已渲染或平台公开暴露给当前页面的数据。
- 自动滚动必须有可见进度、节流、条目/时间上限和取消。
- 不读取 Cookie API、localStorage token、Authorization header 或页面私有 bearer。
- 不绕过虚拟列表、CAPTCHA、登录挑战或站点风控。

若在这些约束下无法稳定枚举，adapter 必须返回 `NO_GO`，而不是扩大权限。

## 9. 信任边界与安全控制

| 边界                      | 主要风险                                       | 必须控制                                                      |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| 页面 -> content script    | 恶意 DOM、选择器欺骗、超大内容、原型污染       | isolated world、预算、纯数据提取、运行时 schema               |
| content -> service worker | 伪造 message、任意 URL/命令、越权动作          | sender/tab/host 校验、命令 allowlist、schema、不可传函数      |
| 平台网络 -> adapter       | 认证泄露、429、私有接口变化、恶意 JSON         | 官方接口优先、字段白名单、限流、typed error、无凭据日志       |
| AI Provider               | 提示词注入、隐私外发、恶意结构化结果           | 默认不用、最小字段、数据隔离、schema、只生成建议              |
| Markdown -> Obsidian      | YAML 注入、JS URL、raw HTML、模板/插件执行语法 | serializer、AST policy、scheme allowlist、语法中和            |
| Vault                     | 路径穿越、覆盖、权限失效、部分写入             | 安全相对路径、默认 skip、逐文件结果、checkpoint               |
| Chrome bookmarks          | 误删、过期快照、部分成功                       | 二次读取、显式确认、operation journal、reconciliation/restore |
| storage/import            | schema 漂移、损坏、超大数据、旧版本            | 版本化 schema、迁移、大小限制、fail closed                    |

### 9.1 远程媒体

MVP 只存储经过 scheme 和 host 解析的媒体 URL，并默认渲染为普通文本链接。不得生成会在打开笔记时自动请求远端的 Markdown image/embed。未来本地下载需要独立 Goal，包含 MIME、大小、重定向、域名、文件名和恶意文件策略。

### 9.2 安全研究内容

帖子中的 shell、PowerShell、HTML、JavaScript 和攻击 payload 可以作为研究文本保留，但必须处于惰性文本或安全代码块中。必须中和 Obsidian/插件可执行语法，且 UI 明确“来源内容不可信”；不得把内容交给本地命令、agent、模板引擎或浏览器执行。

## 10. 现有代码映射

| 当前模块                                    | v4 处理                                                       |
| ------------------------------------------- | ------------------------------------------------------------- |
| `content/twitter.ts`、`content/weibo.ts`    | 保留单条提取能力；拆分 adapter 契约后迁移，不直接扩成全量循环 |
| `content/article.ts`                        | 降级为辅助单篇保存；安全管线 spike 后决定是否保留自研转换     |
| `background/service-worker.ts`              | 保留事件入口；拆出 bookmark/social job services，停止继续膨胀 |
| `utils/storage.ts`                          | 设置保留；任务、catalog、operation 迁入版本化 IndexedDB       |
| `utils/vault-writer.ts`                     | 保留 File System handle；重写冲突和逐文件结果语义             |
| `utils/markdown-generator.ts`/`sanitize.ts` | 作为基线 fixture；通过安全 spike 决定迁移，不直接宣称安全完备 |
| `utils/bookmark-operations.ts`              | 冻结为 v4 候选安全基础，独立 review 后复用                    |
| `popup/App.tsx`                             | 拆分 Popup、Side Panel 和 Options，不再共享整棵应用状态       |
| `pages/CollectionPage.tsx`                  | 队列不再是默认流程；可复用为批量 review 的局部组件            |
| `pages/HealthPage.tsx`                      | 进入书签整理内部步骤，不再是平级产品页面                      |
| `packages/shared`                           | 只保留真正跨包模型；扩展专属消息和 adapter 类型留在 extension |

### 10.1 计划新增的逻辑边界

以下是架构建议，不是当前文件写入授权：

```text
src/social/
  adapters/types.ts
  adapters/x-bookmarks.ts
  adapters/weibo-favorites.ts
  sync-engine.ts
  sync-catalog.ts
  sync-schema.ts
  sync-errors.ts
src/jobs/
  job-store.ts
  job-reconciler.ts
src/vault/
  safe-markdown.ts
  vault-index.ts
  vault-writer.ts
src/surfaces/
  popup/
  sidepanel/
  options/
```

真正实施前应依据现有目录风格重新确认文件清单，避免为了架构图进行无价值搬家。

## 11. 测试与验收架构

### Adapter fixture

- X/微博正常收藏页、空页、未登录、虚拟列表、长文、引用、媒体、删除内容。
- 选择器变化、恶意文本、超大文本、海量媒体、重复 ID 和畸形 URL。
- Fixture 必须脱敏，不保存 Cookie、真实私密 URL 或完整私人收藏正文。

### Job 与 catalog

- service worker 在扫描中、写入前和写入后中断。
- 同一 job 重试不重复写入。
- catalog 存在但文件缺失、文件存在但 catalog 缺失。
- adapter 版本变化后的 reconciliation。
- 100、1,000、10,000 条记录的内存和时间预算。

### Vault

- 已存在、改名、权限失效、空间不足、非法路径和部分失败。
- YAML、模板语法、JS URL、raw HTML、Obsidian embed 和远程媒体攻击 fixture。
- 不覆盖用户编辑和不因源删除而删除本地笔记。

### 用户旅程

1. 普通页面点击一次进入书签整理，复核后应用并恢复。
2. X 收藏页首次同步，关闭 Side Panel 后继续，只写新增项。
3. 微博收藏页增量同步，已存在跳过，不完整内容明确标记。
4. 权限失效、429、选择器变化和 Vault 冲突均有可执行下一步。

## 12. 架构门禁

- 本文不授权任何生产代码修改。
- Goal 041 通过前，不承诺 X/微博全量枚举方式。
- Goal 042 通过前，不把现有待保存队列扩成同步目录。
- 不以“能抓到一次”代替稳定 ID、停止条件、条款、限流和安全证明。
- 任一平台需要凭据抓取、私有 API 绕过或第二安装包时，先回到产品决策，不暗中扩大架构。
