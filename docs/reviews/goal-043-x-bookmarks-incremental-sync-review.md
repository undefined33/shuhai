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

| 包                     | 当前  | 候选   |
| ---------------------- | ----- | ------ |
| `vite`                 | 6.3.5 | 6.4.3  |
| `vitest`               | 3.1.4 | 3.2.6  |
| `@vitest/coverage-v8`  | 3.1.4 | 3.2.6  |
| `pnpm.overrides.vite`  | 无    | 6.4.3  |
| `@vitejs/plugin-react` | 4.4.1 | 不升级 |

候选用于修复 `GHSA-5xrq-8626-4rwp`、`GHSA-p9ff-h696-f583` 和 `GHSA-fx2h-pf6j-xcff`。当前基线完整 audit 为 low 3 / moderate 4 / high 2 / critical 1，production audit 为 0；当前 lock SHA-256 为 `E9B4B644828795CE11C70BEB3F8BDBF21460AC2D960133FB7FC4CCC4F9D2869F`。

这些只是候选版本证据。只有生成并检查新 lock、运行 audit/coverage/完整质量门禁且没有新 supply-chain 问题后，G0 才能通过。

## 4. 未完成门禁

- 尚未修改 package manifests 或 lockfile，也未安装候选依赖。
- 尚未运行候选 audit、lint、typecheck、test、coverage 或 build。
- 本机当前为 Node 24.14.1；最终 PR/CI 仍需 Node 20 lane 证据。
- 尚未实现 043A，未运行 fixture browser E2E，未访问真实 X 或 Vault。
- 043B 仍需 Goal v2 的精确入口文件、message/sender/tab/host/job 绑定和真实 Chrome QA 合同。

## 5. 只读证据

审查只使用 `Get-Content`、`rg`、`git status/diff`、官方 npm registry metadata 和 audit 查询。没有格式化业务代码、安装依赖、下载浏览器、启动监听服务、访问真实账号/Vault、操作 Docker/端口、stage、commit 或 push。
