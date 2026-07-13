# Goal 043 合同与 G0 预审

> 日期：2026-07-13
>
> 范围：Goal 043 v1 合同、G0 精确工具链候选与命令/Chrome 边界
>
> 独立 reviewer：Huygens (`019f5af2-d64e-76b0-91c8-bd9982d801e6`)
>
> 最终结论：`PASS`，合同可转 `READY`；G0 尚未实施，不代表工具链已通过

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
