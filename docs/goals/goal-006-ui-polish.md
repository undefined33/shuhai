# Goal 006: UI 美化 + 体验打磨（shadcn/ui + Tailwind CSS）

> **历史 Goal，不得直接执行。** 当前 UI 方向见 Goal 037 路线和 [`../product-roadmap-v3.md`](../product-roadmap-v3.md)。

将扩展 UI 从 MVP 手写 CSS 升级为 shadcn/ui + Tailwind CSS 现代设计系统。
同时打磨交互体验，让产品从"能用"变成"好用"。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过（测试数不能减少，当前 50）
2. pnpm --filter @shuhai/extension run build 成功
3. 扩展在 Chrome 中加载后，UI 使用 Tailwind CSS + shadcn 组件
4. 支持浅色/深色模式（跟随系统）
5. 所有页面（书签树、分类预览、导出、设置）视觉一致且美观
6. 交互反馈完善（loading 状态、成功/错误提示、过渡动画）
7. 功能不变，不引入新功能

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/chrome-extension
当前状态：

- Goal 004-005 已完成，功能完整（分类、导出、内容保存）
- UI 是手写 CSS（styles.css），功能性但视觉粗糙
- 已有 React + Vite 构建，集成 Tailwind/shadcn 成本低
- Popup 宽度 420px，需要在有限空间内做好信息展示

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 1. [Critical] 集成 Tailwind CSS

### 1.1 安装依赖

```bash
pnpm --filter @shuhai/extension add -D tailwindcss @tailwindcss/vite
```

版本要求：

- `tailwindcss` — 使用 v4.x 最新稳定版（精确版本）
- `@tailwindcss/vite` — 对应 Vite 插件

### 1.2 配置

- vite.config.ts 添加 `@tailwindcss/vite` 插件
- 入口 CSS 文件添加 `@import "tailwindcss"`
- 删除旧的 styles.css 手写样式（逐步替换）

### 1.3 Tailwind 配置

Tailwind v4 使用 CSS-first 配置：

```css
@import 'tailwindcss';
@theme {
  --color-primary: #146c5b;
  --color-primary-foreground: #ffffff;
  --radius: 0.5rem;
  --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
}
```

## 2. [Critical] 集成 shadcn/ui 组件

shadcn/ui 不是 npm 包，是复制源代码到项目中。

### 2.1 初始化

```bash
cd packages/extension
npx shadcn@latest init
```

配置选项：

- Style: Default
- Base color: Slate
- CSS variables: Yes
- Framework: Vite + React
- Components path: `src/components/ui`

### 2.2 需要的组件

按页面需求，添加以下 shadcn 组件：

```bash
npx shadcn@latest add button card tabs scroll-area badge
npx shadcn@latest add dialog alert checkbox input label
npx shadcn@latest add select separator tooltip progress
npx shadcn@latest add collapsible command
```

这些组件的底层依赖是 `@radix-ui/*`（已通过供应链安全审查）。

### 2.3 依赖安全确认

shadcn 组件会引入的 npm 依赖：

- `@radix-ui/react-*` — WorkOS 公司维护，6 年历史，✅ 通过
- `class-variance-authority` — 类名变体工具，需确认版本和维护者
- `clsx` — 类名合并，成熟小工具，✅
- `tailwind-merge` — Tailwind 类名去重，需确认版本和维护者
- `lucide-react` — 图标库（MIT，社区维护，可选）

每个依赖安装前必须确认精确版本和发布时间。

## 3. [Critical] 页面重写

### 3.1 整体布局

```
┌──────────────────────────────────────┐
│  ShuHai                    [状态文字] │  ← 顶栏：品牌 + 状态
├──────────────────────────────────────┤
│  [书签] [方案] [导出] [设置]          │  ← Tabs 导航
├──────────────────────────────────────┤
│                                      │
│  （页面内容区，可滚动）                │
│                                      │
└──────────────────────────────────────┘
```

- 使用 shadcn `Tabs` 组件替代手写 nav buttons
- 顶栏紧凑，不浪费 popup 有限高度
- 内容区使用 `ScrollArea` 组件

### 3.2 书签树页面

- 文件夹用 `Collapsible` 组件，可折叠展开
- 书签数量用 `Badge` 显示
- 搜索框用 shadcn `Input`
- "整理书签"按钮用 shadcn `Button` variant="default"
- 模式切换用 `Select` 组件
- 撤销按钮用 `Button` variant="outline"

### 3.3 分类预览页面

- 每条移动建议用 `Card` 组件
- 勾选用 `Checkbox`
- 置信度用 `Badge` + 颜色编码（绿 >0.8，黄 0.6-0.8，红 <0.6）
- 目标文件夹选择用 `Select`
- 顶部统计用紧凑的数字展示
- "应用选中"用 `Button` variant="default"，"取消"用 variant="ghost"

### 3.4 导出页面

- Vault 目录选择用 `Button` + 路径显示
- 导出范围用 Radio group
- 预览列表用 `ScrollArea`
- 进度用 `Progress` 组件
- 导出结果用 `Alert` 组件（成功/警告/错误）

### 3.5 设置页面

- 表单字段用 `Label` + `Input`
- API Key 输入用 password type + 显示/隐藏切换
- 模型选择用 `Select`
- 备份列表用 `Card` + 操作按钮
- 保存按钮用 `Button`

## 4. [Major] 暗色模式

- Tailwind v4 原生支持 `dark:` 前缀
- shadcn 组件自带暗色模式支持
- 跟随系统 `prefers-color-scheme`
- 不需要手动切换按钮（跟随系统即可）

## 5. [Major] 交互体验打磨

### 5.1 Loading 状态

- 按钮点击后显示 spinner（不只是 disabled）
- AI 分类时显示进度条 + 当前批次
- 导出时显示进度条 + 文件计数

### 5.2 消息反馈

- 成功操作：绿色 Alert，3 秒后自动消失
- 错误：红色 Alert，不自动消失，需要手动关闭
- 警告：黄色 Alert（如"权限需要重新授权"）

### 5.3 过渡动画

- 页面切换：简单 fade（不要过度动画）
- 列表项：stagger 进入
- 折叠/展开：smooth height transition

### 5.4 空状态

- 书签树为空："未检测到书签"
- 分类方案为空：根据模式显示不同提示
- 导出历史为空："尚未导出过书签"

## 6. [Minor] 图标

使用 `lucide-react` 图标库（如果通过安全审查）或内联 SVG：

- 书签页：BookmarkIcon
- 方案页：GitBranchIcon
- 导出页：DownloadIcon
- 设置页：SettingsIcon
- 文件夹：FolderIcon
- 刷新：RefreshCwIcon
- 撤销：UndoIcon

如果 `lucide-react` 不通过安全审查，直接用内联 SVG（从 lucide.dev 复制 SVG path）。

## 7. [Minor] 响应式微调

- Popup 默认 420px 宽
- 如果用户通过 side panel 打开（更宽），适配更宽的布局
- 长文本截断 + tooltip 显示完整内容
- 书签标题超长时 ellipsis

═══════════════════════════════════════════
强制约束：
═══════════════════════════════════════════

【供应链安全】

- 安装任何新依赖前必须确认：
  a) 包名拼写正确
  b) 使用精确版本号
  c) 该版本发布时间超过 7 天
  d) 维护者是已知活跃开发者
  e) 不是单人维护 + 创建不足 6 个月的包
- 已确认通过的：
  - `tailwindcss` — Tailwind Labs 公司，✅
  - `@tailwindcss/vite` — Tailwind Labs 公司，✅
  - `@radix-ui/*` — WorkOS 公司，✅
- 需要现场确认的：
  - `class-variance-authority` — 确认维护者和版本
  - `tailwind-merge` — 确认维护者和版本
  - `clsx` — 确认维护者和版本
  - `lucide-react` — 确认维护者和版本（如不通过则用内联 SVG）

【代码规范】

- TypeScript strict 模式
- 单引号，尾逗号，100 字符行宽
- 不要引入 React import（react-jsx transform）
- Tailwind 类名按逻辑分组（布局 → 间距 → 颜色 → 字体）

【产品边界】

- 本 Goal 只做 UI 重写，不引入新功能
- 所有现有功能必须保持不变
- 测试数不能减少

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 先集成 Tailwind + shadcn 基础设施（步骤 1-2）
- 再逐页面重写（步骤 3）
- 最后打磨细节（步骤 4-7）
- 每完成一个页面后运行：pnpm lint && pnpm typecheck && pnpm test
- 每个里程碑一个 commit
- push 到远程后继续

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- shadcn init 在 monorepo 中有路径问题 → 手动复制组件代码
- Tailwind v4 与 Vite 插件不兼容 → 退回 Tailwind v3 + PostCSS
- @radix-ui 某个组件在 Chrome Extension popup 中行为异常 → 用原生 HTML 替代该组件
- lucide-react 不通过安全审查 → 用内联 SVG
- 网络不可用无法 push → 本地 commit

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. 安装的新依赖列表及版本
5. 需要人工介入的事项
