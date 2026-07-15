# ShuHai 项目状态

> 最后更新：2026-07-15
> 状态：Goal 041/042 与 Goal 043A 已通过；Goal 043B 第二次真实 X probe 在 `0/10` 暴露 DOM 预算误计数，第二版修复候选已通过本地门禁与独立复审，等待提交和 Node 20 CI
> 当前有效路线：[产品路线图 v4](./product-roadmap-v4.md)

## 1. 当前唯一事实入口

后续任何会话必须按顺序读取：

1. 当前用户明确指令。
2. 根目录 [`AGENTS.md`](../AGENTS.md)。
3. 本文件。
4. [`product-roadmap-v4.md`](./product-roadmap-v4.md)。
5. [`goals/README.md`](./goals/README.md)。
6. 若存在，唯一 `READY`/`IN_PROGRESS` Goal 及其引用资料。

当前唯一生产实施 Goal 是 043B，正式状态仍为 `IN_PROGRESS`。离线代码、preloaded-extension route integration、独立 profile 人工 toolbar E2E、固定 ID 和既有 Node 20 CI 均已通过。首次真实 10-candidate no-Vault probe 因无效经典 content script 在读取前以 `tab_changed` 暂停；修复提交 `c9ab16f` 与 Node 20 CI 已通过。用户重载后第二次 probe 已越过构建门禁，但 `safeQueryAll` 的生产 TreeWalker 把 X 的所有布局元素错误计入 200 个内容观察节点，任务以 `structure_changed` 保持 `0/10` 并停止，没有写入 Vault。严格只读聚合诊断只记录 exact page、容器/selector 布尔值和数量：当前 viewport 有 8 张 card、`primaryColumn` 共有 1,549 个布局元素；按“只计实际匹配和读取节点”的候选口径预计 103/200。首版候选把布局限制按 selector 查询重置且会静默截断第 5 个 permalink，独立 reviewer 因此给出 `FAIL`。第二版候选保留 200 内容观察上限，改为整次读取共享 10,000 布局遍历上限，并用 sentinel 显式拒绝超量匹配；本地 lint、typecheck、449 项 test/coverage、extension build、产物语法、Prettier、audit 和 lock 检查已通过，最终独立 actual-diff review 为 `PASS`（P0/P1/P2 均为 0），现等待追加提交和新 Node 20 CI。此前不得继续真实扫描。该授权不包含其它标签、整个 profile、其它站点或真实 Vault。v1-v3、Goal 002-040 和旧 spec 全部保留用于复盘，但不能自动恢复实施。

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

Goal 042 与 043A 已独立通过但尚未接入生产路由的基础模块：

- runtime SocialItem/SyncJob/record/intent schema 与版本化 `shuhai-sync` IndexedDB。
- SyncCatalog、checkpoint、崩溃恢复、跨会话 `source + sourceItemId` 去重。
- 安全 Markdown、受限 Vault 索引重建、逐文件结果与默认不覆盖 writer。
- X fixture adapter、顶部重扫 coordinator、持久化 review revision、typed stop reason 和固定预算。

尚未完成或验证：

- X 收藏页生产接线和真实 toolbar/`activeTab`/Side Panel preflight 用户旅程已通过；首次真实扫描在 DOM 读取前暴露并修复 content script 构建缺陷，真实 selector、滚动和 stop code 证据仍未通过。
- 微博收藏页仍只有 `NO_GO` 研究结论，没有生产枚举。
- disposable Vault 的 1-3 条人工写入结果，以及真正独立的 Popup、Side Panel、Options 构建和按需状态加载。

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
|    3 | Goal 043 | `IN_PROGRESS`             | 共享 DOM 预算 review PASS；等待 CI       |
|    4 | Goal 044 | `PLANNED`                 | 微博收藏增量同步 MVP                     |
|    5 | Goal 045 | `PLANNED`                 | 书签整理流程收缩及 Goal 032 安全收口     |
|    6 | Goal 046 | `PLANNED`                 | 极简界面、E2E 和两周 dogfood             |
|    7 | Goal 047 | `RESEARCH_GATE`           | 根据真实使用决定下一平台                 |

用户已确认 v4；041/042 已完成，043B 是当前唯一实施 Goal。043B 离线代码、自动 route integration、独立项目 Chrome profile 的人工 toolbar E2E、固定 unpacked extension ID 和 content 构建修复已通过；用户重载后的第二次真实 probe 又暴露 DOM 预算误计数。当前第二版候选保持 selector 与 200 内容节点上限不变，将未读取的布局遍历限制为整次读取共享 10,000，并对超过调用方匹配上限的 sentinel fail closed；等待最终独立 review/CI 后才能再次重载复测。真实 selector、平台 stop code 和 Vault 仍是不可代理的后续门禁。032-040 的旧队列继续停止自动编排；其中有价值的安全工作只通过新 Goal 显式继承。

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

1. content script 独立经典脚本修复 `c9ab16f` 与 Node 20 CI 已通过；用户重载后的第二次 probe 在 `0/10`、无 Vault 写入时以 `structure_changed` 停止。
2. 只读聚合诊断确认真实 selector 存在，误报来自生产 TreeWalker 把 1,549 个无关布局元素计入 200 内容节点预算；没有记录标题、正文、作者、ID、URL、媒体或 DOM snapshot。
3. 首版 5,000-per-query 候选被独立 review 否决；第二版使用整次读取共享 10,000 布局遍历上限、原 200 内容观察上限和超量匹配 sentinel。449 项 test/coverage、完整本地门禁与最终独立 review 已通过，必须追加提交、普通 push 并取得新 Node 20 CI。
4. 上述门禁通过后才通知用户重载固定 ID `jdjmpeogiojjhdabdjmpeclcbjcekbje`。再次点击 `继续扫描` 会写入扩展本地 SyncJob/candidate 数据，必须按用户最新要求在动作前单独确认；仍沿用 `incremental + maxCandidates=10 + maxScrollActions=5` no-Vault 边界。
5. no-Vault probe 通过后再由用户手动授权 worktree 内的新 disposable Vault，首次只写 1-3 条；不得使用真实 Obsidian Vault。
6. 真实 Chrome 只使用本机已安装浏览器；不得枚举、读取、切换、刷新或关闭其它标签，不读取密码、验证码、Cookie、localStorage/sessionStorage token、Authorization 或整个 profile，也不得下载浏览器或干扰其它 Chrome 进程。

## 10. 当前文档

- [产品路线图 v4](./product-roadmap-v4.md)
- [扩展架构 v4](./architecture/extension-v4.md)
- [社交收藏增量同步调研](./research/2026-07-13-social-favorites-sync-feasibility.md)
- [Goal 041 执行合同](./goals/goal-041-social-sync-feasibility-spike.md)
- [Goal 状态索引](./goals/README.md)
- [产品路线图 v3（历史）](./product-roadmap-v3.md)
- [全方位审计（历史决策依据）](./audits/2026-07-12-comprehensive-product-security-ui-audit.md)
