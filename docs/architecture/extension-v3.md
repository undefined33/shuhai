# ShuHai Chrome Extension 目标架构 v3

> 状态：**已由 [`extension-v4.md`](./extension-v4.md) 取代，仅供架构复盘；正文保留当时决策**  
> 生效日期：2026-07-12  
> 产品路线：[product-roadmap-v3.md](../product-roadmap-v3.md)

## 1. 架构目标

v3 架构优先保证：

1. 只有一个 Chrome 扩展安装包。
2. 每种界面只有一个用户职责。
3. MV3 service worker 被挂起或重启后，长任务仍有可理解状态。
4. 页面、AI、消息、存储和导入数据在边界处校验。
5. 删除、URL 更新和 Vault 写入有逐项结果、部分失败语义和恢复路径。
6. 内容提取不扩大为后台任意网页抓取。

## 2. 顶层结构

```text
┌──────────────────────────────────────────────────────┐
│ Chrome Extension                                    │
│                                                      │
│ Toolbar Popup      Side Panel        Options Page    │
│ 保存当前页面       整理书签           低频配置/恢复   │
│        │                 │                  │         │
│        └──────── typed command/query ───────┘         │
│                          │                            │
│                 Background Service Worker            │
│     job orchestration / bookmark ops / AI / health   │
│          │               │                 │          │
│       IndexedDB      chrome.bookmarks    fetch        │
│          │                                          │
│   operation log / jobs / settings / capture queue    │
│                                                      │
│ Content Scripts                                      │
│ article / X / Weibo adapters + in-page feedback      │
│          │                                           │
│          └──── structured capture result ────────────┤
│                                                      │
│ File System Access API                               │
│ explicit user-authorized Obsidian Vault directory    │
└──────────────────────────────────────────────────────┘
```

没有 Electron、SQLite、Native Messaging、local daemon 或生产浏览器自动化。

## 3. 界面职责

### 3.1 Toolbar Popup

负责：

- 查询当前 tab 是否支持保存。
- 请求当前页面提取。
- 展示可编辑标题、标签、目标目录和最终相对路径。
- 让用户确认写入并显示真实结果。
- 在权限、冲突、提取或写入失败时给出下一步。

不负责：

- 加载完整书签树、历史、备份和健康记录。
- 启动全量分类或健康检查。
- 编辑复杂规则、模板和 Provider 高级参数。

### 3.2 Side Panel

负责：

- 书签搜索和概览。
- 生成、复核、应用分类建议。
- 运行链接检查，暂停/继续和处理结果。
- 展示批量操作进度、部分失败和恢复入口。

不负责当前页面的默认保存确认，也不承载完整设置页。

### 3.3 Options Page

负责：

- Vault 目录、路径、冲突策略和权限状态。
- AI Provider、密钥、模型和连接测试。
- 规则、模板和高级健康检测策略。
- 操作历史、恢复、诊断导出和本地数据清理。

## 4. 信任边界

| 数据来源               | 信任级别        | 必须处理                                |
| ---------------------- | --------------- | --------------------------------------- |
| 当前网页 DOM           | 不可信          | clone、预算、提取、sanitize、结构校验   |
| 书签标题/URL/文件夹名  | 不可信          | URL 解析、长度、显示转义、提示词隔离    |
| Content script message | 不可信          | sender/capability/schema/size 校验      |
| AI 响应                | 不可信          | schema、枚举、范围、ID 对照、低置信复核 |
| IndexedDB 旧记录       | 不可信/可能过期 | schema version、迁移、损坏处理          |
| 用户导入 JSON          | 不可信          | 文件大小、schema、预览、引用完整性      |
| Vault directory handle | 用户授权能力    | 每次验证权限、禁止逃逸相对目录          |
| 健康检测 HTTP 响应     | 外部不可信      | 不执行内容、限制重定向、无凭据、超时    |
| 扩展自身常量/内置规则  | 可信代码        | code review 和测试                      |

“浏览器已经打开页面”只降低 SSRF 和本地抓取风险，不会自动消除恶意 DOM、Markdown、资源链接、提示词注入或 Obsidian 插件语义风险。

## 5. 消息协议

### 5.1 原则

- 所有消息使用带版本的 discriminated union。
- command 和 query 分开；command 必须有 `requestId` 与幂等语义说明。
- service worker 校验 `sender.id`、tab/frame、允许能力和 payload schema。
- 消息大小有上限；大正文通过持久化 capture id 引用，不在 UI 间反复复制。
- 错误为结构化 code，不让 UI 解析英文异常字符串。

### 5.2 目标结果形态

```text
Result<T> =
  { ok: true, value: T, warnings: Warning[] }
  { ok: false, error: { code, userMessage, retryable, detailsId? } }
```

错误详情必须脱敏，用户文案与诊断信息分离。

## 6. 持久化模型

### 6.1 IndexedDB 存储域

建议使用独立 object stores：

- `settings`：版本化设置，不含明文诊断正文。
- `jobs`：分类、健康检查、保存任务的 durable 状态。
- `operations`：破坏性书签操作与逆操作日志。
- `captures`：待确认/失败恢复的提取结果，带 TTL。
- `history`：面向用户的短期活动摘要。
- `handles`：Vault directory handle 与权限元数据。
- `diagnostics`：脱敏、限量、可清理的错误记录。

### 6.2 Job 状态

```text
prepared -> running -> complete
                    -> partial
                    -> failed
prepared/running -> cancelled
complete/partial -> restoring -> restored | restore_partial
```

UI 不应从按钮 disabled 状态猜测任务状态；它订阅或查询持久化 job。

### 6.3 事务语义

IndexedDB 事务不能覆盖 `chrome.bookmarks`、网络请求或文件系统写入。因此：

- 禁止宣传“原子批量操作”。
- 先写 `prepared` 记录，再逐项调用外部 API，并持久化成功/失败结果。
- 逆操作只针对真实成功项。
- 重试必须按 item id 幂等，不能重复删除、重复创建或重复写入。

## 7. 书签操作域

### 7.1 分类建议

```text
bookmark snapshot
  -> deterministic normalization
  -> user rules
  -> accepted-history match
  -> unresolved subset
  -> optional AI classification
  -> schema validation
  -> plan preview
  -> user confirmation
  -> operation journal
  -> apply + per-item result
```

每条建议返回来源 `rule | history | ai`、目标文件夹、依据和可选置信度。

### 7.2 文件夹与标签

- Chrome 文件夹：主要位置，保持有限、稳定、可浏览。
- 标签：多维主题，只保存在 ShuHai 元数据或导出的 Markdown 中。
- 不用 AI 为每个细分主题自动制造深层目录。

### 7.3 删除恢复

删除前记录：

- 原 bookmark id（仅用于追溯）。
- title、url、parentId、index。
- 操作批次与时间。

恢复时重新创建，不能假设 Chrome 会复用 id。父目录不存在时进入明确的 Recovery 文件夹并报告路径。

### 7.4 URL 更新恢复

记录 bookmark id、title、oldUrl、newUrl。恢复时若 bookmark 已不存在或已被用户再次修改，必须冲突提示，不静默覆盖后续人工修改。

## 8. 健康检查域

### 8.1 安全请求策略

- 仅 `http:`/`https:`。
- 无 Cookie、Authorization、referrer 和用户凭据。
- 每次重定向重新应用目标地址安全策略。
- 阻止 localhost、私网、link-local、特殊用途 IP 和危险端口。
- 解析 URL 与网络地址判断分层；`tldts` 不参与 SSRF 决策。
- 全局并发上限与同可注册域名间隔并存。
- 超时和 `AbortSignal` 必须能暂停/取消。
- 不读取或解析响应正文。

### 8.2 用户语义

- `dead_high_confidence`：404/410。
- `redirected`：稳定可跟随目标，等待用户确认更新。
- `blocked_or_rate_limited`：401/403/429，不判死链。
- `server_error`：5xx，建议稍后重试。
- `timeout`、`dns_error`、`tls_error`、`network_error` 分开。
- `unsafe_target`：被本地网络/协议策略阻止。

筛选器只决定“看什么”，批量工具栏决定“处理当前筛选或选择”。任何删除都经过操作日志。

## 9. 内容提取域

### 9.1 Adapter 契约

```text
CaptureAdapter
  id/version
  supportedHosts
  canHandle(document, url)
  extract(clonedDocument, budget)
  validate(result)
  diagnostics(error)
```

输出包含：

- `kind`: article/tweet/thread/weibo/selection/metadata。
- title、author、sourceUrl、publishedAt、capturedAt。
- Markdown 或进入转换管线的结构化 blocks。
- media 仅保存安全化 URL 和类型，不主动下载。
- adapter id/version、warnings、truncation 和提取来源。

### 9.2 预算

每次提取必须有：

- 最大 DOM 节点数。
- 最大嵌套深度。
- 最大执行时间。
- 最大正文字符数。
- 最大链接/图片/媒体数。
- 最大 thread/post 数和分页次数。

超过预算返回截断警告或明确错误，不让 content script 卡死页面。

### 9.3 安全转换顺序

```text
clone -> extract -> HTML allowlist sanitize -> Markdown conversion
      -> Markdown AST policy -> YAML serializer -> size/path policy
```

若提取器直接输出 Markdown，也必须经过 AST policy。DOMPurify 不替代 Markdown/Obsidian 语义校验。

### 9.4 远程资源

- 默认将远程图片降为普通链接，不生成自动加载 embed。
- 不下载图片、视频、字体或附件。
- 不保留 tracking pixel、query token 或签名参数，除非内容访问确实需要且用户确认。
- 明确告诉用户“正文已保存，媒体为远程引用”，不能暗示已离线归档。

## 10. Vault 写入域

### 10.1 路径

- 所有路径都是相对已授权 Vault handle 的规范化段。
- 禁止空段、`.`、`..`、绝对路径、盘符、UNC、保留设备名和控制字符。
- 文件名经过确定性清理，清理后为空则使用稳定 fallback。
- 写入前显示最终相对路径。

### 10.2 冲突策略

支持并返回：

- `created`
- `overwritten`
- `skipped`
- `renamed`
- `error`

默认策略是安全的不覆盖或自动编号，具体由 Goal 033 决定。成功结果必须包含最终相对路径。

### 10.3 内容策略

- frontmatter 通过 serializer 生成，字段白名单。
- 不写入 raw HTML、脚本、iframe、表单或可执行插件块。
- 来源 URL 作为数据，不生成命令 URI。
- 全文、标题、标签和媒体数量都有上限。

## 11. AI 域

### 11.1 Provider 边界

当前 provider abstraction 足够支持 DeepSeek、Kimi、GLM 和 OpenAI-compatible endpoint。近期不扩张 Provider 数量。

统一请求只包含任务必要数据，避免发送完整网页 DOM、Cookie、浏览历史和无关书签。

### 11.2 Prompt injection 防护

- 系统指令明确：标题、URL、正文都是不可信引用数据，不是指令。
- 使用结构化 JSON 数据边界和随机/稳定 ID，不把内容拼进自由格式命令。
- 不允许模型调用工具、访问 URL 或返回可执行动作。
- 输出 schema 只接受已知 bookmark id、允许目标和枚举。
- 忽略模型返回的新指令、URL 抓取要求、代码和额外字段。
- 低置信度、未知 id 或目标不存在时进入人工复核。

这只能降低风险；真正的控制点仍是 schema、allowlist、用户确认和非自动执行。

## 12. 权限策略

- `bookmarks`：核心整理能力，安装说明中明确用途。
- `storage`：设置和持久化任务。
- `activeTab`/`scripting`：用户主动保存通用页面时临时注入。
- X/微博 host permissions：仅当常驻站点 adapter 确有价值；评估是否可以改为可选权限。
- `http://*/*`、`https://*/*`：健康检查时按用户操作请求 optional permission，说明范围并支持撤销。
- `contextMenus`/`sidePanel`：只保留实际使用入口。

每次权限变化必须有 manifest 测试、用户解释和拒绝后的降级路径。

## 13. 诊断与隐私

诊断记录只保存：

- adapter/provider/operation code 和版本。
- 错误 code、阶段、耗时和截断统计。
- 已脱敏 host 或 URL hash，默认不存完整 URL。
- 不含正文、Cookie、API Key、Authorization、DOM 快照和个人目录绝对路径。

用户可以查看、导出和清空诊断；记录有 TTL 和容量上限。

## 14. 测试架构

### 单元/属性测试

- schema、URL/path policy、Markdown AST policy。
- operation journal 状态机和恢复。
- adapter fixture、分页、去重和预算。
- 冲突策略和逐文件结果。

### 组件测试

- Testing Library + `user-event` 以用户可见行为断言。
- 不把 hook 内部变量或 CSS class 当主要验收。

### E2E

1. 首次授权 Vault -> 保存当前文章 -> 显示实际路径。
2. 生成分类建议 -> 应用部分成功 -> 恢复成功项。
3. 健康检查 -> 暂停/继续 -> 复核 -> 批量处理。

### 安全 fixture

- YAML 注入、路径穿越、JS URL、模板语法。
- raw HTML、SVG、事件属性、data URL、Obsidian 插件块。
- 超大 DOM、深嵌套、海量媒体和异常 Unicode。
- prompt injection、未知 bookmark id、AI schema 绕过。

## 15. 演进约束

- 先通过 Goal 032/033 的数据安全门，再引入存储和提取依赖。
- 内容库替换必须来自 Goal 035 spike 证据。
- UI 重构不改变底层业务语义；底层重构不顺带重新设计界面。
- 旧 Electron 包可以暂时保留用于历史参考，但不参与产品启动、发布或新开发。
- OpenCLI 只作为参考；任何 JSON importer 都必须另立 Goal。
