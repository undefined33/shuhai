---
id: goal-043
title: X Bookmarks Incremental Sync MVP
status: IN_PROGRESS
version: 2
updated: 2026-07-14
depends_on: [goal-041, goal-042]
branch: codex/social-sync-v4
---

# Goal 043：X 收藏增量同步 MVP

> Goal 041 对 X 收藏页 DOM 路线只给出 `LIMITED_GO`，Goal 042 已 `DONE/PASS`。043A fixture-only 候选已通过完整门禁、离线 Chrome fixture E2E 和最终独立 actual-diff review。043B v2 实施合同也已完成两位独立 reviewer 的多轮复审并最终 `PASS`。用户明确授权日常 Chrome 只操作 X 并要求限制并发后，043B 已转为唯一 `IN_PROGRESS` Goal；当前只实施生产接线、测试和离线 fixture E2E，不读取真实 X、不请求 Vault。项目隔离 profile 优先；隔离测试账号确实无法登录后，只允许用户明确指定的单个日常 X 收藏页标签作为真实 QA 例外。真正的真实 X probe 必须在生产实现和离线验收之后运行，不能作为实现自己的前置证据。

## 1. 用户问题

用户已经在 X 收藏页保存了大量内容，希望点击一次后只把新增收藏写入 Obsidian；关闭 Side Panel、service worker 重启、页面虚拟列表回收或 Vault 部分失败时，任务仍应暂停、恢复和去重，而不是从头重复、伪装完整或覆盖已有笔记。

## 2. 最终用户结果

1. 用户只在当前打开的官方 X 收藏页主动启动任务。
2. 首次扫描和后续增量扫描均显示预算、进度、暂停和停止原因。
3. 扫描结果区分新增、已存在、内容变化、不完整和失败；列表摘要不得标成完整正文。
4. 用户复核精确选择后才进入 Vault 写入；重启后仍保留同一选择、revision 和目标路径。
5. 已同步 `source + sourceItemId` 不重复生成文件；源端取消收藏不删除本地笔记。
6. 最终结果显示 created/already_exists/skipped/error 等真实逐项结果，不把 partial 写成完成。

## 3. 分阶段门禁

### 3.1 Gate G0：工具链

Goal 042 只在“不启动监听服务”的窄条件下接受了既有 Vite/Vitest high/critical 债务。Goal 043 在进入 `READY_FOR_REVIEW`、运行任何浏览器 E2E 或启动监听服务前，必须满足其一：

- 升级到经官方 metadata、advisory、Node 兼容性和 lockfile diff 核实的精确安全版本，并通过完整门禁；或
- 由独立 Product/Security reviewer 对精确残余 advisory、命令和浏览器运行方式重新批准。

官方 registry metadata 与 advisory 核查得到以下最小安全组合，合同 review 通过后才允许安装：

| 位置      | 包                     | 当前版本 | 精确候选版本 | 说明                                                |
| --------- | ---------------------- | -------- | ------------ | --------------------------------------------------- |
| root      | `vitest`               | `3.1.4`  | `3.2.6`      | 修复 `GHSA-5xrq-8626-4rwp`                          |
| root      | `@vitest/coverage-v8`  | `3.1.4`  | `3.2.6`      | 必须与 Vitest 同版本                                |
| extension | `vite`                 | `6.3.5`  | `6.4.3`      | 修复 `GHSA-p9ff-h696-f583` 与 `GHSA-fx2h-pf6j-xcff` |
| workspace | `overrides.vite`       | 不存在   | `6.4.3`      | 在 `pnpm-workspace.yaml` 消除第二份旧 Vite          |
| extension | `@vitejs/plugin-react` | `4.4.1`  | 保持 `4.4.1` | 已支持 Vite 6，不做无关升级                         |

三项候选均为 MIT；`vite@6.4.3` 与 `vitest@3.2.6` 的 engines 为 `^18.0.0 || ^20.0.0 || >=22.0.0`，覆盖项目 `>=20.17.0` 下界。发布包没有 `install`/`postinstall`；metadata 中的 dev/build scripts 不在 consumer install 时执行。禁止升级到要求 Node `>=20.19` 的 Vite 8，也禁止把 Vitest 3 的安全修复扩大成 Vitest 4 major 迁移。

原始依赖基线完整 audit 为 low 3 / moderate 4 / high 2 / critical 1，production audit 为 0；原始 lockfile SHA-256 为 `E9B4B644828795CE11C70BEB3F8BDBF21460AC2D960133FB7FC4CCC4F9D2869F`。候选必须保存新的 SHA 与 advisory/path 对比，不能只比较总数。

G0 候选必须同时证明：

1. 使用 pnpm `10.34.5`、官方 registry 和 `--ignore-scripts` 重新生成 lockfile；所有 direct version 精确，无 `^`/`~`。该版本的官方 registry metadata 为 Node `>=18.12`、MIT、integrity `sha512-pO4F8vc2WCVb1qiYWcBlpFwopX2u+uLIk6Fo7itzFow3uR6D5X6mdlStA/AwMXRkMOi84442LgQmBfuKvIAZLg==`，无 consumer install/preinstall/postinstall hook。
2. `pnpm why vite vitest @vitest/coverage-v8` 只出现 `vite@6.4.3`、`vitest@3.2.6` 和 `@vitest/coverage-v8@3.2.6`。
3. 完整 audit 的 high/critical 均为 0，不能新增或恶化 low/moderate，production audit 仍为 0。
4. 运行完整质量门禁、`pnpm test:coverage` 和 extension build；继续禁止 dev/preview/UI/API/browser listener。
5. 本机当前 Node `24.14.1` 的结果只算当前运行时证据；最终 PR/CI 还必须提供 Node 20 lane，不能把 Node 24 冒充最低支持版本。现有 NVM 只有过低的 20.2.0，不下载或切换到它。
6. lockfile delta 限于候选工具链解析变化；出现额外二进制、install hook、Git dependency、未知下载或 production advisory 时立即 STOP。
7. Node 20 CI 必须使用与候选 lock 相同的 pnpm `10.34.5`，并以 `pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org/` 安装；pnpm 9/11、版本漂移或允许 lifecycle script 的 CI 结果不能作为 G0 证据。

G0 明确允许正常项目依赖下载，但只允许以下窄路径：项目级 `.npmrc` 固定 `https://registry.npmjs.org/` 与严格 TLS；根 `pnpm-workspace.yaml` 设置 `overrides.vite=6.4.3` 和 `lockfileIncludeTarballUrl=false`。先以 `--lockfile-only --ignore-scripts` 解析候选 lock，审查 package/version/integrity/依赖闭包后，再以 `--ignore-scripts --frozen-lockfile` 安装。授权只覆盖上述三项 direct dev upgrade 与它们在候选 lock 中固定 integrity 的依赖闭包；不允许 Git/URL dependency、其它 registry、执行下载内容、额外二进制获取、install/postinstall 或全局安装。已有 content-addressed cache 只有在 integrity 与官方 metadata 完全相同时才能复用。

候选 lock 允许一项额外的纯 provenance 机械变化：删除基线中显式保存的 `registry.npmmirror.com` tarball URL。除三项工具链解析变化外，其它 package version 与 integrity 必须逐项相同；最终 lock 不得出现 npm mirror/taobao、Git 或其它 registry URL。manifest 与 lock 不一致期间禁止运行 `pnpm exec` 或其它会隐式安装的 pnpm 命令，必须先完成 lock-only 阶段。

第一份 G0 候选已使用 pnpm `11.3.0` 完成 official-registry/ignore-scripts lock 审计、本地完整门禁和提交前独立 diff review，但 draft PR 的 GitHub Actions run `29247116212` 在 Node `20.20.2` 上证实 pnpm 11 不兼容：CLI 要求 Node `>=22.13`，随后因 `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` 在 install 前退出。这份候选不能作为 Node 20 G0 证据，也不得通过提高 CI Node 版本、设置不安全兼容环境变量或忽略失败来绕过项目 `>=20.17.0` 下界。

修复合同固定 pnpm `10.34.5`。pnpm 10.x 官方文档明确支持当前 `pnpm-workspace.yaml` 的根级 `overrides` 与 `lockfileIncludeTarballUrl`，因此不回退安全配置。合同独立 `PASS` 前只允许只读 metadata/docs/audit 查询和本文档状态修改；不得下载/运行 pnpm 10、修改 CI 或重写 lock。合同通过后，允许项目任务范围内的精确 `npm exec --yes --ignore-scripts --prefer-online --cache=.pnpm-store/goal-043/npm-cache --registry=https://registry.npmjs.org/ --package=pnpm@10.34.5 -- pnpm ...` 获取并运行已核验 CLI；npm cache 固定在 worktree 已忽略目录，所有 install 额外固定 `--store-dir=.pnpm-store/goal-043/store`，不得写用户级共享 store、全局安装、修改全局配置或执行 package lifecycle script。先核对 CLI 输出为 `10.34.5`，再以同一前缀执行 lock-only，审查 lock 后才执行 frozen install。除明确的只读 audit fallback 外，`why`、lint、typecheck、test、coverage、build 和格式检查也必须通过同一 pnpm 10 前缀运行，确保嵌套脚本中的 `pnpm` 仍解析为 `10.34.5`。最终必须追加提交而非 amend/force-push，并重新取得本地完整门禁、独立 diff review 和实际 Node 20 CI `PASS`。

pnpm 10 首次把现有 `node_modules` 切换到任务专属 store 时可能要求重建 modules directory。只有先用 `Get-Item`/`Resolve-Path` 证明它是非 symlink/reparse、绝对路径精确等于 `C:\Projects\ShuHai\.worktrees\social-sync-v4\node_modules` 后，才允许仅对 frozen install 进程临时设置 `CI=true`，由已核验 pnpm 自行替换这个可再生目录。禁止手工 `Remove-Item`、`git clean`、`--force`、扩大路径或保留环境变量；若目录是链接、越出 worktree 或目标不确定，立即 STOP。

Audit 不能以命令退出码代替语义判断：pnpm 10 返回可解析 advisory JSON 时，即使因发现漏洞而非零退出也按实际 counts/path 处理；若返回 HTTP 410、endpoint/protocol/JSON parse 错误或无完整结果，状态必须写为 `UNKNOWN/BLOCKED`，不得声明 0 漏洞。只在该兼容故障下，允许使用本机现有 Node `24.14.1` + pnpm `11.3.0` 对同一 lock 运行 full/production 只读 audit；fallback 前后分别记录 lock SHA-256，禁止 install、修复或改写 lock。fallback 也失败时 G0 保持 blocked。

pnpm 10 修复候选已完成三轮独立合同复审和本地执行：CLI 精确为 `10.34.5`；lock-only 前后语义相同且最终格式化后 SHA-256 保持 `552374FAA202BEC642B0BF2E849A855A15FBB05C3D13E48B7E033BC51E2F8EAB`；full audit 为 low 1 / moderate 1 / high 0 / critical 0，production audit 为 0；唯一 Vite/Vitest 版本、lint、typecheck、269 项 test/coverage 和 extension build 均通过。最终独立 actual-diff review 已 `PASS`，修复提交为 `b8a0b95`；GitHub Actions Node `20.20.2` run `29252734846` / job `86825006096` 也已 `PASS`。G0 正式关闭，允许进入 043A；该结论不授权 043B、真实 X 或生产入口。

### 3.2 043A：fixture-only 候选

允许交付：

- X 收藏条目的受限 DOM adapter 契约和脱敏 fixture。
- 固定预算的批次 coordinator、顶部重扫、checkpoint、typed stop reason。
- catalog 分类、持久化复核选择、write authorization 和 Goal 042 engine 的 mock Vault 集成。
- 无网络的单元/集成测试；工具链门禁通过后才允许运行本地 fixture 浏览器 E2E。

043A 不改 manifest、content script、service worker、Popup、Side Panel，不访问 x.com，不宣称真实平台可用。独立 `PASS` 后只能进入 043B，不能把整个 Goal 写成 `DONE`。

当前结论：043A 为 `PASS`。实现包含严格 runtime schema、IndexedDB v1 -> v2 原子迁移、持久化复核 revision、受预算约束的 X fixture adapter/coordinator、Goal 042 mock Vault 端到端选择写入，以及 typed pause/resume。最终修复把 15 秒 invocation deadline 扩展到 adapter、解析、catalog、store 和分类边界，以 `AbortSignal` 和提交前 guard 阻止迟到的终态事务，并拒绝 adapter 低报 observed-node 数；335 项测试、完整门禁、依赖审计、独立 actual-diff review 和本机 Chrome `150.0.7871.101` 的全新离线 fixture E2E 均通过。该结论不代表真实 X 或生产入口可用，完整证据见 [`goal-043-x-bookmarks-incremental-sync-review.md`](../reviews/goal-043-x-bookmarks-incremental-sync-review.md#13-043a-实现独立复审与-fixture-chrome-证据)。

### 3.3 043B：真实 Chrome QA 与最小接线

043B 的精确实施、迁移、消息、UI、文件、命令与真实 Chrome QA 合同见第 13 节。当前阶段为 `IN_PROGRESS_OFFLINE_IMPLEMENTATION`：用户已授权日常 Chrome 只操作 X 并要求限制并发，项目将边界固定为首次 `incremental + maxCandidates=10 + maxScrollActions=5`、单 tab/job/invocation/outstanding request、滚动间隔至少 2 秒、不写 Vault 及 STOP 条件。该授权现在只启动不接触真实 X 的生产实现、测试与离线 E2E；真实 probe 仍必须等待实现门禁、独立 review 和 Codex Chrome 连接恢复。

## 4. 043A 数据与行为合同

### 4.1 X adapter

- 只接受精确 `https://x.com/i/bookmarks` 能力；其它 host/path 返回 unsupported，不用宽泛 `*.x.com` 猜测。
- 在 isolated world 读取当前已渲染 DOM；不使用 MAIN world、`fetch`、Cookie API、localStorage/sessionStorage、Authorization、私有 GraphQL、动态 query id 或内置 bearer。
- 稳定身份必须来自可验证的 `/status/<1-19 digits>` permalink；缺失或冲突时返回 `structure_changed`，禁止随机生成 ID。
- 收藏列表默认最高为 `summary_only`；只有未来详情 adapter 能证明完整时才允许 `complete`。
- canonical URL 必须来自同一条目的无凭据 `https://x.com/<account>/status/<id>` permalink，`account` 只接受 1-15 位 ASCII 字母/数字/下划线，移除 query/hash、拒绝端口和 host 变体；不得从显示文本拼 URL。
- content hash 固定对 `schemaVersion/source/sourceItemId/canonicalUrl/title/text/author/publishedAt/completeness/media/extractorVersion` 做 key-order serialization 后计算 SHA-256。字符串统一 NFC 与 LF，媒体按 `type/url/alt` 去重排序；排除 `capturedAt`、DOM 顺序噪声和本次扫描时间。
- 不读取或序列化整页/整条 `innerHTML`、`outerHTML` 或无界 `textContent`。正文只从明确 selector 下的 text node 按 UTF-8 预算累计，属性在解析前先做长度/控制字符边界；不得为了诊断保存 DOM snapshot。
- adapter 只返回受 schema 和预算限制的纯数据，不读写 store、Vault、Chrome bookmarks 或 AI。

### 4.2 固定预算

043A ceiling 不得由调用方放大：

| 预算            | 上限       |
| --------------- | ---------- |
| 新接收条目      | 50         |
| 批次/滚动步骤   | 20         |
| 观察 DOM 节点   | 200        |
| 单次运行时间    | 15 秒      |
| 单条正文 UTF-8  | 8 KiB      |
| 单条媒体链接    | 12         |
| 总输入/接受字节 | 16 MiB     |
| checkpoint JSON | 64 KiB     |
| 连续结构错误    | 1 次即暂停 |

调用方提供更大值时取 ceiling，更小值可以收紧。50 条和 16 MiB 是整个 job 的累计上限；20 批、200 节点和 15 秒是每次明确 scan/resume invocation 的上限。checkpoint 至少持久化累计 accepted bytes，不能通过重启清零 job 上限。预算耗尽进入可恢复 `paused/budget_exceeded`；即使恰好收满 50 条，只要没有观察到受支持的明确终点，也不能写成 complete。

### 4.3 checkpoint 与停止

- 虚拟列表恢复从页面顶部重新枚举，以 `source + sourceItemId` 去重；不保存像素位置、DOM node 或页面对象。
- job 增加单调 `scanRevision`。每次 start/resume 先原子 claim 新 revision；每个批次必须带 expected revision，先原子持久化 items 和 checkpoint，再请求下一批。旧 worker 或重复 command 的 stale revision fail closed。
- service worker 重启后若发现遗留 scanning 状态，先原子转为 `paused/worker_interrupted`，再由用户 resume claim 新 revision；不能假设旧执行仍在运行，也不能自动无限续跑。
- stop reason 至少包含：`user_paused`、`budget_exceeded`、`login_required`、`rate_limited`、`structure_changed`、`tab_changed`、`permission_revoked`、`worker_interrupted`。
- paused job 必须持久化 strict `stopRecord`，只含枚举 code、时间、phase、scanRevision 和最小计数；不保存页面错误原文、正文、URL、DOM 或认证信息。resume 在同一 transaction 验证并清除当前 stopRecord。
- 登录挑战、CAPTCHA、429、host/path 改变或 adapter version 不匹配立即暂停，不自动重试或绕过。

### 4.4 分类与内容完整度

- authoritative catalog identity 仍是 `source + sourceItemId`。key 命中且 canonical URL/hash/completeness/extractor version 相同：`existing`，不进入默认选择；同 key 任一身份字段变化：`changed`，默认不写、不覆盖。
- key miss 且 canonical URL 或 content hash 命中其它 record：`incomplete`，作为低置信冲突交给复核，不自动当成 existing，也不默认写入。
- 所有 key/URL/hash 均 miss 且 item 为 `complete/summary_only`：`new`；其中 `summary_only` 必须在 review 中明确标记。
- `metadata_only/unsupported`：`incomplete`，默认不写；允许未来显式单条策略，不在 043A 自动升级。
- 伪造 identity、schema/预算失败：`error`，不进入写入协议。

### 4.5 持久化复核选择

Goal 042 的 job 级 `writeAuthorizedAt` 不足以证明用户选择了哪些条目。043A 必须把复核决定作为持久化领域数据，而不是 UI 临时状态：

- item 增加 `reviewDecision: unreviewed | selected | excluded` 与决定对应的 `reviewRevision`。
- job 增加单调 `reviewRevision`、可选 `authorizedReviewRevision`，以及 selected/excluded/unreviewed 的一致性计数。
- `saveReviewSelection` 在一个 transaction 中接收 expected revision 和精确 selected IDs，为本 job 每个 item 写入 selected/excluded，强制不合格 classification 为 excluded，并递增 revision。
- `authorizeReviewSelection` 必须再次接收 expected revision 和精确 selected IDs，在一个 transaction 中核实它们与持久化决定完全一致，然后绑定 `authorizedReviewRevision`、`writeAuthorizedAt` 并转为 writing。
- write intent 持久化绑定 `reviewRevision`；store 与 engine 都必须核实 item 为 selected，且 item/job/intent revision 完全相同。

```text
ready_for_review + expected reviewRevision + exact selected sourceItemIds
-> persist selected/excluded decisions for every reviewed item
-> return next reviewRevision
-> authorize with the same exact IDs and next reviewRevision
-> revalidate every item/classification and no duplicates
-> bind authorizedReviewRevision + writeAuthorizedAt
-> transition to writing in the same transaction
```

- 默认选择只能包含 `new`；`summary_only` 可选择但必须保留 completeness。
- `existing/changed/incomplete/error` 不得由默认全选进入写入；`unsupported` completeness 归类为 `incomplete`，不是额外 classification。
- write intent 只能为当前 authorized revision 中的 selected item 创建；excluded item 可以保持 `not_requested`，job 完成核算必须显式计入 excluded，而不是伪造 Vault outcome。
- 关闭/重启后，不允许把 unreviewed、excluded 和 selected 混为一种 pending 状态。
- 首次写入开始后 selection 对当前 job 不可变；失败重试沿用同一 review revision 并要求更新的 write authorization。旧 revision、不同 ID 集合和 replay command 全部 fail closed；若要导入先前 excluded 项，创建新的增量 job。

### 4.6 IndexedDB v2 迁移

持久化字段变化必须把 `SYNC_DATABASE_VERSION` 与 meta database version 从 1 升到 2，不能在同一 DB version 下静默改变 strict row schema。

- v2 不删除 `jobs/items/records/intents/meta`，不创建第二个数据库，也不清空 catalog。
- v1 的 prepared/scanning/ready_for_review 和未授权 scanning pause 可以迁移为未复核数据；中断的 scanning 记为 `paused/worker_interrupted`。
- v1 terminal job 只作为历史记录迁移：有 write outcome 的 item 映射为 selected，没有进入 write protocol 的映射为 excluded；不得重新执行。
- 若 v1 存在 writing/partial、带 write authorization 的 pause 或任何 unresolved intent，upgrade transaction 必须原子 abort 并返回明确 migration error；不得猜测选择、删除 intent、重写文件或清库。
- migration 要有条目/字节上限、损坏 row/未知 key/中途 abort/reopen 测试；失败后 v1 数据保持原样。
- v2 新 job 从 `reviewRevision=0` 和所有 item `unreviewed` 开始；只有上述复核 transaction 可以改变决定。

### 4.7 写入与恢复

- 使用 Goal 042 safe Markdown、random intent path、Vault writer 和 catalog transaction，不创建第二套队列。
- 写入前持久化 intent；close 后/catalog 前中断由 reconciliation 恢复。
- 任何 error 只允许在 job 进入 `partial`、用户重新授权 writing 后按原 relative path 重试。
- 源内容删除、取消收藏或本地文件改名不触发自动删除/覆盖。

## 5. 安全与隐私

- DOM、帖子、页面脚本、message、IndexedDB、Vault 和 fixture 都是不可信输入；TypeScript 类型不替代 runtime schema。
- 页面中的 prompt、shell、PowerShell、HTML、Markdown 和“忽略规则”文本只作为内容，不执行、不传给 agent/tool。
- 不记录标题、正文、作者、完整 URL、媒体 URL、DOM、Cookie、token、Authorization 或页面错误原文。
- 同步不调用 AI；未经独立未来 Goal 和用户明确选择，不把社交正文发送给 Provider。
- 远程媒体保持普通文本链接，不下载、不 embed、不在测试中请求。
- 不新增 Electron、companion、Native Messaging、daemon、CDP 或平台私有 API。

## 6. Chrome 与环境执行规则

043A 单元/集成默认不需要浏览器。进入浏览器证据时执行：

```text
LOCAL_CHROME_FIRST / NO_DOWNLOAD / PROJECT_SCOPED
```

- 优先使用本机已经安装、此前项目测试实际使用过的 Chrome；可以只读定位并执行其可执行文件，不把“位于用户目录”误判为禁止使用。
- 禁止下载 Chrome for Testing、Chromium zip、provisioner 替代品或其它浏览器；工具找不到时先核对本机安装和 Codex Chrome 能力，仍不可用才报告。
- 自动化使用当前 Goal worktree 内已由 Git 忽略的 `.pnpm-store/goal-043/chrome-profile/<run-id>` 任务专属全新 profile；不得写入主 checkout 的 `.tmp`，不得复制、读取或修改日常 Chrome profile、Cookies、密码、历史、书签和登录数据。
- 若真实 X 需要登录，由用户在专用 profile 中手工完成；agent 不读取密码、验证码、Cookie、localStorage token 或网络 Authorization。
- 启动时记录 cwd、profile、PID 和用途；只停止本任务亲自启动且 PID/命令/cwd 均匹配的 Chrome。不得按名称杀进程、关闭用户 Chrome 或释放未知端口。
- 若用户明确指定当前 Chrome 的某个测试 tab，可通过 Chrome 控制能力只操作该 tab；不枚举无关页面或把该授权泛化到整个 profile。
- Goal 043 不需要 Docker；不得以“环境隔离”为理由下载镜像、启动容器或操作其它项目容器/网络/卷。

## 7. 文件合同

### 7.1 Task facts

```text
Task / Goal: Goal 043A X Bookmarks fixture-only candidate
Owner / Role: Implementer + independent Product/Security Reviewer
Base commit: 4d2ae62
Branch: codex/social-sync-v4
Absolute cwd: C:\Projects\ShuHai\.worktrees\social-sync-v4
External network: G0 only permits official npm registry metadata/audit plus integrity-locked candidate tarballs; adapter tests denied
Real data: mock/fixture only in 043A
Risk: G0 R3 supply-chain; 043A R1; browser fixture R2 after G0
```

### 7.2 允许读取

- 根 `AGENTS.md`、`CONTRIBUTING.md`、当前 v4 路线/架构/workflow、Goal 041/042 合同和 review。
- `package.json`、`pnpm-lock.yaml`、extension package、TypeScript/Vite/Vitest/Playwright config。
- `packages/extension/src/social/**`、`packages/extension/src/vault/**`。
- `packages/extension/src/content/twitter.ts` 只作为反例/单条基线，不直接修改。
- Goal 041 spike fixture/test/E2E 与 Goal 042 tests。

### 7.3 G0 允许写入

- `.github/workflows/ci.yml`（仅把 pnpm 从不兼容 Node 20 的 `11.3.0` 改为精确 `10.34.5`；install 继续使用 frozen lock、official registry 和 `--ignore-scripts`）
- `package.json`
- `packages/extension/package.json`
- `.npmrc`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `vitest.config.ts`（仅兼容升级确有需要时）
- `packages/extension/vitest.config.ts`（仅兼容升级确有需要时）
- `packages/extension/vite.config.ts`（仅兼容升级确有需要时）
- `docs/goals/goal-043-x-bookmarks-incremental-sync.md`
- `docs/reviews/goal-043-x-bookmarks-incremental-sync-review.md`
- `docs/goals/README.md`
- `docs/PROJECT_STATUS.md`

### 7.4 043A 允许写入

- `packages/extension/src/social/sync-schema.ts`
- `packages/extension/src/social/sync-store.ts`
- `packages/extension/src/social/sync-engine.ts`
- `packages/extension/src/social/adapters/types.ts`
- `packages/extension/src/social/adapters/x-bookmarks.ts`
- `packages/extension/src/social/x-sync-coordinator.ts`
- `packages/extension/tests/fixtures/x-bookmarks.ts`
- `packages/extension/tests/x-bookmarks-adapter.test.ts`
- `packages/extension/tests/x-sync-coordinator.test.ts`
- `packages/extension/tests/sync-schema.test.ts`
- `packages/extension/tests/sync-store.test.ts`
- `packages/extension/tests/sync-engine.test.ts`
- `packages/extension/e2e/x-bookmarks-fixture.spec.ts`
- G0 文档/状态文件。

### 7.5 明确禁止

- `manifest.json`、`src/background/service-worker.ts`、`src/content/twitter.ts`、Popup、Side Panel、Options、shared、desktop、微博代码和 Goal 032 候选文件。
- 任何 allowlist 外生产文件；043B 必须通过 Goal v2 单独授权。
- 新 runtime 依赖。G0 只允许已声明工具链包的精确 dev upgrade，版本核实前不得执行。

## 8. 允许命令

- R0：`Get-Content`、`Get-ChildItem`、`rg`、`git status/diff/log/show`。
- R1：精确 `apply_patch`、精确文件 Prettier/ESLint、`tsc --noEmit`、`vitest run`、`vite build`。
- 质量门禁：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm --filter @shuhai/extension run build`。
- G0 修复合同复审前：只允许 `npm view pnpm@10.34.5 ... --registry=https://registry.npmjs.org/`、官方 pnpm 10.x 文档查询、精确文档 patch 和只读 Git 检查。
- G0 修复合同独立 `PASS` 后：允许精确 `npm exec --yes --ignore-scripts --prefer-online --cache=.pnpm-store/goal-043/npm-cache --registry=https://registry.npmjs.org/ --package=pnpm@10.34.5 -- pnpm --version`；随后用同一前缀运行 `pnpm install --store-dir=.pnpm-store/goal-043/store --lockfile-only --ignore-scripts --registry=https://registry.npmjs.org/`，审查候选 lock 后才允许同参数 frozen install。所有后续 `why` 和质量门禁使用同一 npm exec/pnpm 10 前缀。只解析/复用 lock 中带 integrity 且与官方 metadata 一致的内容，不执行 lifecycle script、不写用户 npm cache/共享 pnpm store、不全局安装、不修改全局 npm/pnpm 配置。
- 若 frozen install 返回 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`：先核实 `node_modules` 是 worktree 内精确普通目录，再只对该条命令临时设置 `$env:CI='true'` 后重试；命令完成后恢复/移除该进程环境值。不得使用 `--force`、手工删除或处理任何其它目录。
- Audit 先使用上述 pnpm 10 前缀；有效 advisory JSON 按实际结果验收。仅遇 410/endpoint/protocol/parse 兼容错误时，允许用已安装的 Node `24.14.1` + pnpm `11.3.0` 对同一 lock 执行 full/production 只读 audit，并用 `Get-FileHash pnpm-lock.yaml -Algorithm SHA256` 证明前后未变；任一 audit 无有效结果即 `UNKNOWN/BLOCKED`。
- 浏览器命令必须等 G0 和 043A 实现 review，通过后按第 6 节补充精确 executable/profile/PID 合同；043A 只已授权并完成隔离 fixture 证据，不授权真实 X 或 043B 浏览器操作。

禁止运行 `pnpm clean`、dev/watch/preview/UI/API/browser server、`--host`、未知下载命令、全局安装、危险命令或任何非本任务进程/端口操作。

## 9. 测试计划

### Schema/store

- stop reason 合法性、状态绑定、旧/损坏 row、unknown key、getter/proxy/prototype、字节/节点/深度预算。
- review revision stale/replay、重复/不存在 ID、默认选择越权、selected/excluded/unreviewed 重启恢复。
- v1 -> v2 安全迁移、terminal history 映射、active write/intent fail closed、upgrade abort 后 v1 保持可读。
- 未授权 item 不能创建 intent；partial/error retry 继续保持 Goal 042 语义。

### Adapter fixture

- 正常 50 条、重叠批次、虚拟列表节点回收、顶部重扫、重复 ID。
- 空页、未登录、429/CAPTCHA、结构变化、导航改变、预算/时间/节点/字节上限和用户暂停。
- 伪造 ID/URL、重复 ID 不同正文、长文截断、媒体超限、getter/proxy、原型污染。
- YAML/HTML/template/Dataview/Obsidian embed、JS/data URL、shell/PowerShell 等攻击文本只作为惰性数据。
- 不发真实网络请求，不读取 credential API，不执行 fixture 中命令。

### Coordinator/integration

- 每批先持久化再继续；批次持久化失败不前进 checkpoint。
- new/existing/changed/incomplete/error 分类及 content hash 稳定性。
- service worker 模拟中断、resume、stale adapter version、重复 command 和同 source active job。
- 精确选择授权后 mock Vault 写入；50 条 close-after-write crash 不重复。

### 浏览器证据

- 043A fixture E2E：本机 Chrome + 全新项目 profile、离线 context、fixture 页面 outbound request 0、虚拟节点回收、pause/resume。该证据不冒充 OS 级 Chrome 进程抓包。
- 043B 真实 X：由 v2 定义测试账号、条目上限、截图/DOM 断言、无正文入 repo、无凭据日志和停止条件。

## 10. QA Delta

```text
变更的用户行为: 043A 无生产入口；建立 X 增量同步候选领域能力
可能损坏的数据: 仅 fake IndexedDB/mock Vault；不得访问真实 Vault/收藏
新增信任边界: X DOM batch -> runtime schema -> persistent coordinator
新增单元测试: adapter/schema/store/selection/stop reason/攻击 fixture
新增集成测试: coordinator + Goal 042 engine + mock Vault
需要的 Chrome 旅程: G0 后 fixture；043B 才是受界真实 X
不在 043A 验证的风险: 真实选择器、账号风控、平台条款变化、生产 UI/message wiring
```

## 11. 验收

043A 候选必须：

- 所有不可信输入先 runtime parse；不存在随机 ID、任意 URL fetch 或 credential 访问。
- 50 条虚拟列表 fixture 暂停/恢复后唯一 identity 数准确，无重复 checkpoint/item/write。
- stop reason 与复核选择跨 store reopen 保持；stale revision 和未授权写入 fail closed。
- 完整度不夸大，hash 不因 capturedAt 改变，changed 不覆盖旧文件。
- 定向攻击/崩溃/10,000 catalog 回归与完整质量门禁通过。
- G0 audit 不新增 production advisory，构建不包含 test-only dependency。
- 独立 reviewer 检查实际 diff 后给出 `PASS`。

整个 Goal 只有在 043B 真实 Chrome 旅程与最小接线也独立通过后才能 `DONE`。043A 通过但缺真实证据时必须写成 `BLOCKED_BY_REAL_X_EVIDENCE` 或等价明确状态。

## 12. 043A STOP 条件

- 需要 Cookie、token、private GraphQL、MAIN world、任意 fetch、CAPTCHA/429 绕过或后台静默浏览。
- 需要扫描用户主收藏库作为首次证明，或需要把私人正文/URL写入 repo、日志、截图或 agent 上下文。
- 需要 manifest/UI/service worker/content/shared/desktop 等 043A allowlist 外修改。
- 工具链精确版本、license、engines、install script、audit 或 lockfile delta 无法证明。
- 需要下载浏览器、复制日常 Chrome profile、杀未知进程、释放未知端口、操作 Docker 或执行危险命令。
- 无法持久化 stop reason、精确选择/revision，或无法保持 Goal 042 的幂等/partial/Vault 安全语义。

## 13. 043B v2 实施合同

### 13.1 当前入口事实与权限结论

本合同基于当前提交 `5acdcc7` 的实际代码，而不是旧路线假设：

- `manifest.json` 当前把 `https://x.com/*`、`https://twitter.com/*` 放在必需 `host_permissions`，并静态注入 `content/twitter.js`；这与 v4“首次使用时按平台请求最小站点权限、可撤销”的产品边界冲突。043B 必须执行第 13.2 节限定的权限迁移，不能把现状误写成最终权限模型。
- `vite.config.ts` 尚未构建 `content/x-bookmarks.js`，必须增加一个独立 build entry。
- `service-worker.ts` 的旧 `onMessage` 把 TypeScript `ExtensionRequest` 当作运行时验证并忽略 `MessageSender`；043B 只能给新的 X 协议增加 strict runtime route 和 sender 校验，不借机重写全部旧消息。
- Popup 和 Side Panel 当前共用大型 `App.tsx`，且旧页面偏好使用持久化 `chrome.storage.local`。043B 只增加 X 上下文入口和单任务工作台；X 启动意图必须使用有 TTL、消费一次的 `chrome.storage.session`，不能复用旧持久化 page preference。
- Vault handle 已由 `utils/vault-writer.ts` 存在 IndexedDB。目录选择和权限请求需要 Side Panel 中的真实用户点击；service worker 不请求文件权限、不接收 handle，也不直接写 Vault。
- 043A 当前把同 job replay 当作 known frontier，并让 catalog-existing 条目占用 50 条 job ceiling；这会使第二批历史导入停在最上方，且 budget pause 没有合法进入复核的用户动作。043B 必须先修复第 13.3 节的领域语义，再接生产 UI。

`packages/extension/manifest.json` 只允许一个可审计的最小权限迁移：从必需 `host_permissions` 删除 X/Twitter 两项，并删除 X/Twitter 的静态 `content_scripts` 条目；保留既有 `optional_host_permissions`、Weibo 条目和其它字段不变。043B 不新增 named permission、CSP、web-accessible resource 或更宽 host。除该精确差异外，任何 manifest 变化都立即 STOP 并重新做权限与 Web Store 隐私审查。

2026-07-14 重新核对的官方 API 依据：[`permissions.request/remove` 的运行时可选 host 权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)、[`scripting.executeScript` 的 host/`activeTab` 前置条件与 `InjectionResult.documentId/frameId`](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[`tabs.sendMessage` 的 `documentId/frameId` 定向发送](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[内存态且默认不暴露给 content script 的 `storage.session`](https://developer.chrome.com/docs/extensions/reference/api/storage)、[必须由用户动作触发的 `sidePanel.open`](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)与[需要用户手势的 File System permission request](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)。这些资料只证明 API 能力；本机 Chrome 的实际 sender 字段、权限提示和用户手势传播仍必须由 fixture/真实 QA 验证。

### 13.2 用户旅程与两个明确模式

#### 日常模式：检查新增收藏

1. 用户位于精确 `https://x.com/i/bookmarks`，点击 Popup 唯一主动作 `同步新增收藏`。
2. service worker 重新查询同一窗口的当前 active tab；Popup 提供的 URL、tab ID 或页面文本均不是授权依据。
3. Side Panel 显示 `检查新增收藏`、固定本次候选上限、Vault 状态与“只读取当前收藏页，不读取 Cookie/token”的短说明。
4. 若尚未授权，preflight 只显示 `允许读取 X 收藏页`；Side Panel 在这个真实 click handler 中直接调用 `chrome.permissions.request({ origins: ['https://x.com/*'] })`，不经 runtime message 转发用户手势。拒绝或异常保持 preflight，不创建 job、不注入脚本、不读取 DOM。
5. 授权后用户点击开始，从页面顶部做受预算扫描；连续命中 20 个 catalog exact-existing ID 时，本次增量扫描可结束为 `known_frontier`。
6. 结果默认只选择 `new`，并明确标记 `summary_only`；用户再次确认后才写 Vault。

#### 历史模式：继续导入更早收藏

1. 用户在 Side Panel 显式选择 `继续导入更早收藏`；它不是隐藏自动分页，也不与日常模式混用。
2. 新 backfill job 不因 catalog-existing frontier 自动停止，exact-existing 项不占 50 条候选上限。
3. backfill 从当前 X 收藏页位置继续向下；同一 document 的 pause/resume 不强制滚回顶部。页面 reload、SPA document 变化或用户回到顶部后会重新经过已入库项，但仍不得重复写入。
4. 每个 job 最多收集 50 个需要复核的候选。达到上限时文案只能是 `本批达到上限，仍可能有更早收藏`；用户可选择 `使用本批结果`，写完后再启动下一批。
5. 只有 adapter 观察到并通过真实页面证据证明的明确 end-of-feed marker，才能显示 `已到收藏列表末尾`。known frontier、时间、节点、批次或 50 条预算都不能宣称“全部同步完成”。

`scanMode` 在 job 创建时固定为 `incremental | backfill`，写入 IndexedDB 后不可更改。service worker 重启或 Side Panel 重开时必须从 job 读取模式，不能依靠内存或让 resume 暗中换模式。

#### 平台权限生命周期

- X 同步只请求精确 `https://x.com/*`，不请求 `https://twitter.com/*`、全网 HTTP/S 或其它平台；manifest 中较宽的既有 optional declaration 只是可申请上限，不是实际授权。
- Side Panel preflight/result 提供 `撤销 X 访问权限`。无 active X job 时可在用户 click handler 中直接调用 `chrome.permissions.remove({ origins: ['https://x.com/*'] })`，同样不经 runtime message；有 pre-writing job 时必须先走显式取消并确认终态，有 pending write intent 或 writing/partial reconciliation 时拒绝撤销并引导先完成恢复。
- 权限被 Chrome 外部撤销时，扫描在下一次 tab/permission 校验暂停为 `permission_revoked/scanning`；复核数据保留。Vault 写权限与 X host 权限彼此独立，不能借一个权限推导另一个。
- 删除静态 X/Twitter content script 后，既有单条推文右键提取仍只在用户点击 context menu 时依靠 `activeTab` 动态注入既有 `content/twitter.js`。043B 不修改 `twitter.ts`，但必须增加 manifest/service-worker 回归测试，证明没有常驻 X DOM 读取且右键单条保存仍可用。

### 13.3 扫描状态机、预算与 IndexedDB v3

043B 必须把 IndexedDB 从 2 原子升级到 3。全局 `SYNC_SCHEMA_VERSION=1` 继续保持不变，因为它参与 SocialItem、content hash、Vault frontmatter 和 catalog identity；不得为了 job 字段变化导致所有既有内容被误判 changed。DB v3 以 job/checkpoint 的新 `contractVersion: 2` 区分持久化合同。

新增持久化语义：

- job：`contractVersion: 2`、`scanMode`、可选 `scanCompletion`；job status 新增无写盘终态 `complete_with_issues`。
- `scanCompletion` 只允许 `trusted_terminal | known_frontier | user_finalized_batch | legacy_migrated`。
- checkpoint：`contractVersion: 2`、`candidateCount`、`classificationErrorCount`、`catalogExistingObservationCount`；保留既有 `acceptedCount/acceptedBytes/scannedCount/consecutiveKnownIds`。
- `scannedCount` 计 adapter 返回的受界 item observations；`acceptedCount` 计通过 item schema 和稳定身份一致性检查的 observations，二者都允许因顶部重扫增加，不能当作全局唯一数。跨会话唯一候选仍只看 job items/catalog。
- `acceptedBytes` 对所有已解析 adapter 输出计费，包括 catalog-existing 和同 job replay，不能因“不写入”绕过 16 MiB 安全预算。
- `candidateCount` 只计需要持久化复核的 `new/changed/incomplete/error` 唯一条目；exact `existing` 不创建新的 job item、不占 `budgets.maxItems=50`。
- `catalogExistingObservationCount` 是受预算的观察次数，不冒充全局唯一收藏数；UI 文案使用 `已跳过的已入库观察`。
- `classificationErrorCount` 只计当前 job 中唯一 `classification=error` candidate rows，必须与 item store 实际行一致；它不能因用户 excluded 而归零。
- `consecutiveKnownIds` 只由 authoritative catalog exact-existing classification 增加；same-job replay、changed、incomplete、error 或 new 必须重置为 0，不能制造假 frontier。

批次顺序固定为：

```text
strict parse adapter response
-> charge observed node / elapsed / byte budgets
-> reject conflicting same-job replay
-> classify + split + persist in one readwrite transaction under the invocation deadline
-> only then request/scroll next batch
```

每次 content batch 的 raw item 数受剩余 candidate slots 和节点预算共同限制，但 catalog-existing raw items不减少下一批的 candidate slots。调用方不能把 50 candidates、20 batches、200 observed nodes、15 秒、16 MiB、20 known frontier、单一 X invocation 或批次间最短 2,000 ms 间隔放大；真实 QA 首次 probe 进一步收紧为 10 candidates 和最多 5 次滚动动作。

043B 用专用 `classifyAndPersistScanBatch` 替换当前“coordinator 先查 catalog、再调用 `putScanBatch`”的分离路径。该 API 接收 expected job/scan revision、strict-parsed observation 列表、adapter observed-node delta、调用级 deadline/abort guard，而不接受调用方预先算好的 `existing/candidate` 总数或任意 checkpoint。它必须在同一个 `jobs + items + records` readwrite transaction 中：

1. 重新校验 job、lease/revision、mode、旧 checkpoint、每个 observation 的稳定 identity 和 canonical UTF-8 byte length。
2. 对每个 observation 查询 authoritative catalog，并检查同 job replay 是否同 identity/hash；冲突整批 abort。
3. 在 transaction 内计算 exact-existing、same-job replay、candidate、known-frontier、`acceptedCount`、`acceptedBytes` 和 `catalogExistingObservationCount` 增量。exact-existing 与 replay 都计 accepted/byte/node/time 安全预算，即使不创建 item row；调用方不能传 scalar 声称少计。
4. 只给唯一 `new/changed/incomplete/error` 写 candidate row；exact-existing 不写新 row、不消耗 candidate slot；same-job replay 不增加 `candidateCount`，且必须把 `consecutiveKnownIds` 重置为 0。
5. 校验 batch 前后所有计数、50/200/15s/16MiB/known-frontier 上限、`candidateCount ===` 可复核唯一 item 数及 `classificationErrorCount ===` 唯一 error item 数，再原子写 candidates、checkpoint 和 job aggregates。deadline、abort、权限取消或任一 guard 在 commit 前失效时整批不提交。

这样“越过顶部大量已入库项”只解除 50 条候选上限，不解除节点、时间和字节预算；catalog 在查与写之间变化也不会产生 TOCTOU 分类。

043A 的 `AdapterBatchRequest.jobAcceptedItems`/`acceptedItemsBefore` 不能继续作为 50 条停止依据；043B 将其替换为 coordinator 计算并持久化的 `jobCandidateItems/remainingCandidateSlots`。adapter 仍负责单批 raw output、节点、正文、媒体、时间和字节 ceiling，但不得把尚未 catalog 分类的 raw item 猜成 candidate。

扫描完成与暂停转换：

- 明确 end marker：`scanning -> ready_for_review`，`scanCompletion=trusted_terminal`。
- incremental 连续 20 个 catalog exact-existing：`scanning -> ready_for_review`，`scanCompletion=known_frontier`。
- `budget_exceeded` 或 `user_paused`：先持久化 `paused`。只有用户点击 `使用本批结果`，且当前 scan revision、stop reason、无 pending classification 和计数全部匹配时，新的 `finalizePausedScan` transaction 才能转为 `ready_for_review/user_finalized_batch`。
- `login_required`、`rate_limited`、`structure_changed`、`no_progress`、`tab_changed`、`permission_revoked` 或 `worker_interrupted` 不能用 `使用本批结果` 绕过；必须恢复、重试或取消。
- ready_for_review 在零候选或用户把全部候选设为 excluded 时，允许新的 `completeReviewWithoutWrites` transaction 以 expected review revision 原子保存 exact empty selection、把剩余 unreviewed 标为 excluded，并在确认无 intent/write result 后诚实结束。它不请求 Vault permission、不创建 write authorization。
- 该 transaction 必须重算 item store：若 `classificationErrorCount=0`，终态为 `complete`；若 `classificationErrorCount>0`，终态必须为新的 `complete_with_issues`，并保留精确错误计数。两个终态都要求 `selectedCount=0`、所有 write count 为 0、无 intent/result、所有候选已 excluded 且 `scanCompletion` 已持久化；任何有选择或写入痕迹的 `complete` 仍必须绑定 review/write authorization。
- `complete_with_issues` 是 terminal、释放 `activeSource`，但不代表同步成功、写入 partial 或到达 feed 末尾。schema 只允许上述 no-write 形态，禁止带 write authorization/intent/result；reload 后 UI 必须从持久化 job/items 恢复 `本次已结束，N 条提取或分类错误未保存`。

取消不是 UI 本地隐藏，而是持久化领域操作：

- 新增 strict `cancel` message 和专用 `cancelJob` transaction。`prepared`、`paused/scanning`、`ready_for_review` 可在 expected revision、无 unresolved batch、无 write authorization/intent/result 时取消；正在 scanning 时先设置同 invocation abort flag，coordinator 取得唯一终态权后再提交，不能由 UI 并发写第二个终态。
- `paused/writing`、`writing` 或 `partial` 只有在先运行既有 reconcile、确认零 pending intent 后才能执行 `abandonWriteJob`；已产生的逐项 outcome、authorization 和 relative path 保留，结果明确显示“任务已停止，已有 N 条可能/已经写入”，不能伪装未写入或回滚文件。
- cancel/abandon 都只把 job 置为 `cancelled` 并释放 `activeSource`，不删除 job/item/catalog/intent/result，不删除或覆盖 Vault 文件。stale revision、活跃 batch、pending intent 或未知结果必须拒绝取消。
- 所有不可恢复扫描 pause 都提供 `取消本次任务`；因此用户可以安全释放 active X source 并重新开始，而不被永久卡在旧 job。

v2 -> v3 migration 必须在一个 upgrade transaction 中完成：

- 不删除 store、job、item、record、intent 或 catalog，不创建第二个数据库。
- 旧 job 固定迁移为 `scanMode=incremental`；旧 scanning job 转为 `paused/worker_interrupted`。
- `candidateCount` 与 `classificationErrorCount` 从旧 job item classification 计算，`catalogExistingObservationCount` 至少计入旧 `existing` rows；旧 review/writing/history job 使用 `scanCompletion=legacy_migrated`，UI 不声称已到列表末尾。
- 旧 exact-existing item 可以作为历史 row 保留；新扫描不再创建此类 row。迁移不得重算 SocialItem hash、改 Vault 路径或重写 catalog identity。
- upgrade transaction 内任一损坏 row、未知字段、预算超限、计数不一致或中途 abort 都必须 abort，数据库仍为 v2 且原数据保持可读；不得清库、猜测或部分迁移。
- upgrade 已提交后若 reopen/layout validation 失败，数据库已经是 v3，不能谎称回滚到 v2。此时必须 fail closed：禁止继续创建/恢复/写入 job，保留原始数据库供诊断，并报告 `DB3_REOPEN_VALIDATION_FAILED`；只能用修复版本继续打开，不能删除数据库或执行破坏性 down migration。

### 13.4 X runtime message 与 sender/tab/document 绑定

新协议使用独立 discriminator `shuhai:x-sync:v1`，不把 TypeScript union 当验证。`x-sync-messages.ts` 必须在 Zod parse 前执行深度、节点、UTF-8 字节、plain-object、forbidden key、accessor/proxy/prototype 预算；request、response、port message 和 storage intent 全部 `strict`，unknown key fail closed。

#### Extension UI -> service worker

- 只接受 `sender.id === chrome.runtime.id`。
- sender URL 必须是精确 extension origin 下的 `popup/index.html` 或 `sidepanel/index.html`；其它 extension page、content sender、外部 extension、缺失 URL 均拒绝。
- launch、start、resume、pause、finalize、cancel、save-selection、complete-without-writes、authorize、get-state 分别使用窄 schema；UI 不得指定 adapter version、Vault path、canonical URL、job budget ceiling、content、catalog record 或 write outcome。X host permission 的 contains/request/remove 由 Side Panel 直接调用 Chrome API；service worker 在创建 job、每批注入和 resume 前仍独立 `permissions.contains`，不能信任 UI 声称已授权。
- 长扫描使用专用 `shuhai:x-sync:v1` Port。`port.sender` 同样验证；整个 source `x` 同时只允许一个 active job、一个绑定 tab/document、一个 invocation 和一个 outstanding content request，而不只是“同一 job 内不并发”。第二个 start/resume 必须返回 typed conflict，不能另开并发扫描。pause 只设置当前 invocation 的受控 abort/pause flag，不并发写第二个终态 transaction。

#### service worker -> content script

- service worker 在用户动作后用 `chrome.scripting.executeScript` 只向 main frame、默认 `ISOLATED` world 注入 `content/x-bookmarks.js`。
- injection result 必须得到 `frameId=0` 与非空 `documentId`；否则停止为 `structure_changed`。
- 每个 scan revision 生成新的 cryptographic random nonce，并在内存中绑定 `jobId + scanRevision + tabId + windowId + frameId + documentId + exact URL + nonce`。
- `chrome.tabs.sendMessage` 必须同时指定绑定的 `documentId` 和 `frameId=0`。content response 严格 echo protocol、job、revision、step、nonce 和 exact `location.href`；任一不匹配整批丢弃并暂停。
- 每批前重新 `chrome.tabs.get/query` 校验 tab/window/active/exact URL；持久化前和终态转换前还必须向同一个 `documentId/frameId` 发送 strict nonce ping，证明响应对应 document 仍存活。导航、关闭、非 active tab、targeted ping failure 或 path 改变统一 fail closed 为 `tab_changed`。
- service worker restart 不恢复内存 binding；启动时调用既有 interrupted recovery，把 scanning job 变为 `paused/worker_interrupted`，由用户重新绑定当前页。

content script 只接受来自本扩展 service worker 的消息：`sender.id` 必须匹配且 `sender.tab` 必须为空；service worker 不是 document context，因此 Chrome 若省略 `sender.url/origin` 可以接受，但只要提供就必须匹配本扩展 origin/background URL。协议、nonce、job、revision 和预算全部 strict parse。页面脚本不能访问该 isolated-world listener，但 DOM 和 listener 输入仍按不可信处理。

所有 X runtime 错误只记录枚举 code、phase、revision 和计数。禁止 console/storage/activity/telemetry 记录标题、正文、作者、source item ID、完整 URL、媒体 URL、DOM、selector 命中内容、Cookie、token、Authorization 或页面错误原文。

### 13.5 一次性启动意图

Popup 点击后创建 `chrome.storage.session` intent，固定 key、最大 1 KiB、TTL 60 秒、随机 nonce，并由 service worker 串行消费一次。intent 只包含 protocol、action、mode、server-revalidated window ID、created/expires time 和 nonce；不包含正文、URL、tab ID、Vault path 或账号信息。session storage 保持默认 access level，不暴露给 content script，并接受浏览器/扩展 reload 后自动清除。

`chrome.sidePanel.open()` 必须在 Popup click handler 的同一用户手势中直接发起，前面不得 `await` intent/storage/tab 操作。intent 创建与 panel open 可以并发；Side Panel 只允许在 2 秒内按 nonce 做有限次数等待，超过即显示“启动已过期，请重试”，不能无限轮询或在没有 intent 时自行开始扫描。

Side Panel 消费时 service worker 必须按 intent window 重新查询 active tab 并验证精确 URL。过期、重复消费、storage corruption、窗口消失或 tab 改变均删除/拒绝 intent，不降级读取旧 `chrome.storage.local` preference。Popup/Side Panel 打开失败只留下可过期 intent，不启动扫描。

### 13.6 Content script DOM 与滚动合同

- 只支持字符串完全等于 `https://x.com/i/bookmarks`；拒绝 twitter.com、子域、端口、query/hash 和其它 X path。
- 不使用 MAIN world、page function、`eval`、inline remote code、fetch/XHR/WebSocket、Cookie API、localStorage/sessionStorage、private GraphQL、动态 query ID 或内置 bearer。
- DOM reader 只把当前已渲染收藏 card 映射成 043A 的窄 observation port；不读取整页/整 card `innerHTML/outerHTML`，不保存 DOM snapshot，不把页面错误原文传回。
- 选择器必须限于收藏列表容器、card、status permalink、明确正文/作者/媒体属性。登录、CAPTCHA、rate-limit 和 end marker 只从页面级受限节点判断，不能因为某条帖子正文出现相同文字而触发。
- 每个 message 最多执行一次受界滚动和一次受界等待；不启动 interval、observer 常驻循环或后台监控。coordinator 只有在前一 content response 已严格校验并原子持久化、且距离上一次滚动完成至少 2,000 ms 后，才可发送下一批请求；该间隔使用 monotonic clock/fake-clock 可测试，调用方不能缩短。连续三批没有新 stable ID、没有明确 end marker 时返回 `no_progress`。
- 429、rate-limit banner、登录挑战、CAPTCHA 或账号限制只允许立即持久化 pause；不自动 retry、不指数并发、不刷新页面、不切换 tab/profile 绕过。普通 resume 也必须由用户重新点击，并继续遵守单 invocation 和 2 秒间隔。
- incremental start/resume 明确回到顶部；backfill 在同 document 继续当前页面位置。content script 不持久化像素、Element、Node 或页面对象，重复注入必须通过 isolated-world marker 保证只注册一个 listener，避免重复声明和多 listener 响应。
- 所有媒体保持普通远程链接，不请求、不下载、不 embed。

### 13.7 Side Panel、复核与 Vault 写入责任

Side Panel 直接在用户上下文中完成 Vault permission 与写入，service worker 只负责扫描和持久化控制：

1. Side Panel 从 store 读取当前 job/items；默认选择只能是 `classification=new`。
2. 用户取消全部选择时，主动作变为 `结束本次，不写入`，调用 `completeReviewWithoutWrites`；不读取 Vault handle、不请求目录权限。无 classification error 时结果为 `complete`，有 error 时结果为 `complete_with_issues` 并显示未处理数量。
3. 用户点击 `保存 N 条到 Vault` 后，先在该真实 click 中读取 handle 并调用现有 permission request。无 handle 或 denied 时保持 review 状态，不提前 authorize writing。
4. permission granted 后，把 expected review revision 和 exact selected IDs 交给 service worker；store 先 `saveReviewSelection`，再以相同精确集合 `authorizeReviewSelection`。
5. Side Panel 重新打开同一 `SyncStore`，使用现有 `createVaultSyncEngine` 串行写 selected items。service worker 不接收/克隆 handle，不生成第二套 writer。
6. 每条写入前只读 query permission；若已撤销，在创建下一 intent 前原子暂停为 `permission_revoked/writing`。写入中途异常按现有逐文件 `error` commit，最终状态为 `partial`，不能伪成功。
7. Side Panel 关闭或崩溃后，reopen 先 reconcile pending intents，再沿用同一 review revision 和同一 relative path 恢复；不得重新选择、覆盖或改路径。
8. 对实际授权写入的 job，selected 全部得到 outcome 且无 write/classification error 才能 `complete`；否则 `partial`。`partial` 只表达已经进入写协议后的不完整结果，不能用于零选择/no-write。完成页显示 created/already_exists/skipped/error 的精确数量和实际 relative path，不显示“已保存”总 toast 代替逐项结果。

`utils/vault-writer.ts` 只允许新增 query-only permission helper，并让既有 request helper复用它；不得改变默认不覆盖、路径校验、写锁、大小限制或旧导出公开行为。真实 QA 只使用工作区内一次性测试 Vault；用户真实 Vault 仍不在 043B 首次证据范围。

### 13.8 最小 UI 合同

- Popup 在精确 X bookmarks 页只显示一个上下文主动作、上次任务短状态和设置次入口，不加载书签树、健康记录、待入库队列或高级设置。
- 点击主动作后打开 Side Panel；长任务不留在 420 x 600 Popup 中。
- Side Panel `XSyncPage` 一次只展示 preflight、scanning、review、writing 或 result 中的一个阶段。preflight 显示 X 权限状态与最小读取范围；模式选择使用 segmented control；pause/cancel 是明确 icon+text action。
- 正文 13-14 px，辅助文字至少 12 px；不新增卡片套卡片、11 px 重要信息、重复主按钮或装饰性视觉。
- review 必须显示 new/existing observations/changed/incomplete/error 的真实数量，`summary_only` 可见；changed/incomplete/error 默认不可选。
- budget、known frontier、trusted terminal、tab changed、login、rate-limit、permission revoked 和 partial 各有不同文案；不把它们折叠成一个 `失败` 或 `已完成`。
- 任何 `complete/complete_with_issues/cancelled` 结果都依据持久化 `scanCompletion`、selection、classification errors 和 write outcomes 生成文案；普通 `complete` 不能自动显示“已同步全部收藏”，`complete_with_issues` 不能使用成功色或“全部处理”文案。
- UI state 从 IndexedDB job 恢复，不依赖组件内数组保存选择、scan mode、revision 或完成依据。

本 Goal 不重构普通页面 Popup、书签 Side Panel 或真正独立 Options Page；那仍属于 Goal 046。若接线要求大规模拆分 `App.tsx`，停止并另写 UI 重构 Goal。

### 13.9 精确文件合同

#### Task facts

```text
Task / Goal: Goal 043B X bookmarks production wiring and bounded real-Chrome QA
Owner / Role: Implementer + independent Product/Security Reviewer + independent QA
Base commit: 5acdcc7
Branch: codex/social-sync-v4
Absolute cwd: C:\Projects\ShuHai\.worktrees\social-sync-v4
External network: fixture tests denied; real QA only X page network created by installed Chrome
Real data: dedicated project Chrome profile preferred; exact user-designated daily X bookmarks tab allowed only after isolated-account login failure; disposable test Vault only after manual gate
Risk: R1 implementation; R2 isolated Chrome or one designated daily X tab/test Vault; unrelated tabs, the rest of the daily profile, and the user real Vault remain forbidden
```

#### 允许修改生产文件

- `packages/extension/manifest.json`（仅第 13.1 节的 X/Twitter 常驻权限迁移）
- `packages/extension/src/social/sync-schema.ts`
- `packages/extension/src/social/sync-store.ts`
- `packages/extension/src/social/x-sync-coordinator.ts`
- `packages/extension/src/social/adapters/types.ts`
- `packages/extension/src/social/adapters/x-bookmarks.ts`
- `packages/extension/src/social/x-sync-messages.ts`（new）
- `packages/extension/src/social/x-sync-launch-intent.ts`（new）
- `packages/extension/src/social/x-sync-runtime.ts`（new）
- `packages/extension/src/content/x-bookmarks.ts`（new）
- `packages/extension/src/background/service-worker.ts`
- `packages/extension/src/utils/vault-writer.ts`（仅 query-only permission helper）
- `packages/extension/src/popup/App.tsx`
- `packages/extension/src/popup/pages/XSyncPage.tsx`（new）
- `packages/extension/src/popup/pages/x-sync-ui-model.ts`（new）
- `packages/extension/vite.config.ts`（仅增加 content build entry）

#### 允许修改测试与证据文件

- `packages/extension/tests/sync-schema.test.ts`
- `packages/extension/tests/sync-store.test.ts`
- `packages/extension/tests/x-bookmarks-adapter.test.ts`
- `packages/extension/tests/x-sync-coordinator.test.ts`
- `packages/extension/tests/x-sync-messages.test.ts`（new）
- `packages/extension/tests/x-sync-launch-intent.test.ts`（new）
- `packages/extension/tests/x-sync-runtime.test.ts`（new）
- `packages/extension/tests/x-sync-service-worker.test.ts`（new）
- `packages/extension/tests/x-sync-ui-model.test.ts`（new）
- `packages/extension/tests/manifest.test.ts`（仅权限与静态注入回归）
- `packages/extension/tests/vault-writer.test.ts`
- `packages/extension/src/content/__tests__/x-bookmarks.test.ts`（new）
- `packages/extension/e2e/x-bookmarks-fixture.spec.ts`
- `packages/extension/e2e/x-bookmarks-extension-fixture.spec.ts`（new）
- `docs/goals/goal-043-x-bookmarks-incremental-sync.md`
- `docs/reviews/goal-043-x-bookmarks-incremental-sync-review.md`
- `docs/goals/README.md`
- `docs/PROJECT_STATUS.md`
- `docs/workflows/README.md`

#### 只读/禁止

- `packages/extension/src/shared/bookmark-types.ts`、`packages/extension/src/content/twitter.ts`、旧普通网页/微博页面、Options、shared package 和 `packages/desktop/**` 均只读或禁止修改。
- 不修改 package manifest、lockfile、CI 或依赖；043B 无新依赖。
- 不修改 Goal 032 候选、其它 Goal、旧路线图和历史 spec。
- allowlist 外文件需求、超出第 13.1 节的 manifest/permission 变化或第二套 DB/writer 需求立即 STOP 并回到合同 review。

### 13.10 允许命令、Chrome 与真实数据门禁

R0/R1 命令继续遵守第 8 节和 command-safety。所有 pnpm 命令固定使用：

```text
npm exec --yes --ignore-scripts --prefer-online --cache=.pnpm-store/goal-043/npm-cache --registry=https://registry.npmjs.org/ --package=pnpm@10.34.5 -- pnpm ...
```

不得 install、更新 lock、运行 lifecycle、dev/watch/preview/clean、下载浏览器、操作 Docker、端口或非任务进程。build 中既有 dist 清理只属于已审查的构建产物行为，不授权任何手工递归删除。

人工门禁与真实 QA 必须按以下顺序，不能形成“先有实现还是先有 probe”的循环：

1. 首选当前 Goal worktree 下 Git ignored 的 `.pnpm-store/goal-043/chrome-profile/real-<run-id>`，由本机已安装 Chrome 启动；禁止 Chrome for Testing/Chromium 下载。
2. 用户本人在该隔离 profile 手动登录专用/测试 X 账号；agent 不读取、转录或截图密码、验证码、Cookie、localStorage/sessionStorage token 或 Authorization。
3. 若专用/测试账号在隔离 profile 确实无法登录，只有用户明确指定日常 Chrome 中的单个 `https://x.com/i/bookmarks` 标签后，才允许把该标签作为 R2 例外；不得枚举、读取、切换、刷新或关闭其它标签，不得读取整个日常 profile，也不得把授权扩展到其它站点。
4. 用户已授权日常 Chrome 只操作 X 并要求限制并发；项目据此固定后续真实 QA 为 `incremental + maxCandidates=10 + maxScrollActions=5`、单 tab/job/invocation/outstanding request、滚动完成到下一批请求至少 2,000 ms，且不授权 Vault 写入。遇 CAPTCHA、login challenge、429、账号限制、selector 不确定或私人主收藏库风险立即 STOP 且不自动重试。该授权已满足离线实现开工门禁，不要求 Codex Chrome 此时可连接，也不读取页面或执行 probe。
5. 043B 生产实现先通过单元/集成、离线 extension fixture E2E、完整质量门禁和独立 actual-diff review；只有这些候选证据通过且 Codex Chrome 连接恢复后，才在受界 Chrome 标签执行首次 10-candidate no-Vault 真实 X probe。
6. probe 通过后，用户再明确确认一个位于 worktree `.pnpm-store/goal-043/test-vault/<run-id>` 的新 disposable Vault，并在目录选择器中手动授权。首次只选择 1-3 条；不使用真实 Obsidian Vault。
7. 任务只关闭它亲自启动且 PID/profile/cwd 可证明的 Chrome；不按名称结束 Chrome，不关闭用户日常窗口。profile 与 test Vault 默认保留并报告，不为“清理”递归删除。

真实 X 必然有平台网络，QA 不宣称 Chrome 进程零网络。证据只证明扩展代码没有 fetch/private API/credential 路径；不抓 HAR、trace、DOM snapshot 或网络 Authorization。

### 13.11 测试与 QA 证据

#### 单元/集成

- DB2 -> DB3 成功、upgrade transaction abort 后仍可读 v2、post-commit reopen validation fail-closed、旧 active/terminal job、legacy existing row、未知字段、宽容器、计数和原子性。
- `classifyAndPersistScanBatch` 的 catalog/classification/candidate/checkpoint 单事务、catalog TOCTOU、commit 前 deadline/abort、整批 rollback 和 stale revision。
- incremental/backfill、catalog existing 不占 candidate cap、same-job replay 不增加 known frontier、20 known stop、50 candidates 后下一 job 能越过顶部 existing 到第 51 条新内容。
- 50+ exact-existing 仍触发 node/time/byte budget；same-job replay 增加 scanned/accepted/bytes 且重置 known；零 candidate 时 existing observation counts/bytes 仍原子持久化，不能由 coordinator 低报 scalar 绕过。
- budget/user pause 显式 finalize；其它 stop reason 拒绝 finalize；零候选及全部 excluded 的 no-write completion 均不请求 Vault permission。无 classification error 得到 `complete`，有 error 得到 `complete_with_issues`；计数、active-source 释放和 close/reopen UI 恢复必须一致。
- scanning cancel race、paused/ready cancel、post-write reconcile 后 abandon、pending intent/stale revision 拒绝取消，并证明 cancelled job 释放 active source 且不删除历史或文件。
- runtime message forbidden keys/getter/proxy/prototype/oversize/depth/node/unknown key、UI/content sender spoof、nonce/job/revision/document mismatch。
- one-shot intent TTL、重复消费、并发消费、session corruption、window/tab change。
- user pause race、重复 start/resume、service worker interrupted recovery、content duplicate injection、三批 no progress、页面级 challenge 与帖子正文伪 challenge。
- 同一 X source 的并发 start/resume fail closed、最多一个 outstanding content request、fake clock 证明滚动完成到下一批请求至少 2,000 ms、首次 probe 最多 5 次滚动，429/challenge 后无自动 retry。
- Vault permission denied/revoked、sidepanel close、pending intent reconcile、1-3 条 partial、重复写和 no overwrite。
- manifest 不再常驻授予/注入 X/Twitter；X exact optional permission request/deny/contains/remove、active job 撤销保护，以及 context-menu `activeTab` 动态单条推文提取回归。

#### 离线 extension fixture E2E

- 使用本机已安装 Chrome、全新项目 profile和实际 `dist` extension。
- Playwright route 在精确 `https://x.com/i/bookmarks` 提供脱敏 fixture，context offline，禁止 fixture 远程请求；不加载真实 X。
- 从 Popup 唯一动作打开 Side Panel，完整走 request exact X permission -> start -> pause/resume -> review -> all-excluded no-write/cancel，并验证 revoke；证明没有 X permission 时不注入、没有真实用户手势/目录授权时不写入。覆盖 reload/SPA navigation、stale document、重复运行、known frontier 和 backfill 第 51 条。File System picker 不用 CDP 或 test-only production backdoor 绕过，实际 disposable Vault outcome 留给人工隔离 QA；writer/engine 的自动化证据使用单元集成中的 fake handle。
- 截图只允许脱敏 fixture UI，不含真实帖子、URL、账号或 Vault 内容；人工检查 popup、窄 Side Panel、深浅主题、长文本、键盘和 focus。

#### 受界真实 X QA

- probe 只记录 Chrome/extension version、模式、预算、枚举状态、数量、stop code 和耗时；不把标题、正文、作者、ID、URL 或媒体写入 repo/log/截图/review。
- 验证 exact page capability、真实 selector、虚拟列表滚动、pause/resume、切离 bookmarks 页得到 `tab_changed`、10-item probe 不夸大 completeness。
- 用户授权 disposable Vault 后只写 1-3 条；QA 通过 UI outcome 和测试目录文件数量/大小核对，不读取或打印文件名/正文。
- 第二次 incremental 必须对已写内容返回 existing/skip，文件数不增加；changed/incomplete 不覆盖。
- 真实页面没有稳定 end marker 时结论必须保持 `LIMITED_GO/batch-only`，不能为了 Goal DONE 伪造 terminal。

#### 最终质量门禁

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm --filter @shuhai/extension run build`
- 精确 Prettier check、`git diff --check`、full/production audit 与 lock SHA 前后相同。
- 独立 reviewer 检查 actual diff；独立 QA 走 fixture 和受界真实 X 用户旅程。实现者自测只算 candidate。

### 13.12 043B 验收与回滚

043B 只有同时满足以下条件才可把 Goal 043 标为 `DONE`：

- Popup/Side Panel 生产入口、sender/tab/document/job/revision 绑定和 runtime schema 独立 `PASS`。
- X/Twitter 不再获得常驻页面读取；X 同步只在用户首次确认后持有精确 X host permission，可撤销，拒绝授权时不创建 job 或注入。
- 50 candidate/backfill/known frontier/finalize batch 语义没有永久卡住或“全部完成”误报。
- DB3 upgrade transaction 原子、post-commit validation fail-closed、现有 catalog/Vault identity 不变，失败时不丢数据。
- 用户精确选择前无文件写入；disposable Vault 1-3 条逐项结果真实，重复运行不新增重复文件。
- 用户可持久化取消所有 pre-write pause；全部 excluded 可无 Vault 权限结束，且 classification error 不会被误报成功；post-write 只能在 reconcile 后安全停止并保留真实 outcomes。
- 受界真实 X probe 没有使用 credential/private API/MAIN world/fetch，也没有触发风控绕过。
- 完整门禁、Node 20 CI、独立 actual-diff review 与独立 QA 均通过。

代码回滚只允许普通反向 PR，不 reset/force push。DB v3 不提供破坏性 down migration；若生产接线失败，禁用 UI 路由但保留 v3 数据和 catalog。源端取消收藏永不删除本地文件。

### 13.13 043B STOP 条件

- 需要超出第 13.1 节的 manifest/permission/CSP 改动、MAIN world、fetch/private GraphQL、Cookie/token、CAPTCHA/429 绕过或后台自动监控。
- sender/documentId 在本机 Chrome 无法可靠获得或 bind；不得降级只看 message.type/URL 字符串。
- exact-existing 仍占 candidate cap、backfill 在已入库前 50 条后无法继续，或 pause batch 仍无诚实进入 review 的状态。
- DB3 需要重算 hash、改 Vault path、清 catalog、删除旧 job 或猜测 active write。
- File System permission 只能通过 service worker/非用户手势请求，或需要把 handle/内容发送到不必要上下文。
- 真实 QA 需要扫描私人主收藏库、读取凭据、记录正文/URL、下载浏览器、杀未知进程、操作 Docker/端口或执行危险命令。
- X 页面结构无法在 10-item probe 中稳定证明；此时维持 `LIMITED_GO`，回到 adapter 研究，不用放宽选择器或权限制造通过。
- 无法证明单 X job/tab/invocation、单 outstanding request、2 秒滚动间隔或 429 零自动重试；不得用提高并发、缩短间隔或自动刷新制造速度。

### 13.14 043B 合同独立复审结论

合同只读复审由 Gibbs (`019f5ca8-5c9e-7901-b5b7-70ce22aa3270`) 与 Helmholtz (`019f5cb3-8157-7eb3-a5be-64da95e458d8`) 独立完成：

1. Gibbs 首轮 `FAIL` 指出四项缺口：不可恢复 pause 没有持久 cancel；manifest 的常驻 X/Twitter 权限违反 v4 首次最小授权与撤销要求；全部 excluded 没有 no-write completion；catalog 查询与 candidate/checkpoint 持久化不在同一事务。
2. Helmholtz 首轮 `FAIL` 进一步指出 store 无法在事务内证明 exact-existing/replay 的 accepted count/bytes 预算增量，且“v3 upgrade 已提交后 reopen 失败仍回滚 v2”的说法不可实现；测试也缺少预算不可绕过的直接断言。
3. 合同据此加入精确 manifest 权限迁移、平台权限生命周期、`classifyAndPersistScanBatch`、`cancelJob/abandonWriteJob`、`completeReviewWithoutWrites`、upgrade abort 与 post-commit fail-closed 的分离语义及专项测试。Helmholtz 第二轮给出 `PASS`，确认原四项聚焦问题全部关闭。
4. Gibbs 第二轮发现最后一个 P1：含 `classification=error` 的全 excluded job 在 `complete` 与写入型 `partial` 之间冲突。合同新增 terminal `complete_with_issues`、持久化 `classificationErrorCount`、零写入约束、active-source 释放、reload UI 与专项测试后，Gibbs 第三轮给出 `PASS`。

最终 verdict：`043B CONTRACT PASS`，P0/P1/P2 均为 0。该结论只证明合同足以进入下一道人工作业门禁；没有修改生产代码、没有运行真实 X、没有请求平台/Vault 权限，也不构成实现或真实用户旅程证据。合同通过时进入 `CONTRACT_PASS_WAITING_MANUAL_GATE`；用户随后授权日常 Chrome 只操作 X 并要求限制并发，当前已按第 3.3 和 13.10 节转为 `IN_PROGRESS_OFFLINE_IMPLEMENTATION`，真实 probe 与 Vault 仍未授权。
