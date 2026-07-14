# ShuHai 项目状态

> 最后更新：2026-07-14
> 状态：Goal 041/042 与 Goal 043A 已通过；Goal 043B 离线代码、route integration 和 Node 20 CI 已通过，等待人工 toolbar E2E
> 当前有效路线：[产品路线图 v4](./product-roadmap-v4.md)

## 1. 当前唯一事实入口

后续任何会话必须按顺序读取：

1. 当前用户明确指令。
2. 根目录 [`AGENTS.md`](../AGENTS.md)。
3. 本文件。
4. [`product-roadmap-v4.md`](./product-roadmap-v4.md)。
5. [`goals/README.md`](./goals/README.md)。
6. 若存在，唯一 `READY`/`IN_PROGRESS` Goal 及其引用资料。

当前唯一生产实施 Goal 是 043B，正式状态仍为 `IN_PROGRESS`。最新候选提交 `97f1a08` 已通过 427 项测试、coverage、build、完整本地门禁、最终 actual-diff review、preloaded-extension route integration 和 GitHub Node 20 CI run `29332332585`。route integration 只验证当前 `dist` service worker hash、离线路由、无 X 权限时零 job/零注入和 Popup 上下文展示；它明确 mock 了 active-tab UI 边界，不能冒充真实 toolbar user gesture、`activeTab` 或 runtime sender。当前只允许完成独立 Chrome profile 中的人工 toolbar E2E。Goal 042 已 `DONE/PASS`；Goal 043 G0 与 043A fixture-only 候选均已 `PASS`。隔离测试账号无法登录后，用户已明确允许日常 Chrome 的单个 X 收藏页标签作为真实 QA 例外，并要求限制 X 并发；项目据此固定 10 candidates、最多 5 次滚动、单 tab/job/invocation/outstanding request、批次至少 2 秒和 429/challenge 零自动重试。真实 X 与 disposable Vault 仍位于人工 toolbar E2E 之后；该授权不包含其它标签、整个 profile、其它站点或真实 Vault。v1-v3、Goal 002-040 和旧 spec 全部保留用于复盘，但不能自动恢复实施。

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

- X 收藏页生产接线已存在，但真实 toolbar/`activeTab`/sender 用户旅程和真实页面 selector 证据尚未通过。
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
|    3 | Goal 043 | `IN_PROGRESS`             | route integration PASS；等待 toolbar E2E |
|    4 | Goal 044 | `PLANNED`                 | 微博收藏增量同步 MVP                     |
|    5 | Goal 045 | `PLANNED`                 | 书签整理流程收缩及 Goal 032 安全收口     |
|    6 | Goal 046 | `PLANNED`                 | 极简界面、E2E 和两周 dogfood             |
|    7 | Goal 047 | `RESEARCH_GATE`           | 根据真实使用决定下一平台                 |

用户已确认 v4；041/042 已完成，043B 是当前唯一实施 Goal。043B 离线代码、自动 route integration 与 CI 已通过，当前等待独立项目 Chrome profile 的人工 toolbar E2E；真实页面读取、probe 和 Vault 仍是不可代理的后续门禁。032-040 的旧队列继续停止自动编排；其中有价值的安全工作只通过新 Goal 显式继承。

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

1. 043B 最新候选 `97f1a08`、427 项测试、完整质量门禁、独立 actual-diff review、preloaded-extension route integration 和 Node 20 CI run `29332332585` 已通过；正式状态仍为 `IN_PROGRESS`。
2. 用户已在独立项目 Chrome profile 中手动加载 `packages/extension/dist`；下一步只完成第 13.11 节真实 toolbar 点击、Popup 单动作、Side Panel exact X permission preflight 和无权限零 job 人工证据。不得用 route mock 替代，也不得以 Chrome 控制暂不可用为理由下载浏览器、CRX、手工删除插件缓存或改动 Chrome 配置。
3. 用户方便重启 Codex 并恢复 Chrome 控制后，只新建或绑定日常 Chrome 中的单个 `https://x.com/i/bookmarks` 标签；不得枚举、读取、切换、刷新或关闭其它标签，也不得读取密码、验证码、Cookie、localStorage/sessionStorage token、Authorization 或整个 profile。
4. 首次 probe 固定为 `incremental + maxCandidates=10 + maxScrollActions=5`、单 tab/job/invocation/outstanding request、滚动完成到下一批请求至少 2 秒、不写 Vault；遇 CAPTCHA、429、账号限制或 selector 不确定立即停止且不自动重试。
5. no-Vault probe 通过后再由用户手动授权 worktree 内的新 disposable Vault，首次只写 1-3 条；不得使用真实 Obsidian Vault。
6. 真实 Chrome 只使用本机已安装浏览器；禁止自行下载浏览器、干扰其它 Chrome 进程或把单标签授权扩大到日常 profile。

## 10. 当前文档

- [产品路线图 v4](./product-roadmap-v4.md)
- [扩展架构 v4](./architecture/extension-v4.md)
- [社交收藏增量同步调研](./research/2026-07-13-social-favorites-sync-feasibility.md)
- [Goal 041 执行合同](./goals/goal-041-social-sync-feasibility-spike.md)
- [Goal 状态索引](./goals/README.md)
- [产品路线图 v3（历史）](./product-roadmap-v3.md)
- [全方位审计（历史决策依据）](./audits/2026-07-12-comprehensive-product-security-ui-audit.md)
