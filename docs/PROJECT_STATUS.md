# ShuHai 项目状态

> 最后更新：2026-07-17
> 状态：前三个 v4 大模块 Goal 041/042/043 均已 `DONE/PASS`；当前没有 `READY` 或 `IN_PROGRESS` 生产 Goal
> 当前有效路线：[产品路线图 v4](./product-roadmap-v4.md)

## 1. 当前唯一事实入口

后续任何会话必须按顺序读取：

1. 当前用户明确指令。
2. 根目录 [`AGENTS.md`](../AGENTS.md)。
3. 本文件。
4. [`product-roadmap-v4.md`](./product-roadmap-v4.md)。
5. [`goals/README.md`](./goals/README.md)。
6. 若存在，唯一 `READY`/`IN_PROGRESS` Goal 及其引用资料。

Goal 043 已完成最终真实 Chrome 门禁。用户在唯一获准的日常 `https://x.com/i/bookmarks` 标签启动新的受界 no-Vault 任务并于 `5/10` 候选、3 条 catalog-existing observations 时暂停；继续后至少完成一批处理，existing observations 增至 6。用户随后只在同一标签离开收藏页，Side Panel 以 `tab_changed` 显示“收藏页已切换”并保持暂停，没有读取新页面；用户最终取消任务。全程未触碰其它标签、Cookie、token、私有 API、真实 Vault 或平台收藏数据。worktree disposable Vault 在前后核对中始终为 5 个文件、总计 5002 bytes、单文件 865-1200 bytes，没有新增写入。独立完成审查 Dalton (`019f6d79-e33c-7301-9fe1-d1504adda2cc`) 给出 `PASS`，P0/P1/P2 均为 0，因此 Goal 041/042/043 正式完成。X 结论仍严格限定为 `LIMITED_GO/batch-only`：没有稳定 feed end marker，不能宣称同步全部历史收藏。Goal 044 仍为 `PLANNED`，且微博当前为 `NO_GO`，不得自动进入生产实施。disposable 测试 Vault 内现有 5 个文件不删除、不修改；v1-v3、Goal 002-040 和旧 spec 全部保留用于复盘，但不能自动恢复实施。

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
|    3 | Goal 043 | `DONE`                    | X 增量同步 MVP；`LIMITED_GO/batch-only`  |
|    4 | Goal 044 | `PLANNED`                 | 微博收藏增量同步 MVP                     |
|    5 | Goal 045 | `PLANNED`                 | 书签整理流程收缩及 Goal 032 安全收口     |
|    6 | Goal 046 | `PLANNED`                 | 极简界面、E2E 和两周 dogfood             |
|    7 | Goal 047 | `RESEARCH_GATE`           | 根据真实使用决定下一平台                 |

用户已确认 v4；041/042/043 均已完成并独立验收。043B 的离线代码、生产接线、固定扩展 ID、受界真实 X 扫描、复核、disposable Vault 逐项写入、catalog 去重、pause/resume、同标签 `tab_changed`、取消和 no-write 均有证据。首轮原定只写 1-3 条但实际误选 5 条的 QA 范围偏差已保留，不据此扩大授权。当前没有生产 writer，也没有可自动开工的 `READY` Goal；Goal 044 必须先处理微博 `NO_GO` 研究门禁，不能因为前三个模块完成就直接实施。032-040 的旧队列继续停止自动编排；其中有价值的安全工作只通过新 Goal 显式继承。

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

## 9. 当前收口与后续门禁

1. 用户已在固定 ID 与精确 X 收藏页完成受界 no-Vault probe；10 个候选进入 review，`new=5`、`incomplete=5`、`changed=0`、`error=0`，无 Vault 写入。
2. UI 只默认选择 5 个 new/list-summary，5 个 `metadata_only` 保持不可默认写入；当前批次没有被误报为全部收藏完成。
3. 第一轮 disposable Vault 因用户误保留全部选择而实际创建 5 个文件；Side Panel 与文件数量/大小一致，作为首次写入功能证据通过，同时记录 1-3 条 QA 范围偏差，不删除、不修改。
4. 修复版第二次 incremental 已固定 `maxCandidates=10 + maxScrollActions=5`，在 `6/10` 候选与 7 条 existing observations 时因安全预算暂停；复核页确认 7 条 existing 未进入可写候选、5 条 incomplete 未选、只有 1 条 new 默认选中，测试 Vault 仍保持 5 个文件且大小不变，没有再次保存。
5. 最终真实门禁已通过：任务在 `5/10` 暂停，继续后 existing observations 从 3 增至 6；同一标签切离 `/i/bookmarks` 后以 `tab_changed` 暂停，随后由用户取消，Vault 聚合保持不变。
6. 前三个大模块已经收口。下一次实施只能从新的 `READY` Goal 开始；Goal 044 在微博 `NO_GO` 结论被独立研究门禁改变前不得接生产枚举，Goal 045/046 也不会自动开工。

## 10. 当前文档

- [产品路线图 v4](./product-roadmap-v4.md)
- [扩展架构 v4](./architecture/extension-v4.md)
- [社交收藏增量同步调研](./research/2026-07-13-social-favorites-sync-feasibility.md)
- [Goal 041 执行合同](./goals/goal-041-social-sync-feasibility-spike.md)
- [Goal 状态索引](./goals/README.md)
- [产品路线图 v3（历史）](./product-roadmap-v3.md)
- [全方位审计（历史决策依据）](./audits/2026-07-12-comprehensive-product-security-ui-audit.md)
