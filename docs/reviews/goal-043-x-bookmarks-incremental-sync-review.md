# Goal 043 合同与 G0 预审

> 日期：2026-07-13
>
> 范围：Goal 043 v1 合同、G0 精确工具链候选与命令/Chrome 边界
>
> 独立 reviewer：Huygens (`019f5af2-d64e-76b0-91c8-bd9982d801e6`)
>
> 2026-07-13 历史快照：初始合同结论 `PASS`、G0 verdict `PASS`、043A fixture-only verdict `PASS`；当时整个 Goal 043 为 `BLOCKED_BY_REAL_X_EVIDENCE`。最终状态见第 16.21 节。

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

最终 verdict：`043B CONTRACT PASS`，P0/P1/P2 均为 0。项目隔离 Chrome profile 优先；隔离测试账号确实无法登录后，只允许用户明确指定的单个日常 X 收藏页标签作为例外。用户已授权日常 Chrome 只操作 X 并要求限制并发，项目把首次真实 QA 固定为 10-candidate、最多 5 次滚动、批次至少间隔 2 秒、单 tab/job/invocation/outstanding request、no-Vault 及 STOP 条件，因此 043B 已进入 `IN_PROGRESS_OFFLINE_IMPLEMENTATION`。真实 probe 位于实现、离线门禁和独立 actual-diff review 之后，不因 Codex Chrome 暂不可用而阻塞离线生产实现。

## 15. 2026-07-14 深度漂移自检与人工门禁修订

本轮在不修改生产代码的前提下重新核对当前 worktree、`origin/main`、draft PR、工具链、现行路线、Goal 看板、043B 合同和真实 Chrome 门禁。代码和工具链事实未发现漂移：候选分支仍基于当前 `origin/main`，既有 PR/CI、pnpm `10.34.5`、lock SHA-256、335 项测试和 extension build 证据保持有效；本轮只修改当前状态/合同文档。

自检发现并修正四类文档漂移：路线图仍把 Goal 042/043 写成旧状态；人工门禁一度要求尚未接线的 043B 先完成真实 probe，形成循环；Goal 032 主工作区与 Goal 043 worktree 的描述容易混淆；X 合同缺少跨 job/tab 的单 invocation、单 outstanding request、2,000 ms 最短批次间隔、首次最多 5 次滚动和 429/challenge 零自动重试硬边界。

隔离测试账号随后无法登录，用户明确授权日常 Chrome 只操作 X，并要求限制并发。项目把该授权收窄为后续真实 QA 只绑定或新建单个 `https://x.com/i/bookmarks` 标签，不枚举、读取、切换、刷新或关闭其它标签，不读取整个 profile，不扩展到其它站点；并固定 10 candidates、最多 5 次滚动、单 tab/job/invocation/outstanding request、批次至少 2 秒和 429/challenge 零自动重试。Codex Chrome 插件当前出现注册存在但核心运行文件不完整的外部门禁；恢复只允许使用插件 UI 和正常应用重启，不手工删除缓存、不下载 CRX/浏览器，也不以其它自动化绕过。该故障只阻塞实现后的真实 probe，不阻塞离线生产实现。

独立只读 reviewer Hubble (`019f5dbb-d072-7193-babb-38c6c64beb29`) 对首轮状态、门禁顺序、日常 Chrome 单标签例外和 X 限速合同给出 `PASS`。用户随后指出 Chrome 连接不应被误设为离线实现的串行前置，本轮据此修正为 `IN_PROGRESS_OFFLINE_IMPLEMENTATION`；最终实际文档 diff 仍需在格式、链接和状态一致性门禁后复核。该状态只授权 043B 合同内离线生产实现，不授权真实页面读取、真实 probe 或 Vault 写入。

## 16. 043B 离线实现候选、独立审查与规范收口

### 16.1 当前候选

043B 已在独立 worktree 内完成合同白名单中的 manifest 权限迁移、DB3/单事务分类持久化、X DOM reader、runtime message/sender/document 绑定、单任务 coordinator、Popup 上下文入口、Side Panel 工作台和 Vault 逐项写入接线。实现期间没有读取真实 X、Cookie、token、日常 Chrome 其它标签或真实 Vault，也没有启动 Docker、服务、监听端口或下载浏览器。

当前仍是离线实现候选，不是 Goal 完成。单元、集成、coverage、build、复杂度审查、最终 post-fix actual-diff review 和 Node 20 CI 已通过；离线 extension fixture E2E 因本机 Chrome 未注册命令行加载的 unpacked extension 而未通过，受界真实 X probe 和 disposable Vault 1-3 条写入仍未完成。

### 16.2 首轮 actual-diff findings

独立 reviewer Huygens (`019f5f21-4c4e-76d0-a5e0-37848ec3a116`) 首轮给出 `FAIL`，P0 none：

- P1：adapter 在 catalog 分类前按 raw candidate batch 报 `candidate_items` 预算，若整批都是 catalog-existing，持久化 candidate count 仍为 0，但 coordinator 会提前暂停；反复恢复可能无法越过这批历史项。
- P1：Chrome 的宽 `https://*/*` 实际授权会覆盖精确 X contains 查询，旧健康检查权限可能被误标成“已仅授权 X”，违反最小权限表达。
- P2：Side Panel 在 intent 缺失、过期或 mode 不一致时会自行发送 `launch`，绕过“Popup 创建一次性上下文意图”的合同。
- P2：根 `pnpm test:coverage` 会发现保留在 Git ignored `.pnpm-store/goal-043/chrome-profile` 下的第三方扩展测试；项目测试本身通过，但标准命令不稳定。

### 16.3 已完成修复

- coordinator 只在持久化后的 `candidateCount` 达到上限时因 candidate budget 暂停；其它 node/time/byte/scroll budget 仍 fail closed。新增回归证明 raw batch 全部命中 catalog 后会继续读取下一批新候选。
- X 权限检查改为同时核对 `permissions.contains` 与 `permissions.getAll`：存在 `http://*/*` 或 `https://*/*` 时进入 `overbroad`，不会创建 job 或注入脚本；UI 提供显式撤销旧全网站权限后再申请精确 X。旧健康检查仍可能重新申请宽权限，完整 per-origin 健康权限重构留给后续 Goal，不能在 043B 暗改。
- launch intent 收敛为一次性窗口上下文授权，不再携带 mode。只有 Popup sender 能创建 intent；Side Panel 的真实开始点击携带严格枚举 mode 并消费 nonce，无法自行补发 launch。service-worker 回归证明 Side Panel launch 被拒绝且 backfill mode 只在消费时写入 job。
- 为关闭 coverage discovery 漂移，合同新增根 `vitest.config.ts` 的单行白名单：只允许 test discovery 排除 `**/.pnpm-store/**`，不得降低阈值或排除生产代码。独立 reviewer Wegener (`019f5f81-d11f-7013-a8fb-2d4196c82b01`) 对该 coverage 修订单独给出 `PASS`，并确认无需修改已由 `packages/*/src` include 收窄的 `coverage.exclude`；配置随后只增加这一项 discovery exclude。
- 精确 X、宽 HTTP、宽 HTTPS 及“精确 + 宽权限”统一由纯函数分类；所有宽权限分支都 fail closed。service-worker 测试直接读取 IndexedDB，证明拒绝或宽权限状态不会创建 X job，也不会注入 content script。
- Popup intent 消费后的标签页校验先查询 `lastFocusedWindow`，再限定原始 `windowId`；多窗口回归证明活动标签在 Popup 与 Side Panel 点击之间变化时返回 `tab_changed`，不注入、不建 job，且 intent 保持一次性消费。
- 旧 Side Panel nonce 不再能删除较新的 Popup intent：nonce 不匹配只返回错误，只有匹配 nonce 才先删除再做服务端窗口复核。新增回归覆盖 A/B 两个连续 Popup intent 的竞态。
- 旧全网站权限的撤销入口已移到 terminal/result 状态也可见的位置；Goal 文件补入仅用于状态同步的 `docs/product-roadmap-v4.md` allowlist，关闭实现与合同文件范围不一致。
- 复杂度复核移除了 UI model 中四个生产未使用字段；旧 SyncStore 兼容 API 涉及跨测试和迁移边界，本 Goal 不做无证据删改，作为后续结构债务记录。

### 16.4 当前自动化证据

- `pnpm lint`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm test`：PASS，426/426（extension 400、desktop 25、shared 1）。
- `pnpm --filter @shuhai/extension run build`：PASS，Vite 6.4.3 转换 1,992 modules；`assets/styles.js` 为 541.95 kB，仍有超过 500 kB 的非阻塞拆包警告。
- 标准 `pnpm test:coverage`：PASS，41 files / 426 tests；全局 statements 53.41%、branches 72.85%、functions 72.91%、lines 53.41%，均超过现有阈值。保留的 ignored Chrome profile 未再进入 test discovery，coverage include 与 thresholds 没有变化。
- Prettier、`git diff --check` 与 lock SHA-256 `552374FAA202BEC642B0BF2E849A855A15FBB05C3D13E48B7E033BC51E2F8EAB`：PASS/未漂移。
- full audit：low 1 / moderate 1 / high 0 / critical 0，均位于既有 ESLint 开发依赖链；production audit：0。没有为规避 advisory 临时升级依赖或漂移 lock。

### 16.5 复杂度审查与当前 verdict

应保留的复杂度是 DB3 原子迁移与事务、运行时 schema/sender/document/nonce 绑定、单 invocation/单 outstanding request、write-intent/partial/reconcile 和持久化逐项结果；这些直接保护用户数据与真实平台账号，不属于可删的“架构装饰”。

当前不在 043B 扩大的结构债务包括大型 `service-worker.ts`、`App.tsx`、`XSyncPage.tsx`、`sync-store.ts` 和 542 kB UI chunk。它们需要按用户旅程拆分的独立 Goal 与 bundle budget，不能在安全接线收尾时做无关重构。

独立复杂度 reviewer Carson (`019f6006-2b58-7cc2-a498-24cebbbf967c`) 确认 DB3、原子事务、sender/document/nonce、单 invocation/单 outstanding request、write-intent/reconcile/partial/cancel 都是必要复杂度，并给出无 P0/P1 的 `PASS`；其发现的旧 nonce 删除新 intent 竞态已修复并新增回归。此前 Wegener 的整体 `FAIL` 只说明当时没有完成启动边界 actual-diff 验收，不能用来否定后续实现，也不能替代最新修复后的最终独立复审。

最终只读 reviewer Kant (`019f6027-1906-7ca3-a3b1-2f86aad7410d`) 对基线 `5acdcc7` 到当前工作树的 post-fix actual diff 给出 `PASS`，P0/P1/P2 均无未解决项。复审确认权限 fail-closed 与零 job/零注入、sender/document/tab/window/nonce 绑定、terminal 宽权限撤销、candidate/backfill budget、partial/cancel/reconcile/Vault write-intent 和 Goal allowlist 均未发现绕过；没有发现需要在本 Goal 强拆的实质过度设计。该 reviewer 未修改文件，也未把逻辑测试冒充浏览器验收。

当前 verdict 更新为 `043B OFFLINE CODE CANDIDATE PASS / GOAL NOT PASS`。剩余阻塞是 extension-level Chrome E2E、受界真实 X 和 disposable Vault QA，而不是当前代码门禁、actual-diff review 或 Node 20 CI。

### 16.6 Chrome extension E2E 门禁

使用本机已安装 Chrome `150.0.7871.101`、当前 worktree 下全新且被 Git 忽略的 profile `.pnpm-store/goal-043/chrome-profile/permission-spike-20260714-1736` 进行了一次 fail-closed 启动验证。运行仅使用构建产物、离线参数和 host resolver fail-closed；没有读取日常 Chrome profile、访问真实 X/Vault、下载浏览器、操作端口或结束其它进程。

Chrome 在 30 秒内没有注册 unpacked extension 的 service worker，验证以 timeout 失败；Playwright context 随后正常关闭，进程检查未发现仍携带该 profile 的 Chrome。该证据只能说明当前安装版 Chrome 的命令行加载路径不可用，不能写成 extension E2E `PASS`。

复核随后发现原 E2E harness 与人工门禁自相矛盾：它要求 profile 不存在并继续传入 Stable Chrome 已忽略的 `--load-extension`，因此用户手动准备后反而会被测试拒绝。候选修复把输入改为当前 Goal profile 根目录下已存在的普通子目录，拒绝根目录、不存在路径、symbolic link/junction 或 realpath 越界；以可见模式重开用户已手动加载 `packages/extension/dist` 的专用 profile，并完全移除命令行 extension 加载 flags。缺少 ShuHai service worker 时返回明确的准备步骤错误。独立复核又指出只取第一个 service worker 可能让 stale/其它 extension 冒充当前候选；harness 因此对浏览器实际提供的 `background/service-worker.js` 与当前 `dist` 文件做 SHA-256 比对，不一致即 fail closed。仓库外路径、Goal profile 根目录和不存在子目录三项实际拒绝检查均通过；独立 reviewer Confucius (`019f6052-a676-7ea1-aa9c-dfdb236ad334`) 对 profile/realpath/hash/context-close diff 给出 `PASS`，P0/P1/P2 均为 0。该 harness 已通过 Prettier、`git diff --check` 和 Playwright `--list` 编译发现，实际 extension E2E 仍等待人工 profile，不能写成 `PASS`。

用户随后已在独立项目 profile `.pnpm-store/goal-043/chrome-profile/manual-e2e-20260714-1850` 中手动加载当前 `packages/extension/dist`，扩展 ID 为 `pbjamjajfdmcnfnljgedgiahcpogpbji`。自动化 route integration 已使用该普通 profile 完成，但真实 toolbar 点击仍需人工证据；不得改用日常 profile、自动下载 Chrome/Chromium，或绕过该门禁直接进入真实 X。

### 16.7 提交与 Node 20 CI

首次提交尝试没有创建 commit：Husky 的 `pnpm lint-staged` 解析到用户全局 pnpm，触发 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 后在任何目录替换前停止。没有使用 `--force`、手工删除或清理。随后通过 Goal 固定的 pnpm `10.34.5` 前缀显式运行同一 `lint-staged`，ESLint/Prettier 全部通过且临时 stash 已正常清理；再次完整运行 lint、typecheck、426 项测试、coverage 和 extension build 后，只对该次 commit 设置进程级 `HUSKY=0`，没有跳过等价质量门禁。

普通追加提交 `c66c3ac` 已 push 到 draft PR `#5`。GitHub Actions run `29326255564` / job `87063170807` 在 Node `20.20.2`、pnpm `10.34.5` 下于 53 秒内 `PASS`；frozen install 使用 official registry 和 `--ignore-scripts`，lint、typecheck、coverage、全仓 build 与 coverage artifact 均成功。该 CI 只关闭 Node 20 门禁，不替代 extension E2E 或真实 X/Vault QA。

### 16.8 Preloaded-extension route integration 与安全纠偏

手动 profile 准备后，测试发现 Playwright 默认参数仍会通过 `--disable-extensions` 禁用已加载扩展，且 MV3 worker 可以休眠。harness 最终只忽略该一个 Playwright 默认参数；扩展 ID 必须由 `SHUHAI_GOAL_043_EXTENSION_ID` 以严格 32 位 `[a-p]` 格式显式提供，并同时校验实际 worker URL host 与当前 `dist/background/service-worker.js` SHA-256。它不读取 Chrome `Preferences`、`Secure Preferences`、日常 profile 或其它扩展配置，也拒绝 profile 根目录、不存在目录、junction/symlink 和 realpath 越界。

直接把 `popup/index.html` 作为普通 tab 打开时，Chrome runtime sender 会带 `sender.tab`，且该 tab 不具有真实 toolbar user gesture/`activeTab`。测试因此收紧为 preloaded-extension route integration：只在测试进程内 mock Popup 的 active-tab UI 查询，验证当前 `dist`、精确 X 上下文展示、无 X host permission 时零 job/零注入和 fixture route 零平台出站；测试名称与合同均明确不宣称真实 toolbar、`activeTab` 或 sender E2E。真实 toolbar 门禁继续保留为人工步骤。

route trace 同时暴露 `popup/styles.css` 仍从 Google Fonts 发起远程请求，违反扩展 UI 不使用远程字体与离线测试边界。候选只删除该 import，保留系统字体 fallback，并在 `manifest.test.ts` 增加 UI stylesheet 无 `http://`/`https://` 回归。build 产物静态扫描确认没有远程字体或 CSS HTTP(S) resource reference。

一次可见 Chrome 启动错误地通过 PowerShell 传递带空格的 `--host-resolver-rules=MAP * ~NOTFOUND`，导致 `*`/`~NOTFOUND` 被拆成 `%2A` 和 `~notfound` 标签，并显示 unsupported flag 警告。该次只关闭命令行和专用 profile 精确匹配的任务 Chrome，未按名称结束进程，也未触碰日常 Chrome。两份 Playwright fixture 已完全移除这个参数；离线 context 与 route abort 继续承担测试网络边界。以后不得复用该参数或用可见 Chrome 试错命令行分词。

最终自动 route integration 1/1 `PASS`，测试本体 1.6 秒、总耗时 3.8 秒。独立 reviewer Volta 先发现“普通 popup tab 冒充 activeTab”和远程字体两个 P1；Aquinas 对修订后的 Goal 合同给出 `PASS`；Hilbert 发现读取 `Secure Preferences` 可能经子路径 junction 越界的 P1，移除所有 Preferences 读取并改为显式 ID + worker URL + SHA 校验后最终给出 `PASS`，P0/P1/P2 均为 0。

本地最终门禁为 lint、typecheck、427/427 tests、41 files / 427 tests coverage、extension build、Prettier、`git diff --check`、production audit 0 和 lock SHA 不变，全部 `PASS`。普通追加提交 `97f1a08` 已 push 到 draft PR `#5`；GitHub Actions run `29332332585` / job `87083017568` 在 Node 20/pnpm `10.34.5` 下 `PASS`。该阶段 verdict 为 `043B ROUTE INTEGRATION PASS / GOAL NOT PASS`；下一门禁仍是独立 profile 的真实 toolbar 点击，其后才是受界真实 X no-Vault probe 和 disposable Vault 1-3 条写入。

### 16.9 人工 toolbar E2E 与终态返回

人工 QA 继续使用独立项目 profile `.pnpm-store/goal-043/chrome-profile/manual-e2e-20260714-1850`、当前 `dist` 和扩展 ID `pbjamjajfdmcnfnljgedgiahcpogpbji`，页面是 Playwright 提供的离线脱敏 exact X bookmarks route。用户实际点击 ShuHai 工具栏图标后确认 Popup 只有 `同步新增收藏` 一个主动作；点击后 Side Panel 先显示 exact X permission preflight。该过程没有访问真实 X、日常 Chrome、Cookie/token、真实 Vault 或其它站点，也没有下载浏览器或影响其它 Chrome 进程。

用户授予精确 X 权限并启动 fixture 任务后，脱敏页面因为测试 route 生命周期切换而进入 `tab_changed`，因此这一步不作为真实 selector 或平台扫描证据。用户随后取消任务并撤销 X 权限，暴露了一个真实 UX 缺口：`cancelled` 结果页没有返回工作区入口。候选修复新增终态专用 `返回工作区`：只在 `complete`、`complete_with_issues`、`cancelled` 和 `failed` 出现；`prepared`、`scanning`、`paused`、`ready_for_review`、`writing`、`partial` 及无 job 均不出现，避免把仍可恢复的任务藏掉。点击只切换 UI workspace，不修改 job、历史、权限或 Vault 数据。

独立 reviewer Dirac (`019f60b7-76a0-7ea2-87ad-6c1d0fcebb5f`) 首轮指出缺少全部状态的直接测试；补齐 10 种 job status 与 no-job 参数化覆盖后，最终 verdict 为 `PASS`，P0/P1/P2 均为 0。最终本地证据为：

- 定向 UI model 测试 38/38 `PASS`。
- `pnpm lint`、`pnpm typecheck`、`pnpm test` 438/438、`pnpm test:coverage` 41 files / 438 tests 和 extension build 全部 `PASS`。
- coverage 为 statements 53.51%、branches 73.05%、functions 72.91%、lines 53.51%；Vite 6.4.3 转换 1,992 modules，既有约 542 kB chunk 警告仍为非阻塞结构债务。
- 精确 ESLint、Prettier、`git diff --check` 和 lock SHA-256 `552374FAA202BEC642B0BF2E849A855A15FBB05C3D13E48B7E033BC51E2F8EAB` 均通过或未漂移。
- 修复提交 `98fbd49` 已普通 push；GitHub Actions run `29335924317` / job `87095013911` 在 Node 20/pnpm `10.34.5` 下 `PASS`。

状态文档独立 reviewer Lovelace (`019f60d1-2118-7790-bff8-05240d989c84`) 首轮发现 Goal 合同复审历史仍把 `IN_PROGRESS_OFFLINE_IMPLEMENTATION` 写成当前状态的一项 P2；改成明确历史时态并指向第 3.3 节当前 gate 后，最终 verdict 为 `PASS`，P0/P1/P2 均为 0。复审确认六份 current 文档一致保持 `IN_PROGRESS_REAL_X_PROBE_GATE` 和 `GOAL NOT PASS`，且没有把 route、toolbar、自动零 job 或真实 X 证据混为一体。

重新 build 并重开同一专用 profile 后，用户在 `本次任务已取消` 终态看到 `返回工作区`，实际点击并确认“返回正常”。专用测试 Chrome 随后正常退出，按精确 profile marker 检查没有遗留进程。人工截图没有作为“无权限零 job”的数据库证据；该不变量继续由 service-worker/IndexedDB 自动化回归承担。

最终 verdict 更新为 `043B MANUAL TOOLBAR E2E PASS / GOAL NOT PASS`。下一门禁是用户明确指定的单个日常 `https://x.com/i/bookmarks` 标签上的 10-candidate、最多 5 次滚动、单 outstanding request、批次至少 2 秒、no-Vault probe；真实 selector、平台 stop code、disposable Vault 1-3 条写入和第二次 incremental 去重仍未验证。

### 16.10 固定扩展 ID 门禁与独立复审

用户于 2026-07-15 精确授权在 `C:\Users\ASUS\.shuhai\keys\shuhai-extension.pem` 创建并限制访问的私钥。实现使用离线生成的 RSA 2048 密钥；私钥路径和文件均关闭 ACL 继承，只允许当前 ASUS 用户、SYSTEM 和 Administrators，且无 `CodexSandboxUsers`。仓库和构建目录只包含 DER SPKI 公钥，不包含 `.pem` 或私钥正文。固定 unpacked extension ID 为 `jdjmpeogiojjhdabdjmpeclcbjcekbje`；该身份不承诺恢复卸载前的 extension storage。

生产提交 `8565c98` 只在 manifest 增加公钥，并在 `manifest.test.ts` 验证 canonical base64、DER SPKI、RSA 2048 和 Chrome 固定 ID 算法；状态收尾提交为 `d619859`。本地 439 项 test/coverage、lint、typecheck、extension build、Prettier、`git diff --check`、full/production audit、source/dist key 比对和 dist 无 `.pem` 均通过；lock SHA-256 未漂移。GitHub Actions Node 20 run `29381583537` 对 `8565c98` 完整通过，后续文档收尾 run `29381742147` 也通过。

独立只读 reviewer Helmholtz (`019f6368-1d6b-7eb3-ae58-44cf399b67cb`) 对 `f8539c2..d619859` 给出 `PASS`，P0/P1/P2 均为 0。复审确认六个变更文件中没有 `.pem`、依赖、lockfile 或 CI 变化；manifest 唯一生产增量是公钥，permission、host permission、CSP 和 `update_url` 未变化；固定 ID 算法与测试合理；当前文档没有声称读取/迁移旧存储或完成真实 X。该 reviewer 没有读取私钥、运行测试/build、检查 ACL 或操作 Chrome，因此其 verdict 只关闭 actual-diff review，不替代用户手动重载固定 ID、受界真实 X no-Vault probe 或 disposable Vault 验收。

当前 verdict 保持 `043B FIXED ID GATE PASS / GOAL NOT PASS`。下一步只能由用户从当前 `dist` 手动重载并确认 Chrome 显示上述固定 ID；确认前不得开始真实 X probe，也不得创建或授权 disposable Vault。

### 16.11 日常 Chrome Popup 路由回归复审

用户在固定 ID、当前 `dist` 和精确 `https://x.com/i/bookmarks` 标签上执行真实 toolbar 检查时，Popup 仍回落通用 launcher。这不是旧扩展或错误构建目录，而是 `getActiveTabInfo` 使用 `currentWindow` 后没有解析到可用 X URL。该失败发生在 UI 上下文识别阶段；没有请求 X host permission、创建同步 job、注入 content script、扫描页面或写入 Vault。

候选只改三处：Popup 查询使用 Chrome 官方推荐的 `{ active: true, lastFocusedWindow: true }`，消费 `runtime.lastError` 并严格只用 `tab.url`；`app-state.test.ts` 增加成功与 fail-closed 两项回归；preloaded-extension route fixture 改为 mock 同一查询合同。没有修改 manifest、权限、service worker、同步算法、依赖或 lockfile。

独立只读 reviewer Wegener (`019f63c0-2660-7941-832d-488a3d8aef8b`) verdict 为 `PASS`，P0/P1/P2 均为 0。reviewer 确认查询仍限定为最后聚焦窗口中的 active tab，没有枚举或扩大到其它标签，错误路径保持 fail closed；reviewer 按合同未操作 Chrome、网络或文件。实现者本地重新运行 lint、typecheck、441 项 test/coverage 和 extension build 全部通过；coverage 为 statements 53.65%、branches 72.92%、functions 73.14%、lines 53.65%。Vite 6.4.3 转换 1,992 modules，既有约 542 kB bundle warning 不由本次引入。

本轮结论是 `ROUTE FIX CANDIDATE PASS / REAL TOOLBAR RECHECK REQUIRED`，不是 Goal 完成。必须由用户重新加载固定 ID 后，在原精确 X 收藏页确认上下文 Popup；此前不得开始 no-Vault probe。

### 16.12 首次真实 probe 的 content script 构建缺陷与修复候选

用户重载固定 ID 后已在原 `https://x.com/i/bookmarks` 标签确认“X 收藏同步”入口正常。首次受界 `incremental + maxCandidates=10 + maxScrollActions=5` no-Vault probe 随即在 DOM 读取前以 `tab_changed` 暂停，进度保持 `0/10`、existing observations 为 0；没有读取收藏、发起 Vault permission 或写入文件。该证据只证明生产入口已到达扫描阶段，不证明真实 selector 或平台滚动可用。

实现复核没有先改 selector、权限、限速或 service worker。实际 `dist/content/x-bookmarks.js` 以 `(() => { import ... })()` 开头，`node --check` 稳定返回 `SyntaxError: Unexpected token '{'`。Vite 原多入口构建把 X content script 的共享依赖拆成静态 module chunk，随后 `wrapContentScripts` 又机械包进 IIFE；Chrome 动态注入的是经典脚本，因此监听器从未注册，后续 targeted `tabs.sendMessage` 无接收端并被 fail-closed 映射为 `tab_changed`。这不是页面真的切换，也不是 X 返回 429 或 selector 为空。

修复候选只改 build boundary：普通 Popup、Side Panel 与 background 继续由原多入口构建；article、toast、twitter、weibo 和 x-bookmarks 五个 content entry 分别通过单入口 Vite build 生成 `format=iife`、`inlineDynamicImports=true` 的自包含文件。每个输出先使用 Node `vm.Script` 按经典脚本解析，再以最终 outer IIFE 隔离 minifier helper 并重新解析；空文件、任何静态 module syntax 或包装后语法错误都让 extension build 失败。`manifest.test.ts` 增加回归，证明普通 IIFE 可接受、IIFE 内静态 `import` 必须抛 `SyntaxError`，且构建 helper 不泄漏到重复注入共享的 isolated-world global；没有改 manifest、权限、同步算法、DOM selector、依赖、lockfile 或 Vault 逻辑。

当前修复证据：lint、typecheck、443/443 test、41 files / 443 tests coverage 和 extension build 均 `PASS`；五个 `dist/content/*.js` 逐个通过 `node --check`、静态 `import/export` 检查并从 final outer IIFE 开始。`x-bookmarks.js` 现为 122,422 bytes 的自包含经典脚本。pnpm 10 audit endpoint 返回可解析的官方 410 retirement 错误，按合同只读回退到本机 pnpm `11.3.0`：full 为 low 1 / moderate 1 / high 0 / critical 0，production 为 0；lock SHA-256 前后均为 `552374FAA202BEC642B0BF2E849A855A15FBB05C3D13E48B7E033BC51E2F8EAB`。第二轮独立 actual-diff review 已 `PASS`。修复提交 `c9ab16f` 已普通 push 到 draft PR `#5`；GitHub Actions run `29390133868` / job `87271536552` 在 Node 20、pnpm `10.34.5` 下完整 `PASS`。用户重载固定 ID 前不得在真实 X 点击 `继续扫描`。当前 verdict 为 `CONTENT BUILD REPAIR PASS / GOAL NOT PASS`。

独立只读 reviewer Harvey (`019f63f2-ecbd-7fd1-8e9a-d6844900f320`) 首轮给出 `FAIL`，P0 为 0：一个有效 P1 是 content 子构建只挂在 `closeBundle` 且未注册 watch graph，无法证明现有 `vite build --watch` 会可靠更新 content scripts；一个证据 P1 要求 outer-IIFE 后重新跑门禁并更新旧数字；P2 指出 `docs/workflows/README.md` 仍把旧 CI/reload 门禁写成当前状态。候选据此把子构建移到每轮可等待的 `writeBundle`，把 extension/shared source 目录加入 Rollup watch graph，使同一 watcher 串行完成主输出与五个 content 输出；最终门禁已重跑为 443 项且产物数字已更新，workflow 状态也已同步。

watch 实测使用项目现有 `vite build --watch`，没有启动 Chrome 或端口。初始 `x-bookmarks.js` 写入时间为 UTC `04:31:44`；通过 `apply_patch` 仅临时增加一行会被 minifier 移除的 source comment 后，watch 自动重建并把写入时间更新到 `04:32:56`，length/hash 仍保持 122,422 bytes / `25D06D94FECCD75336A90B0977AB7579C0C19973C8213BF07BAC9A7AE472D5C7`，证明 content-only 变化已进入 watch graph。恢复 comment 时 watcher 达到测试命令预设超时，在下一轮清空 dist 后被该命令终止；源文件无 diff，随后正常 extension build `PASS` 并恢复完整 dist。该人为中断不作为 watch 完成证据，已成功完成的前一轮 rebuild 才是响应证据。

Harvey 第二轮对最新 working tree 给出 `PASS`，P0/P1/P2 均为 0。复审确认 `writeBundle` + extension/shared watch graph 关闭首轮生命周期问题，443 项/122,422 bytes 证据已更新，workflow 当前门禁不再误报旧 CI；reviewer 未亲自运行 test、build、watch、audit 或 Chrome，因此该 verdict 只关闭 actual-diff review，不替代随后已通过的新 Node 20 CI，也不替代用户重载和真实 no-Vault probe。

### 16.13 第二次真实 probe 的 DOM 预算误计数与修复候选

用户按门禁重载固定 ID 后，第二次受界 no-Vault probe 已越过 content script 构建阶段，但立即以 `structure_changed` 停止并保持 `0/10`；没有写入 Vault。该 stop code 证明 fail-closed 生效，不证明 selector 不存在。用户随后明确授权直接操作当前 X 收藏页和 ShuHai 扩展，但禁止触碰其它标签、进程、任务或本地数据；任何持久化数据修改仍须动作前确认。

实现者只在当前 exact X 收藏标签执行两次受限只读 DOM 聚合检查，不滚动、不点击、不读取 Cookie/token/storage，不返回标题、正文、作者、ID、URL、媒体或 DOM snapshot。证据为：`primaryColumn` 和 `article[data-testid="tweet"]` 均存在，当前 viewport 有 8 张 card；第一张 card 位于容器第 54 个元素处，整个容器有 1,549 个布局元素。现有生产 `safeQueryAll` 使用 TreeWalker 并把经过的每个布局元素都调用 `observe`，因此为寻找最多 11 张 card 会在真实 selector 已命中后仍耗尽 200 节点预算。测试 fixture 没有 `ownerDocument.createTreeWalker`，只统计 querySelectorAll 返回的匹配节点，导致测试与生产语义分叉。按只统计实际匹配和正文遍历节点的候选口径，同一 viewport 预计为 103/200。

首版修复候选不改 selector、权限、消息、同步算法、Vault、依赖或 lock。它保留 TreeWalker 以避免恶意匹配集合的无界 NodeList 分配，并把未读取的布局元素从 200 observed-node 内容预算中分离；但其 5,000 布局上限在每次 `safeQueryAll` 调用中重新计数，且达到 `maximumMatches` 后没有额外 sentinel。独立 reviewer Locke (`019f643b-d812-78e0-9736-32a6850d10f9`) 首轮因此给出 `FAIL`：P1 两项分别是多次 selector 查询可累计放大到约 755,000 次遍历、前四个同源 permalink 会静默遮蔽第五个冲突值；P2 一项是测试没有证明 exact boundary、跨查询累计预算、`nextNode`/`matches` 异常和第五项冲突。首版候选没有提交。

第二版候选仍不改变任何平台或同步边界。它为整次 `readXBookmarksDom` 创建一个共享的 10,000 布局遍历预算，所有 card、permalink、正文和媒体的 TreeWalker 查询共同消费；第 10,000 个布局节点允许完成，第 10,001 个立即 fail closed。`safeQueryAll` 的 TreeWalker 与最小 fixture fallback 都读取至 `maximumMatches + 1` 个匹配 sentinel；card 列表只保留调用方允许的候选数，由 adapter 继续形成 `candidate_items`，而 permalink、正文和媒体出现超量匹配时拒绝整条 observation。新增回归直接覆盖 201 个无关布局元素、整次 exact 10,000/10,001、每个查询都低于旧 5,000 但累计超过 10,000、TreeWalker `nextNode`/`matches` 抛错、TreeWalker 与 fallback 的第五个冲突 permalink，以及 `maxMedia=0`；原超大正文容器、UTF-8、challenge、冲突 identity 和 hostile message 测试保持通过。

当前第二版实现者候选证据为：定向 18/18 测试、精确 ESLint、全仓 lint/typecheck、extension 423 tests、全仓 41 files / 449 tests coverage 和 extension build 全部 `PASS`；coverage 为 statements 53.86%、branches 73.13%、functions 73.20%、lines 53.86%。构建产物 `content/x-bookmarks.js` 为 123,115 bytes 的自包含经典脚本，并通过 `node --check` 和静态 module syntax 检查。pnpm 10 audit endpoint 仍返回官方 410 retirement 错误；合同允许的本机 pnpm 11.3.0 只读 fallback 为 full low 1 / moderate 1 / high 0 / critical 0，production 0。lock SHA-256 前后均为 `552374FAA202BEC642B0BF2E849A855A15FBB05C3D13E48B7E033BC51E2F8EAB`。

Locke 的一次中间复审在最终 test/docs patch 前仍给出 `FAIL`（P2 两项）：合同摘要还写 5,000，且第五个冲突 permalink 当时只有 fallback 直接覆盖。候选随后统一所有 current 文档、在固定预算表正式增加单次 DOM read 共享 10,000 上限，并让同一测试分别走 fallback 与真实 TreeWalker 分支。Locke 对最新实际 diff 的最终 verdict 为 `PASS`，P0/P1/P2 均为 0；reviewer 明确确认固定预算表、生产常量、每次 read 唯一共享 budget 以及 10,000/10,001 和跨 selector 累计测试一致。reviewer 没有运行测试、构建、网络或 Chrome，也没有修改文件，因此该结论只关闭 actual-diff review，不替代新 Node 20 CI 或后续受界真实 X probe。

修复提交 `9f176e7` 已普通 push 到 draft PR `#5`。同一 head SHA `9f176e777f60b7b83af60fdca13225976df6bf91` 的 GitHub Actions runs `29395799014` / job `87288903680` 与 `29395798874` / job `87288903481` 均在 Node 20、pnpm `10.34.5` 下 `PASS`；两条 run 都完成 frozen/ignore-scripts official-registry install、lint、typecheck、coverage、全仓 build 和 coverage artifact。当前 verdict 为 `DOM BUDGET REPAIR PASS / GOAL NOT PASS`；用户重载并确认允许创建新的扩展本地 SyncJob/candidate 数据前不得再次扫描真实 X。

### 16.14 第三次真实 probe 的虚拟列表重复前沿与修复

用户重载 DOM 预算修复后，第三次受界 `incremental + maxCandidates=10 + maxScrollActions=5` no-Vault probe 已真实读到 `8/10` 条候选，随后连续三批没有发现新的 stable ID，以 `no_progress` 暂停。没有写入 Vault、读取凭据、调用私有 API、增加并发或触碰其它标签。生产实现也没有模拟物理鼠标：content script 每个受约束 message 最多执行一次 `window.scrollBy` 与等待，然后只读取 X 当前渲染的虚拟列表 DOM。X 不会把整个收藏库同时留在 DOM 中，因此在不使用官方 OAuth API、私有 GraphQL、Cookie/token 或 MAIN world 的边界下，受限程序化滚动仍是必要的平台适配动作。

根因不是“滚动太慢”，而是三类稳定 ID 被旧协议混在一起：同一 job 已持久化的 candidate、catalog 中已入库的 exact-existing frontier，以及当前 invocation 本轮实际见过的 ID。X 回收虚拟列表 DOM 后会重复返回顶部或相邻 card；旧 content 输出窗口又最多保留 50 个 candidate，导致旧 card 可以占住窗口并遮蔽更后的未知 card。resume 时若把持久化 ID 预先放入 invocation no-progress 集合，还会让旧观察被错误当成本轮重复。首次未提交候选试图把所有 job item 都作为一个 known 集合发送，但独立 reviewer Erdos (`019f654a-ac8b-7bd2-9974-48b5a050759f`) 指出两个 P1：catalog-existing frontier 不一定存在于 job items，重复 resume 会错误累计；只读取前 50 张 card 时，第 51 张新 card 仍会被隐藏。该候选没有提交。

最终修复采用分层、受界状态：

- `SyncCheckpoint` 新增可选 `knownFrontierSourceItemIds`，最多 20 个，必须唯一且数量与 `consecutiveKnownIds` 一致；旧 DB3 checkpoint 缺少该字段时，不猜测旧前沿，而是在下一批保守重建。
- runtime message 分离最多 50 个 `candidateSourceItemIds` 与最多 20 个 `knownFrontierSourceItemIds`，两组必须唯一且互不重叠。candidate replay 会重置 frontier，exact-existing observation 才推进 frontier；重复 exact-existing ID 不会二次累计。
- coordinator 的三批 no-progress 集合从当前 invocation 的空集合开始，不再由持久化 job items 预填；每批分类后再更新 candidate 集合。
- DOM reader 在固定 200 内容观察节点、整次共享 10,000 布局遍历、50 candidate 输出和既有时间/字节预算内继续读取 card identity，跳过 exact-known frontier。为保持页面顺序和 store 的 frontier reset 语义，只保留未知 card 前最近一个必要 candidate replay barrier，而不是返回全部旧 card。

新增回归覆盖 8 个 known 后的后续 card、恰好 50 个 candidate 后第 51 个新 card、candidate/frontier overlap 与超量、暂停恢复不重复增加 frontier、重复 exact-existing 去重、barrier 顺序，以及旧 DB3 checkpoint 缺少 frontier ID 时 close/reopen/resume 的保守重建。最终本地证据为：lint、typecheck、extension 432 tests、全仓 41 files / 458 tests coverage 和 extension build 全部 `PASS`；coverage 为 statements 54.11%、branches 73.27%、functions 73.20%、lines 54.11%。构建产物 `content/x-bookmarks.js` 为 125,421 bytes，SHA-256 `55CF1A9C0624308AA1CA86EF11AD80A623F5F3E90099D344F589C52371910822`，通过 `node --check` 且无顶层静态 `import/export`。pnpm 10 audit endpoint 仍返回官方 410 retirement 错误；本机 pnpm `11.3.0` 只读 fallback 为 full low 1 / moderate 1 / high 0 / critical 0，均为开发工具链路径，production 为 0。lock SHA-256 保持 `552374FAA202BEC642B0BF2E849A855A15FBB05C3D13E48B7E033BC51E2F8EAB`。

Erdos 对最终 actual diff 的 verdict 为 `PASS`，P0/P1/P2 均为 0，并确认首轮两项 P1 已关闭；reviewer 建议补充的旧 DB3 reopen/resume 测试已加入并通过。reviewer 没有运行测试、Chrome 或网络，也没有修改文件。修复提交 `76a3a60` 已普通 push 到 draft PR `#5`；GitHub Actions run `29413005934` / job `87344295492` 在 Node 20、pnpm `10.34.5` 下 `PASS`。当前 verdict 为 `VIRTUAL LIST FRONTIER REPAIR PASS / GOAL NOT PASS`；用户重载并确认允许创建或更新扩展本地 SyncJob/candidate 数据前，不得再次扫描真实 X。

### 16.15 受界真实 X no-Vault 10-candidate probe

用户重载固定 ID 的修复版本后，在先前明确指定的单个日常 `https://x.com/i/bookmarks` 标签自行启动受界 `incremental + maxCandidates=10 + maxScrollActions=5` probe。Side Panel 聚合 review 证据显示任务已越过此前 `8/10 no_progress` 卡点并形成 10 个候选：`new=5`、`incomplete=5`、`changed=0`、`error=0`、catalog existing observations 为 0。5 个 new 标记为列表摘要并默认选中；5 个 incomplete 明确标记为 `metadata_only` 且未默认选择。界面显示当前正在使用本批结果、仍可能有更早收藏等待后续批次，没有声称到达 feed 末尾。`保存 5 条到 Vault` 仍是待点击动作，因此该 probe 没有写文件、请求新目录或使用真实 Vault。

该证据只支持 `LIMITED_GO/batch-only`：真实 selector、受界程序化滚动、10-candidate 上限、候选分类与默认选择已工作；列表摘要和 `metadata_only` 仍不是完整正文，不能据此声称“已完整导出 10 条”或“已同步全部收藏”。下一道人工作业门禁仍是 worktree 内新 disposable Vault，首次只保存 1-3 个默认可保存项；随后第二次 incremental 只要求此前实际写入的 1-3 条返回 existing/skip 且文件数不增加，未写入项仍可继续显示为 new。

QA 过程发生一项必须留痕的证据最小化偏差：Codex Chrome 只能认领精确 X 顶层标签，无法通过 Browser URL policy 打开 `chrome-extension://.../sidepanel/index.html`；在确认这一限制前，一次真实 X `domSnapshot` 把当前渲染帖子的文字带入 Codex 工具输出边界，其后端留存或删除状态未验证。发现后立即停止所有正文 DOM 读取，没有绕过 URL policy，没有把正文、作者、ID、URL、媒体或 snapshot 复制到仓库、PR、截图或本 review。后续真实 X QA 禁止使用整页 DOM snapshot；Side Panel 证据只能由用户提供 Side-Panel-only 截图或人工汇总，agent 不再尝试直接读取扩展页面。浏览器控制被 finalise 后保留原 X 标签，不关闭、刷新或操作其它标签。该偏差不推翻用户在偏差发生前完成的功能 probe，但必须由最终独立 reviewer 评估验收影响。

当前 verdict：`REAL X NO-VAULT FUNCTIONAL PASS / QA EVIDENCE DEVIATION RECORDED / GOAL NOT PASS`。Goal 043 保持 `IN_PROGRESS`，不得在真实 Vault 上继续，也不得把 5 个 `metadata_only` 项强制加入选择。

### 16.16 Disposable Vault 授权与 no-write 监测

用户明确批准一次性测试 Vault 后，Integrator 先把目标规范化并确认仍位于当前 worktree，再创建空目录 `.pnpm-store/goal-043/test-vault/real-20260715-10candidate`。创建后的初始条目数为 0；没有使用真实 Obsidian Vault，也没有修改 X、其它标签或其它本地路径。

File System Access API 的目录授权仍要求真实用户手势。Integrator 没有绕过 picker，也没有改用 Computer Use 或其它浏览器控制面代替用户确认；随后只读轮询该精确目录 10 分钟，只汇总递归文件数量和总字节，不输出文件名或正文。监测结果为 0 个文件，证明当前仍未发生 Vault 写入。下一步保持不变：用户在 Side Panel 只保留 1-3 个默认可保存项，点击保存并在 picker 中手动选择该目录，然后停留在结果页供逐项 outcome 与文件数量/大小核对。

当前 verdict：`DISPOSABLE VAULT DIRECTORY READY / USER PICKER ACTION PENDING / GOAL NOT PASS`。

### 16.17 首轮写入功能证据与范围偏差

用户报告已完成写入后，Integrator 只读核对同一 disposable Vault：递归文件数为 5，总计 5002 bytes，最小 865 bytes、最大 1200 bytes。核对没有输出或读取文件名与正文，也没有访问真实 Vault。用户提供的 Side-Panel-only 截图显示 `created=5`、`already_exists=0`、`skipped=0`，5 条均有逐项 created 结果；截图不复制到仓库，也不转录其中的相对路径或 source ID。

用户随后确认原计划只选 1-3 条，但实际操作时误保留了全部 5 条，并询问是否可将本轮计入验收。鉴于所有写入都位于新建 worktree disposable Vault、逐项 UI 结果与 5 个非空文件一致、没有真实 Vault 或其它数据影响，本轮可作为首次写入功能证据；原定 1-3 条仍作为 QA 风险控制范围，实际 5 条必须记录为偏差，不能据此扩大后续真实 QA 授权。现有文件保留，不删除、不修改，也无需重新执行首次写入。

下一步只验证第二次 incremental：这 5 个实际写入项必须返回 existing/skip，文件数保持 5；不得保存任何新候选。当前 verdict：`FIRST DISPOSABLE VAULT WRITE FUNCTIONAL PASS / 5-ITEM QA SCOPE DEVIATION RECORDED / DEDUP PENDING / GOAL NOT PASS`。

### 16.18 第二次 incremental 回归与离线修复候选

第二次 incremental 尚未形成去重证据。用户从终态点击“返回工作区”后落入旧版总工作台；重新启动扫描时任务未经显式选择从首轮 10 条上限放大为 50 条。真实 Side Panel 聚合状态显示候选停在 5/50，existing observations 在每次人工继续后约增加 3-4，随后反复以 `structure_changed` 暂停。发现后立即停止继续点击，没有执行第二次 Vault 写入，也没有删除或修改首轮 5 个测试文件。

代码审计确认三个初始根因：`App.tsx` 的返回 handler 直接关闭 X route；service worker 仅凭前一 job 为 complete 就切换到 50/20 标准预算；content reader 让多张卡片共用 200 内容节点，并把后续卡片子树耗尽与真实 selector 漂移合并为 `structure_changed`。候选修复将终态返回变成 X 同步入口的本地视图重置，仍要求 Popup-only one-shot launch intent 才能创建下一 job；所有新 job 保持 10 candidates/5 scroll actions；content reader 为卡片分配受全局 200 上限约束的子预算，后续过密卡片只输出已验证 stable permalink 的 identity-only observation。第一张过密、permalink 冲突、selector 异常和 10,000 layout traversal 越界继续返回 `structure_changed`。

第一轮独立 review 指出，直接用 identity-only hash 会把此前完整写入的 summary 误判 changed；修复因此引入只在当前 adapter batch 中存在的 `identityOnlySourceItemIds`，并在 message、coordinator 与 store 三层验证其必须是同批唯一 ID、严格 `metadata_only`、无 title/text/displayName/publishedAt/media 且 canonical handle 一致。已有 catalog 同 canonical 项只计 existing observation；未知 identity-only 项保守记 incomplete，并允许同 job 后续读取到 summary 时原位升级，不增加第二个 candidate。

第二轮独立 review 又指出 identity-only catalog match 不能推进 authoritative known frontier，且原跨层测试绕过了 coordinator。修正时新增真实 coordinator 回归，立即发现 `parseAdapterBatchResult` 的精确键集合只接受基础四键，实际上会拒绝合法可选 `identityOnlySourceItemIds`；这是用户看到“约四条后 structure_changed”的直接跨层原因。最终候选允许基础四键或带该可选字段的精确五键，伪造 hint 仍在持久化前 fail closed；identity-only existing 会清空连续 frontier，只保留保守去重计数。测试同时锁定 observed-node/accepted-byte 计费、20 个 identity-only existing 不触发 `known_frontier`、继续读取下一批 trusted terminal，以及 incomplete 到 summary 的同 job 升级。

当时的离线证据为：聚焦 68/68 tests、全仓 lint/typecheck、41 files / 467 tests coverage、extension build、5 个 content script `node --check` 和 lock 检查均通过；coverage 为 statements 54.49%、branches 73.83%、functions 73.34%、lines 54.49%。锁文件未改，SHA-256 仍为 `552374FAA202BEC642B0BF2E849A855A15FBB05C3D13E48B7E033BC51E2F8EAB`，因此没有重复运行已记录的 audit fallback。第三轮独立 actual-diff review 已 `PASS`，P0/P1/P2 均为 0；reviewer 确认 23 个修改文件都在 043B allowlist 内，并且未运行 Chrome、网络、Vault 或修改文件。修复提交 `058de72` 已普通 push 到 Draft PR #5；GitHub Actions run `29434729210` / job `87418378139` 在规定工具链下完整 `PASS`。证据收口提交 `924c43d` 对应的 run `29435114312` / job `87419676710` 也已 `PASS`。该阶段 verdict 为 `REPAIR REVIEW AND CI PASS / REAL DEDUP RETEST PENDING / GOAL NOT PASS`；后续事实见 16.19 节。

### 16.19 修复版第二轮受界去重观察与最终门禁

用户确认重载固定 ID 后，在同一受界日常 `https://x.com/i/bookmarks` 标签重新进入 X 同步 preflight；界面明确显示 X 权限已授予、批次候选上限 10、Vault 仅在保存时请求。用户手动启动的第二轮 `incremental + maxCandidates=10 + maxScrollActions=5` 扫描在 `budget_exceeded` 正常暂停，Side Panel 聚合状态为 `6/10` 个候选与 7 条 catalog-existing observations。与旧回归不同，本轮没有在约四条后反复 `structure_changed`，也没有静默放大为 50 条。

扫描暂停后，Integrator 只读核对既有 disposable Vault 的聚合信息：仍为 5 个文件、总计 5002 bytes、最小 865 bytes、最大 1200 bytes。没有读取或输出文件名、相对路径、正文、作者、source ID、URL 或媒体，也没有访问真实 Vault。该证据证明第二轮暂停前 catalog 去重观察已生效且没有发生新文件写入；由于任务尚未从 `paused` 转为 `ready_for_review/user_finalized_batch`，它还不能单独证明 7 条 existing observations 在复核页正确展示，或此前写入的 5 条均没有进入可写候选。

浏览器控制策略拒绝自动操作 `chrome-extension://` Side Panel，并明确禁止通过 Computer Use、其它浏览器表面或原始调试协议绕过。Integrator 因此没有代点“使用本批结果”；该点击和 Side-Panel-only 复核截图仍由用户手动完成，不读取 X 页面正文。测试 Vault 在复核前保持不变。

独立完成审查 Kepler (`019f6b19-7886-7212-8f4e-eab9def193cf`) 给出 `NEED_EVIDENCE`：P0 无；P1 为复核页尚未完成，以及严格按第 13.11 节仍缺最终构建上的真实 pause/resume 与同一 X 标签 `tab_changed`；P2 为 `finalizePausedScan` 缺少直接正反行为测试。代码与自动测试已覆盖 tab/document/window 绑定和 pause/resume，但此前真实 `tab_changed` 来自 content 构建失败，不足以冒充用户切离收藏页证据。

P2 已在 allowlist 内的 `packages/extension/tests/sync-store.test.ts` 关闭：参数化测试证明只有 scanning 阶段的 `user_paused`、`budget_exceeded` 能进入 `ready_for_review/user_finalized_batch`；其余 7 个 stop reason 全部拒绝且完整 job 状态不变；writing 阶段即使原因相同也拒绝且完整状态不变。定向 49/49、全仓 lint/typecheck、41 files / 478 tests coverage、extension build、5 个 content script `node --check`、Prettier、`git diff --check` 和 lock SHA 不变均通过。独立 reviewer Hubble (`019f6b3c-fa31-7490-957a-d908785e457c`) 最终给出 `PASS`，P0/P1/P2 均为 0。提交 `4ca26dd` 已普通 push；GitHub Actions run `29506659950` 在 Node 20/pnpm `10.34.5` 下 `PASS`。

该阶段 verdict：`DEDUP OBSERVATION AND NO-WRITE PASS / REVIEW PAGE + REAL PAUSE/TAB-CHANGE PENDING / GOAL NOT PASS`。当时下一步只允许用户点击“使用本批结果”进入复核且不保存；后续事实见第 16.20 节。

### 16.20 第二次 incremental 复核页与 no-write 证据

用户手动点击“使用本批结果”后进入复核页。脱敏聚合证据为：`new=1`、`existing observations=7`、`changed=0`、`incomplete=5`、`error=0`、`summary=1`。5 条 `incomplete/metadata_only` 保持未选，只有 1 条 `new/list-summary` 默认选中，主动作显示保存 1 条；因此 7 条 catalog-existing observations 没有进入可写候选，也没有把不完整项自动加入选择。真实帖子标题、正文、作者、ID、URL 和媒体均未转录或写入仓库。

复核页出现后，Integrator 再次只读核对同一 worktree disposable Vault 的聚合信息：仍为 5 个文件、总计 5002 bytes、最小 865 bytes、最大 1200 bytes，与复核前完全一致。没有读取文件名、相对路径或正文，也没有点击保存、访问真实 Vault 或修改 X 收藏。

独立只读 reviewer Hypatia (`019f6b80-2d74-7361-8ef9-1a8220216c4f`) 给出 `NEED_EVIDENCE`，P0/P2 均为无。reviewer 确认第 16.19 节的复核页 P1 已关闭，且 `finalizePausedScan` 自动化缺口已由提交 `4ca26dd` 关闭；但自动化不能替代最终构建上的真实 `pause -> resume` 与同一 X 标签离开 `/i/bookmarks` 后的 `tab_changed`。

当前 verdict：`REVIEW PAGE AND NO-WRITE PASS / REAL PAUSE-RESUME + SAME-TAB TAB_CHANGED PENDING / GOAL NOT PASS`。下一步仍不得保存或删除当前批次；若用户批准创建新的扩展本地 SyncJob，则只在同一个 X 标签执行一次受界 no-Vault pause/resume 和切页验收，不触碰其它标签、平台收藏或真实 Vault。

### 16.21 最终真实 pause/resume、同标签 tab_changed 与完成审查

用户在唯一获准的日常 `https://x.com/i/bookmarks` 标签启动新的受界 no-Vault 任务，并在 Side Panel 显示 `5/10` 个候选、3 条 catalog-existing observations 时主动暂停。暂停状态保留同一任务与“继续扫描”入口；用户继续后至少完成一批处理，existing observations 增至 6，没有创建新的 Vault 写入授权或结果。

随后用户只在同一 X 标签从收藏页切到 X 首页。Side Panel 显示“收藏页已切换”，持久化停止原因为 `tab_changed`，任务仍停在 `5/10`，没有继续读取新页面，也没有切换、刷新或关闭其它标签。用户最终点击“取消本次任务”，完成 pre-write 取消链路。整个最终旅程没有修改平台收藏、读取 Cookie/token/Authorization、调用私有 API、自动重试或扩大扫描并发。

Integrator 在暂停、切页和取消前后只读核对同一 worktree disposable Vault 的聚合信息：始终为 5 个文件、总计 5002 bytes、最小 865 bytes、最大 1200 bytes。没有读取文件名、相对路径、正文、作者、source ID、URL 或媒体，也没有访问真实 Vault。该结果与复核页证据共同证明 resume 和 `tab_changed` 期间没有发生隐式写入。

独立完成审查 Dalton (`019f6d79-e33c-7301-9fe1-d1504adda2cc`) 按第 13.12 节逐项复核生产路由与 schema、最小 X 权限、候选/backfill/frontier/finalize、DB3/catalog/Vault identity、选择前 no-write、去重、取消/partial/reconcile、凭据与私有 API 禁令、完整门禁、CI 和真实 Chrome 证据，最终给出 `PASS`，P0/P1/P2 均为 0。首轮原定 1-3 条但误选 5 条的 disposable Vault QA 范围偏差已如实记录，不构成剩余阻塞。

最终 verdict：`GOAL 043 DONE/PASS / X LIMITED_GO BATCH-ONLY`。该结论证明受界批次可暂停、继续、复核、去重、取消并安全写入，不证明 X 提供稳定 feed end marker，也不宣称已经完整同步全部历史收藏。Goal 041/042/043 至此全部完成；微博仍为 `NO_GO`，Goal 044 不得自动进入生产实施。
