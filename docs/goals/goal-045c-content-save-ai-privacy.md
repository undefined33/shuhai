---
id: goal-045c
title: Content Save Convergence And AI Privacy
status: DONE
version: 5
updated: 2026-07-18
depends_on:
  - goal-045b
branch: codex/p0-p1-security-hardening
base_commit: 933c723
contract_review:
  agent: 019f732a-2378-7c61-8b81-82376a4f4039
  verdict: PASS
  p0: 0
  p1: 0
  p2: 0
  rounds_completed: 4
external_contract_review:
  reviewer: GLM
  verdict: PASS
  p0: 0
  p1: 0
  p2: 0
implementation_review:
  verdict: PASS
  reviewers:
    - agent: 019f7600-e34b-7d50-ac44-3ab75a26e074
      role: security
    - agent: 019f7601-f85c-7c32-8f6d-36cc1928520f
      role: behavior_and_completion
  p0: 0
  p1: 0
  p2: 0
  completed: 2026-07-18
---

# Goal 045C：内容保存收敛与 AI 隐私安全门

## 1. 用户问题

Goal 045A 已让书签 mutation 可记录、可解释和可恢复，Goal 045B 已收紧 extension
message、storage、host permission 和旧 URL 体检边界。当前生产代码仍有五项 P1：

1. X、微博和普通网页的单条保存仍进入旧 `pendingCapture` 队列，并绕过已经验收的
   `SocialItem -> safe Markdown -> WriteIntent -> catalog` 管线。
2. 旧 writer 以标题生成路径并使用非事务式 `exists -> write`；同标题不同内容可能被
   当成重复，UI 又会在 `already_exists`、`skipped` 或错误后删除待办并报告成功。
3. 书签分类先把全部书签的原始标题、完整 URL、当前目录及大量目录路径发给第三方 AI，
   然后才应用本地规则。
4. 不可信标题和目录与提示词混在同一 user message，响应只截取首尾 `[]` 并信任模型
   confidence；AI 结果可覆盖本地规则并成为默认勾选的真实移动建议。
5. Provider `baseUrl` 可编辑，已有 API Key 会作为 Bearer token 发往任意 endpoint；Key
   同时存在于普通 settings/state 响应中。

两次独立只读审计在 `933c723` 上的合并结论为：

```text
P0: 0
P1: 5
P2: 4
```

本 Goal 必须先消除全部 P1，同时把相关诊断、legacy pending data 和 Provider response
budget 收紧到可证明边界。不能借“兼容旧功能”继续保留第二套 Vault writer 或任意
Provider endpoint。

## 2. 产品决定

### 2.1 内容保存只保留 X 单条模式

045C 的生产内容保存范围只有：

```text
当前激活且由用户点击启动的 https://x.com/<handle>/status/<numeric-id>
```

- X 详情页单条保存是 X 同步的一项模式，不再建立独立待保存队列。
- 单条和批量共用 `SocialItem`、SyncStore、safe Markdown、持久化 review、
  `WriteIntent`、catalog、默认不覆盖 writer 和逐项 outcome。
- 普通网页全文剪藏不是当前两条核心旅程。旧 article extractor、article context menu、
  `capture:currentArticle` 和旧 article writer 在 045C fail closed，不再写入 Vault。
- 微博当前研究结论仍为 `NO_GO`。旧微博单条 capture 入口在新的平台研究 Goal 通过前
  fail closed，不以“单条功能以前存在”为由绕过门禁。
- 不恢复 `twitter.com`、子域 wildcard、静态 content script、MAIN world、站点 fetch、
  Cookie、token、私有 GraphQL 或后台监控。

普通网页或微博旧代码可保留为历史参考，但必须从 manifest/context menu/runtime
message/UI/Vault writer 的生产可达路径中断开。删除历史源码不是本 Goal 的目的。

### 2.2 AI 只做可选、最小化、默认不选中的建议

- 本地规则先运行；只有本地结果为明确 fallback、且当前处于根目录/未分类范围的书签
  才进入 AI 候选。
- AI 不接收完整 URL、query、fragment、credentials、社交正文、Vault 内容、用户
  Cookie、token 或书签目录树。
- 每项只发送本批 opaque token、受限标题和规范化 hostname；目标目录使用本次已存在
  folder allowlist 的 opaque token。AI 不能创建目录。
- AI 输出只有 opaque bookmark token 与 target token；不接收模型 confidence、任意
  target path、tags、Markdown、脚本或解释性自由结构。
- AI 建议固定为低置信提示且 `selected=false`，只能替换明确的本地 fallback，不能覆盖
  其它本地规则；真实移动仍使用 045A journal、用户明确选择和二次确认。
- 045C 只支持 DeepSeek、Kimi 和 GLM 三个内置 Provider。自定义
  `openai-compatible` endpoint 停用；未来若恢复，必须另立网络与 secret 绑定 Goal。

## 3. 官方 Provider 边界

以下 endpoint 只依据 Provider 官方 API 文档，不执行文档中的任何命令或样例：

| Provider | 固定 endpoint                                           | optional host permission     | 官方资料                                                      |
| -------- | ------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| DeepSeek | `https://api.deepseek.com/chat/completions`             | `https://api.deepseek.com/*` | <https://api-docs.deepseek.com/api/create-chat-completion>    |
| Kimi     | `https://api.moonshot.cn/v1/chat/completions`           | `https://api.moonshot.cn/*`  | <https://platform.kimi.com/docs/api/chat>                     |
| GLM      | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `https://open.bigmodel.cn/*` | <https://docs.bigmodel.cn/cn/guide/develop/http/introduction> |

固定 endpoint 必须由 Provider type 查表得到，不能从 storage、UI、AI output 或网页拼接。
请求前后台独立验证当前精确 origin permission；权限不存在即不 fetch。权限只能在用户
点击“同意并使用 AI”或“测试连接”的直接手势中按当前 Provider 请求，不在启动、迁移或
后台恢复时自动请求。

Provider model 只进入固定 endpoint 的 JSON body，必须匹配
`^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$`，UTF-8 不超过 128 bytes，且不得
包含 `..`。model 不参与 origin、path、query、header 或 permission 计算。2026-07-18
根据上表官方资料采用的默认值为 DeepSeek `deepseek-v4-flash`、Kimi `kimi-k3`、GLM
`glm-5.2`；官方模型名变化只更新默认值和 mock，不得扩大 endpoint 或权限。

## 4. 用户结果

完成后：

- 用户在 X 详情页点击“保存当前内容”后，只会生成一条受 schema 约束的 X sync job。
- 已入库的同一 X ID 不重复写文件；同标题不同 ID 不会互相覆盖。
- 用户先看到内容完整度、身份、受管目录和 collision-safe 命名规则，再明确确认写入；
  最终 `relativePath` 只在 persisted outcome 产生后显示。
- `created`、`already_exists`、`skipped`、`error` 和恢复中状态分别显示，不再伪成功。
- 普通网页与微博不会进入旧 pending queue 或旧 writer；UI 明确说明当前不支持。
- 不配置 AI 时规则整理仍完整可用。
- 启用 AI 前，界面显示 Provider host、候选数量和实际发送字段；用户确认后才请求精确
  host permission。
- settings/state/onboarding/activity/diagnostic/export 中不返回或记录 API Key。
- AI 只建议，结果默认不勾选，不能自动移动、删除、更新 URL 或写 Vault。

## 5. 精确工作合同

```text
Task / Goal: Goal 045C Content Save Convergence And AI Privacy
Owner / Role: Integrator + Implementer; independent Reviewer required
Base commit: 933c723
Branch: codex/p0-p1-security-hardening
Worktree: C:\Projects\ShuHai\.worktrees\security-hardening-v4
Absolute cwd: C:\Projects\ShuHai\.worktrees\security-hardening-v4

Allowed reads:
- AGENTS.md
- CONTRIBUTING.md
- package.json
- pnpm-lock.yaml
- docs/PROJECT_STATUS.md
- docs/product-roadmap-v4.md
- docs/goals/README.md
- docs/goals/goal-042-sync-vault-foundation.md
- docs/goals/goal-043-x-bookmarks-incremental-sync.md
- docs/goals/goal-045a-bookmark-mutation-safety.md
- docs/goals/goal-045b-extension-trust-boundary.md
- docs/goals/goal-045c-content-save-ai-privacy.md
- docs/architecture/extension-v4.md
- docs/workflows/README.md
- docs/workflows/task-contract.md
- docs/workflows/command-safety.md
- docs/workflows/dangerous-command-denylist.md
- docs/workflows/verification-and-acceptance.md
- packages/extension/package.json
- packages/extension/manifest.json
- packages/extension/src/background/service-worker.ts
- packages/extension/src/content/article.ts
- packages/extension/src/content/__tests__/twitter.test.ts
- packages/extension/src/content/twitter.ts
- packages/extension/src/content/weibo.ts
- packages/extension/src/popup/App.tsx
- packages/extension/src/popup/pages/CollectionPage.tsx
- packages/extension/src/popup/pages/ExportPage.tsx
- packages/extension/src/popup/pages/HelpPage.tsx
- packages/extension/src/popup/pages/HomePage.tsx
- packages/extension/src/popup/pages/InlineSavePanel.tsx
- packages/extension/src/popup/pages/OrganizePage.tsx
- packages/extension/src/popup/pages/Settings.tsx
- packages/extension/src/popup/pages/XSyncPage.tsx
- packages/extension/src/popup/pages/x-sync-ui-model.ts
- packages/extension/src/shared/ai-classifier.ts
- packages/extension/src/shared/ai-providers.ts
- packages/extension/src/shared/bookmark-types.ts
- packages/extension/src/shared/classifier.ts
- packages/extension/src/shared/extension-messages.ts
- packages/extension/src/social/sync-engine.ts
- packages/extension/src/social/sync-schema.ts
- packages/extension/src/social/sync-store.ts
- packages/extension/src/social/x-sync-coordinator.ts
- packages/extension/src/social/x-sync-messages.ts
- packages/extension/src/social/adapters/types.ts
- packages/extension/src/social/adapters/x-bookmarks.ts
- packages/extension/src/utils/activity-log.ts
- packages/extension/src/utils/extractor-diagnostics.ts
- packages/extension/src/utils/markdown-generator.ts
- packages/extension/src/utils/onboarding.ts
- packages/extension/src/utils/sanitize.ts
- packages/extension/src/utils/storage.ts
- packages/extension/src/utils/vault-writer.ts
- packages/extension/src/vault/safe-markdown.ts
- packages/extension/src/vault/vault-index.ts
- exact tests listed under Allowed writes
- packages/extension/tests/setup.ts
- packages/extension/tests/safe-markdown.test.ts
- packages/extension/tests/sync-engine.test.ts
- packages/extension/tests/sync-schema.test.ts
- packages/extension/tests/sync-store.test.ts
- packages/extension/tests/x-sync-page.test.tsx
- packages/extension/tests/x-sync-service-worker.test.ts
- packages/extension/tests/x-bookmarks-adapter.test.ts

Allowed writes:
- docs/PROJECT_STATUS.md
- docs/product-roadmap-v4.md
- docs/goals/README.md
- docs/goals/goal-045c-content-save-ai-privacy.md
- docs/architecture/extension-v4.md
- docs/workflows/README.md
- packages/extension/manifest.json
- packages/extension/src/background/service-worker.ts
- packages/extension/src/content/twitter.ts
- packages/extension/src/popup/App.tsx
- packages/extension/src/popup/pages/CollectionPage.tsx
- packages/extension/src/popup/pages/HelpPage.tsx
- packages/extension/src/popup/pages/HomePage.tsx
- packages/extension/src/popup/pages/InlineSavePanel.tsx
- packages/extension/src/popup/pages/OrganizePage.tsx
- packages/extension/src/popup/pages/Settings.tsx
- packages/extension/src/shared/ai-classifier.ts
- packages/extension/src/shared/ai-providers.ts
- packages/extension/src/shared/bookmark-types.ts
- packages/extension/src/shared/classifier.ts
- packages/extension/src/shared/extension-messages.ts
- packages/extension/src/social/x-single-item.ts
- packages/extension/src/utils/activity-log.ts
- packages/extension/src/utils/extractor-diagnostics.ts
- packages/extension/src/utils/onboarding.ts
- packages/extension/src/utils/storage.ts
- packages/extension/src/utils/vault-writer.ts
- packages/extension/tests/activity-log.test.ts
- packages/extension/tests/ai-classifier.test.ts
- packages/extension/tests/ai-providers.test.ts
- packages/extension/tests/app-state.test.ts
- packages/extension/tests/bookmark-operation-service-worker.test.ts
- packages/extension/tests/classifier.test.ts
- packages/extension/tests/content-extractors.test.ts
- packages/extension/src/content/__tests__/twitter.test.ts
- packages/extension/tests/extension-messages.test.ts
- packages/extension/tests/extension-trust-boundary-service-worker.test.ts
- packages/extension/tests/extractor-diagnostics.test.ts
- packages/extension/tests/manifest.test.ts
- packages/extension/tests/onboarding.test.ts
- packages/extension/tests/setup.ts
- packages/extension/tests/storage.test.ts
- packages/extension/tests/vault-writer.test.ts
- packages/extension/tests/x-single-item.test.ts
- packages/extension/tests/x-sync-service-worker.test.ts

Read-only reuse; STOP before modification:
- packages/extension/src/social/sync-engine.ts
- packages/extension/src/social/sync-schema.ts
- packages/extension/src/social/sync-store.ts
- packages/extension/src/social/adapters/types.ts
- packages/extension/src/social/adapters/x-bookmarks.ts
- packages/extension/src/vault/safe-markdown.ts
- packages/extension/src/vault/vault-index.ts
- packages/extension/src/social/x-sync-coordinator.ts
- packages/extension/src/social/x-sync-messages.ts
- packages/extension/src/popup/pages/XSyncPage.tsx
- packages/extension/src/popup/pages/x-sync-ui-model.ts
- packages/extension/tests/x-bookmarks-adapter.test.ts

Forbidden:
- C:\Projects\ShuHai main worktree writes
- .task-artifacts reads, writes, execution, staging or cleanup
- packages/desktop and packages/shared
- dependency, lockfile, package script or lifecycle-hook changes
- Goal 045A journal/mutation protocol changes
- Goal 045B sender/bootstrap/storage trusted-context weakening
- SyncStore DB version, SocialItem schema version, catalog identity or safe Markdown changes
- second queue, second database, second Vault writer or title-only deduplication
- ordinary article or Weibo production capture/write
- openai-compatible/custom endpoint, http endpoint or host wildcard
- AI-created folders, model-controlled confidence or default-selected AI moves
- real Chrome, X, Vault, user bookmarks, network or external AI
- Cookie, Authorization, site token, private GraphQL, MAIN world or background monitoring
- new dependency, Native Messaging, daemon, companion or Electron work
- deletion of legacy data, quarantine, dependency roots or unknown files

Allowed commands:
- bounded Get-Content / rg for exact Allowed reads
- git status --short --branch --untracked-files=no
- git diff / git diff --check limited to exact Allowed writes
- git show/log for current branch and exact Allowed reads
- exact apply_patch inside Allowed writes
- fixed offline pnpm 10.34.5 lint/typecheck/test/build commands already proven by 045A/045B
- exact Prettier/ESLint paths already present in the repository
- exact-file git add/commit after independent PASS

External network: denied during implementation, tests and review
Real data: mock/fixture only
Risk: R1
No dependency is allowed.

STOP:
- a fix requires modifying a read-only reuse file
- a fix requires generic article support, Weibo production access or a custom endpoint
- an AI request cannot be bound to an exact built-in HTTPS endpoint and explicit host permission
- a single X item cannot be represented by the current SocialItem/SyncJob/catalog contract
- first proof requires real Chrome, X, Vault, bookmarks, network or an external Provider
- any unknown tracked worktree change appears
- fixed offline tooling attempts install, download, lifecycle or dependency materialization
```

## 6. X 单条保存合同

### 6.1 页面与启动

- Popup 只在当前 tab URL 精确匹配
  `https://x.com/<1-15 ASCII letter/digit/_ handle>/status/<1-19 digit id>` 时显示“保存当前内容”。
- URL 必须满足 `origin === 'https://x.com'`、无 credentials/非默认 port，canonical URL
  固定重建为
  `https://x.com/<normalized-handle>/status/<id>`，丢弃 query 和 fragment。
- 用户点击后，后台再次读取 active tab 并绑定 `tab.id + canonical URL + source item id`；
  UI 不能自行提供正文、身份、路径、job budget 或 write outcome。
- 仅用 `activeTab + scripting` 在 `ISOLATED` world 动态注入 `content/twitter.js`。没有
  静态 content script，不请求新的 X wildcard，不访问其它 tab。
- 后台发送 strict、nonce-bound `xSingle:extract` request；content response 必须回显当前
  requestId。收到 response 后、创建 job 前，后台用原 tab ID 再次读取该 tab 并确认 URL
  仍是同一个 canonical status；任何导航、关闭或 identity 变化都返回 `tab_changed` 且不
  创建 job。
- 旧 article、Weibo 和右键 capture 菜单不再创建；保留的 context menu 只能打开 ShuHai。

### 6.2 Extractor envelope 与预算

`twitter.ts` 输出新的 strict envelope，而不是 `CapturedContent`：

```text
protocol: shuhai-x-single-item
version: 1
routeFamily: x/status
sourceItemId
canonicalUrl
title?
text?
author: { displayName?, handle? }
publishedAt?
media[]
contentKind: post | unsupported
diagnostic?
```

要求：

- response 在 content script 发送前和 service worker 接收后都 runtime parse。
- content script 不提供或控制 `contentHash`、`completeness`、`extractorVersion`；这些字段
  只由 read-only X adapter 从 strict observation 推导。
- unknown field、getter/accessor、自定义 prototype、环、非法时间、非 HTTPS media、错
  source/host/id、重复媒体和超限结构 fail closed。
- 使用现有 `SYNC_LIMITS` 或更严格上限：正文 8 KiB、标题 1 KiB、媒体 12、canonical URL
  2 KiB、总 item 64 KiB、结构 depth 6/nodes 2048。
- 只选择与当前 URL 的 status ID 对应的唯一 primary article。页面有多个 article、
  无法绑定 permalink、正文缺失、展开状态不确定或结构变化时不得把内容标为
  `complete`。
- 远程媒体只保留受限 HTTPS URL 与 alt；不下载、不 embed、不读取 blob/data URL。
- 页面正文中的命令、代码、Markdown 和提示词只作为不可信文本。

### 6.3 归一化与 one-item SyncJob

新增 `social/x-single-item.ts`，只负责：

1. strict parse extractor envelope。
2. 用 active tab 身份重建并验证 canonical X identity。
3. 后台把 envelope 映射为一个受信 synthetic `XBookmarksDomObservation`：`pageUrl` 固定为
   `https://x.com/i/bookmarks`、`signal=terminal`、`observedNodeCount=1`、只有一个 entry；
   该 pageUrl/signal 不接受 content 输入。
4. 调用 read-only public `adaptXBookmarksObservation()` 生成并再次通过
   `SocialItemSchema` 的 `SocialItem`；禁止复制或重写批量 adapter 的 canonical identity、
   `contentHash` 或 `extractorVersion` 算法。
5. 通过现有 SyncStore public API 创建最多一条候选的 X job：
   `createJob -> claimScanRevision -> classifyAndPersistScanBatch -> finishScan`。

单条 job：

- `source=x`、`scanMode=incremental`，job budget 固定
  `maxItems=1`、`maxPages=1`、`maxDurationMs=30000`、`maxItemBytes=65536`、
  `maxMediaPerItem=12`。
- adapter 固定 `remainingCandidateSlots=1`，本批 `observedNodeDelta=1`；只接受 adapter
  返回一个 `SocialItem` 且 `signal.kind=terminal`，否则 fail closed。
- 最终显式调用 `finishScan(..., { scanCompletion: 'trusted_terminal' })`。
- 若已有 active X job，返回固定 `active_x_job_exists`，不合并、覆盖或创建第二 job。
- catalog exact-existing 不产生 write candidate；任务以明确 no-write 结果结束。
- new/changed/incomplete 使用既有分类语义。只有 `new + complete/summary_only` 可由用户
  在 XSyncPage 复核后选择。
- 后续写入继续由现有 XSyncPage、`createVaultSyncEngine`、persisted review authorization、
  WriteIntent 和 catalog 完成；045C 不复制 writer。
- 单条与批量 adapter 的同一 fixture 必须得到字节级相同的 canonical URL、source item
  identity、content hash、completeness 和 extractor version。
- `error/partial/pending intent` 保留 job 和 outcome，不删除、不伪成功。

### 6.4 旧 pending queue 与 writer

- 新生产流程不调用 `savePendingCapture()`、`exportCaptureToVault()` 或
  `generateCapturedContentMarkdown()`。
- `capture:getPending/currentSocial/currentArticle/removePending/clearPending` 从 live
  legacy message union 移除；错误前缀不得 fall through。
- `pendingCapture` 旧 storage 不自动删除、不自动写 Vault、不进入 `state:get` 或 UI。
- 旧值只通过 trusted storage 的 bounded inspection 形成
  `{ present, count, approximateBytes, state }`，不返回标题、正文、URL、媒体或原始异常。
- 替代维护 message 固定为
  `legacyPending:inspect { requestId }` 与
  `legacyPending:clear { requestId, confirmed: true }`。两者都使用 045B trusted UI sender
  binding 和 strict request/response schema；其它字段拒绝。
- inspection 先对精确 `pendingCapture` key 调用 trusted `getBytesInUse`。0 bytes 返回
  `absent`；超过 512 KiB 返回 `{ state:'oversize', count:null }` 且不得读取/遍历原值。
  预算内才读取并 strict/限量检查，摘要状态只能是
  `absent|valid|invalid|oversize|unavailable`，count 最大 20，不返回条目内容。
- Settings 提供明确的“清除旧待保存数据”用户动作；只有用户在 UI 二次确认后才发送
  `confirmed:true` 并精确删除 `pendingCapture` key。045C 不做自动 TTL 删除或猜测迁移。
- `exportCaptureToVault()` 保留为显式 unavailable API，任何输入都在文件系统调用前以
  固定 `legacy_capture_unavailable` 失败；测试中 Vault method 调用为 0。
- production-reachable Home/Collection/InlineSave 不再提供旧待保存写入按钮；未被 App
  引用的历史 ExportPage 保持不可达。可保留只读迁移说明和清除入口，但不能显示伪造成功。

## 7. Diagnostics 与 activity 合同

### 7.1 Extractor diagnostics

诊断只允许：

```text
version
platform: x
routeFamily: x/status
timestamp: background-generated
errorCode: fixed enum
probes: [{ name: fixed enum, found: boolean }]
usedFallback: boolean
```

- 不保存 selector、status ID、handle、完整/部分 URL、标题、正文、媒体、DOM、原始异常或
  自由文本。
- `errorCode` 只允许
  `route_invalid|article_not_found|article_ambiguous|permalink_mismatch|content_missing|expansion_uncertain|structure_changed|payload_invalid|payload_oversize`；
  probe name 只允许
  `primary_article|status_permalink|tweet_text|author|timestamp`。
- content script 只能返回 strict diagnostic；service worker 再次 parse。
- content response 不得包含 timestamp；持久化前由 service worker 使用当前时间添加，旧值
  或页面值不能控制排序。
- persistence 只能调用 `getLocalValue/setLocalValues`，不能直接绕过 trusted-context
  helper。
- stored value 有 strict schema、version、20 条上限、总 byte/depth/node 上限。损坏或
  legacy 报告 fail closed 且不自动改写。

### 7.2 Activity

- 新单条流程只记录固定 event code、source、classification/outcome 与时间。
- 不记录标题、正文、handle、canonical URL、relative path、Provider endpoint、API Key
  或原始错误。
- 旧 `capture_save` entry 读取时只返回经 strict schema 和脱敏后的固定摘要；原始 storage
  不自动删除或重写。显式清理仍由现有用户动作完成。

## 8. AI 数据、secret 与网络合同

### 8.1 Public settings 与 secret 分离

Public provider 配置只包含：

```text
id
provider: deepseek | kimi | glm
name
enabled
model
hasApiKey
```

独立 public legacy summary 为：

```text
builtInConflicts: (deepseek | kimi | glm)[]  // unique, max 3
customState: absent | disabled_no_key | conflict_has_key
```

- Public settings 固定每个 built-in Provider 一条，ID 分别为
  `deepseek-default|kimi-default|glm-default`；不允许同 Provider 多实例、任意 ID 或
  `openai-compatible`，name 也由 provider type 固定且不可编辑。
- `builtInConflicts` 和 `customState` 只是 legacy quarantine 摘要，不影响任一 built-in
  行的 `hasApiKey`；`hasApiKey` 只能由该 Provider 已通过完整 schema、origin binding 和
  envelope budget 校验的 secret 推导。
- `baseUrl` 不进入可编辑设置；UI 只显示由 provider type 查表得到的固定 host。
- API Key 使用独立 versioned `AI_PROVIDER_SECRETS_KEY` envelope，最多三个 built-in
  Provider，每项绑定 `provider + fixed origin + key`。单 Key 必须匹配
  `^[\x21-\x7E]{1,4096}$`，整个 envelope 上限 16 KiB，unknown field 拒绝。
- secret 分离是 extension 内的逻辑隔离，不宣称 OS keychain 或静态加密；本 Goal 的安全
  目标是 Key 不进入普通 UI state/message response/log/export，并且只能绑定固定 endpoint。
- `state:get`、`settings:get/set`、onboarding、summary、activity、backup、export、
  diagnostic 和错误响应不得包含 secret envelope 或完整 Key。
- Settings 保存普通配置和保存/清除 Key 使用不同 strict message：
  `settings:set` 只接收 public settings；
  `ai:secret:set { provider, apiKey }`；
  `ai:secret:clear { provider, confirmed:true }`；
  `ai:testConnection { provider }`。连接测试不接收 provider config、baseUrl 或 Key，后台
  只按 provider 从 secret envelope 读取。
- 空 key 不通过 `ai:secret:set`；“不改变已有 Key”由不发送该 message 表达，清除必须使用
  单独确认动作。
- 旧 settings 中的 built-in Key 可在 trusted background 中迁移：先 strict validate
  provider、忽略 stored base URL、写入并复核 secret envelope，再从 public settings 移除
  Key。任一步失败时 AI fail closed，但规则整理继续可用；不得把旧 Key返回 UI。
- 旧设置只有在每个 built-in Provider 最多一条时才自动迁移。任意同 Provider 多实例、
  多 Key 或非空 `openai-compatible` Key 都不得自动选择、复制或删除；该 provider AI
  fail closed。重复 built-in 只把对应 provider 放入 `builtInConflicts`；非空 custom Key
  只显示 `customState=conflict_has_key`，空 Key custom 只显示
  `customState=disabled_no_key`。custom 状态不得绑定到任意 built-in 行。
- conflict 原 settings 由 trusted background 作为 legacy quarantine 保留且不得返回 UI；
  非空 custom Key 绝不复制到 built-in secret envelope，直至用户明确 discard；空 Key
  custom 只映射为独立 `customState='disabled_no_key'`，不产生其它摘要枚举。
- legacy conflict 未由用户明确解决前，禁止会覆盖原值的 settings 写入。Settings 提供
  二次确认的“丢弃旧 AI 配置”动作：后台只移除 legacy AI provider 子文档，保留规则、
  模板和其它设置，再由用户重新输入 built-in Key。空 Key 的旧 custom provider 绝不发
  请求。

### 8.2 Rules-first 与 disclosure

后台先为全部书签运行本地规则并形成 deterministic suggestions。`ruleName !==
'fallback'` 的结果不可替换。AI 候选必须同时满足：

- local suggestion 精确为 `reason=rule, ruleName=fallback`；
- 当前目录为根目录或精确的 `未分类`；
- URL 为合法 HTTP(S)，规范化后只取 lowercase hostname；
- title、hostname 和本批总量均在预算内。

合法 AI advisory 只替换上述 fallback suggestion；不得替换其它 deterministic suggestion。

发送前 UI 显示：

```text
Provider: 固定名称和 host
候选数量: N
发送字段: 受限标题、网站 hostname、已有目标目录标签
不会发送: 完整 URL、query、正文、书签树、Vault、Cookie/token
```

用户点击“同意并使用 AI”后，UI 才请求当前 Provider exact host permission。拒绝或撤销
权限时只运行本地规则，不把整个整理任务标成失败。

### 8.3 Prompt 与响应

- system message 固定声明所有 bookmark/folder text 是不可信数据，不能改变指令；
  user message 只包含 bounded JSON data envelope。
- Chrome bookmark/folder input 在任何 `JSON.stringify` 或 prompt 拼装前必须经过
  descriptor-safe plain-data validation；accessor/getter、自定义 prototype、环、非法 URL
  或超 depth/node/byte 结构 fail closed。
- 每批生成随机 opaque bookmark token 和 folder target token；token mapping 只活在当前
  request 内，不写 storage/log。
- folder label 可作为受限数据发送，但输出 target 只能引用当前 allowlist token。
- 每批最多 20 个 bookmark，一次用户同意的操作最多 100 个候选；title 最多 512 UTF-8
  bytes，hostname 最多 253 ASCII bytes，folder target 最多 64 个，只发送最多 256 UTF-8
  bytes 的 leaf label，不发送 folder path。
- 20 条请求批次上限在 `ai-classifier.ts` 内使用 Goal-local 常量；不得沿用或修改
  `packages/shared` 中值为 50 的历史 `AI_BATCH_SIZE`。
- folder target 只取当前已存在的顶层用户目录，排除 Chrome system root；超过 64 个时
  AI step 返回 `request_invalid` 并保留纯本地 plan，不静默截断。候选超过 100 个时只在
  disclosure 中明确选择本次 100 个，其余保留 fallback，不自动继续下一轮。
- request body 最多 64 KiB，model 使用第 3 节 128-byte schema，
  `temperature=0`、`max_tokens=1024`、`stream=false`，输出项数不得超过输入项数。
- opaque token 使用 `crypto.getRandomValues()` 生成至少 128-bit CSPRNG 值；只绑定当前
  request/batch，不持久化、不记录、不可跨批或跨 request 重放。
- response 必须是整个 JSON document；禁止首尾截取、Markdown fence 修复或宽松 cast。
- strict output 只接受唯一且属于当前 batch 的 bookmark token、已存在 target token；
  unknown/duplicate/missing/extra field、自由 target、confidence、tags 或超量结果全部拒绝。
- AI suggestion 固定 `reason=ai`、`confidence=0.5`、`selected=false`；只能替换第
  8.2 节定义的 fallback suggestion，不能覆盖其它 deterministic suggestion，也不能进入
  `newFolders`。

### 8.4 请求与响应预算

- fetch 目标必须精确等于第 3 节 endpoint；请求前验证 `https:`、空 credentials、
  固定 host/path、无 query/fragment。
- fetch 固定 `method:'POST'`、`redirect:'error'`、`credentials:'omit'`、
  `cache:'no-store'`、`referrerPolicy:'no-referrer'`；除 `Content-Type` 和当前 secret
  生成的 `Authorization` 外不接受配置型 header。
- 背景独立验证 exact optional permission；UI 声称已授权不构成证据。
- 请求超时固定 30 秒，并覆盖 fetch、stream 读取、fatal UTF-8 decode、JSON parse 和
  schema validation 全过程；cancel、Port disconnect 或 permission revoke 中止 fetch。
- response 先检查 `Content-Length`，再以 stream 读取，最多 256 KiB；不能先调用无界
  `text()`/`json()`。
- 只接受 JSON content type、depth 不超过 8、节点不超过 2048；Provider error body 永不
  进入 UI、activity、diagnostic 或 thrown error message。
- HTTP 401/403/429/5xx 分别映射
  `unauthorized|forbidden|rate_limited|provider_unavailable`；若 test double 直接返回 3xx，
  视为其它非 2xx 并映射 `request_invalid`。
- 只有本地 30 秒 deadline 映射 `timeout`，用户 cancel/Port disconnect/permission revoke
  映射 `aborted`；其它 fetch rejection（包括 `redirect:'error'` 引起的 rejection）统一
  映射 `network_failed`，不得检查异常文本猜测 redirect。
- 错误只映射为
  `permission_required|permission_denied|secret_unavailable|legacy_ai_config_conflict|request_invalid|unauthorized|forbidden|rate_limited|provider_unavailable|timeout|aborted|response_too_large|content_type_invalid|response_encoding_invalid|response_invalid|network_failed`；
  不回显 endpoint、request、response、Key、书签标题或目录。
- 连接测试发送固定最小内容，不发送书签；仍需 exact permission、fixed endpoint、
  30 秒 timeout 和 256 KiB response budget。

## 9. Manifest 与权限

`optional_host_permissions` 精确为：

```text
https://x.com/*
https://api.deepseek.com/*
https://api.moonshot.cn/*
https://open.bigmodel.cn/*
```

不得包含：

```text
http://*/*
https://*/*
*://*/*
https://twitter.com/*
https://weibo.com/*
https://m.weibo.cn/*
```

- provider permission 只由直接用户手势请求；切换 Provider 不自动沿用其它 Provider grant。
- 撤销 Key 或停用 Provider不静默撤销 host permission；Settings 提供明确撤销入口并显示
  实际状态。
- security bootstrap 继续撤销 045B 定义的 broad legacy grants，不能误删 X 或三个精确
  Provider origin。
- provider permission cleanup/contains/request/remove 全部 mock 测试；045C 不进行真实
  Chrome 授权。

## 10. 测试矩阵

### 10.1 X 单条保存

- 精确 X status、query/fragment canonicalization、credentials、错 host、错 ID、
  子域、twitter.com、非详情页。
- content response unknown key、prototype key、getter、环、depth/node/byte、超长正文、
  13 个媒体、非 HTTPS 媒体、重复媒体、非法时间。
- 多 article、无 exact permalink、正文缺失、结构变化和不确定展开状态不能标
  `complete`。
- raw HTML、remote image、JS/data/obsidian URL、wiki/embed、callout、Templater、
  Dataview 和 prompt injection 从 content fixture 到最终 safe Markdown。
- 单条和批量 fixture 的 canonical identity/contentHash/extractorVersion 必须一致；单条
  new 创建一条 review item；exact existing 形成 revision 0 的零 item no-write 复核且不创建
  文件；changed/incomplete 默认不写。
- 同标题不同 ID 产生两个 identity；同 ID 重试不重复；foreign path collision 不覆盖。
- active X job、stale revision、write 前/中、close 后/catalog 前、permission revoked、
  Popup/Side Panel close 和 resume。
- `error/partial` 保留持久状态；只有 identity-matched committed outcome 才显示
  `already_exists`。
- article/Weibo/context-menu/legacy capture route 全部 fail closed，旧 writer 的文件系统
  mock 调用为 0。

### 10.2 Legacy data、diagnostics 与 activity

- pending legacy 单对象、数组、损坏、超限、getter/Proxy、20/21 项和超大正文只返回
  bounded summary，不回显内容、不自动删除；超过 512 KiB 时 `get`/遍历调用为 0。
- `legacyPending:inspect/clear` sender、requestId、unknown field 和 response schema；
  explicit clear 只删除 `pendingCapture`，未确认时 remove 调用为 0。
- diagnostic wrong version/route/probe/error code、私人 ID、selector、URL、正文和 raw error
  全部拒绝；content-supplied timestamp 也拒绝，stored timestamp 由 background 生成。
- trusted storage bootstrap 失败时 diagnostic/activity storage 调用为 0。
- capture activity 和 Provider errors 不含 title、URL、path、body、endpoint 或 Key。

### 10.3 AI

- rules-first：明确本地 rule、已有明确目录和非 HTTP(S) 书签不进 AI payload。
- credentials/query/fragment/path 不进入 payload；只出现 bounded title、hostname 和
  opaque token。
- bookmark/folder getter、accessor、自定义 prototype、环和超 depth/node/byte 输入在
  stringify/fetch 前拒绝，fetch 调用为 0。
- 恶意标题/目录中的“忽略规则”、伪 JSON、Markdown fence和闭合标签只能作为 data。
- strict whole-document response；unknown/duplicate/wrong batch token、自由 folder、
  confidence、tags、extra field、oversize/deep response 全部拒绝。
- AI 不能覆盖本地 suggestion，不能创建目录，所有 AI move 默认 `selected=false`。
- DeepSeek/Kimi/GLM endpoint 和 exact permission；当前官方默认 model 可接受，空白、
  control、超长、含 slash/backslash/colon 或 `..` 的 model 拒绝；任何 model 均不能改变
  fetch URL/header。任何 stored/custom/mutated base URL fetch 调用为 0。
- 单 Provider Key migration、迁移中断恢复、同 Provider 多实例/多 Key conflict、custom
  disabled、redacted settings/state、blank-preserve、explicit clear、wrong
  provider/origin binding 和 aggregate budget；所有 settings/state/test/error 响应无 Key。
- 无 permission、permission deny/revoke、redirect、401/403/429/5xx、timeout、abort、
  slow/oversize chunk、错误或缺失 Content-Length、fatal UTF-8、wrong content type、
  malformed response 均返回固定错误且无 secret/body 泄漏；mock 必须使用
  `ReadableStream<Uint8Array>` 覆盖有界读取。
- redirect mock 必须断言 request 使用 `redirect:'error'`、不会跟随，并以
  `network_failed` 收口；不得测试或实现基于异常文本的 redirect 识别。
- UI 未确认时 `permissions.request` 和 fetch 均为 0；拒绝 permission 后仍生成纯本地 plan。
- manifest 只有第 9 节四个 exact optional origin，没有 broad/static injection 回归。

### 10.4 完整门禁

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
git diff --check
independent review PASS with P0/P1 = 0
```

全部测试使用 mock fetch、fake Chrome、fake IndexedDB 和 mock
`FileSystemDirectoryHandle`。不访问真实网络、Chrome、X、Vault、Provider 或用户书签。

## 11. 完成定义

- 旧 capture queue/writer 不再是任何生产 UI/message/context-menu 的可达写路径。
- X 单条保存只通过 current SocialItem/SyncJob/review/WriteIntent/catalog/safe Markdown
  管线，逐项 outcome 真实且可恢复。
- 普通文章与微博旧保存 fail closed，产品文案不暗示仍支持。
- diagnostics、activity 和 pending legacy summary 不持久化或回显私人正文/URL/raw error。
- AI 只处理本地无法确定项，只发最小字段，只访问用户确认的固定官方 endpoint。
- Key 与 public settings 分离，任何普通状态、日志、诊断和错误中都没有完整 Key。
- 同 Provider legacy 冲突不自动选 Key 或删 Key；AI fail closed，只有用户确认后才清理
  legacy AI 子文档。
- AI 输出 strict、默认不选中、不能创建 folder 或覆盖 local rule。
- 045A/045B、X batch sync、catalog、safe Markdown 和 recovery 测试无回归。
- 完整门禁和独立 implementation review 通过。
- 全程未触碰真实 Chrome、X、Vault、网络、外部 AI 或用户书签。

## 12. 合同预审与实施验收

本 Goal 在进入实施前完成了以下合同预审；旧轮次保留用于复盘合同如何收敛：

| Round | Reviewer                                           | Verdict  | Findings                    |
| ----- | -------------------------------------------------- | -------- | --------------------------- |
| 1     | Bernoulli (`019f72cf-d935-7063-a773-675abac25065`) | `REWORK` | `P0=0/P1=8/P2=3`            |
| 2     | James (`019f72f0-c448-70e2-9f9e-fa605d2653f7`)     | `REWORK` | `P0=0/P1=2/P2=not reported` |
| 3     | Dalton (`019f7306-5548-7d22-9361-2f00385db75c`)    | `REWORK` | `P0=0/P1=0/P2=2`            |
| 4     | Cicero (`019f732a-2378-7c61-8b81-82376a4f4039`)    | `PASS`   | `P0=0/P1=0/P2=0`            |
| 5     | GLM（用户转发只读预审）                            | `PASS`   | `P0=0/P1=0/P2=0`            |

version 4 的内部独立预审与用户转发的 GLM 只读安全预审均已通过。预审 Reviewer 均：

1. 对照 `933c723` 实际代码，而不是实现者自述。
2. 检查五项 P1 是否都有可执行、最小且互不矛盾的修复。
3. 检查 write allowlist 是否足够且没有暗中扩大产品边界。
4. 检查 X 单条 job 是否能只调用现有 SyncStore public API，且无需修改 read-only reuse。
5. 检查 Provider permission、secret migration、rules-first、response budget 和默认不选择。
6. 返回 `PASS` 或 `REWORK`，并列出 P0/P1/P2。

实施完成后，安全 Reviewer
`019f7600-e34b-7d50-ac44-3ab75a26e074` 与行为/完成度 Reviewer
`019f7601-f85c-7c32-8f6d-36cc1928520f` 均独立给出 `PASS`，P0/P1/P2 均为 0。

最终验收记录：

- `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 extension build 全部通过。
- 最终串行测试为 shared 1/1、desktop 25/25、extension 765/765。
- 一次并行运行因 CPU 争用让两个既有 5 秒测试超时；未修改 timeout，随后单独串行复跑
  全部通过。
- extension build 保留一个非阻断提示：`assets/styles.js` 为 533.27 kB，按 Goal 046
  处理主壳拆分和按需加载。
- 全程未触碰真实 Chrome、X、Vault、网络、外部 AI Provider 或用户书签。

Goal 索引、项目状态、路线图和 workflow 已同步将 045C 收口为 `DONE/PASS`。当前没有
`READY` 或 `IN_PROGRESS` Goal；任何后续实现都必须重新完成状态推进。
