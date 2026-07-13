---
id: goal-043
title: X Bookmarks Incremental Sync MVP
status: IN_PROGRESS
version: 1
updated: 2026-07-13
depends_on: [goal-041, goal-042]
branch: codex/social-sync-v4
---

# Goal 043：X 收藏增量同步 MVP

> Goal 041 对 X 收藏页 DOM 路线只给出 `LIMITED_GO`，Goal 042 已 `DONE/PASS`。本 Goal 分成 043A fixture-only 候选和 043B 真实 Chrome QA/最小接线；当前 v1 只允许 043A 与工具链门禁，不能据此修改 manifest、UI、service worker 或访问真实 X。

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

### 3.3 043B：真实 Chrome QA 与最小接线

043B 必须先把实际代码事实、准确文件 allowlist、权限变化、测试账号和回滚写入 Goal v2，并再次独立 review。至少需要：

- 本机已安装 Chrome 的项目隔离验证。
- 专用测试账号或用户明确指定的测试页；不默认扫描主收藏库。
- sender/tab/frame/host/job 绑定与运行时 message schema。
- 最小 manifest/content/background/surface 接线和一条真实用户旅程。

没有 v2 精确授权时，043A 实现者不得提前修改这些入口文件。

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
- 自动化使用 `C:\Projects\ShuHai\.tmp\goal-043\chrome-profile` 下任务专属全新 profile；不得复制、读取或修改日常 Chrome profile、Cookies、密码、历史、书签和登录数据。
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
- 浏览器命令必须等 G0 和 043A 实现 review，通过后按第 6 节补充精确 executable/profile/PID 合同；当前不得启动。

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

- 043A fixture E2E：本机 Chrome + 全新项目 profile、外部网络 0、虚拟节点回收、pause/resume。
- 043B 真实 X：由 v2 定义测试账号、条目上限、截图/DOM 断言、无正文入 repo、无凭据日志和停止条件。

## 10. QA Delta

```text
变更的用户行为: 043A 无生产入口；建立 X 增量同步候选领域能力
可能损坏的数据: 仅 fake IndexedDB/mock Vault；不得访问真实 Vault/收藏
新增信任边界: X DOM batch -> runtime schema -> persistent coordinator
新增单元测试: adapter/schema/store/selection/stop reason/攻击 fixture
新增集成测试: coordinator + Goal 042 engine + mock Vault
需要的 Chrome 旅程: G0 后 fixture；043B 才是隔离真实 X
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

## 12. STOP 条件

- 需要 Cookie、token、private GraphQL、MAIN world、任意 fetch、CAPTCHA/429 绕过或后台静默浏览。
- 需要扫描用户主收藏库作为首次证明，或需要把私人正文/URL写入 repo、日志、截图或 agent 上下文。
- 需要 manifest/UI/service worker/content/shared/desktop 等 v1 allowlist 外修改。
- 工具链精确版本、license、engines、install script、audit 或 lockfile delta 无法证明。
- 需要下载浏览器、复制日常 Chrome profile、杀未知进程、释放未知端口、操作 Docker 或执行危险命令。
- 无法持久化 stop reason、精确选择/revision，或无法保持 Goal 042 的幂等/partial/Vault 安全语义。
