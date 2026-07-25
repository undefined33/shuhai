---
id: goal-046b
title: Two User Journeys And Independent Options
status: DONE
version: 6
updated: 2026-07-24
depends_on:
  - goal-046a
branch: codex/goal-046-ui-shell
base_commit: 55acb0f
external_preaudit:
  status: PENDING
  note: 用户已转发 Goal 046 预审请求，尚未收到可核验结论。
contract_review:
  verdict: PASS
  rounds:
    - reviewer: Raman
      reviewed_at: 2026-07-24
      verdict: FAIL
      summary: 初版存在备份整树泄漏、健康历史入口丢失、书签 bootstrap 未收口、关闭与返回语义不确定等 6 个 P1。
    - reviewer: Raman
      reviewed_at: 2026-07-24
      verdict: FAIL
      summary: 第二版仍把尚不存在的重复检测写成当前承诺，保留了无生产消费者的聚合 state 接口，并让书签快照返回完整 AppSettings。
    - reviewer: Raman
      reviewed_at: 2026-07-24
      verdict: FAIL
      summary: 第三版遗漏一个依赖 state:get 的测试文件，且书签设置仍先经过完整 getSettings，损坏或超限模板可能阻断或抹掉有效分类设置。
    - reviewer: Einstein
      reviewed_at: 2026-07-24
      verdict: FAIL
      summary: 第四版已无 P0/P1，但退役接口错误码、bookmark snapshot sender 负向测试和字段级预算隔离测试仍有 3 个 P2。
    - reviewer: Einstein
      reviewed_at: 2026-07-24
      verdict: PASS
      summary: 第五版关闭全部遗留项；P0/P1/P2/P3 均为 0，允许从 READY 正式转入 IN_PROGRESS。
    - reviewer: Locke
      reviewed_at: 2026-07-24
      verdict: PASS
      summary: 第六版只补入 classification client 独立测试分片和单项规模测试 10 秒 timeout 的精确 allowlist；断言与生产范围不变，P0/P1/P2/P3 均为 0。
implementation_review:
  verdict: PASS
  rounds:
    - reviewer: Locke
      reviewed_at: 2026-07-24
      verdict: FAIL
      summary: 首轮发现 AI 权限等待竞态、新文件夹派生错误、Popup 设置失败无反馈、操作栏位置和组件证据缺口。
    - reviewer: Locke
      reviewed_at: 2026-07-24
      verdict: PASS
      summary: 修复后 P0/P1/P2/P3 均为 0；真实挂载、缩放、主题、焦点和遮挡证据明确移交 046C。
---

# Goal 046B：两条用户旅程与独立 Options

## 1. 用户问题

Goal 046A 已把 Toolbar Popup 和 Side Panel 主壳拆开，但书签入口仍会 lazy-load 旧
`App.tsx`。这会把旧首页、收藏、活动、设置、导出、链接历史和 X 路由再次带回生产任务，
用户仍要理解内部模块名，也会在新旧两代界面之间跳转。

本 Goal 只保留两个用户动作：

1. 整理 Chrome 书签：浏览或搜索、生成建议、复核、应用、查看逐项结果和恢复。
2. 同步 X 收藏：从当前 X 收藏页启动、扫描、复核、写入并返回任务入口。

Vault、X 权限、可选 AI、规则、模板、备份和旧数据维护进入独立 Options Page。它们不再
与日常任务共用页面树或状态读取。

## 2. 用户结果

完成后：

- 普通页面点击 Popup 的“整理 Chrome 书签”后，Side Panel 直接进入书签任务，不出现旧
  Launcher、首页、Tab 或统计卡片墙。
- 书签任务只有“书签”和“恢复”两个任务内视图；分类建议、确认、partial 和恢复语义不变。
- X 收藏任务继续直接进入既有 `XSyncPage`；active job 关闭后仍回到 exact task，只有
  terminal job 的“返回任务入口”进入新 idle，不进入旧 `App.tsx`。
- Popup 和 Side Panel 的设置 icon 打开独立 Options Page。
- Options 首屏只有 Vault、X 页面权限和可选 AI；规则、模板、备份和旧数据维护默认折叠。
- 旧 `App.tsx` 及失去入口的旧首页、收藏、活动、导出、帮助和设置页面不再进入生产 build，
  并在引用清零后删除。

## 3. 非目标

- 不修改分类、AI 提示、bookmark operation、恢复、X adapter、SyncStore、catalog、
  Vault writer 或 Markdown sanitizer 的业务算法。
- 不在 UI 重构中暗中新增 URL 归一化或重复书签检测算法。当前实现没有可验收的重复分析，
  本能力从 v4 当前旅程移入后续独立算法 Goal；046B 不展示、删除或声称发现重复项。
- 不恢复 URL 主动体检。历史 403/429/timeout/5xx 不重新解释为死链。
- 不恢复普通网页、微博或旧通用内容队列。
- 不增加新平台、后台监控、自动写入、自动移动或自动删除。
- 不新增 companion、Native Messaging、daemon、运行时依赖或开发依赖。
- 不执行真实 Chrome、X、Vault 或书签 E2E；完全隔离浏览器验收属于 Goal 046C。
- 不把两周真实 dogfood 伪装成本 Goal 的自动化完成条件。

## 4. 信息架构合同

### 4.1 Toolbar Popup

- 继续遵守 Goal 046A 的 summary-only 和一个 primary CTA 合同。
- Header 只新增一个带 `aria-label="打开设置"` 的 icon button。
- 设置按钮只调用 `chrome.runtime.openOptionsPage()`，不在 Popup 内加载或渲染设置。
- 设置按钮失败时显示固定本地错误，不回退到旧工作区。
- Popup 仍不得发送 `state:get`、`settings:get`、`backups:list` 或读取 Vault handle。

### 4.2 Side Panel

Side Panel 只有：

```text
idle
  -> bookmark-task
  -> x-task
```

- `bookmark-task` 动态 import 新 `BookmarkTaskApp`；不得 import 旧 `App.tsx`。
- `x-task` 继续动态 import 既有 `XSyncPage`。
- idle 和两个 task 都有一个设置 icon，调用独立 Options。
- 任务态只有一个明确返回动作；返回 idle 不取消、清理或伪造持久任务。
- X 只有终态 `complete`、`complete_with_issues`、`failed` 或 `cancelled` 才显示可用返回
  动作并进入 idle。`prepared`、`scanning`、`paused`、`ready_for_review`、`writing` 和
  `partial` 均保持 active，返回与 Escape 不得把它们路由成 idle。
- 书签 mutation 的运行与结果以 operation journal 为真；退出后重新进入必须能恢复结果。
- 分类建议只存在于当前 UI session。可见返回在分类运行中禁用；用户可以显式 correlated
  cancel。若用户直接关闭、刷新 Side Panel 或 Port 断开，后台必须按既有 disconnect
  controller 安全中止，未产生 plan、未修改书签；重新进入从浏览态重新开始，不伪称可恢复
  classification task。
- mutation/apply/restore/accept 正在执行时禁用退出；后台 operation 已完成或进入可恢复
  partial 后才能离开。
- Escape 与可见返回按钮使用相同退出门禁，不建立隐藏第二条路径。

状态矩阵固定为：

| 任务状态                            | 可见返回 / Escape                    | 关闭或刷新 Side Panel                     | 重新进入                        |
| ----------------------------------- | ------------------------------------ | ----------------------------------------- | ------------------------------- |
| 书签浏览、plan ready、确认对话框    | 可退出；Escape 先关闭确认，再退出    | 丢弃未持久化 plan，不产生 mutation        | 书签浏览；journal 仍在          |
| 书签 classifying                    | 返回禁用；只允许显式取消             | Port disconnect 安全 abort，mutation 为 0 | 书签浏览，必须重新生成建议      |
| apply/restore/accept/cancel running | 返回禁用                             | operation journal 继续作为 truth          | 直接显示全部 retained operation |
| apply/result/partial/failed         | 可退出                               | journal 保留逐项结果                      | 恢复视图定位 exact operation    |
| X active 六种状态                   | 不退出 idle；使用任务内 pause/cancel | 持久 SyncJob 保持                         | surface summary 回到同一任务    |
| X terminal 四种状态                 | 返回进入 idle                        | terminal truth 保留                       | idle，可启动下一批              |

### 4.3 书签任务

书签任务固定为两个任务内视图：

```text
书签
  -> 浏览 / 搜索
  -> 选择“规则优先”或“重新审视全部”
  -> 生成整理建议
  -> 逐项复核
  -> 明确确认
  -> 逐项 apply 结果

恢复
  -> 全部 retained operation journal
  -> 安全停止 / 恢复成功项 / 接受当前状态
```

行为合同：

- 默认只进入“书签”，不会自动生成建议。
- `safe` 和 `full` 两种既有分类模式保留，但改为可理解的文字，不暴露内部 mode 名。
- AI 仍是可选建议来源；发送前继续显示 bounded 候选数和 hostname-only 隐私确认。
- 生成 plan 不修改真实 Chrome 书签。
- 默认选中逻辑继续由既有 plan 决定；UI 不扩大选中集合。
- apply 前显示真实选中数、备份与可恢复说明，并再次确认。
- apply、restore 和 accept 必须继续调用 Goal 045A 的 strict command 和 journal。
- partial 必须展示 succeeded、failed、conflict 和可恢复数量，不显示笼统“成功”。
- 恢复视图必须包含全部 retained delete/update/move operations；可以默认聚焦最新项，但
  不得隐藏较早的 unresolved、partial、conflict 或 `restore_failed`。apply 后使用返回的
  exact operation ID 定位本次结果。
- 任何 mutation 均不得由 Options、Popup 或页面挂载自动触发。
- “撤销上次整理”不再与“整理书签”重复摆放；恢复统一进入“恢复”视图。
- 书签目录导出从本次主旅程移除。既有历史代码不再成为生产入口。
- 历史 URL 检查从主旅程移除；Options 高级维护区保留最小只读入口。已有数据不自动删除或
  重解释。

视觉合同：

- 顶部 `TaskHeader` 只出现一次；不重复品牌标题。
- 运行中的分类使用带可访问名称的 progress region；结果使用带 `status`/`alert` 语义的
  result region；底部固定 `ActionBar`。只有至少两处真实复用时才抽取共享组件。
- 页面 section 用留白和分隔线，不用 Card 套 Card。
- 一屏最多一个 Jade primary CTA。
- 列表项允许必要的行容器，但不为每行复制完整按钮栏。
- 正文 14px，辅助文字至少 12.5px；不使用 serif 数字或 `text-[11px]`。
- 360px Side Panel 下按钮、长中英文标题、1,000+ 数量均不横向溢出。

### 4.4 X 收藏任务

- 不修改 Goal 043 的 launch、scan、pause/resume、bounded batch、review、write、catalog
  去重或 `tab_changed` 语义。
- `XSyncPage` 只允许删除重复页面标题、接入统一 TaskHeader/ActionBar/返回语义和调整视觉
  层级。
- `metadata_only` 仍不可默认选中；默认候选上限仍为 5。
- 不能用本批结果声称“全部收藏已同步”或存在 feed end marker。
- 不读取 Cookie、token、其它 tab 或私有 API；不提高并发。
- 写入前继续要求用户复核和 Vault user gesture。

X 返回矩阵只有一个预期：

| SyncJob 状态                                                | 返回行为                                     |
| ----------------------------------------------------------- | -------------------------------------------- |
| `prepared/scanning/paused/ready_for_review/writing/partial` | 不进入 idle；关闭后重开仍回 exact active job |
| `complete/complete_with_issues/failed/cancelled`            | 显示“返回任务入口”，点击后进入 idle          |

## 5. 独立 Options 合同

### 5.1 构建与页面

- Manifest 新增：

```json
{
  "options_ui": {
    "page": "options/index.html",
    "open_in_tab": true
  }
}
```

- 不新增 named permission 或 host permission。
- Vite 增加独立 `options` HTML entry。
- `OptionsApp` 不 import Popup、Side Panel、`App.tsx`、任务页、SyncStore、完整书签树或
  X adapter。
- Options 首屏只读取：
  - Vault handle 的存在与授权状态。
  - 精确 `https://x.com/*` optional permission 状态。
  - `settings:get` 返回的 bounded `AppSettings`。
- Options 不读取 `state:get`、`state:summary`、surface registry、书签树、健康历史、
  export manifests、当前 tab 或活动任务。只有用户展开高级“旧链接记录”后，才发送受界
  `health:listRecords`；只有用户展开“书签备份”后，才读取 metadata-only summary。

### 5.2 页面身份与请求白名单

现有 `validateExtensionUiSender()` 继续只接受精确 Popup/Side Panel，Options 不得被加入
这个通用 task validator。

新增独立 exact Options validator，只接受：

```text
id === chrome.runtime.id
origin === chrome-extension://<same-id> 或缺省
url === chrome-extension://<same-id>/options/index.html
无 query / hash / username / password
无 sender.tab
所有读取字段均为 data property，不调用 accessor
```

Options 只能调用以下 legacy request：

```text
security:getBootstrapStatus
settings:get
settings:set
ai:secret:set
ai:secret:clear
ai:legacy:discard
ai:testConnection
legacyPending:inspect
legacyPending:clear
backups:listSummaries
backups:get
health:listRecords
health:clearRecords
```

Options 明确不得调用：

```text
operations:getRecent
plan:create
onboarding:getProgress
onboarding:set
xSingle:start
backups:list
surface:*
xSync:*
bookmarkOperations:*
classification port
```

`state:get` 和 `state:summary` 已从 runtime schema 删除，不属于“已解析但不在 Options
白名单”的 request。Service Worker 必须先以既有 bounded runtime schema 解析 request：
这两个历史 type 来自任何 sender 都固定返回既有 `invalid_request`；只有仍属于 runtime
schema、但不在 Options 白名单中的 request 才固定返回 `forbidden_sender`。随后再验证
exact sender，不得通过“Options 是 extension page”扩大其它 handler 的信任边界。

### 5.3 Vault、平台权限与 AI

- Vault 只在用户点击“选择 Vault”时调用 File System Access API。
- 页面挂载不弹目录选择、不请求写权限、不写文件。
- 展示目录时只显示 handle name，不显示绝对路径。
- X permission 只在用户点击允许/撤销时调用 `chrome.permissions.request/remove`。
- 页面挂载只调用 `permissions.contains`。
- AI 默认可关闭；未配置时本地规则仍可完整使用。
- API Key 输入默认为 password，不从 background 回读 secret。
- 保存、清除、测试 Provider 都是独立 user gesture；错误只显示固定安全结果。
- Provider host permission 仍按精确内置 origin 单独请求，不新增自定义 endpoint。
- 模板和规则通过既有 runtime schema 随完整 settings 保存。
- 备份列表只返回最多 5 个 metadata summary：

```text
{
  key: /^backup_[0-9]{1,16}$/,
  createdAt: bounded ISO timestamp,
  bookmarkCount: non-negative safe integer
}
```

- `backups:get` 只接受上述 exact key，并且 key 必须仍存在于 bounded backup index。用户
  点击后才返回该单个、既有 16 MiB response budget 内的 `BackupRecord`；不存在返回
  `{ backup: null }`，不得回退到枚举全部 key。下载只发生在 action-time。
- 旧 `backups:list` 从 request schema 和 handler 删除，不留返回全部备份树的 UI API。
- 旧链接记录只允许展示、action-time 安全打开、复制原 URL 和整表确认清除。
- `health:listRecords` 沿用 Goal 045B 的 strict `UrlHealthRecord[]` schema，最多 10,000
  条；挂载 Options 不自动调用。`health:clearRecords` 必须携带 `confirmed: true`，清除前
  再次确认，不得按记录修改、删除或更新真实书签。
- 旧 pending capture 清理需要显式确认；不在挂载时清理。

### 5.4 Options 视觉

- 最大内容宽度 880px，宽屏不拉成长表格。
- 首屏三个无嵌套 section：Vault、X 页面权限、可选 AI。
- “高级设置”默认全部折叠：规则、模板、备份、旧数据维护。
- 每个 section 只有一个清晰状态和对应动作；不用 badge 墙、统计卡片或营销 onboarding。
- 保存设置使用固定 ActionBar 或明确 section 动作，不在页面上下重复。
- 支持 light/dark、键盘、可见 focus、长 Vault 名和 200% 缩放。

## 6. 生产入口与删除合同

046B 完成后，生产依赖图不得包含：

- `src/popup/App.tsx`
- `HomePage.tsx`
- `CollectionPage.tsx`
- `ActivityPage.tsx`
- `ExportPage.tsx`
- `HelpPage.tsx`
- `InlineSavePanel.tsx`
- `OnboardingChecklist.tsx`
- `BookmarkIndexExportPanel.tsx`
- 旧 `OrganizePage.tsx`
- 旧 `HealthPage.tsx`
- 旧 `Settings.tsx`

以上文件在新书签任务、Options 和测试迁移后引用必须为零，并在本 Goal 删除。删除仅限
这些仓库内精确文件，不使用递归删除、通配符清理或 `git clean`。

以下底层组件继续复用：

- `BookmarkTree.tsx`
- `ClassifyPreview.tsx`
- `RulesEditor.tsx`
- `MarkdownTemplateEditor.tsx`
- `XSyncPage.tsx`
- Goal 045A operation command 与后台 handler
- Goal 043 SyncStore、catalog、Vault writer 与 X adapter

若实现发现仍有必要保留上述待删页面之一，必须先修订本合同并独立复审，不能悄悄留下
第二套可达 UI。

## 7. 允许文件

### 文档

- `docs/PROJECT_STATUS.md`
- `docs/product-roadmap-v4.md`
- `docs/goals/README.md`
- `docs/goals/goal-046b-two-journeys-and-options.md`
- `docs/proposals/2026-07-17-ui-shell-redesign.md`
- `docs/workflows/README.md`

### Manifest、构建与信任边界

- `packages/extension/manifest.json`
- `packages/extension/vite.config.ts`
- `packages/extension/src/shared/bookmark-types.ts`
- `packages/extension/src/shared/ai-classifier.ts`
- `packages/extension/src/shared/ai-providers.ts`
- `packages/extension/src/shared/extension-messages.ts`
- `packages/extension/src/background/service-worker.ts`
- `packages/extension/src/utils/backup.ts`
- `packages/extension/src/utils/storage.ts`

`service-worker.ts` 只允许增加 exact Options sender/request gate、Side Panel-only
bookmark snapshot 和受界 backup/health 只读 case，并删除失去生产消费者的
`state:get`/`state:summary` handler 及其专属聚合 helper；不得修改任何 mutation、
classification、X 或 Vault 业务 case。`extension-messages.ts` 只允许增加 exact Options
identity、request-type 白名单、bookmark snapshot、backup summary/get 和 health
read/confirmed-clear schema，并删除 `state:get`/`state:summary` request、success map 与
response schema；不得放宽现有 Popup/Side Panel、surface、X、classification 或 mutation
sender。退役后来自任何 sender 的这两个 request 都必须在 sender gate 前解析失败为既有
`invalid_request`。

新增严格 `BookmarkTaskSettings` 投影：

```text
Pick<
  AppSettings,
  | 'useAi'
  | 'activeProviderId'
  | 'aiProviders'
  | 'aiLegacySummary'
  | 'customRules'
  | 'defaultClassifyMode'
>
```

`ai-classifier.ts` 和 `ai-providers.ts` 只允许把候选检查/helper 的参数类型收窄到实际使用
字段，使完整 `AppSettings` 和上述投影都可结构化传入；不得改变候选选择、规则、提示词、
Provider、权限、网络或批次行为。

新 `bookmarkTask:getSnapshot` 只接受精确 Side Panel sender，严格响应为：

```text
{
  bookmarks: BookmarkItem[] (max 100_000),
  folders: FolderItem[] (max 100_000),
  settings: BookmarkTaskSettings
}
```

后台只调用一次 `getFullTree()`、`flattenBookmarkTree()` 和新
`getBookmarkTaskSettings()`；不读取或返回原始 tree、templates、activeTemplateIds、
exportDirectory、backups、export manifests、health records、onboarding、Vault handle
或 operation journal。

`getBookmarkTaskSettings()` 必须直接读取 `SETTINGS_KEY`，只把上述六个 allowlisted 字段
复制进独立的 byte/depth/array budget，再复用现有 provider、legacy summary、custom rule
和 classify mode 归一化。它不得先调用 `safeSettingsRecord(raw)`、
`normalizePublicSettingsRecord()`、`normalizeTemplates()` 或完整 `getSettings()`，也不得
遍历、克隆、验证或返回模板/导出字段。stored public envelope 与 legacy public settings
都必须 fail closed：合法分类字段保留，单个损坏/超限分类字段降为该字段默认值，不能因
无关模板、active template IDs 或 exportDirectory 损坏而把全部分类设置清零。API Key
仍只通过既有 secret envelope 转换成 `hasApiKey` 布尔值，不返回 secret。

operation journal 继续通过独立 `operations:getRecent` 并行加载，因此 snapshot 失败时
恢复视图仍可工作。

### Surface 与 shell

- `packages/extension/src/popup/PopupApp.tsx`
- `packages/extension/src/sidepanel/SidePanelApp.tsx`
- `packages/extension/src/shell/Brand.tsx`
- `packages/extension/src/shell/TaskHeader.tsx`
- `packages/extension/src/shell/ActionBar.tsx`
- `packages/extension/src/shell/SurfaceLoading.tsx`
- `packages/extension/src/shell/TaskProgress.tsx`（可选新增；至少两处真实复用才抽取）
- `packages/extension/src/shell/TaskResult.tsx`（可选新增；至少两处真实复用才抽取）
- `packages/extension/src/shell/EmptyState.tsx`（可选新增；至少两处真实复用才抽取）
- `packages/extension/src/popup/styles.css`
- `packages/extension/src/design/tokens.css`

### 新书签任务

- `packages/extension/src/tasks/bookmarks/BookmarkTaskApp.tsx`（新增）
- `packages/extension/src/tasks/bookmarks/bookmark-task-client.ts`（新增）
- `packages/extension/src/tasks/bookmarks/bookmark-task-model.ts`（新增）
- `packages/extension/src/tasks/bookmarks/BookmarkOrganizePage.tsx`（新增）
- `packages/extension/src/tasks/bookmarks/BookmarkRecoveryPage.tsx`（新增）
- `packages/extension/src/popup/pages/BookmarkTree.tsx`
- `packages/extension/src/popup/pages/ClassifyPreview.tsx`

### X 任务

- `packages/extension/src/popup/pages/XSyncPage.tsx`
- `packages/extension/src/popup/pages/x-sync-ui-model.ts`

只允许统一 shell、返回、动作层级、字号和重复标题；任何 sync schema、状态机、扫描、选择、
写入或 catalog 行为变化立即 STOP。

### 独立 Options

- `packages/extension/src/options/index.html`（新增）
- `packages/extension/src/options/main.tsx`（新增）
- `packages/extension/src/options/OptionsApp.tsx`（新增）
- `packages/extension/src/options/options-client.ts`（新增）
- `packages/extension/src/options/HistoricalHealthRecords.tsx`（新增）
- `packages/extension/src/popup/pages/RulesEditor.tsx`
- `packages/extension/src/popup/pages/MarkdownTemplateEditor.tsx`
- `packages/extension/src/utils/vault-writer.ts`（只读复用既有 handle/permission helper；
  预计不修改）

### 精确删除

- `packages/extension/src/popup/App.tsx`
- `packages/extension/src/popup/pages/ActivityPage.tsx`
- `packages/extension/src/popup/pages/BookmarkIndexExportPanel.tsx`
- `packages/extension/src/popup/pages/CollectionPage.tsx`
- `packages/extension/src/popup/pages/ExportPage.tsx`
- `packages/extension/src/popup/pages/HealthPage.tsx`
- `packages/extension/src/popup/pages/HelpPage.tsx`
- `packages/extension/src/popup/pages/HomePage.tsx`
- `packages/extension/src/popup/pages/InlineSavePanel.tsx`
- `packages/extension/src/popup/pages/OnboardingChecklist.tsx`
- `packages/extension/src/popup/pages/OrganizePage.tsx`
- `packages/extension/src/popup/pages/Settings.tsx`

### 测试

- `packages/extension/tests/app-state.test.ts`
- `packages/extension/tests/bookmark-operation-service-worker.test.ts`
- `packages/extension/tests/bookmark-operations.test.ts`（只允许为 101 项并发规模用例设置
  10 秒 test timeout；不得修改断言、fixture 或 production 实现）
- `packages/extension/tests/health-page.test.tsx`
- `packages/extension/tests/manifest.test.ts`
- `packages/extension/tests/extension-messages.test.ts`
- `packages/extension/tests/extension-trust-boundary-service-worker.test.ts`
- `packages/extension/tests/ai-classifier.test.ts`
- `packages/extension/tests/ai-providers.test.ts`
- `packages/extension/tests/popup-shell.test.tsx`
- `packages/extension/tests/sidepanel-shell.test.tsx`
- `packages/extension/tests/surface-build-boundary.test.ts`
- `packages/extension/tests/x-sync-page.test.tsx`
- `packages/extension/tests/bookmark-task-model.test.ts`（新增）
- `packages/extension/tests/bookmark-task-client.test.ts`（新增）
- `packages/extension/tests/bookmark-task-shell.test.tsx`（新增）
- `packages/extension/tests/bookmark-recovery-page.test.tsx`（新增）
- `packages/extension/tests/options-shell.test.tsx`（新增）
- `packages/extension/tests/options-build-boundary.test.ts`（新增）
- `packages/extension/tests/backup.test.ts`
- `packages/extension/tests/storage.test.ts`
- `packages/extension/tests/vault-writer.test.ts`（仅当 Vault 只读 projection 需要测试）

除以上文件外一律只读。需要修改 schema、SyncStore、catalog、Vault 写入、bookmark
operation service、AI classifier 或 Chrome bookmark adapter 时立即 STOP。

## 8. 安全与环境边界

- 046B 单元和组件测试只用 fake Chrome、fake IndexedDB 和纯 fixture。
- 不启动或控制任何 Chrome，不读取真实 tab、书签、X、Vault 或 extension storage。
- 不发真实网络请求，不测试真实 Provider。
- 不下载浏览器、依赖、远程字体、图片或样例数据。
- 不新增 analytics、telemetry 或日志正文。
- 不触碰主 checkout 的 Goal 032 未提交改动。
- 不读取、修改或清理其它 worktree、项目、进程、端口或用户目录。
- 不执行危险命令；精确删除只通过 patch 删除 allowlist 内文件。

## 9. 测试矩阵

### Sender 与 Options

- exact Options URL 接受；query、hash、错误 id/origin、tab sender、accessor sender 拒绝。
- Popup/Side Panel task validator 仍拒绝 Options。
- `bookmarkTask:getSnapshot` 只接受 exact Side Panel extension URL；Popup、Options、
  query/hash、错误 id/origin、tab sender 和 accessor sender 全部拒绝。任何拒绝路径均
  不得调用 `getFullTree()`、`flattenBookmarkTree()`、`getBookmarkTaskSettings()` 或
  operation/storage helper。
- Options 白名单 request 全部可达；backup summary 不含 tree，按 exact key 只返回单份
  backup；健康记录只在显式展开后读取。
- `state:get` 和 `state:summary` 不再属于 runtime schema；所有 sender 均收到
  `invalid_request`，service worker 不再构造聚合 state。
- Options 的 plan、operation、X、surface、classification port 均 fail closed。
- Popup/Side Panel 原有 request 不回归。

### Popup 与 Side Panel

- 三个 surface 的设置 icon 只调用 `openOptionsPage`。
- Popup 仍只有一个 primary CTA 且不加载设置。
- idle -> bookmark task -> exit -> idle。
- X active 关闭后重开必须回 exact task；只有四种 terminal 状态的返回进入 idle。
- bookmark task 和 X task 只在对应 route 动态加载。
- Side Panel production graph 不包含旧 `App.tsx`。

### 书签旅程

- 首次 snapshot、snapshot 失败但 operation 可恢复、空书签、1,000+ 书签。
- snapshot 只含 `BookmarkTaskSettings`；大体积或无效模板、active template IDs 和
  exportDirectory 均不进入响应，也不阻断可用分类设置。
- `getBookmarkTaskSettings()` 对 stored public envelope 和 legacy public settings
  分别覆盖：合法六字段、单字段损坏、模板含 `null`、模板超过完整 settings budget、
  secret 只映射为 `hasApiKey`。
- stored public envelope 与 legacy public settings 分别覆盖分类字段自身的 byte、depth
  和 array 超限：每次只允许对应字段回退，其余五字段保持；读取不得迁移、改写或删除
  `storage.local` 数据。
- safe/full 分类、AI consent allow/deny/fallback、进度、cancel、invalid port message。
- plan 预览、逐项选择、zero selection、确认取消、apply success/partial/failure。
- operation progress、restore、restore conflict、accept current、安全停止。
- 可见返回、Escape、close、reload、Port disconnect 的状态矩阵；classification close
  安全 abort 且 mutation 为 0，operation close 后从全部 retained journal 恢复真实结果。
- 未确认时 `chrome.bookmarks.move/remove/update` 调用为 0。
- 界面不出现“重复项”结果或删除入口；重复检测明确等待后续独立算法合同。
- 既有 `bookmark-operation-service-worker.test.ts` 改为验证 `state:get` 返回
  `invalid_request`，同时 `operations:getRecent` 仍独立成功且 mutation 调用为 0。

### Options

- Vault 挂载只读状态；只有用户点击才调用 picker。
- X permission contains/request/remove。
- AI disabled/local-only、set/clear/test、permission deny、legacy conflict。
- 高级 section 默认折叠；规则、模板保存沿用 schema。
- 备份只在用户点击后按 exact key 获取并生成下载；legacy clear 需确认。
- 旧链接记录只读、复制、安全后台打开和 confirmed clear；不会生成 mutation。
- 不发送 `state:get` 或读取当前 tab。

### X 回归

- Goal 043 launch、scan、pause/resume、bounded review/write、catalog duplicate、
  `tab_changed`、cancel/no-write。
- 默认选择仍为最多 5 个 new/list-summary；metadata-only 不默认选。
- 返回不进入旧 App。

### Build

- `dist/options/index.html` 与独立 options entry 存在。
- Popup 初始静态 JS gzip `<130 kB`。
- Side Panel idle 初始依赖图不含 bookmark task、X task 或 Options。
- bookmark task 静态依赖图不含 old App、Home、Collection、Activity、Settings、
  XSyncPage、SyncStore 或 Vault writer。
- Options 静态依赖图不含 old App、任务页、书签树、SyncStore、X adapter 或
  `state:get`。
- bookmark task dynamic route 静态 JS gzip `<180 kB`。
- Options initial static JS gzip `<180 kB`。
- 无单一 UI chunk `>500 kB` warning。
- 所有待删旧文件在源码引用和 production sourcemap/module graph 中为 0。

### Semantic UI 与 accessibility

- 组件 fixture 验收语义 DOM、唯一 primary CTA、键盘顺序、focus-visible、Escape/返回、
  折叠 `aria-expanded`、loading/result live region 和 reduced-motion class/token。
- 静态检查不出现 `text-[11px]` 重要状态，不出现页面 section Card 套 Card。
- DPR 2、200% 缩放、真实 overflow、固定 ActionBar 遮挡、light/dark 像素和多 viewport
  截图不由 jsdom 冒充证据；全部移交已获用户授权的 Goal 046C 隔离浏览器 E2E。

## 10. 门禁

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

另需记录：

- `git diff --check`。
- 精确 allowlist 比较。
- build 文件名、raw/gzip 大小和依赖边界。
- 删除文件引用扫描。
- 独立 contract review，P0/P1/P2 明确。
- 独立 implementation architecture/security review，P0/P1/P2 明确。

最终证据（2026-07-24）：

- `pnpm lint`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm test`：PASS；Shared `1/1`、Desktop `25/25`、Extension `845/845`。
- `pnpm --filter @shuhai/extension run build`：PASS；`1981` modules。
- Popup `7.98 kB / 3.45 kB gzip`；Side Panel `7.78 kB / 2.85 kB gzip`；
  `BookmarkTaskApp` lazy chunk `55.96 kB / 17.18 kB gzip`；Options
  `62.91 kB / 20.42 kB gzip`；无 UI chunk `>500 kB`。
- `git diff --check`：无错误，仅保留仓库既有 Windows 行尾提示。
- production boundary 测试确认旧 `App.tsx` 和精确删除页面不在依赖图中。
- 101 项并发 journal 用例在完整并行套件下曾三次触发 Vitest 默认 5 秒 timeout，
  standalone 为 `2.258s`；经合同 amendment 独立 `PASS` 后只把该测试显式设为 10 秒，
  最终完整套件为 `4.878s`，断言、fixture 和 production 实现均未改变。
- 独立 Reviewer Locke 最终 `PASS`，P0/P1/P2/P3 均为 0；Reviewer 未修改文件或访问
  真实 Chrome、X、Vault、网络和用户书签。

## 11. 状态推进

```text
DRAFT
  -> independent contract PASS
  -> READY
  -> IN_PROGRESS
  -> gates PASS
  -> READY_FOR_REVIEW
  -> independent implementation PASS
  -> DONE
```

- 用户对 Goal 046 总体自动编排的授权不替代本合同独立 review。
- 外部 GLM 预审已转发但尚未返回；不得虚构其结论。若返回 P0/P1，先修订合同并复审。
- 046B `DONE/PASS` 前不得开始 046C 实施。

## 12. 完成条件

- 两条生产用户旅程均不再进入旧 `App.tsx`。
- Options 成为独立受界构建入口。
- 旧管理后台页面引用清零并按精确列表删除。
- 书签 mutation、X sync、Vault 和 AI 隐私合同无行为回归。
- 完整门禁、bundle 预算和精确 allowlist 通过。
- 独立 implementation review 为 `PASS`，P0/P1/P2 均为 0。
- 文档收口并形成独立 commit；不得顺带实施 046C。
