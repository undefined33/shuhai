# Goal 003: 生产化加固 — 打包分发 + 安全存储 + 定时同步 + 日志 + AI 用量

> **历史 Goal，不得直接执行。** 其中 Electron/桌面发布方向已废止；当前队列见 [`README.md`](./README.md)。

让 ShuHai 从"开发可运行"升级为"可分发给真实用户"的状态。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过（测试数不能减少，当前 85）
2. pnpm build 成功
3. pnpm --filter @shuhai/desktop run dist 能生成 Windows NSIS 安装包（release/ 目录下有 .exe）
4. API Key 使用 Electron safeStorage 加密存储，config.json 中不再出现明文 key
5. syncIntervalMinutes 配置生效：应用启动后按配置间隔自动触发同步（与 fs.watch 并存）
6. 应用运行时在 userData/logs/ 目录生成结构化日志文件
7. AI 分类后 token 用量被记录到数据库，Settings 页面可查看累计用量
8. 所有新代码有对应的单元测试
9. 创建 PR: feat/electron-gui → main，PR 状态为 Open

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/electron-gui（不要 merge 到 main）
已完成：

- Goal 001: 端到端 Demo（增量同步、实时更新、URL 健康检测、Dashboard）
- Goal 002: UX 加固（错误恢复、引导、死链审查面板、可访问性）
  当前测试：85 passed
  当前 electron-builder.yml 已存在（最小配置，仅 win/nsis）

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 1. [Critical] Electron 打包配置完善

当前状态：electron-builder.yml 存在但 electron-builder 未安装，无 dist 脚本。

工作内容：

- 安装 `electron-builder` 为 devDependency（精确版本，遵守供应链安全规则）
- 在 packages/desktop/package.json 添加 `"dist": "electron-builder"` 脚本
- 完善 electron-builder.yml：
  - 添加 `extraResources` 或 `asarUnpack` 确保 better-sqlite3 native module 正确打包
  - 添加 `afterPack` 或 `npmRebuild: true` 确保 native module 针对 Electron ABI 编译
  - 配置 `files` 确保 dist/main、dist/preload、dist/renderer 都被包含
- 验证：运行 dist 脚本生成安装包，安装后能正常启动

注意事项：

- better-sqlite3 是 native module，打包时必须确保它是针对 Electron 的 ABI 编译的
- 如果 rebuild 有问题，可以用 `@electron/rebuild` 或在 afterPack hook 中处理
- 不需要 code signing（本阶段跳过）
- 不需要 auto-update（本阶段跳过）

## 2. [Critical] API Key 安全存储

当前状态：DeepSeek API Key 以明文存储在 config.json 中。

工作内容：

- 使用 Electron `safeStorage` API 加密 API Key：
  - `safeStorage.isEncryptionAvailable()` 检查是否可用
  - `safeStorage.encryptString(key)` → 存储 Buffer 的 base64 到 config
  - `safeStorage.decryptString(buffer)` → 读取时解密
- 修改 app-config.ts：
  - config.json 中存储 `aiKeyEncrypted: string`（base64 编码的加密数据）
  - 移除明文 `aiKey` 字段
  - 提供 `getDecryptedAiKey()` 和 `setAiKey(plaintext)` 方法
- 迁移逻辑：如果检测到旧的明文 `aiKey`，自动加密迁移并删除明文字段
- 如果 safeStorage 不可用（极少数 Linux 环境），fallback 到明文并在日志中警告
- 更新 Settings UI：API Key 输入框显示 `••••••••`（已有 key 时），不回显明文
- 更新 DeepSeekProvider 实例化：从加密存储获取 key

## 3. [Major] 定时同步实现

当前状态：syncIntervalMinutes 配置和 UI 存在但是死代码，无实际定时器。

工作内容：

- 在 main process 启动时（bootstrap 完成后）创建 `setInterval` 定时器
- 间隔 = config.syncIntervalMinutes _ 60 _ 1000
- 定时器触发时调用 `syncNow()`（复用现有同步逻辑，受 syncMutex 保护）
- 配置变更时（config:set 触发）重建定时器
- 与 fs.watch 并存：fs.watch 处理实时变化，定时器作为兜底（防止 fs.watch 静默失效）
- 应用退出时 clearInterval
- 添加 IPC 事件 `sync:next-run` 通知 renderer 下次同步时间
- Settings 页面显示"下次自动同步: XX:XX"

## 4. [Major] 结构化日志系统

当前状态：仅有 5 处 console.error/console.log，用户无法获取日志。

工作内容：

- 实现一个轻量级 Logger 模块（不引入外部依赖）：
  - 日志级别：debug, info, warn, error
  - 输出到文件：`app.getPath('userData')/logs/shuhai-YYYY-MM-DD.log`
  - 格式：`[ISO时间] [LEVEL] [module] message`（JSON lines 格式）
  - 同时输出到 console（开发时可见）
  - 日志轮转：保留最近 7 天的日志文件，启动时清理旧文件
- 替换现有 console.error/console.log 为 Logger 调用
- 关键日志点：
  - 应用启动/退出
  - 数据库初始化/迁移
  - 同步开始/完成/失败（含书签数量）
  - AI 分类请求/响应（不记录 API Key，记录 token 数）
  - URL 健康检测开始/完成
  - 导出开始/完成
  - 配置变更
  - 错误和异常
- Settings 页面添加"打开日志目录"按钮（调用 shell.openPath）

## 5. [Major] AI Token 用量追踪

当前状态：tokenUsage 字段是 stub（永远为 0），monthlyBudget 未使用。

工作内容：

- 修改 DeepSeekProvider：
  - 从 API 响应中提取 `usage.prompt_tokens` 和 `usage.completion_tokens`
  - 返回 token 数量给调用方
- 数据库新增 `ai_usage` 表：
  - id, timestamp, operation (classify/summarize/tag), prompt_tokens, completion_tokens, model
- AIClassifier 每次调用后将 usage 写入数据库
- 添加 IPC handler `ai:get-usage`：
  - 返回本月累计 token 数、调用次数
  - 返回历史趋势（按天聚合）
- Settings 页面 AI 区域显示：
  - "本月已用: 12,345 tokens（23 次调用）"
  - 如果设置了 monthlyBudget，显示进度条和剩余额度
- 当月用量超过 budget 时：
  - 日志警告
  - UI 显示警告提示
  - 不自动阻止（只警告，不强制），用户可继续使用

## 6. [Minor] 打包后 native module 验证

工作内容：

- 添加一个简单的 smoke test 脚本 `scripts/verify-package.mjs`：
  - 解压生成的安装包（或检查 app.asar）
  - 验证 better-sqlite3.node 文件存在且大小合理
  - 验证 dist/main/index.js、dist/preload/preload.cjs、dist/renderer/index.html 存在
- 在 dist 脚本后可选运行此验证

## 7. [Minor] CSP 安全头

工作内容：

- 在 window.ts 的 BrowserWindow 配置中添加 Content-Security-Policy：
  - `default-src 'self'`
  - `script-src 'self'`
  - `style-src 'self' 'unsafe-inline'`（CSS-in-JS 需要）
  - `connect-src 'self' https://api.deepseek.com`（AI API）
  - `img-src 'self' data:`
- 或通过 session.defaultSession.webRequest.onHeadersReceived 注入 CSP header
- 确保 renderer 不能加载外部脚本

## 8. [Final] 创建 Pull Request

所有功能完成并验证通过后，创建 PR 将 `feat/electron-gui` 合并到 `main`。

工作内容：

- 确认所有测试通过、build 成功
- 使用 gh CLI 创建 PR：
  ```
  gh pr create --base main --head feat/electron-gui \
    --title "feat: ShuHai Electron desktop app (Goals 1-3)" \
    --body "..."
  ```
- PR body 包含：
  - Summary: 3 个 Goal 的主要功能列表
  - 验证状态（测试数、lint、typecheck、build）
  - Breaking changes（如果有）
  - Screenshots（如果方便）
- 注意：gh 命令也需要代理环境，如果 gh 不支持 http.proxy，使用：
  ```
  HTTPS_PROXY=http://127.0.0.1:10808 gh pr create ...
  ```
- 如果 gh 未安装或认证失败，记录为阻塞项，不要跳过

═══════════════════════════════════════════
强制约束（与前两个 Goal 相同）：
═══════════════════════════════════════════

【网络与代理】

- 所有 git push/pull/fetch 必须加代理：
  git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 push
- Electron 二进制下载需要镜像：
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

【供应链安全】

- 安装任何新依赖前必须确认：
  a) 包名拼写正确（警惕 typosquatting）
  b) 使用精确版本号（如 26.6.3，不是 ^26.6.3）
  c) 该版本发布时间超过 7 天
  d) 维护者是已知活跃开发者
  e) 不是单人维护 + 创建不足 6 个月的包
- 本 Goal 需要安装的依赖：
  - `electron-builder`（已知包，electron 官方维护）— 需确认精确版本
  - 不需要其他新依赖（Logger 自行实现，safeStorage 是 Electron 内置 API）

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
- API Key 加密存储，日志中绝对不能出现 API Key
- safeStorage 解密后的 key 只在内存中存在，不写入任何文件
- CSP 必须阻止外部脚本加载

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 每完成一个功能后运行：pnpm lint && pnpm typecheck && pnpm test
- 测试失败 → 先修复再继续
- 每个功能一个 commit，commit message 格式：feat: xxx 或 fix: xxx
- push 到远程后继续下一个功能
- 优先级：先做 Critical，再做 Major，最后 Minor
- dist 打包如果因为环境问题失败（如缺少 Visual Studio Build Tools），记录问题并继续后续任务

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- electron-builder 安装失败 → 尝试加代理，如果仍失败则跳过打包任务，继续其他任务
- safeStorage 在 CI/headless 环境不可用 → 实现 fallback 逻辑，测试中 mock safeStorage
- better-sqlite3 rebuild 失败 → 记录错误，尝试 @electron/rebuild
- 网络不可用无法 push → 本地 commit，记录待 push
- 任何 spec 不清楚的地方 → 做合理决策，在代码注释中用 // NOTE: 说明理由

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. 生成的安装包路径和大小（如果打包成功）
5. 需要人工介入的事项
