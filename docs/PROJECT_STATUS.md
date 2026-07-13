# ShuHai 项目状态

> 最后更新：2026-07-14
> 状态：Goal 041/042 与 Goal 043A fixture-only 候选已通过；Goal 043 等待真实 X 证据
> 当前有效路线：[产品路线图 v4](./product-roadmap-v4.md)

## 1. 当前唯一事实入口

后续任何会话必须按顺序读取：

1. 当前用户明确指令。
2. 根目录 [`AGENTS.md`](../AGENTS.md)。
3. 本文件。
4. [`product-roadmap-v4.md`](./product-roadmap-v4.md)。
5. [`goals/README.md`](./goals/README.md)。
6. 若存在，唯一 `READY`/`IN_PROGRESS` Goal 及其引用资料。

当前没有可继续实施的生产 Goal。Goal 042 已 `DONE/PASS`；Goal 043 G0 与 043A fixture-only 候选均已 `PASS`。043A 最终修复关闭了 invocation deadline 的迟到事务竞态、adapter 节点低报和 fixture 网络证据夸大问题；335 项测试、完整门禁、依赖审计、全新离线 Chrome fixture E2E 和独立 actual-diff review 均通过。它没有访问真实 X、真实 Vault 或用户 profile，也没有修改 manifest、service worker、content script 或 UI。整个 Goal 043 继续保持 `BLOCKED_BY_REAL_X_EVIDENCE`，当前只允许起草并复审 043B v2 合同。v1-v3、Goal 002-040 和旧 spec 全部保留用于复盘，但不能自动恢复实施。

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

尚未实现：

- X/微博收藏页的生产枚举和真实页面证据。
- X adapter 与上述同步底座的 manifest/content/background/UI 接线。
- 真正独立的 Popup、Side Panel、Options 构建和按需状态加载。

## 5. 冻结中的 Goal 032

当前分支为 `feat/transactional-bookmark-operations`，存在未提交的 Goal 032 候选实现以及同时进行的文档改动。

- Goal 032 状态是 `PAUSED_BY_PRODUCT_RESET`，不是完成或验收通过。
- 不得 reset、revert、checkout 或覆盖这些改动。
- Goal 032 的 operation journal 思想仍符合 v4 的书签安全要求。
- 未来 Goal 045 必须基于实际 diff 和独立 QA 决定保留、修复或拆分，不能只看实现者自述。

## 6. 新路线队列

| 顺序 | Goal     | 状态                         | 目的                                     |
| ---: | -------- | ---------------------------- | ---------------------------------------- |
|    0 | Goal 032 | `PAUSED_BY_PRODUCT_RESET`    | 保留书签 operation journal 候选实现      |
|    1 | Goal 041 | `DONE`                       | X LIMITED_GO、微博 NO_GO                 |
|    2 | Goal 042 | `DONE`                       | SyncJob、catalog、schema、Vault 安全基础 |
|    3 | Goal 043 | `BLOCKED_BY_REAL_X_EVIDENCE` | 043A PASS；043B v2 合同尚未起草          |
|    4 | Goal 044 | `PLANNED`                    | 微博收藏增量同步 MVP                     |
|    5 | Goal 045 | `PLANNED`                    | 书签整理流程收缩及 Goal 032 安全收口     |
|    6 | Goal 046 | `PLANNED`                    | 极简界面、E2E 和两周 dogfood             |
|    7 | Goal 047 | `RESEARCH_GATE`              | 根据真实使用决定下一平台                 |

用户已确认 v4 并授权连续完成 041-043。032-040 的旧队列仍停止自动编排；其中有价值的安全工作通过新 Goal 显式继承。

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

1. 基于实际入口代码起草 043B v2：精确 sender/tab/frame/host/job 绑定、权限差异、回滚、真实 Chrome QA 和文件 allowlist。
2. 对 v2 合同做独立只读复审；合同 `PASS` 前不得修改生产入口。
3. 用户醒来后在全新的项目隔离 Chrome profile 中手动登录测试 X 账号并确认扫描上限；agent 不读取密码、验证码、Cookie、localStorage token 或 Authorization。
4. 真实 Chrome 仍只使用本机已安装浏览器，禁止自行下载浏览器、读取日常 profile 或干扰其它 Chrome 进程。

## 10. 当前文档

- [产品路线图 v4](./product-roadmap-v4.md)
- [扩展架构 v4](./architecture/extension-v4.md)
- [社交收藏增量同步调研](./research/2026-07-13-social-favorites-sync-feasibility.md)
- [Goal 041 执行合同](./goals/goal-041-social-sync-feasibility-spike.md)
- [Goal 状态索引](./goals/README.md)
- [产品路线图 v3（历史）](./product-roadmap-v3.md)
- [全方位审计（历史决策依据）](./audits/2026-07-12-comprehensive-product-security-ui-audit.md)
