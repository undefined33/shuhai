---
id: goal-032
title: Transactional Bookmark Operations
status: PAUSED_BY_PRODUCT_RESET
version: 3
updated: 2026-07-13
depends_on: []
branch: feat/transactional-bookmark-operations
---

# Goal 032：书签批量操作日志与真实恢复

> 2026-07-13：用户已暂停当前 Goal，等待 v4 产品路线确认。现有候选实现和测试不得丢弃、回滚或冒充已验收；未来由 Goal 045 重新审计和收口。

## 1. 用户问题

当前批量删除书签、更新重定向 URL 等操作可能对大量真实 Chrome 书签生效。现有“先创建备份”和“撤销最近整理”不足以保证：

- 一个批次只对应一个可理解操作。
- 哪些项目成功、失败或未执行可追溯。
- service worker 或 Side Panel 关闭后仍能恢复状态。
- 用户可以一键恢复**实际成功变更的项目**。
- 恢复不会静默覆盖用户在操作之后做的新修改。

这是继续优化 UI、健康检测或分类算法之前的 P0 数据安全门。

## 2. 目标

1. 为批量删除和批量 URL 更新建立持久化 operation journal。
2. 正确表达 Chrome Bookmarks API 不支持跨调用事务的事实。
3. 逐项记录成功、失败、跳过和恢复结果。
4. 用户关闭并重新打开扩展后仍能看到未完成/最近操作。
5. 对成功变更提供真实、可测试的一键恢复。

## 3. 非目标

- 不重构 Popup、Side Panel 或整体视觉。
- 不修改 AI 分类算法、健康检测网络策略或内容提取。
- 不新增 npm 依赖。
- 不声称提供真正数据库式 atomic transaction。
- 不把下载的全量书签 JSON 快照冒充自动恢复机制。
- 不实现任意历史时间点恢复；本 Goal 只覆盖受支持操作和有限保留期。

## 4. 精确文件范围

实施前仍需用 `rg` 复核调用关系，但只允许修改下列文件：

| 文件                                                   | 允许改动                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `packages/extension/src/shared/bookmark-types.ts`      | operation、item、request/response 与 state 类型                       |
| `packages/extension/src/utils/bookmark-operations.ts`  | **新建**：状态机、执行、恢复、汇总和保留策略                          |
| `packages/extension/src/utils/chrome-bookmarks.ts`     | 增加最小 `get/create/update/remove` 包装与状态复核；不改分类算法      |
| `packages/extension/src/utils/storage.ts`              | operation journal 的 `chrome.storage.local` 读写；Goal 034 再迁移 IDB |
| `packages/extension/src/background/service-worker.ts`  | 批量执行、查询、恢复消息 handler                                      |
| `packages/extension/src/popup/App.tsx`                 | 调用批量命令、加载最近 operation、显示结果和恢复入口所需状态          |
| `packages/extension/src/popup/pages/HealthPage.tsx`    | 最小批量进度、partial 摘要和最近操作恢复 UI                           |
| `packages/extension/tests/bookmark-operations.test.ts` | **新建**：状态机、执行、partial、恢复、冲突和保留测试                 |
| `packages/extension/tests/chrome-bookmarks.test.ts`    | Chrome 包装与回归测试                                                 |
| `packages/extension/tests/storage.test.ts`             | operation 持久化测试                                                  |
| `packages/extension/tests/app-state.test.ts`           | state 恢复和序列化回归                                                |
| `packages/extension/tests/setup.ts`                    | 仅补齐测试需要的 Chrome bookmarks/storage mock                        |

禁止修改其他文件。若实现证明必须越界，停止并先更新本 spec/version；不得把“编译需要”当作事后越界理由。

本 Goal 不修改分类移动/撤销。它只覆盖健康检查页已经使用的书签删除和 URL 更新（单条与批量都必须走同一 operation service）。分类操作是否迁入 journal 另立 Goal。

## 5. 操作模型

### 5.1 Operation

每次用户确认一个批次，创建一个 operation：

| 字段                    | 要求                                         |
| ----------------------- | -------------------------------------------- |
| `id`                    | 稳定唯一 id                                  |
| `requestId`             | UI 每次确认生成；消息重试必须命中同一批次    |
| `version`               | schema version                               |
| `type`                  | `delete_bookmarks` 或 `update_bookmark_urls` |
| `status`                | 见状态机                                     |
| `createdAt`/`updatedAt` | ISO 时间                                     |
| `requestedCount`        | 用户确认范围                                 |
| `items`                 | 每项原始值、目标值、执行与恢复结果           |
| `summary`               | succeeded/failed/skipped/restored 数量       |
| `source`                | health/classification/manual 等已知来源      |

### 5.2 状态机

```text
prepared -> running -> complete
                    -> partial
                    -> failed
prepared/running -> cancelled
complete/partial -> restoring -> restored
                              -> restore_partial
restore_partial  -> restoring -> restored/restore_partial
```

每次状态变化必须持久化。无法读取或校验 operation 时 fail closed，不继续调用 Chrome API。

每项在调用 Chrome mutation **之前**必须先持久化 `attemptedAt`/attempt count。若 service worker 在 Chrome mutation 成功后、结果写回前中断，下一次读取 journal 时必须按当前 Chrome 状态 reconciliation：

- 删除项已不存在时可归因为本次成功并保留 inverse data；仍保持原快照时归为未执行。
- URL 已等于 `newUrl` 时可归为更新成功；仍为 `oldUrl` 时归为未执行；其它值标记 conflict。
- 恢复同理，只能按可比较状态归因，无法确认时 fail closed。

不得仅凭内存中的 Promise 状态判断成功。

### 5.3 Item 状态

执行：`pending | succeeded | failed | skipped`

恢复：`not_needed | pending | restored | restore_failed | conflict`

错误使用稳定 code；原始异常只进入脱敏诊断，不能作为 UI 唯一语义。

## 6. 删除书签

### 6.1 删除前记录

每项至少保存：

- 原 bookmark id。
- title、url。
- parentId、index。
- 当前操作创建时的可比较快照字段。
- 同标题、同 URL 的书签数量，用于区分“原本就有重复项”和“用户已经手工恢复”。

只允许 URL 书签；若传入文件夹或字段缺失，该项标记失败，不尝试递归删除。

### 6.2 执行

1. 校验用户选择与当前 Chrome 书签仍匹配。
2. 使用 `requestId` 查重；相同请求不得重复创建或重复执行。
3. 写入 `prepared` operation。
4. 切换为 `running`，逐项执行。
5. 每项 mutation 前写 attempt，完成后立即持久化结果，不能到批次结束才统一写。
6. 汇总为 `complete`、`partial` 或 `failed`。

并发策略必须保守且可取消，不能因 UI 切页丢失状态。

`requestId` 必须绑定规范化后的原 payload；同一 id 携带不同 bookmark id、顺序或目标 URL 时 fail closed，不能返回旧批次冒充本次结果。service worker 启动新 mutation 前必须先 reconciliation 所有非 active 的 `prepared/running/restoring` operation。

### 6.3 恢复

- 只恢复删除成功的项。
- 使用 title、url、parentId、index 重新创建，不假设 id 保持不变。
- 同一父目录内按原 index 升序恢复，不能受用户选择顺序影响。
- 父目录存在时尽量恢复原位置。
- 父目录缺失时创建或复用一个用户可见的 `ShuHai Recovery` 文件夹，并记录新路径。
- 同 URL/标题已被用户手动恢复时不得盲目重复创建；标记冲突并让用户选择。
- 原本已有重复书签时按操作前数量恢复，不把历史重复项误判成手工恢复。
- 每项恢复结果持久化，部分恢复明确展示。

## 7. URL 更新

### 7.1 更新前记录

每项至少保存：

- bookmark id、title。
- `oldUrl`、`newUrl`。
- 操作创建时读取到的当前 URL。

### 7.2 执行

- 更新前再次读取 bookmark。
- bookmark 不存在或 URL 已被其他操作修改时标记 conflict/failed，不覆盖。
- `newUrl` 必须通过现有 URL 和安全策略。
- 每项结果立即持久化。

### 7.3 恢复

- 只恢复本 operation 更新成功的项。
- 当前 URL 必须仍等于 operation 的 `newUrl`；否则标记 conflict，不能覆盖用户后续修改。
- 恢复为 `oldUrl` 后记录结果。

## 8. 用户界面要求

本 Goal 只做完成安全流程所需的最小 UI：

- 用户确认框显示操作类型和数量。
- 运行时显示 succeeded/failed/remaining，不伪装原子进度。
- 完成后明确：全部成功、部分成功或全部失败。
- `complete`/`partial` 操作提供“恢复本次操作”。
- 恢复前显示影响数量和冲突说明。
- 重启后在书签整理 Side Panel 或设置恢复区看到最近未完成操作。
- 全量 JSON 备份下载仍可保留，但文案改为“灾备快照”，不称“一键恢复”。

禁止新增每行重复的恢复/删除按钮；批量动作集中在选择工具栏，单项只显示状态和必要冲突处理。

## 9. 保留与清理

- operation journal 保留最新 20 次，并额外保留 30 天内记录；只有同时超出数量和时间窗口的普通终态记录才自动清理。
- 未完成、partial、restore_partial 操作不能被普通自动清理提前删除。
- 清理必须是独立、可测试逻辑。
- operation 不保存 API Key、页面正文、Cookie 或无关书签快照。

## 10. 安全要求

- 所有 message payload 在 service worker 边界校验类型、数量和 item identity。
- 所有执行命令必须包含格式受限的 `requestId`，相同 `requestId` 的重试返回已有 operation。
- 不能信任 UI 传来的 title/url/parentId；执行前重新读取 Chrome 状态。
- 单批数量设置合理上限；超出时要求分批。
- operation id 不可由页面 content script 任意引用或恢复。
- 错误日志脱敏，避免完整私人 URL 在 console 大量泄露。
- 任何 schema/存储损坏都停止破坏性操作并提示用户导出诊断。
- journal 校验必须同时检查结构和语义，包括 item id 唯一性、summary、attempt 证据及 operation/item 状态组合。

## 11. 测试计划

### 单元测试

- 状态机只允许合法迁移。
- requestId 重试不重复执行 mutation。
- mutation 后、journal 结果写回前中断可按 Chrome 当前状态 reconciliation。
- 删除前 inverse data 完整。
- URL 更新检测并发修改冲突。
- summary 对 complete/partial/failed 正确。
- retention 不删除未完成或可恢复操作。

### Chrome API mock 测试

- 100+ 项批量删除全部成功。
- 中间若干项失败，operation 为 partial，恢复只创建成功删除项。
- Side Panel/service worker 状态重新加载后继续展示 operation。
- 原 parent 不存在时恢复到 Recovery 文件夹。
- 用户已手动恢复时不产生静默重复。
- URL 更新后被用户再次修改，恢复标记 conflict。
- 恢复中部分失败并可再次处理失败项。

### 回归测试

- 健康检查“删除选中”使用同一 operation service。
- 重定向“更新选中”使用同一 operation service。
- 分类应用中已有的移动/撤销行为不被意外改变；若纳入新 journal，必须另写范围说明。
- 现有备份下载仍可用，但不承担恢复承诺。

### 手工验证

在专门的测试书签文件夹中：

1. 创建至少 10 条测试书签。
2. 批量删除，其中模拟一条失败。
3. 关闭并重新打开 Side Panel。
4. 确认看到 partial 结果并恢复成功项。
5. 删除原父文件夹后再次验证 Recovery 路径。
6. 更新 URL 后手动再改一条，确认恢复不会覆盖人工修改。

不得用用户真实主书签集作为首次手工验证样本。

## 12. 质量门禁

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

此外必须记录：

- 修改文件清单。
- operation schema 与状态机说明。
- 部分失败和恢复测试证据。
- 手工测试使用的隔离文件夹与结果。
- `git status --short --branch`。

## 13. 完成定义

Goal 032 只有在以下条件全部满足时才算完成：

- 两类破坏性批量操作都通过一个持久化 journal 管理。
- 所有实际成功项都有可验证逆操作数据。
- 重启后状态不丢失。
- 部分失败不会被报告为成功。
- 恢复遇到用户后续修改时 fail closed。
- 自动和手工测试证明成功项可恢复。
- 没有新增依赖或越界 UI/算法重构。
