# ShuHai 项目状态

> 最后更新：2026-07-24
> 状态：Goal 041/042/043/045A/045B/045C/046A/046B 均已 `DONE/PASS`；Goal 046C 仍为 `PLANNED`，等待独立合同门禁
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

用户于 2026-07-17 授权进入自动编排并优先修复审计确认的 P0/P1。实施从干净的 `573512c` v4 基线创建 `codex/p0-p1-security-hardening` 和独立 `security-hardening-v4` worktree；主工作区 Goal 032 候选 diff 只读审计，不覆盖、不 reset、不直接合并。[Goal 045A](./goals/goal-045a-bookmark-mutation-safety.md) 已在 mock 环境完成删除、URL 更新和分类移动 journal，566 项测试与扩展 build 通过，独立 review 为 `PASS` 且 P0/P1/P2 均为 0；没有操作真实 Chrome、X、Vault 或用户书签。[Goal 045B](./goals/goal-045b-extension-trust-boundary.md) 已停用任意 URL 网络体检、撤销 broad host permission、移除静态平台注入，并收紧 message、Port、storage 和历史健康结果的 fail-closed 边界；Goal 定向测试 303/303、全仓测试 702/702 与完整门禁通过，Carver (`019f729b-c43c-7301-afcc-792b82910307`) 独立复审为 `PASS`，P0/P1/P2 均为 0。[Goal 045C](./goals/goal-045c-content-save-ai-privacy.md) 已将 X 单条保存并入现有 SyncStore/catalog/Vault 管线，退役旧通用剪藏生产入口，并完成 AI 固定官方端点、最小披露、secret 隔离、严格响应预算与权限撤销收口；最终 shared 1/1、desktop 25/25、extension 765/765，完整门禁通过。安全 Reviewer (`019f7600-e34b-7d50-ac44-3ab75a26e074`) 与行为/完成度 Reviewer (`019f7601-f85c-7c32-8f6d-36cc1928520f`) 均独立 `PASS`，P0/P1/P2 为 0。三项实施全程没有操作真实 Chrome、X、Vault、网络、外部 Provider 或用户书签。

## 2. 当前产品定义

ShuHai 是一个纯 Chrome Extension，只服务两个用户动作：

1. **整理 Chrome 书签**：分析分类建议；用户复核后应用，结果可解释、可恢复。
2. **同步社交平台收藏**：用户在支持平台收藏页点击启动，增量比较本地目录，只把新增内容安全写入 Obsidian。

普通网页或单条帖子保存是同步能力的单项模式，不再独立扩张为通用剪藏产品。AI 是可选建议器，不是使用前提。

## 3. 界面边界

| 界面          | 职责             | 约束                                                             |
| ------------- | ---------------- | ---------------------------------------------------------------- |
| Toolbar Popup | 上下文单动作入口 | 收藏页同步、详情页单条保存、其它页面整理书签；每次只有一个主动作 |
| Side Panel    | 当前任务工作台   | 只展示一个书签或同步任务，长任务可暂停、继续和恢复               |
| Options Page  | 一次配置/维护    | Vault、平台权限、可选 AI；高级设置默认折叠                       |

Goal 046B 已完成两条任务旅程和独立 Options 切换；Popup、Side Panel 与 Options 不再共用
旧 `App.tsx`。真实挂载、200% 缩放、深浅主题、焦点、ActionBar 遮挡和多 viewport 仍须由
Goal 046C 的完全隔离浏览器 E2E 验收，不能以 jsdom 或实现者自述代替。

## 4. 当前代码事实

当前生产路径：

- Chrome 书签读取、规则优先分类建议、可恢复批量操作，以及只读展示旧链接检查历史。
- X 单条详情页使用 strict envelope，并复用现有 SyncStore、catalog、safe Markdown 和
  Vault writer；exact-existing 项保持 revision 0 的 no-write 结果。
- File System Access API Vault 目录授权和逐文件结果写入。
- 可选 AI 只处理本地 fallback 候选，只向用户确认的固定官方端点发送 bounded title、
  hostname 和 opaque token；Key 与 public settings 分离，输出默认不选中。
- activity、diagnostics 和 legacy summary 使用固定 code 与容量边界，不回显正文、私人
  URL、raw error 或 secret。

历史兼容边界：

- 旧普通文章、微博详情页和 `pendingCapture` 数据仅保留受界检查/清理能力；生产
  message、右键菜单和 UI 入口已不可达，旧 writer 在接触文件系统前 fail closed。

Goal 042 基础与 Goal 043 已通过当前门禁的模块：

- runtime SocialItem/SyncJob/record/intent schema 与版本化 `shuhai-sync` IndexedDB。
- SyncCatalog、checkpoint、崩溃恢复、跨会话 `source + sourceItemId` 去重。
- 安全 Markdown、受限 Vault 索引重建、逐文件结果与默认不覆盖 writer。
- X fixture adapter、顶部重扫 coordinator、持久化 review revision、typed stop reason 和固定预算。
- X 收藏页生产路由、固定 ID、受界 content script、Side Panel review 与真实 no-Vault 10-candidate batch。

Goal 045A 已通过当前门禁的模块：

- 删除、URL 更新和分类移动共用严格 operation journal、command ledger 与全局写协调。
- mutation 前 attempt、逐项 outcome、真实 partial/cancel、reload reconciliation 和冲突安全恢复。
- 固定容量、revision、retention、sender/schema、深层目录和恢复尝试上限的 fail-closed 边界。

尚未完成或验证：

- 微博收藏页仍只有 `NO_GO` 研究结论，没有生产枚举。
- Goal 046A/046B 已完成 Popup/Side Panel 主壳、两条用户旅程、独立 Options、旧入口删除、
  按需状态加载和 bundle 硬门禁；隔离浏览器 E2E 仍属于后续 046C。
- 现有实现没有可验收的重复书签检测算法；该能力不会混入 046B UI 重构，只有在 dogfood
  证明需要后才能以独立算法 Goal 重新进入队列。
- extension build 已不再出现单个 UI chunk `>500 kB` warning；Popup 初始静态 JS 为
  `3.45 kB` gzip，Side Panel 为 `2.85 kB` gzip，BookmarkTask 与 X 任务按 route
  lazy-load，Options 是独立 `20.42 kB` gzip 入口。

## 5. 冻结中的 Goal 032

`C:\Projects\ShuHai` 主工作区位于 `feat/transactional-bookmark-operations`，存在未提交的 Goal 032 候选实现；Goal 043 则在独立 `C:\Projects\ShuHai\.worktrees\social-sync-v4` worktree 中推进。不得把两个 worktree 的状态或写入范围混为一体。

- Goal 032 状态是 `PAUSED_BY_PRODUCT_RESET`，不是完成或验收通过。
- 不得 reset、revert、checkout 或覆盖这些改动。
- Goal 032 的 operation journal 思想仍符合 v4 的书签安全要求。
- 未来 Goal 045 必须基于实际 diff 和独立 QA 决定保留、修复或拆分，不能只看实现者自述。

## 6. 新路线队列

| 顺序 | Goal      | 状态                      | 目的                                     |
| ---: | --------- | ------------------------- | ---------------------------------------- |
|    0 | Goal 032  | `PAUSED_BY_PRODUCT_RESET` | 保留书签 operation journal 候选实现      |
|    1 | Goal 041  | `DONE`                    | X LIMITED_GO、微博 NO_GO                 |
|    2 | Goal 042  | `DONE`                    | SyncJob、catalog、schema、Vault 安全基础 |
|    3 | Goal 043  | `DONE`                    | X 增量同步 MVP；`LIMITED_GO/batch-only`  |
|    4 | Goal 044  | `PLANNED`                 | 微博收藏增量同步 MVP                     |
|    5 | Goal 045A | `DONE`                    | 删除、URL 更新和分类移动 journal 安全门  |
|    6 | Goal 045B | `DONE`                    | 消息、storage、权限与 URL 体检退役       |
|    7 | Goal 045C | `DONE`                    | 内容保存链路与 AI 隐私收口               |
|    8 | Goal 046A | `DONE`                    | 主壳拆分、上下文 Popup 与 bundle 边界    |
|    9 | Goal 046B | `DONE`                    | 两条用户旅程与独立 Options               |
|   10 | Goal 046C | `PLANNED`                 | 隔离 E2E、可用性与视觉验收               |
|   11 | Goal 047  | `RESEARCH_GATE`           | 根据真实使用决定下一平台                 |

用户已确认 v4；041/042/043/045A/045B/045C/046A/046B 均已完成并独立验收。043B 的离线代码、生产接线、固定扩展 ID、受界真实 X 扫描、复核、disposable Vault 逐项写入、catalog 去重、pause/resume、同标签 `tab_changed`、取消和 no-write 均有证据。首轮原定只写 1-3 条但实际误选 5 条的 QA 范围偏差已保留，不据此扩大授权。045A 的三类书签 mutation 已通过 mock-only 数据安全门；045B 的 message、storage、权限和 URL 体检收口也已通过 mock-only 完整门禁与独立复审；045C 的单条内容保存收敛、legacy fail-closed 与 AI 隐私边界同样通过完整门禁和两名独立 Reviewer。046A 的主壳、surface protocol、bundle、isolated fixture visual 均通过完整门禁与独立复审。046B 完成两条旅程、独立 Options 与旧入口删除；最终 shared `1/1`、desktop `25/25`、extension `845/845`，Reviewer Locke 给出 `PASS` 且 P0/P1/P2/P3 为 0。Goal 044 仍受微博 `NO_GO` 阻塞；046C 仍为 `PLANNED`，须先通过独立合同审查。032-040 的旧队列继续停止自动编排；其中有价值的安全工作只通过新 Goal 显式继承。

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
6. Goal 045A/045B/045C/046A/046B 已完成完整门禁并通过独立审查。Goal 044 在微博
   `NO_GO` 结论被独立研究门禁改变前不得接生产枚举；046C 仍需独立合同、审查和显式
   状态推进。

## 10. 当前文档

- [产品路线图 v4](./product-roadmap-v4.md)
- [主界面与视觉系统重构提案（DRAFT）](./proposals/2026-07-17-ui-shell-redesign.md)
- [扩展架构 v4](./architecture/extension-v4.md)
- [社交收藏增量同步调研](./research/2026-07-13-social-favorites-sync-feasibility.md)
- [Goal 041 执行合同](./goals/goal-041-social-sync-feasibility-spike.md)
- [Goal 045A 执行合同](./goals/goal-045a-bookmark-mutation-safety.md)
- [Goal 045B 执行合同](./goals/goal-045b-extension-trust-boundary.md)
- [Goal 045C 执行合同](./goals/goal-045c-content-save-ai-privacy.md)
- [Goal 046A 执行合同](./goals/goal-046a-surface-shell-and-popup.md)
- [Goal 046B 执行合同](./goals/goal-046b-two-journeys-and-options.md)
- [Goal 状态索引](./goals/README.md)
- [产品路线图 v3（历史）](./product-roadmap-v3.md)
- [全方位审计（历史决策依据）](./audits/2026-07-12-comprehensive-product-security-ui-audit.md)
