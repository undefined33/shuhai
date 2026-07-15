# ShuHai Goal 状态索引

> 最后更新：2026-07-16
> 当前状态：Goal 041/042、Goal 043A、受界 no-Vault probe 与 disposable Vault 首次写入功能证据已通过；第二次 incremental 回归已完成离线修复与全量门禁
> 执行规则：当前为 `IN_PROGRESS_REPAIR_RETEST`；独立复审、提交与 CI 已 PASS，用户重载后以 10 条上限核对已写项 existing/skip 与文件数保持 5，不删除首轮文件或使用真实 Vault。

## 当前编排状态

| Lane     | 状态                      | 说明                                      | 恢复条件                        |
| -------- | ------------------------- | ----------------------------------------- | ------------------------------- |
| Goal 032 | `PAUSED_BY_PRODUCT_RESET` | 候选实现保留在主工作区，尚未完成独立验收  | v4 确认后由 Goal 045 审计和收口 |
| Goal 041 | `DONE`                    | X LIMITED_GO、微博 NO_GO                  | 四轮独立 review 最终 PASS       |
| Goal 042 | `DONE`                    | 持久化同步、catalog 与 Vault 安全基础     | 独立 review PASS                |
| Goal 043 | `IN_PROGRESS`             | 首轮 5 条已写；修复提交与 CI 通过         | 用户重载，核对真实去重          |
| 044-046  | `PLANNED`                 | 微博、书签和 UI                           | 按各自前置另写可执行 spec       |
| Goal 047 | `RESEARCH_GATE`           | 是否支持知乎、小红书或其它平台            | 两周 dogfood 证明真实需求       |
| workflow | `043B_REPAIR_RETEST`      | 独立 review、提交与 CI 通过；等待用户重载 | 第二次去重、最终验收            |

## v4 当前队列

| Goal                                                   | 状态                      | 目的                                      | 前置条件                         |
| ------------------------------------------------------ | ------------------------- | ----------------------------------------- | -------------------------------- |
| [032](./goal-032-transactional-bookmark-operations.md) | `PAUSED_BY_PRODUCT_RESET` | 书签批量操作 journal 候选实现             | Goal 045 重新审计                |
| [041](./goal-041-social-sync-feasibility-spike.md)     | `DONE`                    | X/微博 API 与收藏页扫描可行性             | 独立 PASS                        |
| [042](./goal-042-sync-vault-foundation.md)             | `DONE`                    | SyncJob、catalog、schema、Vault 安全基础  | 独立 review PASS                 |
| [043](./goal-043-x-bookmarks-incremental-sync.md)      | `IN_PROGRESS`             | X 收藏增量同步 MVP                        | 首轮 5 条写入证据与已写项去重    |
| 044                                                    | `PLANNED`                 | 微博收藏增量同步 MVP                      | Goal 041 微博结论 + Goal 042/043 |
| 045                                                    | `PLANNED`                 | 书签整理收缩和 Goal 032 安全收口          | v4 确认；独立 review 方案        |
| 046                                                    | `PLANNED`                 | Popup/Side Panel/Options 极简化和 dogfood | 042-045 核心能力可验收           |
| 047                                                    | `RESEARCH_GATE`           | 下一社交平台 adapter                      | 两周真实使用数据                 |

032-040 原队列不再按旧依赖链自动推进。Goal 033-040 的安全、持久化、提取和 UI 结论没有删除，但必须在 042-046 中按 v4 用户旅程重新写范围，不得直接沿用旧编号实施。

## Goal 状态规则

```text
DRAFT -> READY -> IN_PROGRESS -> READY_FOR_REVIEW -> DONE
             \-> BLOCKED_BY_<reason>
任意未完成状态 -> PAUSED_BY_PRODUCT_RESET
任意未实施状态 -> SUPERSEDED
```

- `DRAFT`：问题仍在研究，不能实施。
- `READY`：范围、文件、风险、依赖和测试完整，得到用户授权。
- `IN_PROGRESS`：唯一实施 Goal 已从 `READY` 正式开工。
- `READY_FOR_REVIEW`：实现门禁通过，等待独立 review/QA。
- `PAUSED_BY_PRODUCT_RESET`：保留代码和文档，但停止继续写入。
- `DONE`：独立 review、必要的真实用户旅程和文档收口完成。

状态变化必须同时更新 Goal frontmatter、本文件和 `docs/PROJECT_STATUS.md`。不把“已有候选代码”写成完成，也不把 `partial` 写成成功。

## 历史 Goal

Goal 002-031 记录 Electron、Extension、内容保存、健康检测和 UI 的早期演进；Goal 032-040 记录 v3 的安全整改路线。它们全部保留用于：

- 复盘错误方向和产品转变。
- 查找已有代码与测试的来源。
- 识别可以在 v4 显式复用的安全设计。

历史文件即使包含 `ready` 字样，也不能覆盖本索引。

特别说明：

- `goal-004-fullpage-export.md` 和 `threat-analysis-004.md` 是早期全文抓取讨论；v4 仍不后台抓取任意书签网页。
- Goal 028/029 的任务启动器、Goal 030/031 的视觉方向不再是当前信息架构。
- Goal 032 的代码未验收，不得丢弃，也不得在用户未确认时继续。

## 新 Goal 模板要求

每个新 Goal 必须写清：

1. 用户问题、非目标和成功标准。
2. 精确允许读取/修改文件与禁止范围。
3. 平台权限、账号、fixture 和停止条件。
4. 数据迁移、回滚、幂等、partial 和恢复语义。
5. 安全、隐私、平台条款和日志脱敏。
6. 新依赖的精确版本与供应链门禁。
7. 单元、fixture、组件、E2E 和真实 Chrome 证据。
8. 任务完成后的用户结果，而不只是内部模块交付。

## 文档优先级

出现冲突时按以下顺序：

1. 当前用户明确指令。
2. 根目录 `AGENTS.md`。
3. `docs/PROJECT_STATUS.md`。
4. `docs/product-roadmap-v4.md`。
5. 本文件中唯一 `READY`/`IN_PROGRESS` Goal。
6. `docs/architecture/extension-v4.md` 和当前研究资料。
7. 历史路线图、Goal 和 spec。
