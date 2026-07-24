# Goal 004: 网页全文导出 — 安全抓取 + HTML→Markdown 转换

> **历史且已否决的方向，不得执行。** 当前产品不在后台批量抓取任意网页全文；参见 [`../product-roadmap-v3.md`](../product-roadmap-v3.md)。

将书签导出从"仅保存元数据"升级为"抓取网页全文内容并安全转换为 Markdown 存入 Obsidian"。

因为用户是安全研究员，书签中包含大量含恶意 payload 的页面（XSS、命令注入、恶意脚本），
导出管道必须确保：抓取的内容在转换和存储过程中不会触发任何代码执行。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过（测试数不能减少，当前 106）
2. pnpm build 成功
3. 点击"导出到 Obsidian"后，每个书签的 .md 文件包含网页正文内容（非仅元数据）
4. 恶意页面内容（script 标签、event handler、模板注入、shell payload）被安全中和
5. 导出的 .md 文件在 Obsidian 中打开不会触发任何代码执行
6. 无法抓取的页面（超时/403/非 HTML）优雅降级为仅元数据导出
7. 所有新代码有对应的单元测试，特别是安全相关的 sanitization 测试

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/electron-gui（不要 merge 到 main）
已完成：Goal 001-003（端到端 Demo + UX 加固 + 生产化）
当前测试：106 passed
PR #1 已 Open

用户身份：安全研究员，书签中包含：

- 漏洞分析文章（含 PoC 代码）
- 恶意样本分析页面（含实际 exploit payload）
- CTF writeup（含 shell command、reverse shell 等）
- 钓鱼页面分析（含恶意 JS）
- 正常技术博客和文档

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 1. [Critical] 网页内容抓取模块（含 SSRF 加固）

新建 `src/main/fetcher/page-fetcher.ts`

功能：

- 使用 Node.js 原生 `fetch()` 获取页面 HTML
- 复用现有域名限速（DomainScheduler，2s 间隔）
- 并发控制：最多 3 个并发抓取（p-limit，已有依赖）
- 超时：单页 30 秒（使用 AbortSignal.timeout）
- Content-Type 检查：只处理 text/html，其他类型跳过
- User-Agent：设置为常见浏览器 UA
- 返回：`{ html: string; finalUrl: string; contentType: string }` 或错误

### 1.1 SSRF 加固（Red Team 发现的关键漏洞）

当前 SSRF 防护存在三个绕过向量，必须在本 Goal 中修复：

**a) 重定向绕过** — 当前 `redirect: 'follow'` 不重新验证目标：

- 改为 `redirect: 'manual'`
- 手动跟随重定向（最多 5 hop）
- 每个 hop 的目标 URL 都必须通过 `resolveSafeUrl()` 验证
- 如果任何 hop 指向私有 IP → 中断并报错

**b) DNS Rebinding 防护**：

- `resolveSafeUrl()` 解析出安全 IP 后，直接用该 IP 发起连接
- 设置 `Host` header 为原始域名（保证虚拟主机路由正确）
- 这样 fetch 不会重新做 DNS 解析，消除 TOCTOU 窗口

**c) 补全私有网段**：

- 添加 `100.64.0.0/10`（CGNAT）
- 添加 `198.18.0.0/15`（benchmark）
- 添加 `192.0.0.0/24`（IETF protocol）
- 添加 `240.0.0.0/4`（reserved）
- 添加 `2001:db8::/32`（documentation IPv6）

### 1.2 请求安全配置

- `credentials: 'omit'` — 绝不发送 cookie/auth（防止凭据泄露）
- `referrer: ''` — 不发送 Referer header（防止信息泄露）
- `Accept-Encoding: identity` — 不接受压缩（防止 zip bomb；或接受 gzip 但限制解压后大小）
- 响应体流式读取，硬限制 5MB（超过立即 abort）

### 1.3 错误处理

- 网络超时 → 返回 null，标记为"抓取失败"
- 403/401 → 返回 null，标记为"需要认证"
- 非 HTML → 返回 null，标记为"非网页内容"
- SSRF 拦截 → 返回 null，标记为"安全策略阻止"
- 重定向到私有 IP → 返回 null，标记为"重定向被安全策略阻止"
- 响应体超限 → 返回 null，标记为"页面过大"

## 2. [Critical] HTML 内容提取（Readability）

新建 `src/main/fetcher/content-extractor.ts`

功能：

- 使用 `@mozilla/readability` 从 HTML 中提取正文（去除导航、广告、侧边栏）
- 如果 Readability 提取失败（某些页面结构不标准），fallback 到 `<body>` 全文
- 返回：`{ title: string; content: string; excerpt: string; byline: string }`

依赖：

- `@mozilla/readability`（Mozilla 官方维护，MIT 协议，成熟稳定）
- `linkedom` 或 `jsdom`（提供 DOM 环境给 Readability）
  - 优先选 `linkedom`（更轻量，无 native 依赖，适合 Electron 打包）
  - 如果 linkedom 不兼容 Readability，退而用 jsdom

## 3. [Critical] HTML→Markdown 转换

新建 `src/main/fetcher/html-to-markdown.ts`

功能：

- 使用 `turndown` 将提取的 HTML 正文转换为 Markdown
- 配置 turndown 规则：
  - 保留代码块（`<pre><code>`）→ fenced code blocks
  - 保留表格 → GFM 表格
  - 链接 → `[text](href)`，相对 URL 转绝对 URL
  - 删除 `<script>`、`<style>`、`<iframe>`、`<object>`、`<embed>` 标签
  - 删除所有 HTML event attributes（onclick、onerror 等）

### 3.1 图片处理策略（Red Team 关键发现）

**问题**：如果导出的 .md 保留 `![](https://remote-url)`，Obsidian 打开时会加载远程图片。
这会导致：

- 用户 IP 泄露给恶意服务器（追踪像素）
- 安全研究员身份暴露（攻击者知道谁在分析他们的页面）
- SSRF（如果 Obsidian 加载 `http://169.254.169.254/...`）
- SVG XSS（`data:image/svg+xml` 中嵌入脚本）

**解决方案 — 图片不自动加载，转为纯文本引用**：

```markdown
<!-- 原始: <img src="https://evil.com/track.png" alt="diagram"> -->
<!-- 导出为: -->

[图片: diagram](https://evil.com/track.png)
```

- 所有 `<img>` 转换为纯文本链接格式 `[图片: alt-text](url)`，不使用 `![]()` 语法
- 这样 Obsidian 不会自动加载远程资源
- 用户可以看到图片 URL，手动决定是否查看
- `data:` URI 图片直接移除（可能含 SVG XSS）
- `file://` 协议图片直接移除
- 只保留 `http://` 和 `https://` 协议的图片引用

依赖：

- `turndown`（成熟的 HTML→Markdown 库，MIT 协议）
- `turndown-plugin-gfm`（GFM 表格和删除线支持）

## 4. [Critical] 安全内容消毒（核心安全层）

扩展 `src/main/exporters/sanitize.ts` 或新建 `src/main/fetcher/content-sanitizer.ts`

这是最关键的安全层。用户的书签包含恶意内容，必须确保：

### 4.1 HTML 层面消毒（在 Readability 提取后、turndown 转换前）

- 删除所有 `<script>` 标签及内容
- 删除所有 `<style>` 标签及内容
- 删除所有 event handler 属性（on\*）
- 删除 `<iframe>`、`<object>`、`<embed>`、`<applet>`、`<form>`
- 删除 `<meta http-equiv="refresh">`
- 删除 `javascript:`、`vbscript:`、`data:text/html` 协议的链接
- 删除 `<base>` 标签（防止相对路径劫持）
- 白名单模式：只保留安全的 HTML 标签和属性

### 4.2 Markdown 层面消毒（turndown 转换后）

- 中和 Obsidian 模板语法：`<% %>` → `\<% %\>`，`{{ }}` → `\{\{ \}\}`
- 中和 Dataview 查询语法：` ```dataview ` → ` ```text `（防止 Dataview 插件执行）
- 中和 Dataview JS：` ```dataviewjs ` → ` ```text `（Dataview JS 模式可执行任意代码）
- 中和 Templater 语法：`<% tp. %>` 等
- 中和 Obsidian callout 中的可执行内容
- 中和 Obsidian URI scheme：`obsidian://` → `obsidian-disabled://`（防止触发 Obsidian 命令）
- 中和 RunJS / Shell Commands 等插件语法
- 代码块内容保持原样但标记为纯文本：
  - 恶意 shell 命令在代码块中是安全的（Obsidian 不会执行代码块）
  - 但要确保代码块正确闭合（防止 ``` 逃逸）
  - 如果内容中有未闭合的 ```，强制闭合
  - 代码块语言标记消毒：`dataview`/`dataviewjs`/`templater` → `text`
- 中和 `![[embed]]` 语法（Obsidian 嵌入，可能触发文件包含）
  - `![[` → `\!\[\[`
- 中和 `[[wikilink]]` 如果它指向可执行内容
- 链接 URL 消毒：只允许 http/https/mailto 协议
- 中和 HTML 注释中的隐藏指令（某些渲染器会解析 `<!-- -->` 中的内容）

### 4.3 文件系统安全

- 导出的文件名消毒（已有 sanitizeFilename）
- 文件名 Unicode NFC 规范化（防止 homoglyph 和分解字符绕过）
- 内容大小限制：单个 .md 文件最大 1MB（超过则截断并标注）
- 不允许导出内容中包含文件路径引用（`file://` 协议）
- 路径遍历双重防护：sanitize + isWithinDirectory 最终验证
- `....` → `..` 的正则问题：改用循环替换直到无变化，或直接 split/filter

### 4.4 安全测试用例（必须覆盖）

编写专门的安全测试文件 `tests/content-sanitizer.test.ts`，覆盖：

**HTML 注入：**

- `<script>alert(1)</script>` → 完全移除
- `<img onerror="alert(1)" src="x">` → 转为纯文本引用，移除 onerror
- `<a href="javascript:alert(1)">click</a>` → 移除 href 或替换为 #
- `<svg onload="alert(1)"><circle/></svg>` → 移除 onload 或移除整个 svg
- `<iframe src="evil.com">` → 完全移除
- `<meta http-equiv="refresh" content="0;url=evil">` → 移除
- `<base href="https://evil.com">` → 移除
- `<form action="https://evil.com"><input>` → 移除
- `<object data="evil.swf">` → 移除
- `<link rel="import" href="evil.html">` → 移除

**Obsidian 插件注入：**

- `<% tp.system("calc.exe") %>` → 转义模板语法
- `<% require('child_process').exec('rm -rf /') %>` → 转义
- ` ```dataview\nLIST FROM ""\n``` ` → 改为 text 语言标记
- ` ```dataviewjs\napp.vault.adapter.write('/tmp/pwned','x')\n``` ` → 改为 text
- `{{constructor.constructor('return this')()}}` → 转义模板语法
- `[click](obsidian://advanced-uri?commandid=shell-commands:run)` → 中和 URI
- `![[/etc/passwd]]` → 转义
- `![[some-note#^block]]` → 转义

**代码块安全：**

- 未闭合的 ` ``` ` → 强制闭合
- 嵌套代码块（` ``` ` 内再有 ` ``` `）→ 正确处理
- Shell reverse shell payload 在代码块中 → 保留（代码块内安全）
- 代码块语言为 `dataviewjs` → 改为 `javascript`

**图片/资源安全：**

- `![](https://evil.com/track.png)` → 转为 `[图片: ](url)` 纯文本
- `![](data:image/svg+xml,<svg onload="alert(1)">)` → 完全移除
- `![](file:///etc/passwd)` → 完全移除
- `![](\\\\evil.com\\share\\img.png)` → 完全移除（UNC 路径）

**路径遍历：**

- 文件名 `../../.ssh/authorized_keys` → 消毒为安全文件名
- 文件名 `....` → 不能变成 `..`
- Unicode 分解字符 `\u002e\u002e/` → NFC 规范化后检测

**DoS 防护：**

- 超大内容（>1MB）→ 截断
- 深度嵌套 HTML（1000 层 div）→ 不崩溃
- 超长单行（>100KB 无换行）→ 截断

## 5. [Major] 导出器集成

修改 `src/main/exporters/markdown-exporter.ts`

工作内容：

- 导出流程变为：
  1. 生成 YAML frontmatter（现有逻辑）
  2. 抓取网页内容（page-fetcher）
  3. 提取正文（content-extractor）
  4. 转换为 Markdown（html-to-markdown）
  5. 安全消毒（content-sanitizer）
  6. 组装最终 .md 文件
- 文件结构：

  ```markdown
  ---
  yaml frontmatter（现有）
  fetched_at: 2026-05-27T14:30:00Z
  fetch_status: success | failed | skipped
  ---

  # 标题

  > 来源: [原始链接](url)
  > 抓取时间: 2026-05-27

  ## 正文

  （转换后的网页内容）

  ## 笔记

  （用户自己的笔记区域，导出不覆盖）
  ```

- 如果抓取失败，`fetch_status: failed`，正文区域显示失败原因
- 如果文件已存在且有用户笔记，保留笔记区域不覆盖
- 添加 `--content` / `--metadata-only` 选项（IPC 参数），允许用户选择是否抓取全文

## 6. [Major] UI 集成

修改 BookmarkList.tsx 的导出流程：

- 导出按钮旁添加选项：
  - 「导出全文」— 抓取网页内容 + 转换（默认）
  - 「仅导出元数据」— 现有行为（快速）
- 全文导出时显示进度：
  - "正在抓取: 3/50 (当前: example.com)"
  - 显示跳过/失败的数量
- 导出完成后显示摘要：
  - "导出完成: 45 成功, 3 抓取失败(仅元数据), 2 跳过(已存在)"
- 通过 IPC 事件 `export:progress` 实时推送进度

## 7. [Minor] 缓存机制

避免重复抓取同一页面：

- 数据库新增 `page_cache` 表：
  - url_hash (PK), url, html_content (压缩存储), fetched_at, content_length
- 抓取前检查缓存：如果 fetched_at 在 7 天内，直接使用缓存
- 缓存过期策略：7 天后重新抓取
- 用户可手动清除缓存（Settings 页面）
- 缓存大小限制：总计不超过 500MB，超过时 LRU 淘汰

## 8. [Minor] 特殊页面处理

- PDF 链接：跳过，标记为"PDF 文件，不支持全文导出"
- 需要登录的页面（返回 401/403）：标记为"需要认证"，仅导出元数据
- SPA 页面（JS 渲染）：当前不支持（需要 headless browser），标记为"动态页面，内容可能不完整"
- 非英文/中文页面：正常处理，不做语言限制

## 9. [Major] 现有安全漏洞修复（Red Team 发现）

本 Goal 在实现抓取功能的同时，必须修复以下已存在的安全问题：

### 9.1 URL Health Checker 重定向绕过

当前 `url-checker.ts` 使用 `redirect: 'follow'`，重定向目标不经过 SSRF 验证。
修复：与 page-fetcher 使用相同的手动重定向 + 逐跳验证逻辑。

### 9.2 `showItemInFolder` 任意路径

当前 IPC handler 接受任意路径，可用于确认文件存在/暴露目录结构。
修复：验证路径必须在 vault 目录或 userData 目录内。

### 9.3 `setConfig` vaultPath 无验证

renderer 可设置 vaultPath 为任意目录（如 `C:\Windows\System32`）。
修复：验证路径存在、可写、且不是系统关键目录。

### 9.4 CSP 补强

- 添加 `form-action 'none'`（防止表单提交到外部）
- `img-src` 移除 `data:`（防止 SVG data URI XSS）
- 添加 `frame-ancestors 'none'`

═══════════════════════════════════════════
强制约束：
═══════════════════════════════════════════

【网络与代理】

- 所有 git push/pull/fetch 必须加代理：
  git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 push
- Electron 二进制下载需要镜像：
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
- 网页抓取不需要代理（用户的书签是公网可访问的）

【供应链安全】

- 安装任何新依赖前必须确认：
  a) 包名拼写正确（警惕 typosquatting）
  b) 使用精确版本号
  c) 该版本发布时间超过 7 天
  d) 维护者是已知活跃开发者
  e) 不是单人维护 + 创建不足 6 个月的包
- 本 Goal 需要安装的依赖（均为成熟知名库）：
  - `@mozilla/readability` — Mozilla 官方，用于提取网页正文
  - `linkedom` — 轻量 DOM 实现（如不兼容则用 `jsdom`）
  - `turndown` — HTML→Markdown 转换
  - `turndown-plugin-gfm` — GFM 支持（表格、删除线）
  - 以上均需确认精确版本和发布时间

【代码规范】

- TypeScript strict 模式
- 单引号，尾逗号，100 字符行宽
- Node.js 内置模块用 node: 前缀
- 相对导入用 .js 后缀（ESM）
- 不要引入 React import（已配置 react-jsx transform）
- 不用的变量用 \_ 前缀

【安全 — 本 Goal 最高优先级】

- 导出器中的 sanitize 逻辑不可削弱，只能加强
- SSRF 防护必须应用于所有网页抓取请求
- 转换后的 Markdown 不得包含任何可执行内容：
  - 无 Obsidian 模板语法（<% %>、{{ }}）
  - 无 Dataview 可执行查询
  - 无 javascript:/vbscript:/data: 协议链接
  - 无未闭合的代码块（可能导致后续内容被解释为代码）
  - 无 Obsidian 嵌入语法（![[]]）指向外部或系统文件
- 代码块中的恶意命令是安全的（Obsidian 不执行代码块内容），应保留以供研究
- 日志中不记录抓取的 HTML 全文（可能含敏感信息），只记录 URL 和状态

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 每完成一个功能后运行：pnpm lint && pnpm typecheck && pnpm test
- 测试失败 → 先修复再继续
- 每个功能一个 commit，commit message 格式：feat: xxx 或 fix: xxx
- push 到远程后继续下一个功能
- 优先级：先做 Critical（安全消毒是重中之重），再做 Major，最后 Minor
- 安全测试必须在功能代码之前或同时编写（TDD for security）

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- 依赖安装失败 → 尝试加代理，如果仍失败则跳过
- linkedom 与 Readability 不兼容 → 切换到 jsdom
- 某些页面抓取失败 → 优雅降级为仅元数据，不阻塞整体流程
- turndown 对某些 HTML 结构转换异常 → 添加自定义 rule 处理
- 网络不可用无法 push → 本地 commit，记录待 push

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. 安全测试覆盖的攻击向量列表
5. 需要人工介入的事项
