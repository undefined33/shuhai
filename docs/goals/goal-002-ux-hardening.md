# Goal 002: UX 加固 + 错误恢复 + 引导体验

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

让 ShuHai Electron 桌面应用从"能跑的 Demo"升级为"用户能独立完成首次使用"的状态。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过（测试数不能减少）
2. pnpm build 成功
3. 首次启动 → Setup 向导有清晰的中文引导文案，用户能理解每一步的目的
4. 书签链接点击后在系统默认浏览器打开（不在 Electron 窗口内导航）
5. 数据库损坏时显示错误对话框并提供"重置数据库"选项
6. 所有用户可见的错误有明确的中文提示和恢复路径
7. 所有新代码有对应的单元测试

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/electron-gui（不要 merge 到 main）
已完成：Goal 001 全部功能（增量同步、实时更新、URL 健康检测 UI、Dashboard 生成）

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 1. [Critical] 修复书签链接导航问题

BookmarkCard.tsx 中的 `<a href>` 会在 Electron 窗口内导航，导致应用不可用。

修复方案：

- 使用 `shell.openExternal(url)` 通过 preload 暴露一个 `openExternal` 方法
- 或在 main process 中拦截 `will-navigate` 事件，阻止内部导航并用系统浏览器打开
- BookmarkCard 中改为 `<a>` + onClick handler 调用 `window.shuhai.openExternal(url)`

## 2. [Critical] 启动失败错误恢复

当前问题：bootstrap 失败时 app.quit() 无任何提示。

修复方案：

- 在 `bootstrap()` 的 catch 中使用 `dialog.showErrorBox()` 显示错误信息
- 如果是数据库错误，提供"重置数据库"按钮（删除 db 文件，从 backup 恢复或重新创建）
- 在 App.tsx 的错误状态添加"重试"按钮

## 3. [Critical] 修复 IPC Map 序列化问题

`classifyBookmarks` 返回 `Map<string, BookmarkClassification>`，但 Electron IPC 的 structured clone 不支持 Map。

修复方案：

- 将返回类型改为 `Record<string, BookmarkClassification>`
- 在 main process 端将 Map 转为 plain object 再返回
- 更新 preload.ts 的类型定义

## 4. [Critical] 解决同步竞态条件

`getBookmarkSnapshot()` 和 `ChromeWatcher` 都调用 `syncChromeBookmarks()`，可能并发执行。

修复方案：

- 添加一个模块级的 `syncMutex`（简单的 Promise 链或 flag）
- 确保同一时间只有一个 sync 在执行，后续请求等待或跳过

## 5. [Major] Setup 向导引导文案

当前 Setup 向导缺乏解释，用户不知道：

- 为什么需要选择 Chrome Profile
- Obsidian Vault 是什么
- DeepSeek API Key 是什么、在哪里获取、是否收费

修复方案：

- 每个步骤添加 1-2 行中文说明文字
- Step 0: "ShuHai 会读取你的 Chrome 书签进行整理。请选择要同步的浏览器配置文件。"
- Step 1: "选择你的 Obsidian 笔记库目录，导出的书签将保存在这里。"
- Step 2: "DeepSeek 是 AI 分类服务（可选）。留空则使用内置规则分类。获取 Key: platform.deepseek.com"
- 如果 Chrome 未检测到，显示警告："未检测到 Chrome 浏览器，请确认已安装。"

## 6. [Major] 统一错误/消息系统

当前问题：

- 错误和成功消息共用一个 state，样式判断逻辑错误
- Settings 保存无 error handling

修复方案：

- 创建一个简单的 message state: `{ text: string; type: 'success' | 'error' | 'info' }`
- 根据 type 应用不同 CSS class
- Settings.tsx 的 save() 添加 try/catch，失败时显示错误
- 消息 3 秒后自动消失（setTimeout）

## 7. [Major] 空状态和引导

当前问题：书签为 0 时显示"无匹配书签"，无引导。

修复方案：

- 区分"无书签"和"筛选无结果"两种状态
- 无书签时显示引导："尚未同步到书签。请确认 Chrome 配置文件正确，或点击刷新。"
- 筛选无结果时显示："当前筛选条件无匹配结果，试试清除筛选。"

## 8. [Major] 导出反馈增强

当前问题：导出后不告诉用户文件在哪。

修复方案：

- 导出成功消息中包含 vault 路径
- 添加"在文件管理器中打开"按钮（调用 shell.showItemInFolder）

## 9. [Major] Watcher 失败反馈

当前问题：Chrome 不存在时 watcher 静默返回，用户不知道同步未启动。

修复方案：

- `start()` 返回 `{ success: boolean; reason?: string }`
- 通过 IPC 事件 `sync:status` 通知 renderer 同步状态
- BookmarkList 顶部显示同步状态指示器（正常/未启动/错误）

## 10. [Major] 死链审查面板

当前问题：URL 健康检测发现死链后，用户只能看到数字统计，无法对单条死链做决策。
用户需要：看到死链标题 → 用标题去搜索新链接 → 替换/删除/保留。

修复方案：

- 检测完成后，如果有死链，在 BookmarkList 下方或弹出一个"死链审查"面板
- 面板内容：
  - 列表显示所有状态为 dead/error 的书签
  - 每条显示：标题、原 URL、失败原因（404 / 超时 / DNS 失败 / 被拒绝）、检测时间
  - 标题可点击复制（方便用户去搜索引擎搜索）
- 每条书签提供操作按钮：
  - 「保留」— 标记为"已审查"，不做处理（可能是临时故障，下次检测会重新验证）
  - 「替换链接」— 弹出输入框，用户粘贴新 URL，替换后重新检测
  - 「删除」— 从数据库标记为 removed（需二次确认）
  - 「稍后处理」— 关闭面板，书签保持 dead 状态，下次打开面板仍可见
- 面板顶部显示统计："共 N 个死链，已处理 M 个"
- 批量操作：全选 + 批量删除/批量保留
- IPC 接口：
  - `bookmarks:update-url` — 替换书签 URL
  - `bookmarks:mark-reviewed` — 标记为已审查
  - `bookmarks:remove` — 标记删除
- 数据库：bookmark 表添加 `reviewed_at` 字段（nullable timestamp）

## 11. [Minor] 基础可访问性

- 所有按钮添加 `:focus-visible` 样式
- 消息区域添加 `aria-live="polite"`
- 导航按钮添加 `aria-current="page"`
- BookmarkCard title 添加 `title` 属性显示完整文本

## 12. [Minor] Settings 未保存提示

- 跟踪 dirty state（对比 draft 和 config）
- 导航离开时如果有未保存更改，显示确认提示

═══════════════════════════════════════════
强制约束（与 Goal 001 相同）：
═══════════════════════════════════════════

【网络与代理】

- 所有 git push/pull/fetch 必须加代理：
  git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 push
- Electron 二进制下载需要镜像：
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

【供应链安全】

- 安装任何新依赖前必须确认：
  a) 包名拼写正确
  b) 使用精确版本号
  c) 该版本发布时间超过 7 天
  d) 维护者是已知活跃开发者
  e) 不是单人维护 + 创建不足 6 个月的包
- 本 Goal 预计不需要新依赖

【代码规范】

- TypeScript strict 模式
- 单引号，尾逗号，100 字符行宽
- Node.js 内置模块用 node: 前缀
- 相对导入用 .js 后缀（ESM）
- 不要引入 React import（已配置 react-jsx transform）
- 不用的变量用 \_ 前缀

【安全】

- 导出器中的 sanitize 逻辑不可删除或削弱
- SSRF 防护逻辑不可删除
- openExternal 必须验证 URL 协议（只允许 http/https）
- 不要在代码中硬编码 API key 或密码

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 每完成一个功能后运行：pnpm lint && pnpm typecheck && pnpm test
- 测试失败 → 先修复再继续
- 每个功能一个 commit，commit message 格式：feat: xxx 或 fix: xxx
- push 到远程后继续下一个功能
- 优先级：先修 Critical，再修 Major，最后 Minor

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- Chrome Bookmarks 文件不存在 → 用测试 fixture 验证，生产代码优雅降级
- 网络不可用无法 push → 本地 commit，记录待 push
- pnpm install 失败 → 尝试加代理
- 任何 spec 不清楚的地方 → 做合理决策，在代码注释中用 // NOTE: 说明理由

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. 需要人工介入的事项
