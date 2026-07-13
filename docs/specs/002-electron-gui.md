---
version: 1
assignee: codex
status: superseded
superseded_by: ../product-roadmap-v4.md
issue: 'TBD'
---

# Electron 桌面应用框架 + 基础 GUI

> **历史 spec：不得执行。** ShuHai 已切换为纯 Chrome Extension，Electron 不再是产品主线。参见 [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) 和当前 [`../product-roadmap-v4.md`](../product-roadmap-v4.md)；v3 仍保留产品演进过程。

## 目标

将已有的核心管线（Chrome 读取、分类、导出）包装为一个可运行的 Electron 桌面应用，用户安装后能看到书签列表、触发分类和导出操作。

## Prior Context

- 已完成: 项目骨架 (monorepo, TypeScript, ESLint, Vitest)
- 已完成: `packages/shared/` 核心类型定义
- 已完成: `packages/desktop/src/main/readers/chrome-file-reader.ts`
- 已完成: `packages/desktop/src/main/pipeline/` (normalize, classify, index)
- 已完成: `packages/desktop/src/main/exporters/markdown-exporter.ts`
- 已完成: `packages/desktop/src/main/ai/` (DeepSeek provider + AI classifier)
- 所有 25 个测试通过

## 技术方案

### 构建工具

- **主进程**: TypeScript → tsx (开发) / tsc (生产)
- **渲染进程**: Vite + React + @vitejs/plugin-react
- **打包**: electron-builder (生产构建)
- **开发模式**: Vite dev server (renderer) + tsx --watch (main)

### 依赖（已安装或待安装）

| 包                   | 版本   | 用途           |
| -------------------- | ------ | -------------- |
| electron             | 41.6.1 | 桌面框架       |
| react                | 19.1.0 | UI 框架        |
| react-dom            | 19.1.0 | React DOM      |
| vite                 | 6.3.5  | 渲染进程构建   |
| @vitejs/plugin-react | 4.4.1  | React JSX 支持 |

**注意**: 安装新依赖前 MUST 检查供应链安全（见 CLAUDE.md）

### 架构

```
packages/desktop/
├── src/
│   ├── main/
│   │   ├── index.ts          # Electron 主进程入口（MUST 重写）
│   │   ├── window.ts         # 窗口管理
│   │   ├── tray.ts           # 系统托盘
│   │   ├── ipc.ts            # IPC 通信处理
│   │   ├── readers/          # ✅ 已有
│   │   ├── pipeline/         # ✅ 已有
│   │   ├── exporters/        # ✅ 已有
│   │   ├── ai/               # ✅ 已有
│   │   └── db/               # SQLite 数据层（本 spec 不实现，后续）
│   ├── renderer/
│   │   ├── index.html        # HTML 入口
│   │   ├── main.tsx          # React 入口
│   │   ├── App.tsx           # 根组件
│   │   ├── pages/
│   │   │   ├── BookmarkList.tsx    # 书签列表页
│   │   │   ├── Settings.tsx        # 设置页
│   │   │   └── Setup.tsx           # 首次运行向导
│   │   ├── components/
│   │   │   ├── BookmarkCard.tsx    # 单个书签卡片
│   │   │   ├── StatusBadge.tsx     # URL 状态标记
│   │   │   └── Layout.tsx          # 页面布局
│   │   └── styles/
│   │       └── global.css          # 全局样式（Tailwind 或手写）
│   └── preload.ts            # preload 脚本（暴露安全 API）
├── vite.config.ts            # Vite 配置（渲染进程）
├── electron-builder.yml      # 打包配置
└── package.json              # ✅ 已有，需更新 scripts
```

## 文件清单

| 操作 | 路径                                                        | 说明                                  |
| ---- | ----------------------------------------------------------- | ------------------------------------- |
| 重写 | `packages/desktop/src/main/index.ts`                        | Electron app 启动、创建窗口、注册 IPC |
| 新建 | `packages/desktop/src/main/window.ts`                       | BrowserWindow 创建和管理              |
| 新建 | `packages/desktop/src/main/tray.ts`                         | 系统托盘图标 + 右键菜单               |
| 新建 | `packages/desktop/src/main/ipc.ts`                          | IPC handlers: 读书签、分类、导出      |
| 新建 | `packages/desktop/src/preload.ts`                           | contextBridge 暴露 API                |
| 新建 | `packages/desktop/src/renderer/index.html`                  | HTML 入口                             |
| 新建 | `packages/desktop/src/renderer/main.tsx`                    | React 挂载                            |
| 新建 | `packages/desktop/src/renderer/App.tsx`                     | 路由 + 页面切换                       |
| 新建 | `packages/desktop/src/renderer/pages/BookmarkList.tsx`      | 书签列表                              |
| 新建 | `packages/desktop/src/renderer/pages/Settings.tsx`          | 配置页                                |
| 新建 | `packages/desktop/src/renderer/pages/Setup.tsx`             | 首次向导                              |
| 新建 | `packages/desktop/src/renderer/components/BookmarkCard.tsx` | 书签卡片                              |
| 新建 | `packages/desktop/src/renderer/components/StatusBadge.tsx`  | 状态标记                              |
| 新建 | `packages/desktop/src/renderer/components/Layout.tsx`       | 布局                                  |
| 新建 | `packages/desktop/vite.config.ts`                           | Vite 渲染进程配置                     |
| 修改 | `packages/desktop/package.json`                             | 更新 scripts (dev/build/start)        |
| 修改 | `packages/desktop/tsconfig.json`                            | 添加 JSX 支持                         |

## IPC 通信接口

渲染进程通过 preload 暴露的 API 与主进程通信：

```typescript
// preload.ts 暴露给 renderer 的 API
interface ShuHaiAPI {
  // 书签操作
  getBookmarks(): Promise<RawBookmark[]>;
  classifyBookmarks(urls: string[]): Promise<Map<string, ClassificationResult>>;
  exportBookmarks(bookmarks: ProcessedBookmark[]): Promise<ExportResult>;

  // 配置
  getConfig(): Promise<AppConfig>;
  setConfig(config: Partial<AppConfig>): Promise<void>;

  // 系统
  selectDirectory(): Promise<string | null>; // 打开文件夹选择对话框
  getChromeProfiles(): Promise<string[]>; // 检测可用的 Chrome Profile
}

interface AppConfig {
  vaultPath: string;
  chromeProfile: string;
  ai: AIConfig;
  firstRunComplete: boolean;
}
```

## UI 要求

### 首次运行向导 (Setup.tsx)

1. 欢迎页 → 选择 Chrome Profile（自动检测可用 Profile）
2. 选择 Obsidian Vault 路径（文件夹选择对话框）
3. 可选：配置 DeepSeek API Key
4. 完成 → 跳转到书签列表

### 书签列表页 (BookmarkList.tsx)

- 显示从 Chrome 读取的所有书签
- 每个书签显示：标题、URL（截断）、分类、状态标记
- 顶部工具栏：搜索框、"AI 分类" 按钮、"导出到 Obsidian" 按钮
- 支持按分类筛选
- 大量书签时使用虚拟滚动（SHOULD，非 MUST）

### 设置页 (Settings.tsx)

- Vault 路径（可修改）
- Chrome Profile 选择
- AI 配置（Provider、API Key、模型）
- 同步频率设置

### 系统托盘

- 图标：简单的书签图标（可用 emoji 或 SVG）
- 右键菜单：打开主窗口 / 立即同步 / 退出
- 关闭窗口 → 最小化到托盘（不退出）

## 样式方案

SHOULD 使用简洁的 CSS（不强制 Tailwind）。要求：

- 跟随系统暗色/亮色模式（`prefers-color-scheme`）
- 中文字体优先：`-apple-system, "Microsoft YaHei", sans-serif`
- 紧凑布局，适合桌面应用

## 验收标准

- [ ] `pnpm dev` 能启动 Electron 窗口，显示 React 页面
- [ ] 首次运行显示向导，完成后记住配置
- [ ] 书签列表能正确显示从 Chrome 读取的书签
- [ ] 点击"导出"能生成 .md 文件到指定 vault 目录
- [ ] 系统托盘正常工作（右键菜单、关闭最小化）
- [ ] `pnpm typecheck` 无错误
- [ ] `pnpm lint` 无错误
- [ ] 已有的 25 个测试仍然通过

## 注意事项

### MUST（硬约束）

- 不修改 `packages/shared/` 中已有的类型定义
- 不修改已有的 readers/pipeline/exporters/ai 模块的公开接口
- preload 使用 contextBridge，不开启 nodeIntegration
- 安装新依赖前检查供应链安全（CLAUDE.md 规则）
- 使用精确版本号

### SHOULD（建议）

- 开发模式支持热重载（Vite HMR for renderer）
- 窗口大小记忆（关闭时保存位置和尺寸）
- 错误状态有友好提示（不是空白页面）
- 加载状态有 loading indicator

### 不要做

- 不实现 URL 健康检测（后续 spec）
- 不实现 SQLite 持久化（后续 spec，本阶段用内存/JSON）
- 不实现 Chrome 扩展相关功能
- 不添加 i18n（MVP 只用中文）
