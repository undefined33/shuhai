# Goal 042 持久化同步与 Vault 安全基础 Review

> 状态：`ACCEPTED / PASS`
> 当前门禁：Goal 042 已收口；Goal 043 仍需独立合同、工具链门禁和真实 Chrome 分阶段证据
> Reviewer：独立 Product/Security reviewer（Carver）

## 1. Audit 门禁决策

Goal 042 v1 在完整 `pnpm audit` 发现既有 dev toolchain 的 high/critical advisory 后正确触发 STOP。对未新增三项依赖的基线 checkout 与候选 checkout 使用同一官方 registry 复核后，两边结果一致；候选 `pnpm audit --prod` 为 0。

独立 reviewer 结论为：允许在 Goal 042 v2 的窄基线例外下继续，但不得把既有漏洞描述为已解决，也不得启动任何 Vite/Vitest 监听服务。若最终 audit 出现新增 advisory、severity 恶化、进入 production path 或依赖闭包变化，立即停止。

## 2. 新增依赖证据

| 包               | 版本    | 许可证     | 官方 integrity                                                                                    | install/postinstall    |
| ---------------- | ------- | ---------- | ------------------------------------------------------------------------------------------------- | ---------------------- |
| `zod`            | `4.4.3` | MIT        | `sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==` | 无                     |
| `idb`            | `8.0.3` | ISC        | `sha512-LtwtVyVYO5BqRvcsKuB2iUMnHwPVByPCXFXOpuU96IZPPoPN6xjOGxZQ74pgSVVLQWtUOYgyeL4GE98BY5D3wg==` | 无                     |
| `fake-indexeddb` | `6.2.5` | Apache-2.0 | `sha512-CGnyrvbhPlWYMngksqrSSUT1BAVP49dZocrHuK0SvtR0D5TMs5wP0o3j7jexDJW01KSadjBp1M/71o/KR3nD1w==` | 无；包内开发脚本不执行 |

安装命令使用了 `--ignore-scripts`。机器全局 pnpm registry 原本指向淘宝镜像，第一次解析因此不符合合同指定来源；该过程偏差不隐藏。随后已用命令级 `--registry=https://registry.npmjs.org/` 逐包核对官方 metadata、tarball 与 integrity，并把三个新增 lock 节点固定到官方 tarball；未修改全局配置。

### 2.1 机器可读 audit 摘要

两次审计均使用 pnpm `11.3.0`、`https://registry.npmjs.org/` 和同一审查窗口。advisory ID、severity、package、affected range 与 dependency path 完全一致；候选只增加三个预期依赖，总依赖数从 437 变为 440。

```json
{
  "baseline": {
    "lockfileSha256": "6C0A2C2063D98DB0939DBD850B76D460D756B9CA92D8A1A4C8E26050025CCBDE",
    "totalDependencies": 437,
    "counts": { "low": 3, "moderate": 4, "high": 2, "critical": 1 }
  },
  "candidate": {
    "lockfileSha256": "E9B4B644828795CE11C70BEB3F8BDBF21460AC2D960133FB7FC4CCC4F9D2869F",
    "totalDependencies": 440,
    "counts": { "low": 3, "moderate": 4, "high": 2, "critical": 1 },
    "productionCounts": { "low": 0, "moderate": 0, "high": 0, "critical": 0 }
  },
  "advisoryIds": [
    "GHSA-4w7w-66w2-5vf9",
    "GHSA-5xrq-8626-4rwp",
    "GHSA-93m4-6634-74q7",
    "GHSA-fx2h-pf6j-xcff",
    "GHSA-g4jq-h2w9-997c",
    "GHSA-h67p-54hq-rp68",
    "GHSA-jqfw-vq24-v9c3",
    "GHSA-p9ff-h696-f583",
    "GHSA-v6wh-96g9-6wx3",
    "GHSA-xffm-g5w8-qvg7"
  ],
  "delta": { "newAdvisories": [], "severityChanges": [], "productionPathChanges": [] }
}
```

## 3. 既有 high/critical 债务

| Advisory              | 严重度   | 路径                          | 利用前提与当前缓解                                                                      | Owner / 修复门禁                                          |
| --------------------- | -------- | ----------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GHSA-5xrq-8626-4rwp` | critical | root Vitest / coverage Vitest | 需要 Vitest UI server 监听；Goal 042 只运行 `vitest run`，禁止 UI/API/browser server    | 工具链依赖治理；Goal 043 review 或任何监听服务前处理/复审 |
| `GHSA-p9ff-h696-f583` | high     | extension Vite dev server     | 需要 Vite dev server WebSocket；Goal 042 只运行 `vite build`，禁止 dev/preview/`--host` | 工具链依赖治理；Goal 043 review 或任何监听服务前处理/复审 |
| `GHSA-fx2h-pf6j-xcff` | high     | root/extension Vitest 与 Vite | 需要 Vite server 文件访问路径；Goal 042 不启动监听服务                                  | 工具链依赖治理；Goal 043 review 或任何监听服务前处理/复审 |

## 4. 候选验证证据

| 命令/检查                                                  | 最新结果                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| 六个 Goal 042 定向 suite                                   | 6 files、121 tests PASS                                            |
| `pnpm lint`                                                | shared、desktop、extension 全部 PASS                               |
| `pnpm typecheck`                                           | shared、desktop、extension 全部 PASS                               |
| `pnpm test`                                                | shared 1、desktop 25、extension 243，合计 269 tests PASS           |
| `pnpm --filter @shuhai/extension run build`                | PASS，1,899 modules transformed                                    |
| `pnpm audit --prod --registry=https://registry.npmjs.org/` | 0 known vulnerabilities                                            |
| 构建产物扫描 `fake-indexeddb\|FDBFactory\|IDBFactory`      | 0 matches                                                          |
| `git diff --check`                                         | 无 whitespace error；只有仓库既有 LF/CRLF checkout warning         |
| `pnpm-lock.yaml` SHA-256                                   | `E9B4B644828795CE11C70BEB3F8BDBF21460AC2D960133FB7FC4CCC4F9D2869F` |

定向测试覆盖 runtime schema、恶意 object/accessor/proxy、job 状态和事务、50 条 close 后/catalog 前崩溃恢复、安全 Markdown、10,000 records/index、Vault 权限/IO/别名/大小写/compatibility collision、内部并发与外部竞态边界。

独立 Product/Security reviewer 已检查最新实际 diff，并独立重跑 6 个定向 suites（121/121）、extension typecheck、目标 ESLint 与 `git diff --check`；最终 verdict 为 `PASS`。完整全仓门禁与构建/依赖证据由 Integrator 按上表复核通过。

## 5. Vault writer 原子性边界

浏览器 File System Access API 只提供 `getFileHandle({ create: true })` 与 writable stream 锁，没有 OS `O_EXCL` 等价的原子 create-if-absent。候选实现因此只承诺：

- 已可见的同名文件不写入；大小写/Unicode/entry kind 碰撞 fail closed。
- 同一 Vault 的 ShuHai 并发 writer 使用全局 mutex 串行，包括 alias handle；同级碰撞键统一执行 `NFKC -> uppercase -> NFC`。
- 每个新目标使用持久化 intent token 形成随机文件名；重启和错误重试复用同一路径。
- 创建后发现非空目标时 abort，不覆盖其内容。

仍然无法绝对区分外部不协作进程在 lookup 后创建的零字节文件，也无法消除最后一次检查后的外部修改窗口。测试明确固定这个限制，不把它伪装成已解决；若需要对任意本地进程提供原子排他保证，纯 Chrome Extension 架构必须重新评估。

独立 reviewer 多轮指出的大小写/compatibility sibling collision、祖先目录并发、`isSameEntry` 异常分支、error 加 pending intent 时禁止进入 partial，以及稳定重试路径，均已加入实现与定向测试并在最终轮确认关闭。
