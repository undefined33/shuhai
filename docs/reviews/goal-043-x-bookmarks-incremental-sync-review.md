# Goal 043 合同与 G0 预审

> 日期：2026-07-13
>
> 范围：Goal 043 v1 合同、G0 精确工具链候选与命令/Chrome 边界
>
> 独立 reviewer：Huygens (`019f5af2-d64e-76b0-91c8-bd9982d801e6`)
>
> 初始合同结论：`PASS`；当前 G0 verdict：`FAIL/BLOCKED_BY_TOOLCHAIN_COMPAT`，pnpm 10 修复合同待独立复审

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
