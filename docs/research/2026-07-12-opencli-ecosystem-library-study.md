# OpenCLI、现成库与同类产品调研

> 调研日期：2026-07-12  
> 目的：减少自造轮子，同时避免为一个纯扩展产品引入新的安装包、隐私边界和供应链风险  
> 结论性质：架构决策输入；任何版本在安装前必须重新核对

## 1. 调研安全方法

本次外部资料全部按**不可信数据**处理：

- 只阅读官方项目仓库、官方文档和 npm 元数据。
- 不执行网页、README、Issue 或第三方文章中的命令和提示。
- 不使用外部页面中的 prompt、Cookie、token、脚本片段或构建产物。
- 对 OpenCLI npm 包只做静态文件审阅，不启动 daemon、不连接现有 Chrome、不读取登录态。
- 不因为项目声称“安全”就把它当作 ShuHai 的安全边界。

## 2. 结论摘要

### 2.1 最重要的判断

1. **OpenCLI 不应成为 ShuHai 的运行时依赖。**它的 Browser Bridge + 本地 daemon + 登录态 Chrome 自动化会重新引入第二个安装组件和更大的信任边界。
2. **OpenCLI 值得学习 adapter 契约、结构化输出、typed error、fixture 和失控保护。**这些思想可在纯扩展内实现。
3. **内容提取不应继续全部自研。**Defuddle、DOMPurify、Turndown/remark、`yaml` 组成的候选管线值得独立 spike，但没有任何单个库能独自解决恶意 Markdown 和 Obsidian 语义风险。
4. **运行时数据边界和持久化任务应尽快采用成熟小库。**`zod` 与 `idb` 的收益明显，风险与体积可控。
5. **同类产品最值得学习的是任务收敛，不是功能数量。**Obsidian Web Clipper、MarkDownload、Raindrop、Karakeep、Linkwarden 分别展示了单任务 popup、可预览转换、检测是提示、标签与集合分工、结构化搜索等模式。

## 3. OpenCLI 深入评估

### 3.1 它是什么

[OpenCLI 官方仓库](https://github.com/jackwener/opencli)将网站能力暴露为命令行接口。网页 adapter 通过 [Browser Bridge / Web Adapter](https://opencli.info/docs/adapters/browser/web.html) 使用用户已经登录的 Chrome 页面，并由本地进程协调浏览器、页面与结构化输出。

2026-07-12 查询 npm 时，`@jackwener/opencli` 的快照为 `1.8.6`，许可证为 Apache-2.0，要求 Node.js 20+；解包体积约 12.7 MB、文件约 2207 个。其依赖包含 Readability、Turndown、`js-yaml`、`undici` 和 WebSocket，并带安装生命周期脚本。以上只是调研快照，不是未来安装版本。

### 3.2 为什么不直接接入

| 冲突     | OpenCLI 需要                          | ShuHai v3 需要                    |
| -------- | ------------------------------------- | --------------------------------- |
| 产品安装 | 浏览器 Bridge + 本地 daemon/CLI       | 一个 Chrome 扩展                  |
| 登录态   | 自动化用户已登录 Chrome               | content script 只处理用户当前页面 |
| 权限边界 | 跨站 adapter、daemon、CDP/浏览器协调  | 最小站点权限和主动用户操作        |
| 维护面   | CLI、daemon、Bridge、adapter 共同升级 | extension + Vault 目录授权        |
| 安全暴露 | Cookie/页面/本地 IPC/供应链           | 浏览器沙箱内提取和显式写入        |

把 OpenCLI 嵌入核心流程会推翻“纯扩展、单安装包”的产品决策。它也不能替 ShuHai 解决 Markdown、Vault 写入冲突、Chrome 书签恢复和 UI 简化问题。

### 3.3 Twitter/X adapter 的启示和风险

静态审阅 OpenCLI 的 Twitter bookmarks adapter 后发现，它依赖 X 的内部 GraphQL `Bookmarks`、登录态 `ct0` Cookie 和 bearer token，还会处理动态 query id、分页、note tweet、媒体和去重。

这类实现的优点是可以批量获取结构化书签；缺点是：

- 使用未承诺稳定的内部接口，随时可能失效。
- 必须接触用户登录态和站点 token。
- 动态发现 query id 增加远程配置与脚本扫描依赖。
- 可能受到站点条款、限流和账户风控约束。
- 一旦被 ShuHai 内置，就需要长期跟随 X 的私有实现变化。

因此 ShuHai 不复制该 adapter，也不承诺 Twitter/X 账户级批量同步。当前策略仍是用户打开内容后主动提取。

### 3.4 值得借鉴的设计

- 明确的 adapter 元数据：站点、域名、访问策略、参数和输出列。
- 命令结果以结构化对象返回，而不是让 UI 猜测 DOM 状态。
- typed errors：未登录、选择器变化、内容过大、分页终止、网络失败。
- 每个 adapter 有脱敏 fixture 和 parser 单测。
- 分页上限、去重和 runaway guard。
- 可观察但脱敏的诊断信息。
- 明确 fallback 链，并把最终使用的来源返回给用户。

### 3.5 可选的未来集成

核心产品稳定后，可以考虑一个**离线 JSON 导入器**：

1. 用户自行运行 OpenCLI 并导出 JSON。
2. ShuHai 只读取用户选择的文件，不连接 daemon、不控制 Chrome、不读取 Cookie。
3. 用运行时 schema 校验版本、字段、大小和 URL。
4. 展示预览、重复项和目标路径，用户确认后再入库。

它应是高级可选入口，不进入近期路线，也不成为保存当前内容的依赖。

## 4. 候选库评估

### 4.1 建议优先评估采用

| 库                                                                               | 2026-07-12 快照 | 用途                                 | 边界与注意事项                                                              | 建议          |
| -------------------------------------------------------------------------------- | --------------- | ------------------------------------ | --------------------------------------------------------------------------- | ------------- |
| [Zod](https://zod.dev/)                                                          | `4.4.3`         | 消息、存储、AI 输出、导入 schema     | 需要设计错误提示和版本迁移，不能只在 TypeScript 编译期校验                  | Goal 034 优先 |
| [idb](https://github.com/jakearchibald/idb)                                      | `8.0.3`         | Promise 化 IndexedDB、事务与迁移     | 不能把浏览器 IDB 事务误解为跨 Chrome API 事务                               | Goal 034 优先 |
| [yaml](https://eemeli.org/yaml/)                                                 | `2.9.0`         | 结构化生成 YAML frontmatter          | 禁用/限制 alias，仍需字段白名单和字符串长度预算                             | Goal 033/035  |
| [tldts](https://github.com/remusao/tldts)                                        | `7.4.8`         | 可注册域名、同域调度、分类与重复检测 | 官方明确它不是合规 URL 安全解析器；必须先用 `new URL()`，不能用于 SSRF 决策 | Goal 039      |
| [Testing Library](https://testing-library.com/docs/react-testing-library/intro/) | React `16.3.2`  | 从用户视角测试组件                   | 避免实现细节断言                                                            | Goal 040      |
| [user-event](https://testing-library.com/docs/user-event/intro/)                 | `14.6.1`        | 更真实的键盘、鼠标交互               | 需要处理异步和 focus 行为                                                   | Goal 040      |
| [axe-core Playwright](https://playwright.dev/docs/accessibility-testing)         | `4.12.1`        | 自动化可访问性检查                   | 自动扫描不能替代键盘和人工语义检查                                          | Goal 040      |

版本只用于记录本次调研状态。实施 Goal 必须精确锁版本并重新检查许可证、安全公告、包体和安装脚本。

### 4.2 内容提取候选：必须先 spike

#### Defuddle

[Defuddle](https://github.com/kepano/defuddle)由 Obsidian Web Clipper 相关作者维护，面向浏览器，提供正文、元数据和 Markdown 输出。2026-07-12 npm 快照为 `0.19.1`，MIT，仍处于 `0.x` 演进阶段。

优点：

- 比简单 Readability 更关注网页元数据和 Markdown。
- 与 Obsidian Web Clipper 的真实使用场景接近。
- 浏览器端可用，适合当前页面提取。

关键风险：

- 它是提取器，不是安全 sanitizer。
- API 和行为仍可能快速变化。
- 异步解析可能在本地信息不足时访问第三方 FxTwitter 服务。ShuHai spike 必须使用本地解析或显式 `useAsync: false`，不允许隐式外发页面 URL/内容。

#### Mozilla Readability

[Readability](https://github.com/mozilla/readability)成熟、专注文章正文，但输出仍是 HTML。官方安全说明也要求在使用结果前配合 sanitizer，并提供 `maxElemsToParse` 等资源限制。

适合当作质量基线或 fallback，不应再直接把输出当作安全 Markdown。

#### DOMPurify

[DOMPurify](https://github.com/cure53/DOMPurify)是成熟 HTML sanitizer。2026-07-12 快照为 `3.4.12`。

它解决 HTML 元素、属性和 URL 方案的部分问题，但：

- sanitize 后再让其他库改变 DOM，可能破坏其保证。
- 它不理解 Obsidian wikilink、模板语法、Markdown raw HTML 或插件语义。
- 远程图片、链接隐私和本地 URI 需要额外策略。

#### Turndown 与 remark/rehype

[Turndown](https://github.com/mixmark-io/turndown)适合 HTML -> Markdown 转换，生态成熟；[remark](https://github.com/remarkjs/remark)与[rehype](https://github.com/rehypejs/rehype)适合把 Markdown/HTML 当 AST 处理并实施结构化策略。

建议 spike 两条管线：

1. `DOM clone -> Defuddle/Readability -> DOMPurify -> Turndown -> Markdown AST policy -> yaml stringify`
2. `DOM clone -> Defuddle Markdown -> Markdown AST policy -> yaml stringify`

以 fixture 质量、安全、体积和性能决定，不先入为主。

### 4.3 条件采用

| 库                                                                    | 快照             | 条件                                                                                    |
| --------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| [TanStack Virtual](https://tanstack.com/virtual/v3/docs/introduction) | `3.14.5`         | 先用 1,500、10,000 书签基准证明当前 `VirtualList` 有真实问题，再替换                    |
| [p-retry](https://github.com/sindresorhus/p-retry)                    | 建议评估 `7.1.1` | 最新 v8 需要 Node 22，与项目 Node 20 基线不符；必须限制可重试错误、次数和 `AbortSignal` |

重试不能用于破坏性 Chrome API 操作，也不能把 HTTP 4xx、权限错误或 schema 错误变成重复请求。

### 4.4 当前不建议采用

- OpenCLI 作为运行时依赖。
- LangChain、LlamaIndex 或大型 agent/AI orchestration SDK。
- Dexie：当前需求用 `idb` 足够，避免重复抽象。
- WXT、Plasmo 全量迁移：现有 Vite/MV3 构建已运行，迁移不会直接提升用户价值。
- SingleFile、Monolith 一类完整网页归档方案：与“不批量归档任意恶意页面”的边界冲突。
- Puppeteer/Playwright 作为生产抓取引擎。
- webextension-polyfill：产品目前 Chrome-only。
- 任意要求另装本地 daemon、Native Messaging host 或 Obsidian 社区插件的核心方案。

## 5. 推荐内容管线

以下是目标管线，不代表已经实现：

```text
用户主动保存当前页面
  -> 选择站点 adapter；不存在时使用 selection/generic article
  -> clone DOM，不操作 live DOM
  -> 应用节点数、深度、时间、文本和媒体数量预算
  -> 提取结构化内容；失败时 metadata-only，禁止 body.textContent 兜底
  -> HTML 严格 allowlist sanitize
  -> 转 Markdown
  -> Markdown AST 策略：URL scheme、raw HTML、模板/插件语法、资源链接
  -> yaml.stringify 生成 frontmatter
  -> 文件名/路径/总大小/冲突策略检查
  -> 用户确认最终相对路径
  -> Vault writer 返回逐文件结构化结果
```

### 5.1 Fallback 顺序

1. 站点专用 adapter。
2. 用户当前选择文本。
3. 通用文章提取器。
4. 标题、来源 URL 和少量 metadata。
5. 明确失败。

禁止把整个 `body.innerText` 作为成功兜底；它会把导航、隐藏提示、恶意诱导和无关页面状态写进知识库。

### 5.2 Markdown 安全策略

- 只允许 `http:`、`https:` 和明确批准的内部相对链接。
- 默认把远程图片变成普通链接，不在 Obsidian 中自动加载。
- 去除 raw HTML、`javascript:`、危险 data URL、iframe、表单和事件属性。
- 对 `{{...}}`、`<%...%>`、DataviewJS、命令 URI、插件协议等做产品级策略，不依赖 HTML sanitizer。
- frontmatter 只接收固定字段，通过 YAML serializer 生成，不拼字符串。
- 标题、作者、标签、URL、正文和 AI 输出都设置长度/数量上限。
- 保留来源 URL 和捕获时间，但不保留 Cookie、token、DOM 快照或请求头。

## 6. 同类产品可学习点

### 6.1 Obsidian Web Clipper

资料：[官方仓库](https://github.com/obsidianmd/obsidian-clipper)、[捕获文档](https://obsidian.md/help/web-clipper/capture)、[故障排查](https://obsidian.md/help/web-clipper/troubleshoot)

值得学习：

- Popup 围绕当前页面保存，不塞入知识库管理后台。
- 提取、选择文本、高亮和模板形成明确 fallback。
- 使用 Defuddle + DOMPurify，但仍保留失败排查路径。
- 模板是高级能力，不应阻塞第一次保存。

不照搬：依赖 Obsidian 桌面集成的具体传输方式，以及高级模板复杂度。

### 6.2 MarkDownload

资料：[官方仓库](https://github.com/deathau/markdownload)

值得学习：点击扩展 -> 预览/编辑 Markdown -> 复制或下载，选择文本是直观 fallback；Readability + Turndown 提供成熟基线。

不照搬：下载目录不是 Vault 写入模型，完整页面转换仍需要 ShuHai 的安全与冲突策略。

### 6.3 Raindrop.io

资料：[Broken links](https://help.raindrop.io/broken-links)、[Duplicates](https://help.raindrop.io/duplicates)、[Filters](https://help.raindrop.io/filters)

值得学习：

- “失效”是提示，不是自动删除判决。
- Basic、Default/Standard、Strict 按可信度逐步扩大异常范围。
- 重复检测解释协议、`www`、尾斜杠、tracking 参数和 fragment 归一化。
- 筛选项只在有匹配数据时出现。
- 大规模 AI 变更前要求确认。

### 6.4 Karakeep

资料：[官方文档](https://docs.karakeep.app/)

值得学习：标签用于多维关联，列表/集合用于主要归属；规则和本地 AI 可以配合。

不照搬：其服务器、自托管、归档和协作范围远大于 ShuHai；源码为 AGPL-3.0，不复制实现。

### 6.5 Linkwarden

资料：[官方文档](https://docs.linkwarden.app/Usage/overview)

值得学习：一个主要 collection 配合多个 tags，以及结构化搜索。

不照搬：服务器归档、多人协作和 AGPL-3.0 代码。

### 6.6 Readwise Reader

资料：[Obsidian 导出帮助](https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian)

值得学习：增量写入、稳定目标位置和尽量保留用户已经编辑的内容。

不照搬：依赖第三方云服务和 Obsidian 插件的同步模型。

## 7. 对 ShuHai 的具体产品影响

### 7.1 文件夹与标签

- Chrome 文件夹表示主要位置，一条书签只有一个位置。
- ShuHai/Markdown 标签表示安全研究主题、技术、来源或项目等多维属性。
- AI 可以建议标签，但不能为了多维分类创建大量嵌套文件夹。

### 7.2 健康检测

- 404/410 是高可信失效候选，不等于自动删除。
- timeout、abort、5xx、429、TLS、DNS 和重定向要分开呈现。
- 同域限速和全局并发同时保留。
- 批量删除必须建立在 Goal 032 的真实恢复之上。

### 7.3 保存队列

- 正常单条保存不进入队列。
- 队列只用于批量捕获、用户选择“稍后处理”、权限/写入失败或恢复未完成任务。
- 队列项必须显示进入原因，而不是让用户猜“刚才保存到哪里了”。

### 7.4 AI

- 规则和历史结果先处理，AI 只补充不确定项。
- 书签标题、URL、页面文本全部放在结构化数据边界，提示词明确其不可信。
- 输出必须 schema 校验并显示建议来源、置信度和变更预览。
- 当前四类 Provider 已足够，近期不继续加平台。

## 8. 依赖引入门禁模板

每个新依赖的 Goal 必须记录：

1. 它替代了哪段具体自研代码或风险。
2. 不引入它的真实成本。
3. 精确版本和锁文件变化。
4. 许可证及是否需要 NOTICE/attribution。
5. minified/gzip 体积和运行时性能。
6. 直接/传递依赖、安装脚本和原生模块。
7. Node/Chrome/MV3/CSP 兼容性。
8. 维护频率、bus factor、公开安全记录。
9. 数据外发、遥测、远程配置或隐式网络调用。
10. 最小 spike、攻击 fixture、回滚方案。

通过评估不等于立即采用；只有对应 Goal 的验收证据可以授权生产迁移。

## 9. 最终决策

- **采用思想，不采用 OpenCLI 运行时。**
- **优先小型基础库，拒绝大框架迁移。**
- **提取库先对比、攻击测试，再决定。**
- **先修数据正确性，再重做 UI，再优化算法。**
- **任何新能力都必须让两个核心任务更快、更可信，否则进入 backlog。**
