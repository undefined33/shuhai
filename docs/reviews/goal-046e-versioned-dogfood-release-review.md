# Goal 046E 独立合同审查

> 审查日期：2026-07-28
> 审查对象：`docs/goals/goal-046e-versioned-dogfood-release.md` v1
> 审查角色：独立合同 Reviewer
> 结论：`REWORK`

## 1. 结论与计数

| 严重度 | 数量 |
| ------ | ---: |
| P0     |    0 |
| P1     |    2 |
| P2     |    6 |
| P3     |    2 |

合同选择“合并后主线的版本化 detached worktree + 不可覆盖 release 目录 + 固定扩展
ID + 逐文件 hash + 隔离 Chromium”的总体方向正确，也明确排除了真实 Chrome、X、
Vault、书签和私钥。当前仍有两个核心保证无法由合同中的命令真实证明，并有六个执行闭环
缺口，因此不能从 `DRAFT` 推进到 `READY`。

## 2. 逐项发现

### P1-1：只比较本地 `origin/main`，不能证明产物来自远端合并后 main

位置：4.2、6.2、8、9。

创建工具只要求 `HEAD` 等于“当前本地 `origin/main`”。remote-tracking ref 可以过期；
PR 合并后若没有一次明确、受界的 fetch，工具可能从旧 main 生成一个完全通过 hash 和
acceptance 的过期产物。这直接违反“从合并后的 `origin/main` 生成”的核心结果。

必须修复：

1. 在进入离线 release 阶段前定义一次精确且非破坏性的
   `git fetch --no-tags origin main`，记录 fetch 后的 40 位 OID。
2. 明确该 OID 必须等于已通过远端 CI 的 PR 合并结果；若远端 main 已继续前进，则合同要
   明确是发布“当前远端 main”还是“该 PR 的 merge commit”，不能两者混写。
3. detached worktree 必须从这个已记录 OID 创建；之后才进入 offline 阶段。
4. `release.json`、最终状态文档和 review 记录同一个 OID，工具继续验证
   `HEAD == fetched OID`，不能只相信本地 ref 名称。

### P1-2：离线安装会运行 lifecycle script，可能修改共享 Git hooks

位置：4.2、4.3、8；事实依据：根 `package.json` 存在 `"prepare": "husky"`。

`pnpm install --offline --frozen-lockfile` 默认可运行根 `prepare` 和依赖安装脚本。在 Git
worktree 中，hooks 属于共享 repository metadata；这可能写到实施 checkout 之外并影响主
checkout 或其它 worktree，与“主 checkout 只读”和“不影响其它任务”冲突。offline 只约束
网络，不约束 lifecycle 副作用。

必须修复：

1. 合并后安装命令改为
   `pnpm install --offline --frozen-lockfile --ignore-scripts`。
2. 合同明确不运行 `prepare`、Playwright browser install 或任何依赖 lifecycle script。
3. 若现有锁定依赖在 `--ignore-scripts` 下无法运行门禁，必须停止并回到合同审查，不能临时
   放开脚本或下载浏览器。

### P2-1：固定的最终 worktree 路径只能发布一次，升级流程不闭合

位置：2.7、4.2、10。

`C:\Projects\ShuHai\.worktrees\dogfood-release` 被要求永久保留，且再次存在时必须停止。
这能保存第一份产物，却使下一次 main release 无法使用同一流程；“升级和回退说明”因此
缺少可执行的未来路径。若以后 checkout/switch 这个 detached worktree，又会破坏当前长期
加载目录的来源边界。

必须修复：最终 release worktree 本身也应版本化，例如
`.worktrees/dogfood-release-<source-commit-first-12>`，并继续执行 exists-stop。新版本创建
新的 detached worktree，旧版本和旧加载路径保持不变；不得要求原地切换或清理旧 worktree。

### P2-2：直接写最终目录不是事务发布，首轮失败会留下不可重试的半成品

位置：5.3、6.3。

合同同时要求“只向最终固定目录写入”“任何写入 exclusive/no-overwrite”以及“目标存在即
停止”。若复制第 N 个文件、写 metadata 或最终 fsync/close 时失败，最终 release ID 目录
会成为半成品，之后又因 no-overwrite 永久拒绝重试。用户只能额外授权人工删除，流程本身
并不稳定。

必须修复：

1. 允许在 `dogfood/releases/` 下创建 task-owned、随机且 exclusive 的 staging sibling。
2. staging 中完成复制、逐文件 hash、manifest/ID 校验和完整自校验。
3. 最终目标不存在时，使用同一文件系统内的原子 rename 发布；不得 merge/replace 已存在
   目标。
4. 失败 staging 保留并明确标记为非可加载产物；自动清理仍禁止。后续重试使用新的 staging
   ID，不会覆盖失败证据。

### P2-3：同一个 verify 命令无法同时满足 acceptance 前后两种相反要求

位置：6.5、8。

第一次 `pnpm dogfood:verify -- <release-id>` 在 acceptance 尚不存在时必须成功；最后一次
同名、同参数命令又被要求“同时检查 `acceptance.json` 存在且 overall PASS”。合同规定
verify 只接受一个 release ID，因此实现无法判断本次调用属于前验还是终验。

必须修复：定义无歧义的 CLI。例如保留 basic verify，并新增固定的
`pnpm dogfood:verify-accepted -- <release-id>`；或允许唯一固定 flag
`--require-acceptance`。两种模式都必须拒绝额外参数和路径输入，最终命令清单与工具 parser
保持一致。

### P2-4：reparse point 要求没有可执行判定算法，容易产生虚假安全声明

位置：5.3、6.3、6.5、7。

“拒绝任何 reparse point”比 Node `lstat().isSymbolicLink()` 能稳定证明的范围更宽；合同
也没有要求逐级检查现有祖先和 realpath containment。实现者可能只检查最终文件，漏掉父
目录 junction；也可能声称普通 Node API 已识别所有 Windows reparse 类型。

必须修复：把安全不变量写成可测试算法：

1. 对 release root、staging、目标、extension 和 acceptance profile 的每个已存在祖先逐级
   `lstat`，拒绝 symbolic link/junction 和非预期文件类型。
2. 对所有已存在路径执行 `realpath`，按 Windows 大小写规则验证仍位于各自固定 root。
3. 每个新相对路径先做 `resolve` containment，再使用 exclusive create。
4. 若仍要求拒绝所有其它 Windows reparse tag，必须指定仓库现有工具可实现且不需要下载、
   提权或系统配置的精确探测方法；否则将措辞收敛为“任何可导致路径重定向或逃逸的
   symlink/junction/reparse 路径”。

### P2-5：Goal 使用了状态索引未定义的 `READY_FOR_INTEGRATION`

位置：9；对照 `docs/goals/README.md` 的 Goal 状态规则。

当前全局状态机只定义 `DRAFT -> READY -> IN_PROGRESS -> READY_FOR_REVIEW -> DONE`，
合同却插入 `READY_FOR_INTEGRATION`，没有定义谁推进、何时回退、是否算实施中 Goal，也
没有要求同步更新三处状态源。这会再次制造状态漂移。

必须修复：优先复用已定义状态；若确实需要 `READY_FOR_INTEGRATION`，必须在
`docs/goals/README.md` 的全局状态规则中正式定义，并写清 frontmatter、Goal 索引和
`docs/PROJECT_STATUS.md` 的同步转换。合同 review PASS 前不能只在局部 Goal 自创状态。

### P2-6：安全核心缺少明确的负向测试矩阵

位置：5.1、8。

合同只列一个 `dogfood-release.test.ts` 和全量命令，没有规定该文件必须证明哪些拒绝路径。
双 build、dirty/stale source、partial publish、path escape、extra file、hash drift 和
acceptance fail-closed 都是本 Goal 的主要行为，不能只依赖最终 happy-path Chromium。

必须修复：在测试合同中至少明确以下自动化用例：

- dirty tracked、dirty untracked、HEAD/ref 不匹配和非 40 位 OID 均拒绝。
- 已存在 final target、staging 冲突、路径逃逸、父级 symlink/junction 均拒绝。
- 双 build 的缺失/额外文件、bytes/hash 漂移均不发布 final target。
- partial staging 不会出现可加载 final target，重试不覆盖旧 release。
- verify 拒绝 release 中缺失、额外、非普通、size/hash/ID/manifest/lockfile 不一致。
- acceptance 失败或异常时不写 PASS；终验拒绝缺失、非 PASS 或与 release 不匹配的
  `acceptance.json`。
- CLI 拒绝绝对路径、`..`、额外参数、环境变量输出覆盖和任意 browser/profile/URL 输入。

测试可对纯函数、临时 fixture 和受控 runner 做依赖注入，但生产 CLI 仍必须使用固定 build
命令；不得为了测试给生产 CLI 增加任意命令执行能力。

### P3-1：release metadata 缺少构建工具链身份

位置：6.4。

逐文件 hash 足以验证当前字节，但长期审计无法区分 Node/pnpm/Vite 工具链变化。建议
`release.json` 增加 bounded 的 `nodeVersion`、`pnpmVersion`、`platform`、`arch`，并从
锁定 workspace 读取 Vite 版本；不要记录用户名、绝对可执行路径或环境变量。

### P3-2：网络证据字段无法区分“未观察到”与“观察到并阻断”

位置：7.3、7.7。

单个“阻断请求计数”在值为 0 时语义不清。建议 acceptance 证据分别记录
`observedHttpRequests`、`abortedHttpRequests`、`unexpectedNetworkFailures`，并明确
offline 是启动配置而不是“零网络尝试”的证明。任何未被策略阻断的 HTTP(S) 都应使
`overall` 失败。

## 3. 已确认正确的合同部分

- 版本化 `extension/` 与 mutable `packages/extension/dist` 分离，后续普通 build 不会触碰
  已发布 extension 文件。
- release ID 同时绑定 manifest version 和完整源提交的 12 位前缀。
- manifest public `key` 只用于固定 ID 推导，不访问私钥。
- extension 文件集合、字节数和 SHA-256 排序记录，acceptance 前后要求 hash 不变。
- 真实 Chrome/X/Vault/书签、Cookie、token、Provider 和其它标签均明确禁止。
- Chromium 使用全新项目 profile、offline 模式、固定 extension 路径和只读 Popup 身份
  断言；不把隔离证据冒充真实 toolbar/Vault/两周 dogfood。
- release、acceptance 和旧版本均采用 no-overwrite，回退不依赖覆盖旧目录。
- Reviewer 写入范围与实现范围分离，当前 `DRAFT/CONTRACT_REVIEW` 状态正确。

## 4. 完成前必须修复项

本合同再次送审前必须全部完成：

1. 修复 P1-1：建立远端 main freshness、CI merge OID 与 detached source 的可核验证据链。
2. 修复 P1-2：离线安装强制 `--ignore-scripts`，禁止 husky/依赖 lifecycle 副作用。
3. 修复 P2-1：版本化最终 worktree，使未来升级与旧版本并存。
4. 修复 P2-2：staging 完整校验后原子发布，失败不污染 final target。
5. 修复 P2-3：拆分 basic verify 与 require-acceptance 终验语义。
6. 修复 P2-4：把路径、祖先和 reparse 防护写成可实现、可测试的不变量。
7. 修复 P2-5：统一 Goal 全局状态机。
8. 修复 P2-6：补齐 fail-closed 负向测试矩阵。

P3 建议同轮修复；若保留，下一轮必须逐项说明为何不影响长期加载和证据诚实。

## 5. 审查边界与证据

本轮仅执行仓库内只读检查并写本 review。未运行浏览器、网络、build、install、lint、
typecheck、test、格式化、Git stage/commit/push，也未访问真实 Chrome、X、Vault、书签、
Cookie、token、私钥、其它进程或端口。

只读检查包括：

- 按规定顺序读取协作、状态、路线、Goal 索引、workflow、命令安全、denylist 和
  `CONTRIBUTING.md`。
- 审查 Goal 046E v1、当前 `git status`/diff、根与 extension package metadata、
  manifest、tsconfig、gitignore、Vite build 行为和既有隔离 E2E 能力。

审查时 worktree 在 `codex/goal-046e-dogfood-release`，相对 `origin/main` 仅有
`docs/goals/README.md` 修改和 Goal 合同新增；本 review 是本轮唯一新增写入。

## 6. Round 2：v2 合同复审

> 复审日期：2026-07-28
> 复审对象：`docs/goals/goal-046e-versioned-dogfood-release.md` v2
> 当前结论：`PASS`

### 6.1 严重度计数

| 严重度 | 数量 |
| ------ | ---: |
| P0     |    0 |
| P1     |    0 |
| P2     |    0 |
| P3     |    0 |

### 6.2 上一轮发现闭合情况

| 上一轮发现                      | v2 闭合证据                                                                                                                                                              | 结果 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| P1-1 远端 main 来源不可证明     | 4.2 和 8 明确先执行受界 fetch 与 `gh pr view`，绑定 CI 成功的 40 位 merge OID；若 fetch 后 main 已前进则停止，离线阶段只认已记录 OID                                     | 闭合 |
| P1-2 install lifecycle 副作用   | 4.2 和 8 固定使用 `--offline --frozen-lockfile --ignore-scripts`，明确禁止 root prepare、Husky、browser install 和 dependency lifecycle；失败则退回合同审查              | 闭合 |
| P2-1 最终 worktree 只能发布一次 | 2.7 和 4.2 将 detached worktree 改为 `dogfood-release-<merge-oid-first-12>`；新版本使用新 worktree，旧路径永久保留                                                       | 闭合 |
| P2-2 非事务发布污染 final       | 5.3 和 6.3 增加 exclusive 随机 staging、完整自校验和同文件系统单次 rename；失败 staging 保留且不成为 final                                                               | 闭合 |
| P2-3 verify 前后语义冲突        | 6.5 和 8 拆分 basic `dogfood:verify` 与 `dogfood:verify-accepted`，终验独立要求 acceptance PASS 和 identity/hash 一致                                                    | 闭合 |
| P2-4 reparse/path 判定不可执行  | 5.3 和 6.3 将不变量收敛为 Node 可识别的 symbolic link/junction、逐级 lstat、realpath containment、Windows 大小写规则和 resolve containment，不再声称识别全部 reparse tag | 闭合 |
| P2-5 局部自创状态               | 9 明确只使用全局 `DRAFT -> READY -> IN_PROGRESS -> READY_FOR_REVIEW -> DONE`，集成与发布作为 `READY_FOR_REVIEW` 内部证据阶段                                             | 闭合 |
| P2-6 缺少负向测试矩阵           | 8 明确列出 dirty/OID、existing target、staging、路径逃逸、双 build 漂移、partial publish、verify、acceptance 和 CLI 输入拒绝矩阵                                         | 闭合 |
| P3-1 缺少工具链身份             | 6.4 增加 Node、pnpm、Vite、platform 和 arch bounded metadata                                                                                                             | 闭合 |
| P3-2 网络证据语义不清           | 7.7-7.8 分开记录 observed、aborted 和 unexpected network，并明确 offline 不冒充 OS 级零网络证明                                                                          | 闭合 |

### 6.3 复审判断

v2 已形成可执行闭环：

- 远端实现 PR merge OID、成功 CI、fetch 后 `origin/main`、detached `HEAD`、
  `release.json` 和最终状态文档绑定同一提交。
- 每个 release 使用版本化 detached worktree；普通开发 build、未来版本和回退不会覆盖
  已加载目录。
- 安装保持 offline/frozen/ignore-scripts，不触发共享 hooks、浏览器下载或依赖 lifecycle。
- 双 build inventory 一致后才进入 staging；final 只由校验完成的 staging 原子 rename
  出现，no-overwrite 与失败重试可以同时成立。
- fixed ID、manifest、lockfile、逐文件 hash、service worker hash、basic verify 和
  accepted verify 的责任边界清楚。
- 路径、symlink/junction、realpath、CLI 参数和环境变量覆盖均有 fail-closed 约束及负向
  测试合同。
- Chromium 只使用已存在的 Playwright executable 和全新 repo-local profile；不读取真实
  Chrome、X、Vault、书签或权限数据，网络证据也不夸大。
- 实现 PR、合并后 release、独立 final evidence review 和 docs-only closure PR 顺序明确，
  不把隔离 acceptance 冒充真实 toolbar、Vault 或两周 dogfood。

### 6.4 剩余阻塞项

无合同级 P0/P1/P2/P3 阻塞项。v2 可以由 Integrator 将合同 review 状态更新为 `PASS`，
并按全局状态机从 `DRAFT` 推进到 `READY`；这项状态推进不属于 Reviewer 写入权限。

本次 `PASS` 只表示执行合同完整，不表示实现、质量门禁、远端 CI、release 产物、隔离
Chromium acceptance 或最终 evidence review 已通过。上述事实仍必须在对应阶段真实产生，
不得用本合同结论代替。

### 6.5 Round 2 审查边界

本轮只读取 v2 Goal 和现有 review，并只向本 review 追加 Round 2。未读取其它文件，未运行
浏览器、网络、build、install、lint、typecheck、test、格式化或 Git 写命令，未访问真实
Chrome、X、Vault、书签、Cookie、token、私钥、其它进程或端口。

### 6.6 Round 2 命令位置勘误确认

复审以 v2 当前最新文件为准。第 8 节已明确划分执行 cwd：

1. `git fetch --no-tags origin main`、`gh pr view ...` 和版本化
   `git worktree add --detach ... <merge-oid>` 在实施 worktree 中执行。
2. 创建完成后切换到
   `C:\Projects\ShuHai\.worktrees\dogfood-release-<merge-oid-first-12>`。
3. offline/frozen/ignore-scripts install、完整门禁、create、basic verify、isolated
   acceptance 和 accepted verify 全部只在该 detached worktree 中执行。

这一修订消除了“尚未创建 detached worktree 却要求在其中 fetch/worktree add”的命令顺序
歧义，也没有重新引入 lifecycle、远端来源、路径或真实数据风险。Round 2 结论保持
`PASS`，P0/P1/P2/P3 均为 0，无剩余合同阻塞项。

## 7. Implementation Review

> 审查日期：2026-07-28
> 审查对象：Goal 046E v2 当前未提交实现 diff
> 审查角色：独立实现、安全与发布 Reviewer
> 结论：`REWORK`

### 7.1 严重度计数

| 严重度 | 数量 |
| ------ | ---: |
| P0     |    0 |
| P1     |    2 |
| P2     |    2 |
| P3     |    1 |

### 7.2 阻塞发现

#### P1-1：`verify-accepted` 接受自相矛盾的 PASS 证据

`AcceptanceMetadataSchema` 只约束 `bookmarkDigest.unchanged` 为 `true`，却不要求
`before === after` 和 `nodeCountBefore === nodeCountAfter`；网络字段也不要求
`observedHttpRequests === abortedHttpRequests`。`verifyReleaseAt()` 解析该 schema 后只核对
release/source/extension/service-worker identity。因此一个被修改为“书签摘要已变化”或
“观察到 1 个 HTTP 请求但阻断 0 个”的 `acceptance.json`，仍可通过
`dogfood:verify-accepted`。

直接证据：

- `packages/extension/scripts/dogfood-release.ts:100-120` 缺少上述跨字段约束。
- `packages/extension/scripts/dogfood-release.ts:490-509` 没有补做 bookmark/network 语义
  校验。
- `packages/extension/tests/dogfood-release.test.ts:206-230` 只用
  `unexpectedNetworkFailures: 1` 触发失败，没有覆盖 `observed > aborted` 且 failures 为 0，
  也没有覆盖摘要/节点数不一致。

这违反 Goal 6.5、7.7-7.8 的终验 fail-closed 合同。完成前必须把跨字段不变量放进 schema
或 accepted verifier，并增加精确负向测试。

#### P1-2：合同规定的安全核心负向矩阵大部分没有实现

当前定向测试只有 7 个，未调用 `createRelease()`、`verifyRelease()` 或
`acceptRelease()`，也没有受控 filesystem/build/browser adapter。它不能证明：

- 已存在 final、staging 冲突和 partial staging 不会发布 final；
- 双 build 缺失/额外/bytes/hash 漂移时 final 不出现；
- verify 对实际 release 的缺失、额外、特殊文件、manifest/ID/lockfile 漂移 fail closed；
- acceptance 异常不写 PASS，accepted verify 拒绝缺失、非 PASS 和 identity/hash 漂移；
- 每次 build 前的 `dist` redirect 防护真正生效；
- 失败重试不覆盖旧 staging/release。

现有 `compareInventories()`、schema 和 CLI parser 单元断言不能替代这些端到端的仓库内临时
fixture 测试。Goal 8 明确把上述矩阵列为“至少覆盖”，因此当前状态文档中的“实现门禁已
通过”不足以支持发布。完成前必须用 repo-local 临时 fixture 和受界 adapter 覆盖核心成功/
失败路径；production CLI 仍不得获得任意命令、输出目录或浏览器输入。

#### P2-1：创建工具没有验证当前 checkout 是 detached HEAD

Goal 6.2 要求创建命令验证当前目录是 detached release worktree。实现只比较
`process.cwd()`、`HEAD` 与传入 OID，并检查 worktree clean：

- `packages/extension/scripts/dogfood-release.ts:529-535`
- `packages/extension/scripts/dogfood-release.ts:357-362`

处在某个分支、但分支尖端恰好等于传入 OID 的 checkout 同样会通过。完成前必须通过受界
Git 查询验证 `HEAD` 没有 symbolic branch，并增加 branch-attached 拒绝测试。

#### P2-2：网络计数无法覆盖扩展启动早期及 service worker 发起的请求

`launchPersistentContext()` 会先加载扩展并启动 service worker，路由拦截却在 context
创建完成后才注册（`dogfood-acceptance.ts:154-187`）。此外，page/context routing 不能被
当作 extension service worker 请求的完整观察器。当前实现可能以
`observedHttpRequests: 0` 通过，却没有证明扩展启动阶段没有产生未计数的 HTTP(S) 尝试。

`offline: true` 和 Chromium flags 是重要的隔离层，但不能替代证据计数。完成前必须调整
验收证据语义或采用能覆盖 extension service worker 的受控观测方式；若技术上只能证明
“离线启动且页面路由未观察到请求”，metadata、文档和 verifier 必须如实收窄，不能把该
计数表述成整个验收过程的完整网络观测。

### 7.3 P3 与过度设计判断

#### P3-1：实现规模与验证能力失衡

两个发布脚本合计约 989 行，却只有 240 行、7 个测试，且核心 I/O 路径没有进入测试。
“版本化目录 + inventory + 原子发布 + 独立验收”本身符合用户要求，不属于无价值功能；
但当前自建发布框架在路径工具、metadata、CLI 和 acceptance 中承担了过多责任，形成了
“实现复杂、证据很薄”的过度设计。

修复时不建议继续增加新的发布层或通用框架。应优先：

1. 保留一个最小 release creator/verifier；
2. 为 filesystem、Git identity、build runner 和 acceptance runner 提供窄且固定的测试
   adapter；
3. 复用既有隔离 E2E 能力，减少重复的浏览器编排代码；
4. 删除不能被验收证明的 metadata 声明，而不是继续堆字段。

### 7.4 已确认成立的实现部分

- source OID 为 40 位、`HEAD` 相等和 tracked/untracked dirty gate 已实现。
- `runBuild()` 在两次 build 前都会检查现有 `dist` 路径链和目录类型。
- 双 inventory、exclusive staging、staging 自校验、同文件系统 rename 与 final
  exists-stop 的主路径已实现。
- release ID、manifest public key 和固定扩展 ID
  `jdjmpeogiojjhdabdjmpeclcbjcekbje` 已绑定。
- release/acceptance metadata 使用 strict runtime schema，CLI 拒绝额外参数和路径形输入。
- acceptance 使用 fresh project-owned profile，只关闭自身持有的 context，并检查隔离
  profile 的书签摘要和 X optional permission 前后状态。
- README、CONTRIBUTING、release guide 与状态文档已统一区分 mutable `dist` 和版本化
  dogfood 路径；没有把隔离验收冒充真实 Chrome/Vault/两周 dogfood。

### 7.5 运行证据与缺口

本轮实际运行：

```text
pnpm --filter @shuhai/extension exec vitest run tests/dogfood-release.test.ts
PASS：1 file，7 tests

pnpm --filter @shuhai/extension run lint
PASS

pnpm --filter @shuhai/extension run typecheck
PASS
```

按 Reviewer allowlist，本轮没有运行 install、build、release create/verify/accept、浏览器、
网络或完整 workspace 门禁；没有访问真实 Chrome、X、Vault、书签、私钥、其它进程或端口，
也没有执行 Git 写操作。上述未运行项不能视为通过。

### 7.6 完成前必须修复

1. 修复 P1-1，并为 acceptance 跨字段不变量增加负向测试。
2. 补齐 Goal 8 的 release/verify/acceptance 核心失败矩阵；不能只测试纯函数。
3. 修复 P2-1，强制 detached HEAD 并测试 attached branch 拒绝。
4. 修复或诚实收窄 P2-2 的网络证据边界。
5. 修复后重新运行定向测试、extension lint/typecheck、完整质量门禁，并再次进行独立
   Implementation Review。

在上述 P1/P2 清零前，Goal 046E 不得提交发布 PR、创建最终 release 或进入隔离
acceptance。当前结论为 `REWORK`。

## 8. v3 窄 Amendment Review

> 审查日期：2026-07-28
> 审查对象：Goal 046E v3 相对 v2 的两项合同修订
> 审查角色：独立 Amendment Reviewer
> 结论：`PASS`

### 8.1 严重度计数

| 严重度 | 数量 |
| ------ | ---: |
| P0     |    0 |
| P1     |    0 |
| P2     |    0 |
| P3     |    0 |

### 8.2 Implementation Review P1-2 的合同侧范围

v3 在 5.3 明确新增：

```text
node_modules/.cache/shuhai-dogfood-tests/<run-id>/
```

该目录位于版本化 worktree 的 repo-local、已忽略 cache 边界内，并继续受普通目录/普通
文件、symlink/junction、realpath containment、预先存在目标和意外文件类型 fail-closed
约束。第 8 节仍只允许纯函数、受界 repo-local fixture 和注入的 filesystem/build adapter，
production CLI 的固定 build 命令、输出 root 和 browser 选择没有放宽。

因此，合同已为 create/verify/acceptance 核心失败矩阵提供明确且不污染 release 的测试
fixture 所有权边界，关闭 Implementation Review P1-2 的“合同没有可用测试落点”范围问题。
新增条目只允许本 Goal 工具创建对应 run 目录，没有新增自动清理、递归删除、覆盖、任意
临时路径或仓库外写入权限；失败 fixture 可以保留为证据。

这不代表 P1-2 的实现已经通过。实现者仍须真实补齐 Implementation Review 所列事务发布、
双 build 漂移、verify、acceptance、失败重试和 redirect 防护测试，并由后续独立实现复审
确认。

### 8.3 Implementation Review P2-2 的合同侧范围

v3 将 acceptance 网络字段精确收窄为 Chromium/extension 启动完成后，由页面 context 路由
观察到的：

- `observedPageHttpRequests`
- `abortedPageHttpRequests`
- `unexpectedPageNetworkFailures`

合同明确声明这些计数不覆盖 extension 启动早期或 service worker 的全部网络尝试，并把
`offline: true` 与禁网 flags 定义为额外隔离层，而不是 OS 级零网络或完整网络观测证明。
任何在该已声明观察范围内出现且未被策略阻断的 HTTP(S) 仍会使 acceptance 失败。

这一修订符合 Implementation Review P2-2 提供的允许修复路径：在当前技术观测能力有限时
诚实收窄 metadata、文档和 verifier 语义。它没有授权访问真实站点、放开网络、增加 URL
输入、启用 service worker 网络、读取日常 profile 或降低 offline/flags 隔离要求。

### 8.4 权限与边界判断

- 真实 Chrome、X、Vault、书签、Cookie、token、私钥和其它 profile 权限没有扩大。
- browser/network 权限没有扩大；仍禁止下载，acceptance 仍使用已存在 Chromium、全新
  repo-local profile、offline 和禁网 flags。
- 文件写入只增加一个 repo-local test run root，没有增加仓库外路径。
- 删除、覆盖、清理、进程、端口和 Git 写权限没有增加。
- release、staging、acceptance 的 no-overwrite 和 fail-closed 语义没有削弱。

### 8.5 剩余阻塞项

本次两项 amendment 没有合同级剩余阻塞项，P0/P1/P2/P3 均为 0，结论为 `PASS`。

Implementation Review 原有实现结论仍为 `REWORK`；本 Amendment Review 只确认 P1-2 与
P2-2 的合同侧范围已经闭合，不替代实现修改、测试证据、完整质量门禁或新的独立
Implementation Review。

### 8.6 审查边界

本轮只读取 v3 中与两项 amendment 有关的合同片段及现有 review 对应发现，并只向本 review
追加本节。未运行实现、build、install、browser、network、lint、typecheck、test、格式化
或 Git 写命令，未访问任何真实用户数据。

## 9. Implementation Review Round 2

> 复审日期：2026-07-28
> Reviewer：Ptolemy
> 审查对象：Goal 046E v3 最终 working diff
> 结论：`PASS`

### 9.1 严重度计数

| 严重度 | 数量 |
| ------ | ---: |
| P0     |    0 |
| P1     |    0 |
| P2     |    0 |
| P3     |    1 |

上一轮 Implementation Review 的 2 个 P1、2 个 P2 均已闭合。当前没有阻止 Goal 046E
进入后续完整质量门禁和 `READY_FOR_REVIEW` 的实现、安全或发布问题。

### 9.2 上一轮四项关闭证据

#### P1-1：矛盾 PASS 终验证据

`AcceptanceMetadataSchema` 现在以跨字段 refinement 强制：

- `bookmarkDigest.before === bookmarkDigest.after`
- `nodeCountBefore === nodeCountAfter`
- `observedPageHttpRequests === abortedPageHttpRequests`
- 页面网络失败、console/page error、X 权限和 `overall` 继续保持固定安全值

`verify-accepted` 会重新解析同一 schema，并继续核对 release ID、source commit、extension
ID 和 service-worker hash。repo-local fixture 已证明 bookmark/network 矛盾、非 PASS、
identity 和 service-worker hash 不匹配均无法通过终验。

结论：上一轮 P1-1 已关闭。

#### P1-2：安全核心负向测试矩阵

定向测试现在通过 repo-local 普通文件和目录，直接调用生产
`createRelease()`、`verifyRelease()` 和 `acceptRelease()`。测试 adapter 只替换固定 build、
时间、随机 ID、publish 和 Chromium observation 边界，没有复制一套替代发布算法。

当前 19 项覆盖：

- clean/detached/OID、dirty、attached branch 和 existing final gate；
- 双 build 的 hash、missing 和 extra drift；
- staging 冲突、partial publish、失败 staging 保留和新 staging 重试；
- 发布后 missing、extra、hash tamper、manifest、lockfile 和 redirect；
- acceptance 缺失、非 PASS、identity、service-worker hash、bookmark/network 矛盾；
- acceptance runner 异常时不写 PASS，以及有效 fake-runner evidence 的 accepted verify；
- 普通 junction、broken junction、绝对边界和 CLI path/extra argument 拒绝。

生产 CLI 仍只使用固定 production runtime，不接受任意 build command、output root、browser、
profile、URL 或环境变量覆盖。

结论：上一轮 P1-2 已关闭。

#### P2-1：detached HEAD

生产 source identity 读取 `git branch --show-current`，`validateSourceIdentity()` 要求 branch
为空；attached branch 会在首次 build 前以 `source_checkout_not_detached` 拒绝。测试同时
验证 build 调用数保持 0。

结论：上一轮 P2-1 已关闭。

#### P2-2：网络证据范围

Goal v3、release guide、acceptance metadata 和实现统一使用：

- `observedPageHttpRequests`
- `abortedPageHttpRequests`
- `unexpectedPageNetworkFailures`

文档明确声明它们只表示 Chromium/extension 启动完成后页面 context 的观测，不覆盖启动
早期或 service worker 的全部网络尝试，也不冒充 OS 级零网络证明。`offline: true` 和禁网
flags 仍作为额外隔离层保留。

结论：上一轮 P2-2 已按诚实收窄证据边界的路径关闭。

### 9.3 路径、事务和 override 复审

- `assertSafeExistingPathChain()` 使用
  `lstatSync(path, { throwIfNoEntry: false })` 逐级检查，broken junction/symlink 不再因
  `existsSync()` 返回 false 而漏过；新增 broken junction 测试已通过。
- 每次 build 都经同一 `buildInventory()` 在运行 build 前检查 `dist` 路径链，build 后再
  inventory；第二次 build 漂移不会创建 final。
- staging 使用 exclusive 随机目录，复制、metadata、manifest/ID 和 inventory 自校验完成
  后才 publish；失败 staging 保留，final 不出现，重试不覆盖旧证据。
- production CLI parser 只接受固定 command 与 OID/release ID；测试注入接口不能由 CLI
  参数或环境变量到达。
- 未发现新的路径逃逸、特殊文件、no-overwrite、partial、schema、CLI override 或真实数据
  边界问题。

### 9.4 独立运行证据

本轮 Reviewer 独立运行：

```text
pnpm --filter @shuhai/extension exec vitest run tests/dogfood-release.test.ts
PASS：1 file，19 tests

pnpm --filter @shuhai/extension run lint
PASS

pnpm --filter @shuhai/extension run typecheck
PASS

git diff --check
PASS；仅输出既有 LF/CRLF 转换提示
```

实现者关于先前全量 `pnpm test` 的报告没有被当作本轮独立证据。

### 9.5 P3 非阻塞维护建议

`ReleaseRuntime` 与 acceptance runner 为了让同一生产代码进入 repo-local fixture，暴露了
较宽的测试注入面，两个发布脚本的总体规模仍偏大。这些接口不能由 production CLI 或环境
变量触达，也没有新增依赖、daemon、网络或产品行为，因此不构成发布阻塞。

后续只应维护当前最小 creator/verifier/acceptance 边界，不要继续扩张为通用发布框架；
新增 metadata 或抽象前必须先有可执行验收需求。

### 9.6 未验证项与边界

本轮没有运行：

- 浏览器或 Playwright acceptance；
- production build；
- production release create/verify/accept；
- 网络、完整 workspace `pnpm test` 或最终 detached release checkout；
- 真实 Chrome、X、Vault、书签、私钥、其它进程或端口。

这些内容仍必须在 Goal 046E 后续完整质量门禁、合并后版本化 detached checkout 和最终隔离
release 阶段真实验证。本轮只修改本 review 文件，没有修改实现、Goal/status 文档或其它
路径，也没有执行 Git stage、commit、push 或其它 Git 写操作。
