# ShuHai Workflow

> 最后更新：2026-07-15
> 适用范围：ShuHai 的规划、实施、审查、QA、提交与状态维护。

## 1. 为什么有这套流程

本流程吸收三个本地项目中已经被实践验证的部分，再按 ShuHai 的单仓库 Chrome Extension 规模做减法：

| 来源       | 吸收的做法                                             | 不照搬的内容                             |
| ---------- | ------------------------------------------------------ | ---------------------------------------- |
| BestTrader | spec 驱动、精确任务合同、QA Delta、实现与验收分离      | 与交易运行时、独立部署环境绑定的重型门禁 |
| DarkMesh   | 持续编排、风险分级、大模块 owner、partial/blocked 真话 | WAF、R86S、租户与外部实验室专用流程      |
| TextMMORPG | 稳定规则与动态看板分离、真实用户旅程、历史归档与防漂移 | 内容批次、素材生产和多人剧情资产专用流程 |

目标不是增加文档数量，而是避免三类浪费：靠聊天记状态、把一个闭环拆成许多半成品、把“测试通过”误写成“用户能用”。

## 2. 事实来源

事实优先级由根目录 `AGENTS.md` 定义。各文档只承担一种职责：

- `AGENTS.md`：稳定且强制的产品、安全、Git 和质量规则。
- `docs/PROJECT_STATUS.md`：当前产品边界、当前阶段和优先级。
- `docs/product-roadmap-v4.md`：当前路线与非目标；旧版本保留用于复盘。
- `docs/goals/README.md`：唯一动态编排看板。
- `docs/goals/goal-*.md`：一个大模块的可执行合同。
- `docs/workflows/*.md`：长期执行方法，不记录瞬时项目状态。
- `docs/reviews/*.md`：需要长期保留的验收证据；普通命令输出不单独制造报告。

同一事实不得在多个 current 文档中维护不同副本。历史 Goal 即使写着 `READY`，也不能覆盖当前看板。

## 3. 当前编排模型

ShuHai 使用“大模块 owner + 独立验收”模式：

1. Product/Architect 把用户问题、非目标、文件边界、风险和验收写入 Goal。
2. Integrator 维护看板、派发、检查实际 diff 和证据，并决定下一条可执行 lane。
3. Implementer 在精确 allowlist 内完成一个端到端模块，自测、小修和复跑不拆成新 Goal。
4. Reviewer 检查行为回归、数据完整性、安全边界和缺失测试。
5. QA 从用户入口重新走真实旅程，不接受实现者自述代替证据。

同一 agent 可以承担多个角色，但它自己的测试只能证明 `CANDIDATE`，不能冒充独立产品验收。

## 4. 文档入口

- [持续编排](./continuous-orchestration.md)
- [任务合同](./task-contract.md)
- [命令与环境安全](./command-safety.md)
- [危险命令硬禁止清单](./dangerous-command-denylist.md)
- [验证与验收](./verification-and-acceptance.md)

## 5. 当前大模块

| 顺序 | 模块                                | Goal    | 当前状态                                            |
| ---: | ----------------------------------- | ------- | --------------------------------------------------- |
|    0 | 书签 operation journal 候选实现     | 032     | `PAUSED_BY_PRODUCT_RESET`，保留 diff，等待 045 审计 |
|    1 | X/微博收藏同步可行性                | 041     | `DONE/PASS`                                         |
|    2 | 同步、catalog、Vault 与 schema 基础 | 042     | `DONE/PASS`                                         |
|    3 | X 与微博增量同步                    | 043/044 | 043B `IN_PROGRESS_REPAIR_RETEST`，044 `PLANNED`     |
|    4 | 书签整理安全收口                    | 045     | `PLANNED`，复用前独立 review Goal 032               |
|    5 | 极简界面和两周 dogfood              | 046     | `PLANNED`                                           |

Goal 043B 是当前唯一生产实施 writer，状态为 `IN_PROGRESS_REPAIR_RETEST`。真实 no-Vault 10-candidate probe 与首次 disposable Vault 5 文件写入功能已经通过并记录范围偏差；第二次 incremental 暴露终态返回旧工作台、新 job 静默放大为 50 条、共享内容预算与可选 identity-only hint 解析反复误报结构变化。离线修复候选保持 Popup-only intent、10 candidates/5 scroll、单 tab/job/invocation/request、2 秒批次间隔、200 内容节点和 10,000 layout traversal 边界；后续过密卡片只能降级为严格 `metadata_only`，catalog match 不推进 authoritative frontier。当前必须先完成独立 review、提交/CI、重载，再验证 5 个已写项 existing/skip 且测试 Vault 文件数保持 5；禁止删除首轮文件、使用真实 Vault、读取其它标签或扩大日常 profile 授权。未来模块会共享 message、IndexedDB、Vault writer 和界面状态，因此不允许多个 writer 同时实施；平台只读研究、独立安全 review 和 fixture 设计可以并行。
