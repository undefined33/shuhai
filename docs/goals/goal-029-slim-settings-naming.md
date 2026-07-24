# Goal 029: 整理工作台瘦身 + 设置精简 + 命名统一

> **历史 Goal，不得直接执行。** 可复用的命名原则已并入 v3，当前队列见 [`README.md`](./README.md)。

## 背景

Goal 028 重构了首页为任务启动器，解决了"打开 ShuHai 不知道做什么"的问题。但进入子页面后，仍然存在：

- "整理书签"工作台内塞了太多功能（浏览、分类、导出索引、操作历史入口）
- 设置页首屏太重（Vault、AI Provider、模板、规则、备份、帮助全部平铺）
- 命名仍是系统视角（分类方案、链接体检、待保存内容、捕获）

## 目标

1. 整理书签工作台只保留核心流程：生成建议 → 预览 → 应用
2. 设置页首屏只显示必填项，高级功能折叠
3. 全局命名统一为用户视角
4. 低频功能降级到合理位置

## 改动范围

| 文件                                 | 改动                                   |
| ------------------------------------ | -------------------------------------- |
| `src/popup/pages/OrganizePage.tsx`   | 瘦身：移除导出索引主入口、简化模式     |
| `src/popup/pages/Settings.tsx`       | 重构：必填项首屏 + 高级折叠            |
| `src/popup/pages/HomePage.tsx`       | 小改：命名更新                         |
| `src/popup/pages/ActivityPage.tsx`   | 小改：命名更新、入口降级               |
| `src/popup/pages/CollectionPage.tsx` | 小改：命名更新                         |
| `src/popup/pages/HealthPage.tsx`     | 小改：命名更新                         |
| `src/popup/pages/HelpPage.tsx`       | 小改：命名更新                         |
| `src/popup/pages/ExportPage.tsx`     | 降级：从主流程移到整理完成后的可选动作 |
| `src/background/service-worker.ts`   | 小改：右键菜单命名（如果 027 未覆盖）  |
| `src/content/toast.ts`               | 小改：toast 文案命名                   |

## 具体设计

### 1. 命名统一表

全局搜索替换以下用户可见文案（不改变量名/类型名，只改 UI 文本）：

| 当前文案         | 改为            | 出现位置                          |
| ---------------- | --------------- | --------------------------------- |
| 分类方案         | 整理建议        | OrganizePage、toast、activity log |
| 链接体检         | 检查失效链接    | HealthPage、toast、activity log   |
| 待保存内容       | 待入库          | CollectionPage、HomePage          |
| 最近写入 Vault   | 已保存          | CollectionPage、Settings          |
| 导出书签索引     | 生成书签目录    | ExportPage、OrganizePage          |
| 操作历史         | 历史记录        | ActivityPage、HomePage            |
| 捕获 / 捕获时间  | 收藏 / 收藏时间 | CollectionPage、预览面板          |
| 整理了 N 个书签  | 整理了 N 个书签 | 保持不变（已经是用户语言）        |
| 体检完成         | 检查完成        | toast                             |
| 正在体检书签链接 | 正在检查链接    | status bar                        |

注意：只改 UI 文本和 toast/status 消息。不改 TypeScript 类型名、变量名、storage key、activity log 的 `type` 枚举值。

### 2. 整理书签工作台瘦身

**当前 OrganizePage 模式**：

- browse（浏览书签树）
- plan（AI 分类方案）
- health（链接体检）— Goal 028 已拆出
- export（导出索引）

**改为**：

- browse（浏览书签）
- plan（整理建议：生成 → 预览 → 应用）

"导出书签索引"从 OrganizePage 的主按钮区移到：

- 整理完成后的"还可以..."区域：`整理完成！还可以：[生成书签目录到 Obsidian]`
- 或者设置页的"高级工具"区域

"操作历史"入口从 OrganizePage 移到首页底部小链接或设置页。

### 3. 设置页精简

**当前结构**（全部平铺）：

```
知识库（Vault 选择 + 导出前缀）
AI 服务商（多 Provider 管理）
自定义规则（RulesEditor）
导出模板（MarkdownTemplateEditor）
最近写入
书签备份
使用帮助
```

**改为分层结构**：

```
┌─ 基本设置（始终展开）─────────────┐
│ Obsidian Vault    [已选择: MyVault] [更换] │
│ AI 服务商         [DeepSeek · 已配置] [编辑] │
└──────────────────────────────────────────┘

▸ 分类规则（点击展开）
  RulesEditor 组件

▸ 导出模板（点击展开）
  MarkdownTemplateEditor 组件

▸ 备份与历史（点击展开）
  书签备份列表
  已保存记录
  历史记录入口

▸ 高级工具（点击展开）
  生成书签目录
  使用帮助
```

实现：用 `Collapsible` 组件（已有）包裹各区域。默认只展开"基本设置"。

### 4. 首次使用引导融入设置首屏

如果 Vault 未选择或 AI Key 未配置，设置首屏显示引导提示：

```
┌─────────────────────────────────────┐
│ 开始使用 ShuHai                      │
│                                     │
│ ① 选择 Obsidian Vault  [选择目录]   │  ← 未完成时高亮
│ ② 配置 AI 服务商       [去配置]     │  ← 未完成时高亮
│                                     │
│ 完成后即可使用 AI 整理和内容保存      │
└─────────────────────────────────────┘
```

完成后这个引导区域消失，显示正常的"基本设置"卡片。

### 5. 低频功能降级清单

| 功能         | 当前位置                     | 降级到                        |
| ------------ | ---------------------------- | ----------------------------- |
| 导出书签索引 | OrganizePage 主按钮          | 整理完成后提示 / 设置高级工具 |
| 操作历史     | 顶级 Tab / OrganizePage 入口 | 首页底部链接 / 设置备份与历史 |
| 书签备份管理 | Settings 平铺                | Settings 折叠区               |
| 导出模板编辑 | Settings 平铺                | Settings 折叠区               |
| 使用帮助     | Settings 平铺                | Settings 折叠区               |

### 6. 整理完成后的引导

当用户在 OrganizePage 应用整理建议后，显示完成状态：

```
┌─────────────────────────────────────┐
│ ✓ 已整理 12 个书签到 5 个文件夹      │
│                                     │
│ 还可以：                             │
│ · [生成书签目录到 Obsidian]          │
│ · [检查失效链接]                     │
│ · [返回首页]                         │
└─────────────────────────────────────┘
```

这样"导出书签索引"不再占主流程位置，但在合理的时机出现。

## 不改的

- 底层逻辑（service worker、vault-writer、classifier 等）全部不动
- TypeScript 类型名、变量名、storage key 不改
- ActivityType 枚举值不改（`'classify_apply'` 等保持不变）
- 功能本身不删除，只调整入口位置和可见性

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

重点验证：

- 所有用户可见文案已统一（搜索旧文案确认无残留）
- 设置页首屏只显示 Vault + AI Provider
- 折叠区域点击展开/收起正常
- 导出书签索引从 OrganizePage 主按钮区消失
- 整理完成后显示"还可以"引导
- 操作历史入口在首页底部或设置中可达
- 首次使用引导在未配置时显示
