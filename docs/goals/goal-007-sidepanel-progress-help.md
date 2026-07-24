# Goal 007: Side Panel + AI 流式进度 + 帮助引导

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

将扩展从 popup-only 升级为 Side Panel 主界面，实现 AI 分类流式进度，
并添加完整的帮助/引导系统让新用户能独立上手。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过（测试数不能减少，当前 50）
2. pnpm --filter @shuhai/extension run build 成功
3. 扩展支持 Side Panel 模式（更宽的界面，书签树和方案预览体验更好）
4. AI 分类时 UI 显示真实批次进度（"批次 3/30，已分类 150 个"）
5. 首次安装后显示欢迎引导，帮助用户理解每个功能
6. 帮助页面/面板可随时访问，解释所有功能的用途和操作方式
7. 功能逻辑不变，只增强体验

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/chrome-extension
当前状态：

- Goal 004-006 已完成，功能完整 + UI 美观
- 问题：420px popup 对 1469 个书签偏挤
- 问题：AI 分类无真实进度反馈
- 问题：新用户打开扩展不知道该做什么

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 1. [Critical] Chrome Side Panel 支持

### 1.1 manifest.json 添加 side_panel

```json
{
  "side_panel": {
    "default_path": "sidepanel/index.html"
  },
  "permissions": ["bookmarks", "storage", "contextMenus", "sidePanel"]
}
```

### 1.2 Side Panel 入口

- 新建 `src/sidepanel/` 目录，结构与 popup 类似但布局更宽
- Side Panel 宽度约 400-500px，高度占满浏览器侧边
- 复用 popup 的所有页面组件，但布局适配更大空间：
  - 书签树可以展示更多层级
  - 分类预览可以并排显示"当前位置"和"目标位置"
  - 导出预览可以显示更多文件列表

### 1.3 Popup 变为轻入口

Popup 保留但简化为快捷入口：

- 显示书签统计摘要（X 个书签，Y 个文件夹）
- 快捷按钮："打开侧边栏"、"快速整理"、"导出"
- 点击"打开侧边栏"调用 `chrome.sidePanel.open()`

### 1.4 用户可以选择使用方式

- 习惯 popup 的用户：点击扩展图标直接操作
- 需要更大空间的用户：从 popup 点"打开侧边栏"，或右键扩展图标选择"在侧边栏中打开"

## 2. [Critical] AI 分类流式进度

### 2.1 Background → UI 通信改为 Port

当前 AI 分类是一次性 `sendMessage` → 等待全部完成 → 返回结果。
1469 个书签分 30 批，用户可能等几分钟看不到任何反馈。

改为使用 `chrome.runtime.connect()` 建立长连接：

```typescript
// popup/sidepanel 端
const port = chrome.runtime.connect({ name: 'classify' });
port.postMessage({ type: 'plan:create', mode: 'full' });

port.onMessage.addListener((msg) => {
  if (msg.type === 'progress') {
    // { done: 150, total: 1469, batch: 3, totalBatches: 30 }
    updateProgress(msg);
  }
  if (msg.type === 'complete') {
    setPlan(msg.plan);
  }
  if (msg.type === 'error') {
    setError(msg.error);
  }
});
```

```typescript
// background service-worker 端
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'classify') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'plan:create') {
        await classifyWithProgress(msg.mode, (progress) => {
          port.postMessage({ type: 'progress', ...progress });
        });
        port.postMessage({ type: 'complete', plan });
      }
    });
  }
});
```

### 2.2 进度 UI

分类进行中显示：

```
┌─────────────────────────────────────────┐
│  AI 正在分析你的书签...                   │
│                                          │
│  ████████████░░░░░░░░  150/1469 (10%)   │
│  批次 3/30 · 预计剩余 2 分钟             │
│                                          │
│  [取消]                                  │
└─────────────────────────────────────────┘
```

- 使用 shadcn `Progress` 组件
- 显示已完成数/总数、百分比
- 显示当前批次/总批次
- 预估剩余时间（基于已完成批次的平均耗时）
- 支持取消（中断后续批次，保留已完成的结果）

### 2.3 取消机制

- Background 维护一个 `AbortController`
- UI 发送 `{ type: 'cancel' }` 时，abort 当前 fetch
- 已完成的批次结果保留，生成部分方案
- 提示用户："已取消，基于已分析的 150 个书签生成了部分方案"

## 3. [Critical] 帮助与引导系统

### 3.1 首次安装欢迎页

当 `chrome.storage.local` 中没有 `onboarded: true` 时，显示欢迎引导：

```
┌─────────────────────────────────────────┐
│  👋 欢迎使用 ShuHai                      │
│                                          │
│  ShuHai 帮你智能整理 Chrome 书签，        │
│  并将知识导出到 Obsidian。                │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │ 1. 整理书签                      │    │
│  │    AI 分析你的书签，建议更好的    │    │
│  │    文件夹分类方案                 │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ 2. 导出到 Obsidian               │    │
│  │    将书签索引写入 Obsidian vault  │    │
│  │    作为知识库入口                 │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ 3. 保存社交内容                   │    │
│  │    在 Twitter/微博页面右键保存    │    │
│  │    推文或微博到知识库             │    │
│  └─────────────────────────────────┘    │
│                                          │
│  [开始使用]                              │
│                                          │
│  💡 提示：配置 DeepSeek API Key 可       │
│  获得更精准的 AI 分类（设置页配置）       │
└─────────────────────────────────────────┘
```

点击"开始使用"后设置 `onboarded: true`，不再显示。

### 3.2 帮助页面

在导航中添加"帮助"tab（或设置页底部添加"使用帮助"链接）：

内容结构：

```markdown
# ShuHai 使用帮助

## 书签整理

### 安全模式 vs 全量重分类

- **安全模式**：只整理根目录/未分类的书签，不动已有文件夹中的书签
- **全量重分类**：AI 重新审视所有书签的分类，可能建议从一个文件夹移到另一个

### 操作流程

1. 选择整理模式
2. 点击"整理书签"
3. 查看移动方案预览
4. 勾选/取消不想移动的项
5. 点击"应用选中"执行移动
6. 如果不满意，点击"撤销"恢复

### AI 分类

- 需要在设置中配置 DeepSeek API Key
- 没有 Key 时使用内置规则分类（基于域名和标题关键词）
- API Key 获取：https://platform.deepseek.com

## 导出到 Obsidian

### 首次使用

1. 点击"选择 Vault 目录"
2. 在弹出的文件选择器中选择你的 Obsidian vault 根目录
3. 浏览器会记住这个授权（可能需要偶尔重新确认）

### 导出内容

- 每个书签生成一个 .md 文件
- 包含：标题、URL、分类、标签、来源信息
- 文件按分类文件夹组织
- 已存在的文件不会被覆盖

### 安全说明

- 远程图片不会自动加载（防止 IP 泄露）
- 所有内容经过安全消毒（防止 Obsidian 插件注入）

## 保存推文/微博

### 使用方式

1. 在 Twitter/X 或微博页面浏览
2. 看到想保存的内容时，右键选择"保存此推文"或"保存此微博"
3. 内容会出现在"导出"页面的待处理列表中
4. 确认后写入 Obsidian vault

### 保存的内容

- 推文/微博正文
- 作者信息
- 发布时间
- 媒体链接（不自动下载图片）

## 设置

### DeepSeek API Key

- 用于 AI 智能分类
- 可选，不配置则使用内置规则
- Key 存储在浏览器本地，不会上传到任何服务器

### 分类模式默认值

- 设置每次打开时的默认模式

### 备份

- 每次整理前自动备份
- 保留最近 5 次备份
- 可下载备份文件（JSON 格式）
```

### 3.3 上下文提示（Tooltip）

在关键操作旁添加 `?` 图标 + tooltip：

- "安全模式" 旁：解释什么是安全模式
- "全量重分类" 旁：解释会重新审视所有书签
- "置信度" 旁：解释数字含义（越高越确定）
- "导出" 按钮旁：解释会写入什么文件
- API Key 输入框旁：解释在哪里获取

### 3.4 空状态引导

各页面空状态不只是"没有数据"，而是引导用户下一步：

- 书签页无书签："未检测到 Chrome 书签。请确认浏览器中有书签。"
- 方案页无方案："点击书签页的「整理书签」生成分类方案。"
- 导出页未授权 vault："点击「选择 Vault 目录」开始导出到 Obsidian。"
- 设置页无 API Key："配置 DeepSeek API Key 可获得更精准的 AI 分类。[获取 Key →](https://platform.deepseek.com)"

## 4. [Major] 文件夹选择增强（Combobox）

当前"方案"页修改目标文件夹是普通 Select，书签多时不好找。

改为可搜索的 Combobox：

- 使用 shadcn `Command` 组件（已有）
- 输入时实时过滤文件夹列表
- 支持输入新文件夹名（创建新分类）
- 显示每个文件夹当前的书签数量

## 5. [Minor] 快捷键

- `Ctrl+Enter` / `Cmd+Enter`：在方案页快速应用选中
- `Escape`：取消当前操作/关闭弹窗
- `/`：聚焦搜索框

## 6. [Minor] 导出进度优化

导出大量书签时也显示进度：

- 使用与 AI 分类相同的 Port 通信模式
- 显示："正在写入: 45/1469 (Bookmarks/安全/研究/...)"

═══════════════════════════════════════════
强制约束：
═══════════════════════════════════════════

【网络与代理】

- 所有 git push/pull/fetch 必须加代理：
  git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 push

【供应链安全】

- 本 Goal 预计不需要新 npm 依赖
- Side Panel 和 Port 通信都是 Chrome 原生 API
- 帮助内容是静态文本

【代码规范】

- TypeScript strict 模式
- 单引号，尾逗号，100 字符行宽
- 不要引入 React import
- Tailwind 类名按逻辑分组

【产品边界】

- 不引入新的核心功能
- Side Panel 复用现有组件，不重写逻辑
- 帮助内容使用中文

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 优先级：Side Panel（1）→ AI 进度（2）→ 帮助引导（3）→ Combobox（4）→ 其余
- 每完成一个功能后运行：pnpm lint && pnpm typecheck && pnpm test
- 每个功能一个 commit
- push 到远程后继续

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- `chrome.sidePanel` API 在某些 Chrome 版本不可用 → 保留 popup 作为主界面，side panel 作为可选增强
- Port 通信在 Service Worker 休眠后断开 → 添加重连逻辑，或 fallback 到轮询
- Side Panel 和 Popup 共享状态冲突 → 使用 chrome.storage 作为单一数据源
- 网络不可用无法 push → 本地 commit

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. Side Panel 是否能正常打开和使用
5. 需要人工介入的事项
