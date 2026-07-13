# Goal 030: 视觉减法与任务完成感

> **历史 Goal，相关实现已合并；不得继续追加。** 后续 UI 以 Goal 037 和 v3 三界面职责为准。

## 背景

Goal 028-029 解决了结构问题（从 Tab 控制台变成任务启动器）。但视觉层面仍像"功能完整的内部工具"，不像成熟 Chrome 插件。

核心差距：

- 信息密度偏高，首屏没有单一视觉焦点
- Card/Badge/图标权重均匀，视线到处跳
- 11px 字号在 Windows 深色背景上难读
- 操作完成后缺乏"愉悦感"，只有文字 toast
- popup 全量加载应用状态，启动不够快

## 目标

1. 首屏只有一个视觉焦点（主任务区占 50%+ 视觉权重）
2. 字号下限 12px，正文 13-14px
3. 减少 Card 边框、Badge、图标数量
4. 关键操作完成后有明确的视觉反馈
5. popup 轻量化：只加载当前 tab 信息 + 摘要数据

## 改动范围

| 文件                                  | 改动                               |
| ------------------------------------- | ---------------------------------- |
| `src/popup/styles.css`                | 字号变量、间距调整、动效 keyframes |
| `src/popup/pages/HomePage.tsx`        | 金字塔布局：主任务区大、辅助入口小 |
| `src/popup/pages/InlineSavePanel.tsx` | 视觉强化：成功状态动效             |
| `src/popup/App.tsx`                   | popup 模式懒加载、数据精简         |
| `src/components/ui/card.tsx`          | 新增无边框变体                     |
| `src/components/ui/button.tsx`        | 按钮文案口语化（通过 props）       |
| `src/components/ui/toast.tsx`         | 成功 toast 加 check 动效           |
| `src/popup/pages/OrganizePage.tsx`    | 完成状态视觉强化                   |
| `src/popup/pages/HealthPage.tsx`      | 完成状态视觉强化                   |
| `src/popup/pages/Settings.tsx`        | 首屏进一步精简                     |

## 具体设计

### 1. 首页金字塔布局

**当前**：所有 TaskCard 等高等宽，平铺排列。

**改为**：

```
┌─────────────────────────────────────────┐
│                                         │
│   [主任务区 - 大卡片，有背景色]          │
│   保存当前页面 / AI 整理书签             │
│   （根据当前 tab 动态决定哪个是主角）     │
│                                         │
└─────────────────────────────────────────┘
  [次要入口]        [次要入口]
  检查失效链接       待入库 (3)
  ─────────────────────────────
  浏览书签 · 历史记录 · 设置
```

规则：

- 如果当前 tab 可提取内容（Twitter/Weibo/文章）→ InlineSavePanel 是主角
- 如果当前 tab 不可提取 → "AI 整理书签"是主角（大卡片）
- 其他任务变成小按钮行，不再是完整 Card

实现：

- 主任务区：无边框，用 `bg-primary/5` 背景色区分，padding 更大
- 次要入口：只保留图标 + 文字 + 箭头，不用 Card 包裹
- 底部辅助：纯文字链接行

### 2. 字号规范

**硬规则**：

| 用途                | 字号 | Tailwind class                    |
| ------------------- | ---- | --------------------------------- |
| 页面标题            | 16px | `text-base`                       |
| 卡片标题 / 按钮     | 14px | `text-sm`                         |
| 正文 / 列表主体     | 13px | `text-[13px]`                     |
| 说明文字 / 辅助信息 | 12px | `text-xs`                         |
| 极少量 metadata     | 11px | `text-[11px]`（仅时间戳、字数等） |

全局搜索 `text-[11px]` 和 `text-xs`，将正文/说明类内容提升到 12-13px。`text-[11px]` 只允许出现在：

- 时间戳
- 字数/媒体数等纯数字 metadata
- 路径预览

### 3. 减少视觉噪音

**Card 边框减少**：

- 主任务区：无边框，用背景色
- 次要入口：无边框，用 hover 背景色
- 只有"确认面板"和"设置区块"保留边框

**Badge 减少**：

- 只在需要吸引注意力时使用（待入库数量、错误状态）
- 去掉纯信息性 Badge（如"已提取""Twitter/X"来源标签）
- 来源信息改为纯文字

**图标减少**：

- 主任务卡保留图标（视觉锚点）
- 次要入口的图标去掉或缩小到 14px
- CardTitle 前的图标全部去掉，只保留主任务区

### 4. 操作完成感

**保存成功**：

```css
@keyframes check-pop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  60% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
```

保存成功后，InlineSavePanel 收起，显示一个绿色 check 图标 + 路径 + "复制路径"按钮，持续 3 秒后淡出。不是 toast（toast 在角落容易被忽略），而是**原位反馈**。

**整理完成**：
OrganizePage 应用成功后，显示：

```
✓ 已整理 12 个书签

还可以：
· 检查失效链接
· 生成书签目录
· 返回首页
```

check 图标用 `check-pop` 动画。

**检查完成**：
HealthPage 检查完成后，显示摘要卡片：

```
✓ 检查完成

正常 1,200 · 重定向 15 · 死链 3 · 错误 2
```

### 5. popup 轻量化

**当前**：popup 打开后调用 `state:get`，返回完整的 `ExtensionState`（书签树、所有书签、文件夹、备份、导出记录、健康记录...）。

**改为**：新增一个轻量请求 `state:summary`：

```typescript
interface StateSummary {
  bookmarkCount: number;
  folderCount: number;
  pendingCaptureCount: number;
  onboarded: boolean;
  hasVaultHandle: boolean;
  hasAiProvider: boolean;
  lastExportDate?: string;
}
```

popup 首页只请求 `state:summary`（< 1KB）。进入子页面时再按需加载完整数据。

Service worker 新增 handler：

```typescript
case 'state:summary':
  return { ok: true, data: await getStateSummary() };
```

### 6. 按钮文案口语化

| 当前       | 改为         |
| ---------- | ------------ |
| 开始整理   | 整理我的书签 |
| 开始检查   | 找出坏链接   |
| 写入 Vault | 确认保存     |
| 查看待入库 | 处理待入库   |
| 加入队列   | 稍后处理     |

### 7. 暗色模式调整

当前暗色背景 `#09090b` 太黑，Card 背景 `#111827` 和页面背景对比度不够。

改为：

- 页面背景：`#0f1419`（Twitter 暗色风格，不那么死黑）
- Card 背景：`#1a2332`（稍亮，有层次）
- 边框：`#2a3a4a`（更柔和）

保持 primary 绿色不变，但在暗色模式下稍微提亮到 `#1a9a7a`。

### 8. 间距统一

当前 `gap-3`（12px）在小空间里太紧。

规则：

- 页面级间距：`gap-4`（16px）
- 卡片内间距：`p-4`（16px）
- 元素间距：`gap-3`（12px）
- 紧凑列表：`gap-2`（8px）

## 不改的

- 功能逻辑全部不动
- 页面路由结构不动（028 已定）
- 组件 API 不动（只改样式和文案）
- Service worker 只新增 `state:summary`，不改现有接口

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

重点验证：

- 首页在 Twitter 页面打开时，InlineSavePanel 是视觉主角
- 首页在普通页面打开时，"整理我的书签"是视觉主角
- 全局无 `text-[11px]` 用于正文/说明（只允许 metadata）
- 保存成功后原位显示 check + 路径（不只是 toast）
- 整理/检查完成后有明确的完成状态视觉
- popup 首次加载不请求完整书签树
- 暗色模式下文字可读性提升
- Card 边框数量明显减少
