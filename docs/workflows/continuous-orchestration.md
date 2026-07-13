# 持续编排规则

## 1. 目标

自动编排意味着 Integrator 在已授权边界内持续完成“读事实 -> 选择 lane -> 派发/实施 -> 验证 -> 更新看板”，而不是让用户在 agent 之间搬运中间状态。它不意味着跳过 Goal、扩大权限或静默操作真实数据。

## 2. Goal 生命周期

```text
DRAFT -> READY -> IN_PROGRESS -> READY_FOR_REVIEW -> DONE
             \-> BLOCKED_BY_<reason>
任意未完成状态 -> PAUSED_BY_PRODUCT_RESET
任意未实施状态 -> SUPERSEDED
```

- `READY`：范围、文件、风险、测试和前置条件完整，允许开工。
- `IN_PROGRESS`：已从 `READY` 正式开工；同时最多一个实施 Goal。
- `READY_FOR_REVIEW`：实现者门禁通过，等待独立 review/QA。
- `DONE`：review、必要的真实用户旅程和文档收口完成。
- `BLOCKED_BY_*`：只阻塞该 lane，不自动把整个项目写成 blocked。
- `SUPERSEDED`：保留历史，但不得继续执行。
- `PAUSED_BY_PRODUCT_RESET`：保留代码、测试和文档，但停止 writer；恢复必须进入当前路线的新 Goal。

状态变化必须同时更新 Goal frontmatter 和 `docs/goals/README.md`。不得把“prompt 已写”写成“已派发”，不得把 `partial` 写成 `complete`。

## 3. 自动循环

每次收到用户继续指令、实现结果、测试结果、review 发现或外部状态变化时：

1. 重读 `git status --short --branch` 和动态看板。
2. 核对是否存在用户/其他 agent 改动，禁止覆盖或回滚。
3. 按顺序分类 lane：`active`、`ready_for_review`、`ready_to_start`、`blocked`、`research_gate`、`parked`、`done`。
4. 优先收口已完成实现的 review，不让半成品堆积。
5. 若没有 review，启动最高优先级且前置满足的唯一 `READY` Goal。
6. 在任务合同内实施、自测、修复并复跑。
7. 更新动态看板和验收证据，再决定下一 Goal 是否可以转 `READY`。

只有所有 lane 都缺少用户授权、外部状态或产品决策时，才报告项目等待。单个测试慢、实现困难或某条 lane 阻塞，不是停止其它安全工作的理由。

## 4. 大模块 owner

一个 Goal 默认由一个 owner 完成完整闭环：

```text
codefact -> implement -> unit/integration tests -> build -> manual journey -> handoff
```

只有以下情况才拆分：

- 写入文件集合不相交，且并行确实缩短关键路径。
- 需要独立安全审查、产品 QA 或供应链审查。
- 真实 Chrome/Vault 环境必须由独立角色控制。
- 上下文或任务规模已经影响可靠性。
- 前置 API/数据契约尚未存在，继续会迫使实现者猜接口。

共享文件同时只能有一个 writer。发现 allowlist 外问题只记录，不顺手修改。

## 5. 当前执行队列

当前队列的唯一真相在 `docs/goals/README.md`。当前没有可执行依赖链：

```text
Goal 032 paused
Goal 041 draft/research gate
Goal 042-047 planned
```

- 用户确认 v4 前，不把 Goal 041 转 `READY`。
- Goal 041 没有得到平台 `GO/LIMITED_GO` 前，不写生产社交同步代码。
- Goal 032 的候选实现只能由 Goal 045 显式接管，不能在旧 Goal 中自行恢复。
- 不插入视觉装饰、Provider 扩张、任意网页全文抓取、Electron 或 companion 工作。

## 6. 无动作时的处理

没有新触发且没有可执行 lane 时，不制造无意义文档 churn。看板写清：

- 阻塞原因。
- 已核实的事实。
- 精确恢复事件，例如“用户确认 v4 且 Goal 041 合同补齐后”。
- 下一条将启动的 Goal。

长任务通过当前任务状态更新说明“继续、测试中或具体阻塞”，但状态更新不替代 durable 看板。
