# ShuHai 项目状态

> 最后更新：2026-07-16
> 状态：Goal 041/042 与 Goal 043A 已通过；Goal 043B 第二次 incremental 回归修复已提交且 CI 通过，等待用户重载和真实去重复测
> 当前有效路线：[产品路线图 v4](./product-roadmap-v4.md)

## 1. 当前唯一事实入口

后续任何会话必须按顺序读取：

1. 当前用户明确指令。
2. 根目录 [`AGENTS.md`](../AGENTS.md)。
3. 本文件。
4. [`product-roadmap-v4.md`](./product-roadmap-v4.md)。
5. [`goals/README.md`](./goals/README.md)。
6. 若存在，唯一 `READY`/`IN_PROGRESS` Goal 及其引用资料。

当前唯一生产实施 Goal 是 043B，正式状态仍为 `IN_PROGRESS`。用户在明确指定的日常 `https://x.com/i/bookmarks` 标签完成受界 `incremental + maxCandidates=10 + maxScrollActions=5` no-Vault probe；随后在用户单独授权的 worktree disposable Vault `.pnpm-store/goal-043/test-vault/real-20260715-10candidate` 首次写入 5 条，Side Panel 显示 `created=5`、`already_exists=0`、`skipped=0`，文件系统只读核对为 5 个非空文件、总计 5002 bytes、单文件 865-1200 bytes，未读取文件名或正文。第二次扫描暴露三项回归：终态返回旧总工作台、新 job 未经确认从 10/5 放大为 50/20，以及密集卡片触发 `structure_changed`。审计进一步确认密集卡片先耗尽共享内容预算，再因 coordinator 的精确键集合错误拒绝合法 `identityOnlySourceItemIds`；独立 review 还发现 identity-only catalog match 不得推进 authoritative known frontier。当前修复已固定新 job 为 10 candidates/5 scroll actions，终态返回 X 同步入口并等待新的 Popup-only intent；后续过密卡片只能在全局 200 内容节点内输出严格验证的 identity-only/`metadata_only`，可保守记为 existing，但会清零连续前沿，未知项可在后续完整读取时原位升级。第一条异常、伪造 hint、permalink 冲突与 10,000 layout traversal 越界继续 fail closed。最新全仓 lint、typecheck、41 files / 467 tests coverage、extension build、5 个 content script `node --check` 和 lock 检查均通过；第三轮独立 actual-diff review 为 `PASS`，P0/P1/P2 均为 0。修复提交 `058de72` 已普通 push 到 Draft PR #5，GitHub Actions run `29434729210` 已通过；证据收口提交 `924c43d` 对应 run `29435114312` / job `87419676710` 也已通过。用户重载和第二次去重复测仍待完成。现有 5 个测试文件不删除、不修改；授权不包含真实 Vault、其它标签、整个 profile 或其它站点。v1-v3、Goal 002-040 和旧 spec 全部保留用于复盘，但不能自动恢复实施。

## 2. 当前产品定义

ShuHai 是一个纯 Chrome Extension，只服务两个用户动作：

1. **整理 Chrome 书签**：分析分类、重复项和失效候选；用户复核后应用，结果可解释、可恢复。
2. **同步社交平台收藏**：用户在支持平台收藏页点击启动，增量比较本地目录，只把新增内容安全写入 Obsidian。

普通网页或单条帖子保存是同步能力的单项模式，不再独立扩张为通用剪藏产品。AI 是可选建议器，不是使用前提。

## 3. 界面边界

| 界面          | 职责             | 约束                                                             |
| ------------- | ---------------- | ---------------------------------------------------------------- |
| Toolbar Popup | 上下文单动作入口 | 收藏页同步、详情页单条保存、其它页面整理书签；每次只有一个主动作 |
| Side Panel    | 当前任务工作台   | 只展示一个书签或同步任务，长任务可暂停、继续和恢复               |
| Options Page  | 一次配置/维护    | Vault、平台权限、可选 AI；高级设置默认折叠                       |

当前实现仍让 Popup 和 Side Panel 共用大型 `App.tsx`，真正的 Options Page 也尚未独立。这是 v4 后续重构对象，不是已经完成的事实。

## 4. 当前代码事实

已实现但需要重新验收：

- Chrome 书签读取、分类建议、健康检测、批量操作和基础恢复。
- X/微博单条详情页 DOM 提取。
- 普通文章提取、待保存队列和 Markdown 生成。
- File System Access API Vault 目录授权和写入。
- AI Provider、规则、模板、活动、备份和诊断。

Goal 042 基础与 Goal 043 已通过当前门禁的模块：

- runtime SocialItem/SyncJob/record/intent schema 与版本化 `shuhai-sync` IndexedDB。
- SyncCatalog、checkpoint、崩溃恢复、跨会话 `source + sourceItemId` 去重。
- 安全 Markdown、受限 Vault 索引重建、逐文件结果与默认不覆盖 writer。
- X fixture adapter、顶部重扫 coordinator、持久化 review revision、typed stop reason 和固定预算。
- X 收藏页生产路由、固定 ID、受界 content script、Side Panel review 与真实 no-Vault 10-candidate batch。

尚未完成或验证：

- 微博收藏页仍只有 `NO_GO` 研究结论，没有生产枚举。
- 用户重载，以及仅对 5 个实际写入项的第二次 incremental 去重。
- 真正独立的 Popup、Side Panel、Options 构建和按需状态加载仍属于 Goal 046。

## 5. 冻结中的 Goal 032

`C:\Projects\ShuHai` 主工作区位于 `feat/transactional-bookmark-operations`，存在未提交的 Goal 032 候选实现；Goal 043 则在独立 `C:\Projects\ShuHai\.worktrees\social-sync-v4` worktree 中推进。不得把两个 worktree 的状态或写入范围混为一体。

- Goal 032 状态是 `PAUSED_BY_PRODUCT_RESET`，不是完成或验收通过。
- 不得 reset、revert、checkout 或覆盖这些改动。
- Goal 032 的 operation journal 思想仍符合 v4 的书签安全要求。
- 未来 Goal 045 必须基于实际 diff 和独立 QA 决定保留、修复或拆分，不能只看实现者自述。

## 6. 新路线队列

| 顺序 | Goal     | 状态                      | 目的                                     |
| ---: | -------- | ------------------------- | ---------------------------------------- |
|    0 | Goal 032 | `PAUSED_BY_PRODUCT_RESET` | 保留书签 operation journal 候选实现      |
|    1 | Goal 041 | `DONE`                    | X LIMITED_GO、微博 NO_GO                 |
|    2 | Goal 042 | `DONE`                    | SyncJob、catalog、schema、Vault 安全基础 |
|    3 | Goal 043 | `IN_PROGRESS`             | 首轮 5 条已写；修复后复测第二次去重      |
|    4 | Goal 044 | `PLANNED`                 | 微博收藏增量同步 MVP                     |
|    5 | Goal 045 | `PLANNED`                 | 书签整理流程收缩及 Goal 032 安全收口     |
|    6 | Goal 046 | `PLANNED`                 | 极简界面、E2E 和两周 dogfood             |
|    7 | Goal 047 | `RESEARCH_GATE`           | 根据真实使用决定下一平台                 |

用户已确认 v4；041/042 已完成，043B 是当前唯一实施 Goal。043B 离线代码、自动 route integration、独立项目 Chrome profile 的人工 toolbar E2E、固定 unpacked extension ID、content 构建、DOM 预算与虚拟列表前沿修复均已通过。用户执行的真实 X no-Vault probe 已稳定进入 10-candidate review，并正确区分 5 个 new/list-summary 与 5 个 incomplete/metadata-only；没有写 Vault，也没有夸大全量完成。真实 selector、受界滚动和 10-item batch 得到证据；disposable Vault 首轮逐项写入、回归修复和最终独立 actual-diff review 已通过。剩余不可代理门禁只有用户重载后的第二次 incremental 去重。032-040 的旧队列继续停止自动编排；其中有价值的安全工作只通过新 Goal 显式继承。

## 7. 平台判断

- X 有官方 Bookmarks API，但需要开发者 App、OAuth 并有可变成本；同时研究受约束的收藏页扫描。
- 微博官方个人收藏读取能力当前未验证，只允许先做官方能力核实和隔离 DOM spike。
- 小红书、知乎不进入第一批；每个平台必须单独得到 `GO`、`LIMITED_GO` 或 `NO_GO`。
- 不保存 Cookie、Authorization、站点 token、私有 GraphQL query id 或内置 bearer。

详见 [`research/2026-07-13-social-favorites-sync-feasibility.md`](./research/2026-07-13-social-favorites-sync-feasibility.md)。

## 8. 安全底线

- 页面 DOM、平台响应、书签、URL、AI、message、storage 和 Vault 文件均不可信。
- 社交扫描只由用户在当前支持平台收藏页主动启动；不后台监控浏览或抓取任意书签网页。
- 遇到 CAPTCHA、登录挑战、429、权限不足或结构变化立即暂停，不绕过。
- 远程媒体默认写成普通链接，不自动 embed 或下载。
- Markdown 必须中和 YAML、危险 URL、raw HTML、模板和 Obsidian 插件执行语法。
- 源平台取消收藏或删除内容不能自动删除本地笔记。
- AI 不参与同步执行；未经用户明确选择，不发送社交正文给 Provider。
- 书签删除、移动和 URL 更新必须确认、逐项记录、表达 partial 并可恢复。

## 9. 当前下一步

1. 用户已在固定 ID 与精确 X 收藏页完成受界 no-Vault probe；10 个候选进入 review，`new=5`、`incomplete=5`、`changed=0`、`error=0`，无 Vault 写入。
2. UI 只默认选择 5 个 new/list-summary，5 个 `metadata_only` 保持不可默认写入；当前批次没有被误报为全部收藏完成。
3. 第一轮 disposable Vault 因用户误保留全部选择而实际创建 5 个文件；Side Panel 与文件数量/大小一致，作为首次写入功能证据通过，同时记录 1-3 条 QA 范围偏差，不删除、不修改。
4. 预算/路由修复已经独立 review、提交并通过 CI；用户重载后，第二次 incremental 仍固定 `maxCandidates=10 + maxScrollActions=5`，必须把这 5 个已写项识别为 existing/skip，且测试 Vault 文件数保持 5；若出现新增写入、changed/incomplete 覆盖或错误则失败。
5. 真实 Chrome 只使用本机已安装浏览器；不得读取、切换、刷新或关闭其它标签，不读取密码、验证码、Cookie、localStorage/sessionStorage token、Authorization 或整个 profile，也不得下载浏览器或干扰其它 Chrome 进程。

## 10. 当前文档

- [产品路线图 v4](./product-roadmap-v4.md)
- [扩展架构 v4](./architecture/extension-v4.md)
- [社交收藏增量同步调研](./research/2026-07-13-social-favorites-sync-feasibility.md)
- [Goal 041 执行合同](./goals/goal-041-social-sync-feasibility-spike.md)
- [Goal 状态索引](./goals/README.md)
- [产品路线图 v3（历史）](./product-roadmap-v3.md)
- [全方位审计（历史决策依据）](./audits/2026-07-12-comprehensive-product-security-ui-audit.md)
