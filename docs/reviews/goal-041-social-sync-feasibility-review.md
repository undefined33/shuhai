# Goal 041 验收记录

> Goal：041 Social Favorites Sync Feasibility Spike  
> 分支：`codex/social-sync-v4`  
> 当前结论：`ACCEPTED / PASS`

## 用户结果

- X 官方 API：`GO`，但只有用户明确选择开发者账号、OAuth 和计费后才可实施。
- X 收藏页 DOM：`LIMITED_GO` 只授权离线 fixture 约束的候选实现；未经隔离真实页面 QA 不能宣称可用或绝对全量。
- 微博公开 API 与 DOM：`NO_GO`；没有官方能力或隔离真实页面证据前不进入生产。
- Goal 041 独立复审通过后可进入平台无关的 Goal 042；Goal 043 即使完成候选代码，仍需真实 X 页面证据才可产品验收。

## 实际变更

- `packages/extension/tests/fixtures/social-sync-spike.ts`
- `packages/extension/tests/social-sync-spike.test.ts`
- `packages/extension/e2e/social-sync-spike.spec.ts`
- Goal、状态、研究与本验收文档

没有修改生产 `src/`、manifest、依赖声明、lockfile、UI、service worker、Vault writer 或现有 adapter。

## QA Delta

```text
变更的用户行为: 无生产行为；只决定后续平台承诺
可能损坏的数据: 无真实数据写入
新增/改变的信任边界: 无；明确拒绝 Cookie/token/private GraphQL
新增单元测试: 34 个 fixture 场景
新增集成测试: 无生产集成
需要的 Chrome 旅程: Playwright 临时上下文中的虚拟列表节点回收
不在本 Goal 验证的风险: 真实 X/微博页面选择器、账号风控、真实 Vault
```

## 已运行证据

| 命令                                                                                         | 结果                           |
| -------------------------------------------------------------------------------------------- | ------------------------------ |
| `pnpm --filter @shuhai/extension exec vitest run tests/social-sync-spike.test.ts`            | 1 文件、34 测试通过            |
| `pnpm exec playwright test packages/extension/e2e/social-sync-spike.spec.ts --reporter=list` | 1 个隔离浏览器测试通过         |
| `pnpm lint`                                                                                  | 通过                           |
| `pnpm typecheck`                                                                             | 首次因根包缺少 `tsc` 失败      |
| 临时加入 `packages/extension/node_modules/.bin` 后再次执行 `pnpm typecheck`                  | 全包通过                       |
| `pnpm test`                                                                                  | 全包通过；extension 126 个测试 |
| `pnpm --filter @shuhai/extension run build`                                                  | 通过                           |

隔离 worktree 首次运行 pnpm 时按现有 lockfile 复用了本机 store 并安装了已锁定依赖；未新增或升级 package，lockfile 未变化。允许构建的 `esbuild` 执行了仓库已有 postinstall。该事实不能被写成“零安装副作用”。

这次安装虽然没有版本、lockfile 或网络下载变化，仍违反 Goal 041 对依赖安装副作用的禁止，记录为 `PROCESS_DEVIATION`。后续 Goal 必须在创建隔离 worktree 时先检查工具链可用性，并在合同允许后再执行安装；不能追溯修改合同把偏差伪装成合规。

## 待独立验收

- Reviewer round 1 为 `REWORK`：指出 DOM checkpoint、平台结论、预算、过程偏差、身份测试和 current 文档状态问题。
- Round 2/3 继续发现预算可放大、checkpoint JSON 字节、terminal 时钟和边界测试缺口；均在本 Goal 内修正。
- 当前实现为顶部重扫、JSON checkpoint、不可放大 ceiling、accepted-byte/页/项/真实时钟预算和 34 个单测；平台结论已收紧。
- 当前 diff 的隔离 E2E 已通过；其唯一 `test-results/.last-run.json` 已按核验绝对路径精确删除，空目录随后非递归删除。
- Reviewer round 4 最终结论为 `PASS`：terminal 单一时钟快照和 64 KiB checkpoint JSON guard 已关闭最后两项 finding。
- `PASS` 只接受本研究门禁，不等于真实 X DOM 已获产品验收；该证据仍属于 Goal 043 的发布门禁。

真实平台验证未执行，原因是本 Goal 明确禁止主账号与真实收藏。这个限制正是 X `LIMITED_GO` 和微博暂不生产化的依据，不得在后续文档中消失。
