# Goal 043 合同与 G0 预审

> 日期：2026-07-13
>
> 范围：Goal 043 v1 合同、G0 精确工具链候选与命令/Chrome 边界
>
> 独立 reviewer：Huygens (`019f5af2-d64e-76b0-91c8-bd9982d801e6`)
>
> 初始合同结论：`PASS`；G0 verdict：`PASS`；043A fixture-only verdict：`PASS`；整个 Goal 043 仍为 `BLOCKED_BY_REAL_X_EVIDENCE`

## 1. 审查结论

Goal 043 已把 043A fixture-only 候选和 043B 真实 Chrome/生产接线分开。v1 只允许先实施工具链 G0，再实现无真实账号、无生产入口的 adapter/coordinator 候选；manifest、content script、service worker 和 UI 仍被禁止。

持久化合同已补充 IndexedDB v2、scan revision、typed stop record、逐 item review decision、review revision 和 write-intent revision 绑定。v1 存在未决写入时迁移原子 abort，不猜测用户选择、不清库、不重写 Vault。

Chrome 合同采用 `LOCAL_CHROME_FIRST / NO_DOWNLOAD / PROJECT_SCOPED`：允许定位和运行本机已安装 Chrome，但禁止下载替代浏览器、读取日常 profile 或干扰其它 Chrome/Docker/端口资源。

## 2. 独立 finding 与修复

首轮 verdict 为 `FAIL`，发现一个 P1：Task facts 把 G0 网络写成只允许 metadata/audit，但命令又允许安装依赖，形成不可执行的过度约束。

修复后合同明确：

- 先从 `https://registry.npmjs.org/` 以 `--lockfile-only --ignore-scripts` 生成候选 lock。
- 审查 package/version/integrity/闭包后，才允许 `--frozen-lockfile --ignore-scripts` 获取 lock 固定的 registry tarball。
- 授权仅覆盖三项精确 direct dev upgrade 及其 integrity-locked 闭包；Git/URL dependency、其它 registry、lifecycle script、额外二进制和全局安装仍禁止。

同一独立 reviewer 复审最终给出 `VERDICT: PASS`，没有剩余 P0/P1 合同阻塞。

## 3. G0 候选证据

只读工具链研究确认最小候选：

| 包                         | 当前  | 候选   |
| -------------------------- | ----- | ------ |
| `vite`                     | 6.3.5 | 6.4.3  |
| `vitest`                   | 3.1.4 | 3.2.6  |
| `@vitest/coverage-v8`      | 3.1.4 | 3.2.6  |
| workspace `overrides.vite` | 无    | 6.4.3  |
| `@vitejs/plugin-react`     | 4.4.1 | 不升级 |

候选用于修复 `GHSA-5xrq-8626-4rwp`、`GHSA-p9ff-h696-f583` 和 `GHSA-fx2h-pf6j-xcff`。当前基线完整 audit 为 low 3 / moderate 4 / high 2 / critical 1，production audit 为 0；当前 lock SHA-256 为 `E9B4B644828795CE11C70BEB3F8BDBF21460AC2D960133FB7FC4CCC4F9D2869F`。

这些只是候选版本证据。只有生成并检查新 lock、运行 audit/coverage/完整质量门禁且没有新 supply-chain 问题后，G0 才能通过。

## 4. 合同首次 PASS 时未完成的门禁

- 合同首次 PASS 时尚未修改 package manifests 或 lockfile，也未安装候选依赖；此后的 G0 开工偏差见第 5 节，自动生成候选已被拒绝。
- 尚未运行候选 audit、lint、typecheck、test、coverage 或 build。
- 本机当前为 Node 24.14.1；最终 PR/CI 仍需 Node 20 lane 证据。
- 尚未实现 043A，未运行 fixture browser E2E，未访问真实 X 或 Vault。
- 043B 仍需 Goal v2 的精确入口文件、message/sender/tab/host/job 绑定和真实 Chrome QA 合同。

## 5. G0 开工偏差与合同修订

进入 G0 后，manifest 修改完成但 lock 尚未同步时误运行了 `pnpm exec prettier`。pnpm 11 因 manifest/lock 不一致自动执行 workspace install：从用户级旧淘宝镜像配置下载 5 个包，更新 node_modules/lock，并运行仓库自己的 `prepare: husky`。没有运行第三方 install/postinstall、没有下载浏览器、没有访问真实数据或影响外部进程，但该顺序不符合本合同的 lock-only/official-registry 要求，因此这份自动生成候选被拒绝，不能作为 G0 通过证据。

同一次运行还证明 `package.json.pnpm.overrides` 在 pnpm 11 已被忽略。根据 pnpm 11 官方配置规则，修订后的候选将：

- 在项目 `.npmrc` 覆盖用户配置，固定官方 npm registry 和严格 TLS。
- 在根 `pnpm-workspace.yaml` 设置 `overrides.vite=6.4.3` 与 `lockfileIncludeTarballUrl=false`。
- 语义比较 lock：除工具链版本外，其它 version/integrity 不变，并移除历史 mirror tarball URL。
- manifest/lock 不一致期间不再运行 `pnpm exec`；先完成 lock-only 审查，再执行 ignore-scripts 安装。

独立 reviewer Leibniz (`019f5b17-cf8c-7612-9fd7-43e3e7bf30b9`) 对这次偏差和修订完成只读复审，最终 `VERDICT: PASS`，P0/P1 均为 none。唯一 P2 是本文件第 3/4 节仍保留旧 override 位置和“尚未修改 manifest/lock”的历史表述；上文已改为 workspace 配置和明确的历史快照，不阻塞 G0 继续。

## 6. 合同 review 只读证据

审查只使用 `Get-Content`、`rg`、`git status/diff`、官方 npm registry metadata 和 audit 查询。没有格式化业务代码、安装依赖、下载浏览器、启动监听服务、访问真实账号/Vault、操作 Docker/端口、stage、commit 或 push。

## 7. G0 候选实现证据

- 项目 `.npmrc` 固定 `https://registry.npmjs.org/`，npm 配置核实 `strict-ssl=true`；`pnpm-workspace.yaml` 固定 `overrides.vite=6.4.3` 和 `lockfileIncludeTarballUrl=false`。
- `pnpm install --lockfile-only --ignore-scripts --registry=https://registry.npmjs.org/` 成功：解析 446 个包，downloaded 0 / added 0，没有 lifecycle script。
- 语义 lock 对比只增加 Vitest 3.2.6/Vite 6.4.3 的预期 dev toolchain 闭包；其它相同 package integrity 保持不变。旧 `vite@6.3.5`、`vite@6.4.2` 和 Vitest 3.1.4 闭包被移除；mirror/taobao、Git、显式 tarball URL 均为 0。
- 审查候选 lock 后运行 `pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org/`：reused 3 / downloaded 0 / packages +3 -2，没有 lifecycle script。
- 最终 lockfile SHA-256：`552374FAA202BEC642B0BF2E849A855A15FBB05C3D13E48B7E033BC51E2F8EAB`。
- `pnpm why vite vitest @vitest/coverage-v8` 各只出现一个版本：Vite 6.4.3、Vitest 3.2.6、coverage-v8 3.2.6。
- 官方 registry 完整 audit：low 1 / moderate 1 / high 0 / critical 0；production audit 为 0。相较基线没有新增或恶化 advisory。
- `pnpm lint`、`pnpm typecheck`、`pnpm test` 均通过；普通测试共 269 个（shared 1 / desktop 25 / extension 243）。
- `pnpm test:coverage` 通过 33 files / 269 tests；`pnpm --filter @shuhai/extension run build` 使用 Vite 6.4.3 转换 1,899 modules 并成功完成。
- 本地 Prettier check 与 `git diff --check` 通过。全过程未启动 dev/watch/listener、Chrome、Docker，未访问真实 X、Vault、Cookie 或其它项目资源。

## 8. 当前 verdict

独立 reviewer Jason (`019f5b30-a7a3-7b43-96a9-c7fb1357088a`) 对实际 manifest/workspace/lock/docs diff 给出 `VERDICT: FAIL`。P0 none；唯一 P1 是 `.github/workflows/ci.yml` 仍固定 pnpm 9，不能可靠消费 pnpm 11 workspace override/lock 语义，而且 CI install 未使用 `--ignore-scripts`。因此 Node 20 不是普通 pending，而是已知可复现性阻塞；修复并复验前不能进入 043A。

## 9. CI 修订合同

G0 write allowlist 增加且只增加 `.github/workflows/ci.yml`，允许两项精确修改：

1. `pnpm/action-setup@v4` 的 `version` 从宽泛 `9` 改为精确 `11.3.0`，与候选 lock 生成器一致；不顺带升级 Action major。
2. CI install 改为 `pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org/`；Node 20、lint、typecheck、coverage、build 和其它 workflow 结构保持不变。

该合同必须先独立 review；通过后才能修改 CI。修改后重跑本地非监听门禁并提交候选，让 GitHub Actions Node 20 lane 提供最终证据。任何 pnpm 版本漂移、lifecycle script、非官方 registry 或额外 workflow 改动都立即 STOP。

同一独立 reviewer 对修订合同给出 `VERDICT: PASS`，P0/P1/P2 均为 none。随后 CI 候选只实施了上述两项修改；当前仍等待实际 diff 复审和提交后的 GitHub Actions Node 20 结果，P1 尚不能提前写成已关闭。

修复后的实际 diff 和全套本地复验再次由该 reviewer 审查，最终 `VERDICT: PASS`，P0/P1/P2 均为 none。该结论只授权精确 stage、commit、push 和创建 draft PR 触发 Node 20 CI；在 CI lane 实际成功前，G0 仍不是最终 `PASS`。

## 10. 实际 Node 20 CI 失败与 pnpm 10 修复合同

候选提交 `8451189` 已 push 到 `codex/social-sync-v4`，draft PR 为 `#5`。GitHub Actions run `29247116212` / job `86806588209` 在 `actions/setup-node` 提供的 Node `20.20.2` 上失败，发生在 workspace install 之前：

- `pnpm/action-setup@v4` 安装的 pnpm `11.3.0` 明确警告最低要求为 Node `22.13`。
- 随后的 `pnpm store path --silent` 加载 `node:sqlite`，Node 20 返回 `ERR_UNKNOWN_BUILTIN_MODULE`。
- 因此此前“pnpm 11.3.0 可作为 Node 20 lock/CI 生成器”的合同假设错误。提交前独立 diff `PASS` 不能覆盖真实 CI 证据，G0 verdict 降为 `FAIL/BLOCKED_BY_TOOLCHAIN_COMPAT`。

禁止通过把 CI 提高到 Node 24、设置 `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true`、忽略失败、amend/force-push 或重新使用 pnpm 9 来制造绿色结果。项目公开 engines 下界仍是 Node `>=20.17.0`，G0 必须真实证明该下界 lane。

只读官方证据确认修复候选为 pnpm `10.34.5`：npm registry metadata 声明 Node `>=18.12`、MIT、tarball `https://registry.npmjs.org/pnpm/-/pnpm-10.34.5.tgz`、integrity `sha512-pO4F8vc2WCVb1qiYWcBlpFwopX2u+uLIk6Fo7itzFow3uR6D5X6mdlStA/AwMXRkMOi84442LgQmBfuKvIAZLg==`，发布包无 consumer install/preinstall/postinstall hook。pnpm 10.x 官方 settings 文档明确支持根级 `pnpm-workspace.yaml` 的 `overrides` 和 `lockfileIncludeTarballUrl`，所以现有安全配置可以保留。

修复合同按以下顺序执行：

1. 独立 reviewer 先只读复审本节和 Goal 043 的精确 allowlist、版本、integrity、命令与 STOP 条件。
2. `PASS` 后才允许通过 official registry、`--ignore-scripts` 和精确 `--package=pnpm@10.34.5` 的项目任务命令获取 CLI；npm cache 固定到 `.pnpm-store/goal-043/npm-cache`，pnpm install store 固定到 `.pnpm-store/goal-043/store`，不写用户共享 cache/store、不全局安装或修改全局配置。
3. 首先只运行 `pnpm --version` 并要求精确输出 `10.34.5`；不匹配立即 STOP。
4. 使用同一 CLI 重新生成 lock-only；语义比较 package/version/integrity/URL/闭包，不接受无关漂移。
5. lock review 通过后才 frozen install；除 audit compatibility fallback 外，why、lint、typecheck、test、coverage、extension build 和 Prettier 均使用同一 pnpm 10 前缀，再运行 `git diff --check`。
6. 独立 reviewer 检查实际修复 diff；`PASS` 后追加 commit/push 到现有 draft PR，等待 Node 20 CI。禁止 amend 或 force-push。

在第 1 步通过前，没有下载或运行 pnpm 10，也没有修改 `.github/workflows/ci.yml`、package manifests、workspace 配置或 lockfile。

### 10.1 首轮修复合同复审 finding

独立 reviewer Euclid (`019f5b58-6049-78a0-8392-683c46a0bd39`) 对首轮修复合同给出 `VERDICT: FAIL`，P0 none，两个 P1：默认 `npm exec` 会写用户 npm cache、pnpm 会写共享 store；同时 pnpm 10 的旧 audit endpoint 若返回 410，原合同没有 `UNKNOWN/BLOCKED` 和只读 fallback 语义。

最小修订为：

- npm cache 与 pnpm store 分别固定到 worktree 已忽略的 `.pnpm-store/goal-043/npm-cache` 和 `.pnpm-store/goal-043/store`。
- pnpm 10 audit 只有得到可解析的完整 advisory 结果才算有效；410、endpoint/protocol/parse 错误一律 `UNKNOWN/BLOCKED`。
- 仅该兼容故障允许本机现有 Node `24.14.1` + pnpm `11.3.0` 对同一 lock 做 full/production 只读 audit，前后核对 SHA-256，不 install、不改 lock；fallback 失败不能宣称 0 漏洞。
- 除 fallback 外，lock/install/why 和完整质量门禁全部使用同一精确 pnpm `10.34.5` npm exec 前缀。

该修订必须再次独立只读复审；复审 `PASS` 前仍不得运行 pnpm 10 或修改 CI/lock。

同一独立 reviewer 对最小修订后的实际文档 diff 完成第二轮只读复审，给出 `VERDICT: PASS`，P0/P1/P2 均为 none。复审确认项目内 npm cache/pnpm store、精确 pnpm `10.34.5`、audit `UNKNOWN/BLOCKED`、只读 fallback 和同版本门禁边界均可执行；当前授权进入 CLI version 核验与后续分阶段 G0 修复，不代表 lock、门禁或 Node 20 CI 已通过。

### 10.2 frozen install 非交互重建门禁

受控 CLI version 精确输出 `10.34.5`。lock-only 成功，结构化 YAML 比较确认前后 4 个 importer、446 个 package、446 个 snapshot 和 446 个 integrity 完全相同，语义 diff 0；mirror/Git/tarball URL 均为 0。文本 diff 仅为 pnpm 10 的 YAML 排版，候选 lock SHA-256 为 `19034D0337743941656D77A4E1ACC0C2E34A8161530832AE9C122805D84ABAB8`。

首次 frozen install 在任何目录删除前返回 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。原因是当前 `node_modules` 来自先前 store，pnpm 10 在无 TTY 下拒绝自动重建。只读检查确认其为普通 Directory、非 symlink/reparse，解析绝对路径精确为 `C:\Projects\ShuHai\.worktrees\social-sync-v4\node_modules`。

修订合同只允许：独立复审后，对精确 frozen install 命令临时设置 `CI=true`，由已核验 pnpm 重建该 worktree 的可再生 `node_modules` 并写入任务专属 store。禁止 `--force`、手工递归删除、`git clean`、链接目录、仓库外路径或持久化环境变量。该授权不扩展到任何用户数据、其它项目、Chrome、Docker、进程或端口。

同一独立 reviewer 第三轮复审给出 `VERDICT: PASS`，P0/P1/P2 均为 none，并授权临时进程级 `CI=true` 的精确 frozen install。该命令成功重建本 worktree 的 `node_modules`，从 official registry 下载 376 个 lock 固定包到任务专属 store，未运行 lifecycle script；命令结束后环境值恢复。

## 11. pnpm 10 修复候选本地证据

- pnpm `10.34.5` full audit 返回完整 advisory JSON：low 1 / moderate 1 / high 0 / critical 0；production audit 为 0，没有使用 fallback。
- `pnpm -r why vite vitest @vitest/coverage-v8` 各只出现一个版本：Vite 6.4.3、Vitest 3.2.6、coverage-v8 3.2.6。
- Prettier 恢复 lock 的原有排版后，SHA-256 回到 `552374FAA202BEC642B0BF2E849A855A15FBB05C3D13E48B7E033BC51E2F8EAB`，与提交候选完全相同；最终 lock 无 diff。
- 所有命令通过同一 pnpm 10 npm exec 前缀运行：lint、typecheck、普通测试 269/269、coverage 33 files / 269 tests、extension build Vite 6.4.3 / 1,899 modules 均通过。
- `.github/workflows/ci.yml` 只把 `pnpm/action-setup@v4` 的版本从 `11.3.0` 改为 `10.34.5`；Node 20、frozen lock、official registry、`--ignore-scripts` 和其余 CI 结构不变。
- 未启动 Chrome、Docker、dev/watch/listener，未访问真实 X、Vault、Cookie、用户 profile、其它项目、进程或端口。

独立 reviewer Euclid 对最终实际 diff 给出 `VERDICT: PASS`，P0/P1/P2 均为 none。review 确认实际改动恰好为 CI 和四份文档，lock 无 diff，且所有本地证据与安全边界一致；只授权精确 stage 这五个文件、追加 commit、普通 push 和等待现有 draft PR 的 Node 20 CI，禁止 amend/force。CI 成功前 G0 仍不是最终 `PASS`。

## 12. G0 最终结论

修复提交 `b8a0b95` 已普通 push 到 `codex/social-sync-v4`。现有 draft PR `#5` 触发 GitHub Actions run `29252734846` / job `86825006096`，在 Node `20.20.2` 和 pnpm `10.34.5` 下于 50 秒内 `PASS`；workflow 的 frozen lock、official registry、`--ignore-scripts`、lint、typecheck、coverage 和 extension build 全部成功。

最终 verdict：`G0 PASS`。该结论只关闭工具链/供应链门禁并允许 043A fixture-only 实现；不代表 X adapter 已实现，不授权真实 X、Chrome E2E、manifest/content/background/UI 接线，也不把整个 Goal 043 写成完成。

## 13. 043A 实现、独立复审与 fixture Chrome 证据

### 13.1 实现范围

043A 只修改 Goal v1 白名单中的 social schema/store/engine、X adapter/coordinator、fixture 与测试；没有修改 manifest、content script、service worker、Popup、Side Panel、Options、shared、desktop 或生产路由，也没有新增依赖。

候选实现提供：

- schema/database v2 的 strict runtime parse、typed stop record、scan/review revision 和精确选择授权。
- v1 -> v2 原子迁移；逐 store cursor 读取，30,000 行、16 MiB、500,000 全库节点、单行深度/节点上限，任何不安全历史写状态或迁移超限都保留 v1 原库。
- selected/excluded/unreviewed 持久化语义；selected item、job 和 write intent 必须绑定同一 review revision，未尝试的 selected item 不能伪装成 `partial`。
- 只接受精确 `https://x.com/i/bookmarks` 和合法 status permalink 的纯 X DOM adapter；正文/媒体/字节/节点/时间均受固定上限，扫描期间导航改变会丢弃整批。
- 顶部重扫、跨批去重、catalog 分类、persist-before-next、真实墙钟 adapter deadline、typed pause/resume 和 Goal 042 mock Vault 端到端选择写入。

### 13.2 独立 actual-diff review

独立 reviewer Aristotle (`019f5c1d-3f2b-72d0-ac3b-881ef871f1ff`) 对实际工作树进行了多轮只读审查：

1. 首轮 `FAIL` 找到四个 P1：迁移在全量 materialize 后才检查总预算、`partial` 可包含 selected-but-not-requested、挂起 adapter/超额 metrics 未 fail closed、扫描期间未重复校验页面；另有 persist rejection 缺测试的 P2。
2. 修复后第二轮关闭后三项和 persist P2，但发现低字节宽容器可绕过迁移内存预算的一个 P1，以及 deadline 精确 5 ms 断言的 P2。
3. 增加 500,000 全库节点上限、双层累计校验、123 x 4,090 null 宽数组攻击测试和 deadline 范围断言后，第三轮最终结论为 `PASS`，P0/P1/P2 均为 0。
4. 首次 fixture E2E 暴露缺少 fake IndexedDB globals 后，唯一测试入口修复 `import 'fake-indexeddb/auto'` 又经同一 reviewer 独立 `PASS`；该文件不进入 TypeScript/Vite 生产入口。
5. 最终提交前 reviewer Heisenberg (`019f5c61-480c-7ca0-b524-7fa9cc9f3682`) 给出 `FAIL`：15 秒 deadline 只覆盖 adapter、不可信 adapter 可低报 observed-node 数，以及页面 route 证据不能证明整个 Chrome 进程零网络。
6. 修复候选使用统一 invocation deadline 包住 adapter、hash parse、catalog、batch persistence、classification 和 finish transition；新增挂起 catalog、挂起 persistence、挂起 finish 与节点低报四项回归。Chrome fixture 增加 offline context、阻止 service worker、禁用后台网络能力和 host resolver fail-closed；证据表述收紧为“fixture 页面 route 观察 0 请求”，不再宣称 OS 级 Chrome 进程抓包。
7. Heisenberg 复审关闭节点计量和网络证据 P1，但发现 `Promise.race` 不能取消迟到的 `finishScan` 事务，以及状态页仍有一处过早写成 043A 已通过。最终修复给 finish transaction 传入 `AbortSignal` 和提交前 wall-clock guard；store 测试证明过期终态写入原子回滚，coordinator 测试在超时后实际延迟调用原始 `finishScan` 并再次确认 job 保持 `paused`。状态顺序修正后，同一 reviewer 最终给出 `PASS`，P0/P1/P2 均为 0。

reviewer 独立复跑相关 43/43 测试、精确 ESLint、extension typecheck 和 `git diff --check` 均通过。review 全程没有修改文件、启动浏览器、安装依赖或访问网络。

### 13.3 本地门禁与审计

所有命令继续使用合同固定的 pnpm `10.34.5` npm-exec 前缀、项目内 npm cache 和任务专属 store：

- `pnpm lint`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm test`：PASS，335/335（extension 309、desktop 25、shared 1）。
- `pnpm test:coverage`：PASS，35 files / 335 tests；social store/coordinator/adapter 语句覆盖率分别为 81.5% / 81.48% / 82.67%。
- `pnpm --filter @shuhai/extension run build`：PASS，Vite `6.4.3` 转换 1,899 modules。
- Prettier check 与 `git diff --check`：PASS。
- full audit：low 1 / moderate 1 / high 0 / critical 0；仍是既有 dev-only `@eslint/plugin-kit` 与 `js-yaml` advisory。production audit：0。

### 13.4 fixture Chrome E2E

浏览器预检确认使用本机已安装的 Chrome `150.0.7871.101`，可执行文件为 `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`。每次运行都先证明 profile/output 是当前 worktree `.pnpm-store/goal-043/` 下尚不存在且被 Git 忽略的新目录；没有下载 Chrome、复制日常 profile、读取登录数据、操作端口或按名称结束进程。

- 首次 profile `fixture-20260714-003041` 在打开 fake IndexedDB 时因缺少全局 `IDBRequest` 失败；Chrome PID `35156` 由 Playwright graceful close，exit code 0。该 profile 没有复用或删除。
- 测试入口最小修复经独立 review 后，使用另一个全新 profile `fixture-20260714-003653` 重跑；1/1 PASS，测试本体 1.5 秒。Chrome PID `37124` graceful close，exit code 0。
- 最终 P1 修复后使用第三个全新 profile `fixture-20260714-010509` 重跑；offline context、service worker block、后台网络禁用参数和 `MAP * ~NOTFOUND` host resolver 均启用，1/1 PASS，测试本体 1.4 秒。
- 迟到终态事务修复并取得独立 `PASS` 后，使用第四个全新 profile `fixture-20260714-012902` 重跑；同样保持 offline/service-worker/host-resolver 边界，1/1 PASS，测试本体 1.5 秒，Playwright-owned Chrome 随 context 正常关闭。
- 断言证明 50 条 fixture 在第一次 budget pause、store close/reopen、顶部重扫和第二个 scan revision 后恰好保持 50 个唯一 source item；scanned count 大于 50，说明重叠节点确实被重扫，最终页面只保留 10 个回收节点。
- fixture 容器中 `img`、`iframe`、`script` 为 0，攻击文本保持惰性；在 context 建立后注册的 Playwright page route 记录 outbound request 为 0。该断言证明 fixture 页面没有发出请求，不证明 Chrome 启动前后的 OS 级进程网络为 0。
- 最新非空截图为被忽略的 `.pnpm-store/goal-043/playwright-output-20260714-012902/.../fixture-final.png`（30,813 bytes），人工检查只含脱敏 fixture 41-50，没有真实帖子、URL、账号或 Vault 数据。

### 13.5 043A verdict

最终 verdict：`043A PASS`。Heisenberg 已在最终 actual-diff 复审中确认 P0/P1/P2 均为 0；335 项测试、coverage、完整质量门禁、production audit 0 和第四次全新离线 fixture Chrome E2E 均通过。该结论只授权精确 stage、追加 commit、普通 push、等待 Node 20 CI，以及随后起草 043B v2 合同；不授权生产接线或真实 X 操作。候选仍不证明真实 X selector、登录状态、平台风控、生产 message binding 或真实 Vault 用户旅程，整个 Goal 043 保持 `BLOCKED_BY_REAL_X_EVIDENCE`。

## 14. 043B v2 实施合同独立复审

043B 合同基于提交 `5acdcc7` 后的实际 manifest、service worker、Popup/Side Panel、Vault permission、sync schema/store/coordinator 重新起草，没有把 043A fixture 假设直接当作生产入口事实。复审期间没有修改生产代码、启动浏览器、访问真实 X/Vault、读取用户 profile 或执行安装/进程/端口操作。

### 14.1 首轮 findings

独立 reviewer Gibbs (`019f5ca8-5c9e-7901-b5b7-70ce22aa3270`) 首轮给出 `FAIL`，P0 none：

- P1：不可恢复 pause 没有持久 cancel，active source 可能永久阻塞下一任务。
- P1：manifest 对 X/Twitter 常驻 host 权限和静态 content script 与 v4 首次最小授权/撤销边界冲突。
- P2：全部 excluded 仍会落入 Vault 流程，缺少无需目录权限的 no-write completion。
- P2：catalog classify 与 candidate/checkpoint persistence 分离，存在 TOCTOU 和计数不可证明问题。

独立 reviewer Helmholtz (`019f5cb3-8157-7eb3-a5be-64da95e458d8`) 聚焦算法/迁移复审也给出 `FAIL`，P0 none：

- P1：现有 store API 不能在事务内证明 exact-existing/replay 的 accepted counts/bytes，解除 50 candidate cap 后可能低报其它安全预算。
- P1：DB2 -> DB3 upgrade 已提交后的 reopen/layout validation 失败无法回滚到 DB2，原合同的原子回滚表述不成立。
- P2：缺少 50+ existing 仍触发 node/time/byte budget、same-job replay 计费和零 candidate 计数持久化的直接测试。
- P2：新 finalize/no-write transaction 必须明确只能经专用 revision/stop/item/intent guard 到达，不能由通用 transition 绕过。

### 14.2 修订与最终 verdict

合同修订加入：

- 从必需权限和静态 content script 移除 X/Twitter，首次只申请精确 X host permission，支持撤销；旧单条推文右键提取仅在用户动作下使用 `activeTab` 动态注入。
- 单事务 `classifyAndPersistScanBatch`，由 store 内部重算 catalog classification、candidate/error/known counts、accepted bytes 和全部预算。
- 持久化 `cancelJob/abandonWriteJob`，pre-write 可安全释放 active source，post-write 必须 reconcile 且保留实际 outcomes。
- `completeReviewWithoutWrites`，零候选或全部 excluded 不请求 Vault permission。
- DB upgrade transaction 失败保留 DB2；提交后 reopen validation 失败则 DB3 fail-closed，不伪造回滚。
- 对权限、预算、取消、no-write、迁移和 reload 的直接自动化/真实 QA 合同。

Helmholtz 第二轮给出 `PASS`，确认其首轮四项问题全部关闭。Gibbs 第二轮发现一个新的 P1：包含 `classification=error` 的全 excluded job 既不能诚实 `complete`，也不能进入要求写授权的 `partial`。最终合同增加无写盘 terminal `complete_with_issues`、持久化 `classificationErrorCount`、active-source 释放、UI/reload 语义和专项测试；Gibbs 第三轮给出 `PASS`。

最终 verdict：`043B CONTRACT PASS`，P0/P1/P2 均为 0。当前只进入 `CONTRACT_PASS_WAITING_MANUAL_GATE`：用户必须在全新项目隔离 Chrome profile 中手动登录专用/测试 X 账号并确认 10-candidate probe 与 disposable Vault 边界，之后才能把生产实现正式置为 `READY/IN_PROGRESS`。
