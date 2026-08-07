---
id: goal-048
title: Host Command Incident Containment
status: READY_FOR_REVIEW
version: 3
updated: 2026-08-07
base_commit: 6157ed9ca138510b23431e42c41196fb4badcfd4
branch: codex/goal-048-host-command-replay
worktree: C:\Projects\ShuHai\.worktrees\goal-048-host-command-replay
supersedes_candidate_base: 13402ca845259df9bc4db15d132329aec8e0ba30
---

# Goal 048：本地命令事故面收口

## 1. 问题与新基线修订

本 Goal 只封闭仓库声明的本地 install、dev、build、lint、typecheck、test、coverage、
E2E、Husky、Prettier 和 dogfood release 命令事故面，不修改 Chrome Extension 产品行为。

旧候选基于 `13402ca`，固定 10 组 synthetic suite 与独立 final re-audit 均为
`PASS_INCIDENT_CONTAINMENT`，但它落后当前 live-verified
`origin/main@6157ed9ca138510b23431e42c41196fb4badcfd4` 51 个提交。当前 main 又新增了
Goal 046E 的 offline install 与四个 dogfood surface，因此旧候选不得整批复制、提交或
冒充当前验收。本版只做逐路径核对后的 replay，并把这些新增入口纳入同一 containment；只有
§5.5 明列的 7 个无 main 侧变化、无需 v3 修复的文件可在 hash 核对后 byte-copy。

要关闭的事故路径仍只有：

1. 目标 stdout/stderr 在 raw-byte 计数前被无界 capture、decode、保留或写日志。
2. 缺少 finite wall/idle、Windows Job 进程树、内存/进程数和 machine-wide heavy lane。
3. package scripts、install lifecycle、Husky、Prettier、dogfood CLI 和当前命令文档绕过
   canonical runner。

固定 heavy mutex 为 `Local\CodexHostHeavyLane-v1`，并发为 1。quick operation 也必须由
同一 registry 分类，但不获取 heavy mutex。busy/abandoned lane 在 `ChildPID=0` 时
fail closed。

## 2. 用户结果

- 仓库声明的本地工具入口只接受 typed named operation，不接受 arbitrary command、shell
  string 或 caller-supplied budget。
- Windows child 在执行用户代码前进入 kill-on-close Job；输出、时间、内存、进程数、
  cleanup、PID/port 和 receipt 都有固定边界。
- Goal 046E 的 offline install、create、verify、accept 和 verify-accepted 在本 Goal 中只证明
  typed route、sealed dispatch 与资源边界；真实 release 兼容性仍由 Goal 046E 门禁验收。
- 当前 041-046E 产品事实、Goal 046E 独立 acceptance-fix worktree 和主 checkout Goal 032 dirty
  均不被覆盖或吸收；相同 repo-relative path 在不同 worktree 中不共享写入所有权。

## 3. 非目标

- 不修改 `packages/extension/src/**`、Goal 046E 的 acceptance 实现/测试修复、release 文件系统事务、
  产品行为、CI、lockfile 或依赖。`dogfood-release.ts` 只允许收口既有 package-tool 子进程，并让
  release ID / pnpm provenance 的 create 与 verify schema 收敛到本合同的同一严格规则。
- 不运行真实 pnpm/package script、browser、Playwright、Husky commit、network、model、
  DB、Docker 或真实业务。
- 不新增 `.codex` hook/rule，不承诺拦截任意恶意外部 shell。
- 不扩张旧审计的未来 hardening 矩阵，不把本 Goal 变成通用发布框架。
- 不复用或修改既有 dogfood release，不写 `acceptance.json`。

## 4. 精确工作区与写入 allowlist

唯一 writer：

```text
branch: codex/goal-048-host-command-replay
worktree: C:\Projects\ShuHai\.worktrees\goal-048-host-command-replay
base: 6157ed9ca138510b23431e42c41196fb4badcfd4
```

允许修改的 30 个 durable paths：

```text
.gitignore
.husky/pre-commit
AGENTS.md
CLAUDE.md
CONTRIBUTING.md
README.md
docs/PROJECT_STATUS.md
docs/dogfood/release-guide.md
docs/goals/README.md
docs/goals/goal-046e-versioned-dogfood-release.md
docs/goals/goal-048-host-command-incident-containment.md
docs/workflows/command-safety.md
docs/workflows/dangerous-command-denylist.md
docs/workflows/verification-and-acceptance.md
package.json
packages/desktop/package.json
packages/extension/package.json
packages/extension/scripts/dogfood-release.ts
packages/extension/vitest.config.ts
packages/shared/package.json
playwright.config.ts
vitest.config.ts
scripts/host-command/BoundedHostCommandRunner.cs
scripts/host-command/Invoke-ShuHaiBoundedCommand.ps1
scripts/host-command/Test-ShuHaiBoundedCommand.ps1
scripts/host-command/assert-session.cjs
scripts/host-command/host-command-registry.json
scripts/host-command/hostile-child.cjs
scripts/host-command/shuhai-command.cjs
.tmp/host-stability-narrow-v1/implementation-report.md
```

Runner 只可额外覆写 ignored receipt `.tmp/host-command/current.json`（最大 32 KiB）及固定
synthetic test 目录 `.tmp/host-stability-narrow-v1/test/**`。测试临时项只按精确 manifest
窄清理；不生成 per-run log。

以下 foreign ownership 全部禁止写入：主 checkout Goal 032/048 混合 dirty、旧 Goal 048
worktree、既有 release/worktree、UI zip、045A toolchain artifacts 和其它 Goal 文件。

Goal 046E acceptance-fix 的唯一所有者仍是
`C:\Projects\ShuHai\.worktrees\goal-046e-acceptance-evaluate-fix`；本 Goal 全程不得在该 worktree
写入或执行命令，其 3 个 dirty path 必须保持 byte-for-byte 不变：

```text
docs/goals/goal-046e-versioned-dogfood-release.md
packages/extension/scripts/dogfood-acceptance.ts
packages/extension/tests/dogfood-release.test.ts
```

本 Goal 只授权在自己的 branch/worktree 中修改 base copy 的
`docs/goals/goal-046e-versioned-dogfood-release.md`，且仅限 current command canonicalization 与
明确标记 Goal 048 前历史证据的非产品 hunk。Goal 048 集成后，Goal 046E 才能恢复，并须在新
main 上语义重放上述 3-file dirty diff；若同一 Goal 文档发生冲突，必须同时保留 048 command
规则与 046E acceptance 修复，不得整文件择一覆盖。

## 5. 实现合同

### 5.1 Runner 不变量

- Public Node shim 只接受 registry operation ID。Windows local 必须进入
  `shuhai-command.cjs -> Invoke-ShuHaiBoundedCommand.ps1 -> BoundedHostCommandRunner.cs`；
  non-Windows interactive fail closed，`CI=true` 只允许 registry raw argv。
- Windows 使用 `CreateProcessW(CREATE_SUSPENDED)`，先 assign kill-on-close Job 再 resume。
  stdout/stderr 通过 anonymous pipes 读取，在 decode、retention、console 和 receipt 前执行
  per-stream/aggregate raw-byte cap。
- wall/idle 使用 monotonic deadline；parent PID + start identity、process/job memory、
  process-count、cancel、overflow、exception 和 parent disappearance 共用 task-owned cleanup。
- heavy operation 只持有 `Local\CodexHostHeavyLane-v1` 一个 lease；nested sealed raw 不重拿。
- receipt 只含 reason、digest、limits、`JobEmpty`、owned PID/TCP/UDP 与 ledger/cleanup proof，
  不含完整目标输出。
- `ledgerProven`、`handleObligationsProven` 与 `secondaryCleanupErrors` 只证明 receipt 发布前已经
  完成的 target/job/pipe/reader/digest/handle cleanup；receipt directory、atomic file 与 receipt
  mutex 是发布该证明所需的自举 transport，不进入同一 ledger，避免在证明落盘前保留未完成
  obligation。上述 proof 字段必须在序列化前最终确定，发布后不得再改写为另一个内存 verdict。
- 对任何可能启动 target 的路径，runner 必须在 `CreateProcessW` 前完成 receipt reservation：
  heavy operation 先作 Heavy Lane acquisition decision，再取得 receipt mutex，并在 mutex 内以
  `FileMode.CreateNew` 独占创建固定 `.tmp/host-command/current.json.pending`；quick operation 直接
  先作相同 reservation。reservation 失败时 `targetStarted=false`、`ChildPID=0`，不得创建 Job/pipe
  或启动 target。heavy lane 已经 busy/abandoned 的 pre-target blocked result 可在 finalization 时
  才取得 receipt reservation，因为该路径不再可能启动 target。
- Runner 从 exclusive create 成功起持有 receipt mutex、pending ownership 与 pending file，直到
  target cleanup proof 已最终确定并完成 publication。publisher 必须按 `write -> Flush(true) ->
  dispose pending stream -> atomic replace/move` 的顺序执行，stream dispose 后仍持有 receipt mutex
  与 pending path ownership。既有普通 pending、目录或 reparse 一律不得
  覆盖。runner 也只可清理本 invocation 成功 CreateNew 的 pending；任意 future invocation 不得
  自动删除既有 pending。receipt reservation 会使并发 quick operation fail closed，而不是绕过
  Heavy Lane 或无 receipt 启动 target。
- Atomic `File.Replace`/`File.Move` 成功是唯一 publication commit point。commit 前任意 directory、
  reservation、write、flush、mutex 或 replace/move 失败，必须令 wrapper result/exit fail、保持既有
  `current.json` byte-for-byte 不变，并仅按 ownership 精确清理本 invocation pending。commit 后
  serialized result、`status`、`reason`、proof fields、`secondaryCleanupErrors` 与 exit code 全部不可
  再变；不得再次调用会重算 verdict 的 finalizer。receipt mutex release/dispose 是 non-inheritable、
  当前 wrapper 进程所有的 post-commit teardown，必须以 non-throwing best effort 执行，并由随即
  发生的 wrapper process exit/OS handle teardown 兜底；它不再属于已发布 invocation verdict。
- `.tmp/host-command/current.json.pending` 只作为上述精确 transient path 被 ignore 和测试；不得
  扩张为 wildcard pending/log。验收任何 operation 必须同时核对 wrapper exit/result、receipt
  operation/reason 与 bounded current file，旧 receipt 不得替代失败 invocation 的证据。
- `_shuhai:*` raw scripts 未处于 sealed session 时必须失败；`clean` 继续显式 blocked。

### 5.2 新基线 dogfood operations

Registry 必须新增并静态证明以下固定入口：

| Public operation | Profile/class | 动态参数 | 固定 raw 语义 |
| --- | --- | --- | --- |
| `dogfood-install-offline` | `install` / heavy | 无 | `pnpm install --offline --frozen-lockfile --ignore-scripts` |
| `dogfood-create` | `standard` / heavy | 恰 1 个小写 40 位 Git OID | `pnpm exec tsx packages/extension/scripts/dogfood-release.ts create <oid>` |
| `dogfood-verify` | `quick` | 恰 1 个严格 release ID | `pnpm exec tsx packages/extension/scripts/dogfood-release.ts verify <id>` |
| `dogfood-verify-accepted` | `quick` | 恰 1 个严格 release ID | `pnpm exec tsx packages/extension/scripts/dogfood-release.ts verify-accepted <id>` |
| `dogfood-accept` | `e2e` / heavy | 恰 1 个严格 release ID | `pnpm exec tsx packages/extension/scripts/dogfood-acceptance.ts <id>` |

OID policy 只接受 40-byte ASCII `^[0-9a-f]{40}$`。Release policy 最长 38-byte，只接受
ASCII `^shuhai-v[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}-[0-9a-f]{12}$`。两者均拒绝缺失、
额外参数、flag、绝对/相对路径、反斜杠、shell metacharacter、非 ASCII 和环境变量输出覆盖。
public operation、PowerShell 入口和 sealed raw dispatcher 必须按 UTF-8 byte length 与同一 regex
重复验证；raw step 只能 append 已验证值。

Root/package public scripts 只路由 shim；dogfood 文档直接展示 canonical `node
scripts/host-command/shuhai-command.cjs <operation>`。不得把 direct pnpm 保留为正常入口。
同时必须保留 main 的 `root-typecheck` shared build 语义、extension lint 对 `scripts/` 的覆盖、
现有依赖/版本和 Goal 046E package scripts。

`dogfood-create` 已在外层持有唯一 Heavy Lane，因此 `dogfood-release.ts` 禁止再调用 public
`extension-build`、再次启动 runner 或再次获取 lease。其 build step 必须以 `shell: false`、
继承 stdio 的方式进入当前 sealed session 的 `extension-build-raw`，并由 `assert-session.cjs`
重复验证 operation/allowedRaw；`dogfood-create` 的 raw closure 必须精确包含
`dogfood-create-raw` 与 `extension-build-raw`。`root-test`、`extension-test` 与
`root-test-coverage` 的 allowedRaw 保持旧候选最小集合，不得借本 Goal 扩权；当前测试只直接
读取 production `readPnpmVersion`，所有 `createRelease` 均注入 fixture runtime。
`pnpm --version` 的 `execSync` capture 必须移除；release metadata 只可从 `pnpm exec` 已提供的
`npm_config_user_agent` 中解析：整体必须为不超过 512 UTF-8 bytes 的 ASCII，以空格 token 化后
必须恰有一个 `pnpm/<version>`，version 只接受无前导零的稳定三段 semver
`^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$`；缺失、重复、格式错误均
fail closed。该字段只作 bounded provenance，不作为 session 或 package-manager 身份认证。
`BUILD_COMMAND` metadata/schema literal 同步改为 canonical
`node scripts/host-command/shuhai-command.cjs extension-build`；这是有效 release metadata 值的
唯一获准变化，新的 Goal 046E release 必须据此重新生成，旧 release 不被改写或复用。v3 另外
只收紧下述 release/pnpm validators，使 create 与 verify 拒绝域一致，不改变当前有效值的含义。

`dogfood-release.ts` 内部 `RELEASE_ID_PATTERN` 必须与三层 public release policy 完全相同：只接受
三段、每段 1-5 位的 manifest version。用于 extension `manifest.version` 与 release metadata 的
schema 同样只接受三段且每段数值不大于 65535；`minimum_chrome_version` 可保持 Chrome 的 1-4
段格式，但每段也限制 1-5 位且不大于 65535。`ReleaseMetadataSchema.pnpmVersion` 必须直接复用
`PNPM_VERSION_PATTERN`，使 verify 与 create 一样拒绝任意非空但非稳定三段 semver 的 provenance。

### 5.3 既有 operation inventory 与 sealed lifecycle

新基线必须完整继承并冻结以下既有 public inventory；不得因重放只保留 dogfood 路由：

- `root-install` 使用 `install/heavy`；`root-dev` 与 desktop/extension/shared 的 `*-dev`
  使用 `watch/heavy`。
- root 与 desktop/extension/shared 的 `*-build`、`*-lint`、`*-typecheck`、`*-test`
  使用 `standard/heavy`；`root-test-coverage` 同为 `standard/heavy`。
- `root-test-e2e` 使用 `e2e/heavy`；`husky-lint-staged` 使用 `standard/heavy`。
- `prettier-check`、`prettier-write` 使用 `quick`，动态参数固定为 `prettier-paths`。
- `blocked-clean` 只有 `blockedReason=clean_policy_blocked`，不得存在 raw 删除实现。

Leaf public IDs 必须完整存在：`desktop-{dev,build,lint,typecheck,test}`、
`extension-{dev,build,lint,typecheck,test}`、`shared-{dev,build,lint,typecheck,test}`。
Root recursive raw 只调用对应 `_shuhai:*` leaf；nested raw 继承外层 lease。

Lifecycle 不是普通 public shim：root `preinstall`、`prepare` 和 lint-staged callbacks 必须直接
进入 `assert-session.cjs`，仅在 runner 已建立的 sealed session 或合同允许的 non-Windows CI
lifecycle 条件下执行。lint-staged TypeScript callback 固定 `typescript-paths`，document
callback 固定 `document-paths`；两者只 append 已重复验证的 repo-relative existing files。

### 5.4 当前命令文档与历史证据

AGENTS、CLAUDE、README、CONTRIBUTING、verification、denylist、本 Goal branch 上的 Goal 046E
base copy 与 release guide
中的当前指令全部改为 canonical named operation。Goal 046E 已真实运行过的旧 `pnpm` 命令
仍须保留历史事实，但必须改写为明确的 inline `Goal 048 前历史命令` 记录，不得伪称当时由
wrapper 执行，也不得继续作为可复制的 current command block。Case 9 只允许这种明确标记的
历史证据文本；任何未标记、行首 direct pnpm/tool 或新增 current authority 均 fail closed。
Goal 046E 的 read-only Git/`gh`/worktree 命令保持原合同，不被扩张成 package-tool operation。

### 5.5 三方语义合并

旧 base 至 current main 已同时修改 12 个 allowlist 文件。合并必须：

- `.gitignore` 取 union，保留 dogfood release/cache 与 receipt ignore。
- AGENTS/CONTRIBUTING/README 保留当前产品、installed-tool、release 和 ownership 事实，只替换
  命令入口并增加 runner 规则。
- PROJECT_STATUS/goals README 保留 041-046E 全部 current truth，仅增加 Goal 048 lane。
- command safety/denylist/verification 保留当前用户真相与风险规则，叠加 named operation、
  receipt 和 Heavy Lane 约束。
- `package.json`/extension package/vitest config 做结构合并，禁止旧文件整体覆盖。
- `dogfood-release.ts` 只替换 fixed shell/capture、nested public build、上述 `BUILD_COMMAND`
  provenance literal，以及 v3 明列的三段 release ID、manifest version 与 stable pnpm schema；
  后三项只收紧 invalid-input rejection 并统一 create/verify authority。除此以外，其余 metadata
  字段值和含义、filesystem transaction、inventory、detached checkout 与 acceptance 数据语义
  保持 current main。

只有下列 7 个路径从 `13402ca` 到 `6157ed9` 无 main 侧变化，且不需要 v3 修复；逐个
核对旧候选 SHA-256 后允许 byte-copy：

```text
.husky/pre-commit
CLAUDE.md
packages/desktop/package.json
packages/extension/vitest.config.ts
packages/shared/package.json
playwright.config.ts
scripts/host-command/hostile-child.cjs
```

Hostile fixture 必须保持旧独立 re-audit 的 byte identity。C# runner core 不再允许 byte-copy，
但修改只限新增私有 receipt-reservation holder/helper、`Run` 中 Heavy Lane decision 后且 Job/pipe/
process setup 前的 reservation 与向 finalizer 移交，以及相应 `FinalizeResult`/publisher transport：
移除自指 receipt obligations、exclusive-create fixed pending、只清理本 invocation owned pending，
并保证 proof fields 在发布前 finalize。`Run` 的其它控制流以及 Job、process、pipe、deadline、limit、
target wait 或 child cleanup 语义不得改变。12 个重叠文件
必须三方语义合并；`Invoke-ShuHaiBoundedCommand.ps1`、`Test-ShuHaiBoundedCommand.ps1`、
`assert-session.cjs`、registry 与 shim 五个旧骨架必须在旧候选上精确扩展 v3 policy，不得原样复制。

## 6. 固定验收与证据

合同独立 review `PASS` 前不得实施。实施后只运行：

1. Node syntax、JSON schema、PowerShell AST、C# compile、registry/manifest route cross-check、
   current-command authority scan 和 `git diff --check`。
2. 旧固定 10 组 KiB synthetic suite，仍是 10 组，不运行真实 pnpm/tool/browser。

Case 1 在同组增加 OID/release 参数的 valid/invalid registry 拒绝，包括四段 release ID。Case 8
先在 pending 不存在时写入 exact harness-owned sentinel，把它视作本 invocation 的 foreign path；
调用 synthetic-green 后必须证明 wrapper fail、`targetStarted=false`、`ChildPID=0`、无 owned PID/port、
sentinel bytes/hash 与既有 current receipt bytes/hash 均不变，再由 harness 按 sentinel identity 精确
清理。在 sentinel 清理前，同组还必须调用 `synthetic-lane-hold`：允许先完成 Heavy Lane decision，
必须证明 `laneAcquired=true`，但仍同样 `targetStarted=false`、`ChildPID=0`，且
`lane-starts.log` marker count 不增加，由此覆盖
heavy acquired 的 pre-target reservation。仍在同一 Case 8，harness 随后以 `FileShare.None` 持有
`current.json`，确定性制造本 invocation
`CreateNew` 成功后的 atomic replace sharing failure；必须证明 wrapper fail，释放 handle 后旧 current
hash 不变且 owned pending 已消失。最后再运行 green，证明 receipt mutex 可重新取得且 current 正常
发布。Case 9 扫描本 Goal 两个
新增 current docs，并证明五个 dogfood operation、package routes、sealed raw、nested
`extension-build-raw` closure、无 `execSync` capture、exact argv、C# exclusive pending ownership、
receipt proof scope，以及 create/verify 共用的 release/pnpm schema。对 receipt source 必须精确负向
证明：pending 只使用 `FileMode.CreateNew`；ownership 只在 create 成功后置位、publish 后撤销；delete
只受 ownership flag 保护；publisher 不接收或调用 `ResourceLedger`，也不存在 receipt reserve/bind/
prove/fail obligation；proof snapshot 在 publish 前生成，commit 后没有 result/proof/cleanup verdict
重算。还必须证明 quick reservation 先于 Job/pipe/`CreateProcessW`；heavy acquired 的 Heavy Lane
decision 先于 reservation，而 reservation 再先于 Job/pipe/`CreateProcessW`；heavy busy/abandoned
不进入 target-start preparation，只在 finalization 尝试 receipt；reservation failure 分支不可到达
Job/pipe/process setup。这不新增第 11 组。Case 10
必须证明 exact 30-file candidate manifest、staged=0、test temp=0、
receipt bounded、pending absent、`JobEmpty=true`、task-owned PID/TCP/UDP=`0/0/0`，且最终 current
是 Case 8 恢复后的本轮 green receipt而不是旧文件。

旧 implementation/final audit/final re-audit 只作参考；新的
`.tmp/host-stability-narrow-v1/implementation-report.md` 必须在 `6157ed9` 基线上重新生成，
不得复制旧 PASS。实现者最多给 `CANDIDATE/READY_FOR_REVIEW`；独立 reviewer 复核实际 diff、
10/10、receipt 和新基线继承后才能接受。

## 7. 状态机与 STOP 条件

```text
DRAFT -> independent contract review PASS -> READY -> IN_PROGRESS
      -> semantic replay + fixed acceptance -> READY_FOR_REVIEW
      -> independent final review PASS -> precise commit/push/PR/CI/merge -> DONE
```

任一条件立即 STOP：

- base/ref 不再是 live-verified `6157ed9`，或发现新的 current command surface。
- 需要 allowlist 外写入、整文件覆盖 12 个重叠文件，或写入 Goal 046E acceptance-fix worktree。
- dogfood operation 未同时具备 typed argument policy、sealed raw、profile 和文档路由。
- runner core 语义变化超过当前 containment，或真实 tool/browser 被启动。
- synthetic suite 非 10/10、receipt/Job/ledger/PID/port 不洁净、Heavy Lane busy、发现 P0/P1/P2。

## 8. 状态记录

- `2026-08-02`：旧基线候选与最终 re-audit 通过，仅证明 `13402ca`。
- `2026-08-03`：handoff 确认候选落后 main 51 commits，禁止直接集成。
- `2026-08-07 DRAFT`：live remote main 仍为 `6157ed9`；发现 Goal 046E 新命令入口并完成
  containment-only 合同修订；首轮独立 review 发现 cross-worktree ownership 表述冲突与 nested
  build 重入 Heavy Lane 风险，已按精确 path/closure 修订。
- `2026-08-07 READY`：独立 contract re-review `PASS`，P0/P1/P2/P3=`0/0/0/0`；独立
  nested feasibility review 为 `TECH_CONTRACT_PASS`，允许进入 semantic replay。
- `2026-08-07 IN_PROGRESS`：从 `READY` 正式开工；唯一 writer 为本合同指定 branch/worktree，
  Goal 046E acceptance-fix worktree 继续冻结。
- `2026-08-07 READY_FOR_REVIEW`：current-base semantic replay、全部静态门禁和固定 synthetic suite
  已完成；suite 首次完整运行即 `10/10 PASS`，最终 receipt 为 1106 bytes，`JobEmpty=true`、
  task-owned PID/TCP/UDP=`0/0/0`、test temp=`0`、staged=`0`、exact durable manifest=`30/30`。
  独立 semantic delta 与 harness review 均为 `PASS` 且 P0/P1/P2/P3=`0/0/0/0`；等待独立 final
  review，不表示 commit、PR、CI、merge 或 main 完成。
- `2026-08-07 REWORK/IN_PROGRESS`：全新独立 final review 给出 P0/P1/P2/P3=`0/0/3/1`，确认
  fixed pending 可覆盖、receipt self-bootstrap obligation 可令持久 receipt 假成功，以及 release
  ID/pnpm create-verify schema authority 不一致。前一轮 `10/10` 降级为 superseded normal-path
  evidence，禁止 commit/PR；v3 重新打开 C# receipt core 的精确限域修改并要求全套重验。
- `2026-08-07 READY_FOR_REVIEW/v3`：两路独立实现复审及 P3 加固复核最终均为
  P0/P1/P2/P3=`0/0/0/0`；Node `3/3`、JSON `5/5`、PowerShell AST `2/2`、C# compile `1/1`
  与 diff/ownership 门禁通过。v3 固定 suite 首次且唯一一次运行即 `10/10 PASS`（23.7 秒）；最终
  receipt 1105 bytes、SHA-256
  `5fd27257cc5fddd25065a27a071c29a97bb006a8263393d0d2bc58b11d31119d`，task-owned
  PID/TCP/UDP=`0/0/0`、test temp=`0`、pending absent、Heavy Lane clean、staged=`0`、exact
  durable manifest=`30/30`。等待全新 independent final review；不表示 commit、PR、CI、merge
  或 main 完成。
- `2026-08-07 FINAL_REVIEW_PASS/v3`：全新的 security 与 evidence/ownership final reviewer 均为
  `PASS`，两者 P0/P1/P2/P3=`0/0/0/1`。共同唯一 P3 是 allowlist 外
  `docs/workflows/README.md:64` 的既有瞬时状态漂移，不影响运行时与 ownership 结论。实现与 receipt
  哈希未变化；现仅授权 exact 30-path stage、无 Husky 的合同提交、PR/CI/merge 门禁，仍不表示
  commit、PR、CI 或 merge 已发生。
