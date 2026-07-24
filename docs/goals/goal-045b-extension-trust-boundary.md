---
id: goal-045b
title: Extension Trust Boundary And URL Health Retirement
status: DONE
version: 6
updated: 2026-07-18
depends_on:
  - goal-045a
branch: codex/p0-p1-security-hardening
base_commit: 5f1f9f2
contract_review:
  agent: 019f7064-b923-7c62-87ee-f4feeedbef7b
  verdict: PASS
  p0: 0
  p1: 0
  p2: 0
implementation_review:
  agent: 019f729b-c43c-7301-afcc-792b82910307
  verdict: PASS
  p0: 0
  p1: 0
  p2: 0
---

# Goal 045B：扩展信任边界与 URL 体检安全收口

## 1. 用户问题

Goal 045A 已保证三类书签 mutation 可记录、可解释和可恢复，但旧扩展壳仍有五组 P1：

1. 普通 legacy runtime message 只做 TypeScript cast，没有严格运行时 schema。
2. `classify` / `health` Port 没有绑定精确 extension sender。
3. `storage.local` 默认对 content script 可见，包含设置、健康记录和 operation journal。
4. URL 体检持有全站可选权限，自动跟随未验证重定向，不能在稳定版 Chrome 中抵御
   DNS rebinding。
5. 历史健康结果没有绑定扫描时的完整书签身份，却可以触发删除或 URL 更新。

这些问题必须在内容保存与 AI 收口之前解决，不能依赖“页面一般不会伪造消息”或
“初始 URL 看起来是公网”。

## 2. 官方能力结论

本 Goal 只采用 Chrome 官方资料作为浏览器能力依据：

- [`chrome.dns`](https://developer.chrome.com/docs/extensions/reference/api/dns) 仍只在
  Dev channel 可用，官方明确没有迁入 stable 的可预见计划。
- [跨源网络请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
  说明 extension service worker 在拥有 host permission 后可访问对应远程源，并明确警告
  不要接受不可信 content script 提供的任意 URL。
- [`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage/)
  默认向 content script 暴露 `storage.local`，Chrome 102+ 可用
  `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` 收紧。
- [`chrome.permissions`](https://developer.chrome.com/docs/extensions/reference/api/permissions)
  支持按需请求和移除 optional host permissions。

### 2.1 架构决定

纯稳定版 Chrome Extension 无法在每次请求和每个重定向之前可靠获得并固定实际解析 IP，
因此当前架构不能证明任意书签 URL 不会解析到本机、内网、云 metadata 或在校验后发生
DNS rebinding。

本 Goal 采用 fail-closed 决定：

1. 停用任意 URL 的主动网络体检，不发 HEAD/GET，不请求全站权限。
2. 从 manifest 删除 `http://*/*`、`https://*/*`，只保留 X 同步所需的精确
   `https://x.com/*` optional host permission。
3. Service Worker 启动时尝试撤销旧版本遗留的两项 broad grants；失败时不启动任何
   legacy message/Port 工作。
4. 旧健康结果只作为“历史、未复核”信息，允许打开或复制原 URL、清除本地历史；不得
   重试、批量选择、删除书签、自动替换或手工替换 URL。
5. `health` Port 一律拒绝并断开；`health:retryOne` 不再是受支持的 legacy request。

重新引入网络体检需要新的研究 Goal，且必须先证明稳定版浏览器能够满足 DNS、重定向、
权限回收和请求目标绑定，不得在本 Goal 留隐藏开关。

## 3. 用户结果

完成后：

- 普通网页/content script 不能读取 `storage.local`，也不能调用 legacy UI 命令。
- 只有当前扩展自己的 Popup 或 Side Panel 可以发送经过严格 schema 校验的 legacy
  message；未知字段、超限结构和错误 surface 全部 fail closed。
- `classify` Port 只接受精确 extension UI sender 和严格 request；输出也在发送前校验。
- X 严格协议和 Goal 045A bookmark operation 协议保持原合同，不降低现有 sender/schema。
- 扩展不再持有全站 optional host permission，也不会主动访问任意书签 URL。
- 用户看到链接体检为何暂不可用；旧结果不会再被描述为可靠死链证据或触发真实书签修改。
- 设置、operation journal、待保存内容和 API Key 不再默认暴露给 content script。

## 4. 精确工作合同

```text
Task / Goal: Goal 045B Extension Trust Boundary And URL Health Retirement
Owner / Role: Integrator + Implementer; independent Reviewer required
Base commit: 5f1f9f2
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
- docs/goals/goal-045a-bookmark-mutation-safety.md
- docs/goals/goal-045b-extension-trust-boundary.md
- docs/workflows/README.md
- docs/workflows/task-contract.md
- docs/workflows/command-safety.md
- docs/workflows/dangerous-command-denylist.md
- docs/workflows/verification-and-acceptance.md
- packages/extension/package.json
- packages/extension/manifest.json
- packages/extension/src/background/service-worker.ts
- packages/extension/src/shared/bookmark-types.ts
- packages/extension/src/shared/extension-messages.ts
- packages/extension/src/utils/storage.ts
- packages/extension/src/utils/url-health.ts
- packages/extension/src/utils/bookmark-operations.ts
- packages/extension/src/popup/App.tsx
- packages/extension/src/popup/pages/HomePage.tsx
- packages/extension/src/popup/pages/OrganizePage.tsx
- packages/extension/src/popup/pages/HealthPage.tsx
- packages/extension/src/popup/pages/Settings.tsx
- packages/extension/src/popup/pages/XSyncPage.tsx
- packages/extension/src/popup/pages/x-sync-ui-model.ts
- packages/extension/src/social/x-sync-messages.ts
- packages/extension/tests/setup.ts
- packages/extension/tests/storage.test.ts
- packages/extension/tests/url-health.test.ts
- packages/extension/tests/manifest.test.ts
- packages/extension/tests/app-state.test.ts
- packages/extension/tests/extension-messages.test.ts
- packages/extension/tests/extension-trust-boundary-service-worker.test.ts
- packages/extension/tests/health-page.test.tsx
- packages/extension/tests/bookmark-operation-service-worker.test.ts
- packages/extension/tests/bookmark-operations.test.ts
- packages/extension/tests/x-sync-service-worker.test.ts
- packages/extension/tests/x-sync-page.test.tsx
- packages/extension/tests/x-sync-ui-model.test.ts

Allowed writes:
- docs/PROJECT_STATUS.md
- docs/product-roadmap-v4.md
- docs/goals/README.md
- docs/goals/goal-045b-extension-trust-boundary.md
- docs/workflows/README.md
- packages/extension/manifest.json
- packages/extension/src/background/service-worker.ts
- packages/extension/src/shared/bookmark-types.ts
- packages/extension/src/shared/extension-messages.ts
- packages/extension/src/utils/storage.ts
- packages/extension/src/utils/url-health.ts
- packages/extension/src/popup/App.tsx
- packages/extension/src/popup/pages/HomePage.tsx
- packages/extension/src/popup/pages/OrganizePage.tsx
- packages/extension/src/popup/pages/HealthPage.tsx
- packages/extension/src/popup/pages/Settings.tsx
- packages/extension/src/popup/pages/XSyncPage.tsx
- packages/extension/src/popup/pages/x-sync-ui-model.ts
- packages/extension/src/social/x-sync-messages.ts
- packages/extension/tests/setup.ts
- packages/extension/tests/storage.test.ts
- packages/extension/tests/url-health.test.ts
- packages/extension/tests/manifest.test.ts
- packages/extension/tests/app-state.test.ts
- packages/extension/tests/extension-messages.test.ts
- packages/extension/tests/extension-trust-boundary-service-worker.test.ts
- packages/extension/tests/health-page.test.tsx
- packages/extension/tests/bookmark-operation-service-worker.test.ts
- packages/extension/tests/x-sync-service-worker.test.ts
- packages/extension/tests/x-sync-page.test.tsx
- packages/extension/tests/x-sync-ui-model.test.ts

Forbidden:
- C:\Projects\ShuHai main worktree writes
- .task-artifacts reads, writes or execution
- packages/desktop and packages/shared
- package manifest, dependencies, lockfile and lifecycle hooks
- Goal 045A operation schema, journal semantics or mutation eligibility
- X adapter/store/engine/Vault writer and content extraction/AI implementation
- X message schema changes beyond adding the single strict `security_bootstrap_failed` error
  variant; sender/request/unknown-field validation may not be weakened
- new permission, new dependency, Native Messaging, daemon or companion
- real Chrome, X, Vault, user bookmarks, network requests or external AI
- DNS emulation, proxy interception or claims that literal-IP checks solve DNS rebinding
- deletion of quarantine or dependency roots

Allowed commands:
- bounded Get-Content / rg for exact Allowed reads
- git status --short --branch
- git diff / git diff --check limited to exact Allowed writes
- git show/log for current branch and exact Allowed reads
- exact apply_patch inside Allowed writes
- fixed offline pnpm 10.34.5 lint/typecheck/test/build commands from Goal 045A
- exact Prettier/ESLint paths already verified in Goal 045A
- non-destructive exact-file git add/commit after independent PASS

Risk: R1, mock-only
No dependency or permission addition is allowed.

STOP:
- a fix requires changing Goal 045A request or journal contracts
- a fix requires stable DNS resolution/pinning, a new permission, browser Dev channel or native code
- strict schemas cannot represent the existing UI without exposing secrets to an untrusted sender
- X or bookmarkOperations sender contracts would need weakening
- first proof requires real Chrome, network, Vault, X or user bookmark access
- any unknown worktree change appears in an allowed file
- fixed offline toolchain attempts install, download, lifecycle or dependency materialization
```

## 5. Message 与 Port 合同

### 5.1 Legacy runtime message

新增独立 `extension-messages.ts`，不把普通 UI 协议继续堆入 operation 或 X 协议模块：

- request、success/error response、classification Port request/message 均使用 Zod
  `strictObject` / discriminated union。
- unknown 输入在解析前执行第 5.4 节的固定 byte、depth、node 和单 string 上限；解析错误
  只返回固定 `invalid_request`，不回显输入。
- sender 必须同时满足：
  - `sender.id === chrome.runtime.id`
  - `sender.tab === undefined`
  - URL 的 origin 精确等于当前 extension origin
  - pathname 精确为 `/popup/index.html` 或 `/sidepanel/index.html`
  - 不接受 query、fragment、错误 scheme、错误 extension id 或 options/content script URL
- `parseLegacyResponse(request, raw)` 必须按原 request 做 request-correlated 校验；每种
  request 只能接受自己的 success data，error envelope 也必须 strict。
- response 在 Service Worker 发送前和 UI 消费前按对应 request type 校验；
  `App.sendMessage` 不得保留泛型 `as T`，非法响应不得更新任何 UI state。
- 错误只返回稳定 code 和固定短消息，不返回 provider body、URL、API Key 或原始异常文本。
- 新增只读 legacy route `operations:getRecent`，不得使用保留给 mutation router 的
  `bookmarkOperations:` 前缀。严格响应为 `{ operations: BookmarkOperation[] }`，返回
  `getBookmarkOperations()` 中全部 retained operations，沿用既有排序，不截断、不读取
  书签树/capture/健康记录/设置，也不执行 reconciliation/mutation。
- `state:get` 不再承担 operation 恢复数据；App 独立加载 `operations:getRecent`。即使
  `state:get` 因无关 tree/capture/health 损坏或超限失败，恢复界面也必须展示已加载的
  delete/update operations，并允许按 Goal 045A 协议执行 restore、cancel、acceptCurrent。
- 新增严格、只读、request-correlated 的 `security:getBootstrapStatus`。这是唯一不在
  handler 内再次等待 bootstrap 的 legacy request：精确 sender/schema 校验后直接等待
  bootstrap 终态，成功返回 `{ ready: true }`，失败返回 fixed
  `security_bootstrap_failed` error；不泄漏失败阶段、权限列表或原始异常。
- Popup X launcher 和 Side Panel `XSyncPage` 在打开 SyncStore、Vault handle、launch intent
  或连接 X Port 前必须先调用 `security:getBootstrapStatus`；失败只显示固定权限说明，
  这些 storage/Vault/Port 调用次数必须为 0。X 业务命令仍使用 X strict
  `security_bootstrap_failed` error variant。

现有 X 与 bookmarkOperations envelope 继续优先路由。任何带这两个协议前缀但 schema 错误的
输入必须在对应路由内 fail closed，不能落入 legacy handler。

所有 `onMessage` / `onConnect` listener 必须在模块加载时同步注册，不能因异步安全初始化
失败而让请求悬挂。固定路由顺序为 X namespace -> `bookmarkOperations:` prefix ->
legacy；每条路由先完成自己的 sender/schema 校验，再等待第 6 节的同一个 bootstrap
Promise。bootstrap pending/reject 时，协议之间也不得 fall through。

### 5.2 Classification Port

- 连接时先验证精确 sender；失败立即 disconnect，且不注册业务 listener。
- 只接受严格：
  - `{ type: "plan:create", requestId, mode }`
  - `{ type: "cancel", requestId, targetRequestId }`
- requestId 使用安全随机 ID 并受 schema 长度/字符约束；progress/complete/task-error 都必须
  回显对应 plan requestId。cancel 的自身 requestId 用于审计，targetRequestId 必须精确
  命中当前 plan，否则 fail closed。
- 收到 `plan:create` 时先 bounded parse 并记录 requestId，再等待 bootstrap；bootstrap
  失败时发送一次
  `{ type: "error", requestId, errorCode: "storage_unavailable" }` 后 disconnect，期间不
  创建 controller、不读取书签。
- 每条 Port 同时最多一个 active plan；第二个 `plan:create` 返回固定
  `classification_in_progress` error，回显被拒绝 plan 的 requestId 后断开，不隐式替换
  前一个 controller。
- 合法定向 cancel 返回
  `{ type: "cancelled", requestId, targetRequestId }` 后断开；无法取得合法 requestId 的
  malformed/超限输入直接 disconnect，不发送不可关联 error。
- progress/complete/error 在 `postMessage` 前按 schema 校验并限制最大大小。
- disconnect/cancel 继续中止当前 controller；不得影响 X 或其它任务。
- Popup/Side Panel 的 classification listener 必须先 bounded parse 输出，再更新 progress
  或 plan；只接受当前 requestId。非法、错 variant、错 requestId、迟到或超限输出一律
  丢弃并停止当前分类任务。

### 5.3 Health Port

- `port.name === "health"` 立即 disconnect。
- 不注册 message listener，不创建 AbortController，不调用 fetch。
- unknown port 同样 disconnect。

### 5.4 结构预算

预算按 UTF-8 bytes 计算，并通过有环检测、不会调用 accessor 的 plain structured clone
执行。生产 message 输入应来自 Chrome structured clone；JavaScript 不能透明识别所有
Proxy，因此不声称“识别 Proxy”，而是在 prototype/descriptor trap 抛错时 fail closed。
accessor、`undefined`、`bigint`、symbol、function、非有限 number、禁用 key
`__proto__` / `constructor` / `prototype` 一律拒绝。唯一允许的 primitive 是
`null | string | boolean | finite number`。

| 通道                                               | max bytes | max depth | max nodes | max single string |
| -------------------------------------------------- | --------: | --------: | --------: | ----------------: |
| legacy request                                     |   512 KiB |        32 |    20,000 |           256 KiB |
| legacy response，包括 `state:get`                  |    16 MiB |        64 |   250,000 |             2 MiB |
| `operations:getRecent` response                    |     5 MiB |        64 | 4,194,305 |            64 KiB |
| classification Port request                        |     8 KiB |         8 |        64 |             1 KiB |
| classification Port progress/complete/error output |     8 MiB |        32 |   150,000 |           256 KiB |

计量规则唯一且由生产/测试共用同一 helper：

- root depth 为 0；进入任一 object property value 或 array element 时 depth `+1`。
- 每个 object、array、primitive/null 各计 1 node；property key 不另计 node。
- max single string 同时约束 property key 和 string value，按 `TextEncoder` UTF-8 bytes。
- 安全 clone 只接受 `Object.prototype`/`null` plain object 和普通 array；通过
  `Object.getOwnPropertyDescriptors` 读取 own data properties，拒绝 getter/setter、symbol、
  稀疏/越界 array key、环和 forbidden key，不调用用户 getter。
- clone 期间先以 UTF-8 key/value 增量计数提前拒绝明显超限值；最终 bytes 必须严格等于
  `TextEncoder(JSON.stringify(safeClone)).byteLength`，且不得大于表中上限。

`operations:getRecent` 的预算由 045A 上限推导：任意合法 journal JSON 不超过
`BOOKMARK_OPERATION_JOURNAL_MAX_BYTES = 4 MiB`，每个 JSON node 至少占 1 byte，因此
`4,194,305` nodes、64 depth、64 KiB single string 是既有 schema 上限的超集；5 MiB 为
`{ operations }` response envelope 留出固定余量。测试必须证明接近 4 MiB、最大 node
density 和多个非最新可恢复 operation 均可返回。

各维度的 `limit - 1`、`limit`、`limit + 1` 测试使用同一生产 helper 的可注入小型 limits，
测试目标维度时放宽其它维度；不得为 production node 常量分配 419 万节点 fixture。
production constants 另测接近 4 MiB 的合法 045A journal、5 MiB response 上限和全部
retained operations。

`state:get` 的 16 MiB 明确包含书签树、历史 capture 和旧健康记录；operation 使用独立
5 MiB 响应预算。超过预算时 fail closed，不截断或返回半个 state。每项边界至少覆盖
`limit - 1`、`limit`、`limit + 1`，并覆盖 depth、nodes、single string，而不是只测 JSON
总长度；另覆盖 `undefined`、`bigint`、JSON 转义字符串和 non-BMP UTF-8。

## 6. Storage 与权限合同

1. `ensureTrustedLocalStorageAccess()` 对同一 extension context 生命周期只初始化一次。
2. 必须调用 `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`。
3. API 缺失、throw、callback/runtime error 或 Promise reject 都让 local read/write/remove
   和 legacy/X/bookmark command/classification Port 入口 fail closed。
4. 初始化未完成时，消息可以等待同一 Promise，但不能先读取或写入敏感 storage。
5. 测试证明并发十次调用只触发一次初始化。
6. manifest 的 optional host permissions 只能包含 `https://x.com/*`。
7. Service Worker 使用同一个 `securityBootstrap`，顺序固定为：
   `setAccessLevel(TRUSTED_CONTEXTS)` -> `permissions.getAll` -> 必要时精确
   `permissions.remove` broad origins -> 再次 `permissions.getAll` 验证后验。
8. 两项 broad origin 原本均不存在时 cleanup 幂等成功；存在时最多 remove 一次，不能只信
   callback boolean，只有二次 `getAll` 确认两项均消失才成功。`remove=false` 但后验已
   消失可成功；`remove=true` 但仍存在必须失败。
9. cleanup 前已单独存在的 `https://x.com/*` 在 cleanup 后必须仍存在；若只有 broad grant，
   cleanup 后 X 状态为 `not_granted`，只能由用户在 X 流程重新授权，不自动 request。
10. API 缺失、throw、runtime error、Promise reject、二次检查失败或 exact X grant
    意外消失均让 bootstrap fail closed。
11. `SECURITY_BOOTSTRAP_TIMEOUT_MS = 5000` 覆盖从 `setAccessLevel` 到最后一次
    `permissions.getAll` 的完整链；任一 callback/Promise 5 秒内不 settle 即 timeout。timeout
    后本 Service Worker 生命周期永久 fail closed，迟到 callback/resolve 不能重置状态或
    触发任何业务副作用。
12. timeout 设置永久 `expired` latch；每个 await/callback 返回后、调用下一项 Chrome API
    前必须复核。过期后不得再启动后续 `getAll`/`remove` 步骤；已在途 Chrome 调用可以迟到
    完成，但不得推进链、改变 bootstrap 结果或触发业务副作用。
13. bootstrap 成功前不得启动 `xSyncRecovery`、operation reconciliation、classification
    controller、storage read/write、context-menu capture 或其它业务 Chrome API 副作用。
14. listener 仍同步存在并返回各协议的稳定失败：
    - X strict error union 新增唯一 `security_bootstrap_failed`，不得冒充
      `storage_corrupt`；request/sender/unknown-field 规则保持不变。
    - bookmarkOperations 使用既有固定 failure envelope 与 `storage_read_failed`。
    - `security:getBootstrapStatus` 唯一使用 strict
      `security_bootstrap_failed` error；其它 legacy routes 使用 strict
      `storage_unavailable`，两者不得互换。
    - classify Port 发送一次 strict error 后断开。
    - health/unknown Port 不等待 bootstrap，立即断开。
15. cleanup 失败时 Popup 与 Side Panel 的 X UI、legacy 错误面只显示固定说明：
    “旧全站访问权限未能确认撤销，ShuHai 已暂停；请在扩展详情中撤销站点访问后重新加载
    扩展。”不声称已经撤销，也不提供会自动请求 broad permission 的重试。
16. 删除 X 页面旧 broad cleanup/retry UI；保留用户主动申请/撤销精确
    `https://x.com/*` 的既有入口。真实 sync-store 损坏仍使用既有 `storage_corrupt` 文案。
17. 不把权限撤销失败降级成 warning 后继续任意 URL fetch。

## 7. URL 体检退役语义

- `checkBookmarkUrl` / `checkBookmarkUrls` 保留为显式 unavailable API 或完全移除生产导出；
  任一路径都必须在调用 `fetchImpl` 前以稳定 `url_health_unavailable` 失败。
- `summarizeHealthRecords` 可保留为纯函数，用于展示历史数据。
- UI 首屏说明：当前纯扩展架构无法安全验证任意地址和重定向，因此暂不主动扫描。
- 历史结果标为“旧检查结果，仅供人工核实”，不显示“今天检查完成”。
- `UrlHealthRecord` 使用 strict runtime schema；数组最多 10,000 条，bookmark id 最长
  512 bytes，title/error 最长 4 KiB，parent path 和 URL 最长 8 KiB，timestamp 最长
  64 bytes，status 只接受既有 enum，number 必须有限且非负。storage 中非法记录只从
  trusted UI 结果排除，原始 storage 不自动改写或删除。
- 每条历史结果只允许：
  - action-time 再次校验后，在非激活新标签打开原 URL。
  - 复制原 URL。
- 可打开 URL 只允许不含 username/password、控制字符且 UTF-8 不超过 8 KiB 的
  `http:` / `https:`；只调用 `chrome.tabs.create({ active: false, url })`。不满足条件的
  记录仍可显示和复制，但“打开”禁用；删除 `window.open` fallback。
- 可清除整个本地历史；不能按结果删除/更新真实书签。
- 只移除“由历史健康结果创建新 mutation”的入口；Goal 045A 已验收的独立 operation
  journal 面板必须保留 `restore`、`cancel`、`acceptCurrent`、partial/conflict 展示，
  重开扩展后仍能恢复此前已经执行成功的 delete/update operation。
- `state:get` 失败时，App 使用独立 `operations:getRecent` 结果显示最小恢复面板；其它
  整理、capture、健康历史操作保持禁用，不用空 state 假装完整加载成功。
- 旧 `dead/error/redirected` 标签不再等于可操作结论。
- 不保留隐藏快捷键、旧 handler 或 fallback message 重新发起扫描。

## 8. 测试矩阵

至少覆盖：

- `storage.local.setAccessLevel` 成功、缺失、reject、runtime error 和十路并发单次初始化。
- 初始化失败时 local get/set/remove、legacy message、X Port 和 bookmark operation command
  都没有业务副作用。
- bootstrap pending/reject 时，X、bookmarkOperations、legacy 三条 message 路由互不
  fall through；listeners 不悬挂；classification 不创建 controller 或读取书签。
- fake timer 分别覆盖 `setAccessLevel`、首次/二次 `getAll`、`remove` 永不 settle，
  5 秒后稳定失败；迟到 success 仍不触发后续 permission API、storage、recovery、
  controller 或 mutation，并冻结 `getAll/remove` 调用次数。
- Popup/Side Panel 合法 sender；错误 id、tab/content script、options、query、fragment、
  fake URL、Proxy getter 全部拒绝。
- 每种 legacy request 的合法最小样例；unknown field、错误 union、超长 string、超深/超大
  payload 全部拒绝。
- 每种 legacy response 与原 request 匹配；unknown field、错误 success variant、超限响应
  和包含原始异常文本的响应被后台或 UI 拒绝，且不会修改 UI state。
- `security:getBootstrapStatus` 初始 mount 失败时 Popup X launcher / XSyncPage 的
  SyncStore、Vault、launch intent 和 X Port 调用次数均为 0，只显示固定权限说明。
- parser 与 UI 分别断言 bootstrap status 只接受 `security_bootstrap_failed`，其它
  legacy route 只接受 `storage_unavailable`，错误码不得互换。
- `state:get` 因无关字段损坏/超限失败后，`operations:getRecent` 仍让 delete/update 的
  restore、cancel、acceptCurrent 和 conflict/partial 可见；未确认时 mutation 为 0。
- `operations:getRecent` 返回全部 retained operations，包括多个非最新可恢复项；接近
  4 MiB 与最大 node density 的合法 045A journal 不被新预算拒绝。
- classification Port sender/request/output schema、bootstrap 关联错误、cancel ack、定向
  cancel、重复 plan、错 requestId、迟到 complete、disconnect 和无 ID malformed 后终止。
- health/unknown Port 立即断开，fetch mock 调用次数为 0。
- `checkBookmarkUrl` / batch API 即使传入公网 URL 和 mock fetch 也 fail closed，fetch 为 0。
- manifest 不含 broad host permission，只保留精确 X optional origin。
- legacy broad permission cleanup 覆盖 absent、broad-only、exact-X+broad、
  false-but-absent、false-and-still-present、runtime error/reject；失败时业务无副作用。
- Popup/Side Panel 对 `security_bootstrap_failed` 只显示固定权限说明；真实
  `storage_corrupt` 仍显示原文案；旧 broad cleanup UI 消失，精确 X 权限入口保留。
- HealthPage 不渲染 start/retry/delete/update/selection 控件，只保留说明、打开、复制和
  清除；`health-page.test.tsx` 同时证明 reload 后 delete/update operation 仍有恢复入口。
- tampered 历史 `javascript:`、`data:`、`file:`、带凭据、控制字符和超长 URL 均不能
  导航，`chrome.tabs.create` 调用次数为 0；合法 HTTP(S) 只以 `active:false` 打开。
- 第 5.4 节每个预算覆盖 bytes/depth/nodes/single-string 的
  `limit - 1`、`limit`、`limit + 1`。
- 现有 X、bookmarkOperations、app-state、storage、manifest 测试不回归。

完整门禁：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
git diff --check
independent review PASS with P0/P1 = 0
```

## 9. 完成定义

- content script 无法直接读取 `storage.local`。
- 所有 legacy message/classification Port 都有严格 schema、预算和 sender binding。
- 同一个 fail-closed bootstrap 完成 storage trusted contexts 和 legacy permission 后验；
  失败时 listeners 有稳定响应且所有业务副作用为 0。
- `operations:getRecent` 独立于聚合 state，state 损坏或超限不切断 Goal 045A 恢复入口。
- health Port 与任意 URL fetch 均不可达。
- broad optional host permission 从 manifest 和遗留 grant 中移除。
- 健康历史不再触发真实书签删除或 URL 更新。
- Goal 045A 的 operation 恢复、停止、接受当前状态和冲突展示没有回归。
- X 与 Goal 045A 协议测试保持通过。
- 完整门禁和独立 review 通过。
- 未触碰真实 Chrome、X、Vault、网络或用户书签。

## 10. 完成证据

- 2026-07-18 完成 mock-only 实施；实际变更严格限定为合同列出的 30 个文件，没有新增依赖或
  lockfile 变化。
- manifest 已移除 broad host permission 与静态平台 content script；只保留精确 X optional
  origin，并通过用户动作后的按需注入启动扫描。
- storage trusted-context bootstrap、legacy message、classification Port、健康历史只读、
  operation 恢复和固定错误协议均有边界测试。
- Goal 定向测试 303/303、全仓测试 702/702 通过；`pnpm lint`、`pnpm typecheck`、
  `pnpm test`、扩展 build、Prettier check 和 `git diff --check` 全部通过。
- Carver (`019f729b-c43c-7301-afcc-792b82910307`) 独立实现复审结论为 `PASS`，
  P0/P1/P2 均为 0。
- 全程没有操作真实 Chrome、X、Vault、网络或用户书签。
