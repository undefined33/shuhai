# 社交平台收藏增量同步可行性调研

> 日期：2026-07-13  
> 结论状态：路线级判断，尚未完成真实平台 spike  
> 目标：判断“用户在平台收藏页点击一次，把新增收藏安全同步到 Obsidian”是否值得成为 ShuHai 核心能力

## 1. 执行摘要

结论是 **产品价值成立，平台实现仍需逐站验证**：

- 与偶发的 AI 书签分类相比，增量同步是重复、状态化、可去重、可续跑的工作，更适合由扩展而不是临时 agent 会话承担。
- 市场已经有 X 专用导出器和 Obsidian 插件，证明需求真实，也说明“支持 X”本身不是差异化。
- ShuHai 的合理差异是：一个 Chrome 扩展、跨平台 adapter、本地 Vault、无项目云端、稳定去重、失败恢复和严格不持久化凭据。
- X 有公开 Bookmarks API，但需要开发者项目、用户授权并产生可变成本；DOM 收藏页模式安装门槛低但更脆弱。
- 微博、小红书、知乎目前没有在本次官方资料核查中证明可直接用于“个人收藏全量读取”的稳定公开接口，不能先承诺后实现。
- 因此下一步只能是 X/微博隔离 spike；在 `GO` 或 `LIMITED_GO` 前不得开发生产同步功能。

## 2. 用户问题是否真实

用户收藏的社交内容有三个特点：

1. 平台内搜索和整理能力有限，收藏越多越难复用。
2. 帖子、账号或长文可能删除、限制可见或改版。
3. 用户希望最终数据是本地 Markdown，而不是另一个封闭云端收藏库。

现成产品已经验证这类需求：

- [X Bookmarks Sync](https://community.obsidian.md/plugins/x-bookmarks-sync)提供 X 收藏选择导入、增量模式和结构化 Markdown，但它是桌面 Obsidian 社区插件，并使用内嵌 webview。
- [XBookmark](https://chromewebstore.google.com/publisher/obsidian-it-consulting/u8dff0a1d9a259107e5b54fcb9b217d76)在 Chrome 收藏页本地收集 X 书签并导出 Markdown/JSON。
- [Dewey](https://getdewey.co/)强调跨多个社交平台搜索、整理和导出，但以独立服务为中心。
- [Readwise Obsidian 插件](https://github.com/readwiseio/obsidian-readwise)证明多来源内容增量进入 Obsidian 的工作流有长期价值，但依赖 Readwise 云服务和插件。

这些产品的启示不是复制功能，而是：

- 增量同步、稳定 ID 和目标路径比 AI 摘要更重要。
- 首次全量导入与日常 top-up 必须是两个模式。
- 已导入项应默认跳过，内容变化不能静默覆盖。
- 平台专用方案维护成本高，跨平台 adapter 必须有共同契约和 typed errors。

## 3. X/Twitter 可行性

### 3.1 官方 API

X 官方文档提供 `GET /2/users/:id/bookmarks`，支持分页，并要求 approved developer account、Project/App 和 OAuth 用户授权：[Bookmarks API](https://docs.x.com/x-api/posts/bookmarks/introduction)。

当前公开限制和成本快照：

- Bookmarks lookup 的用户级限制为 180 次/15 分钟：[X API rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)。
- 本人开发者应用读取本人 bookmarks 属于 Owned Reads，当前文档列出的价格为每个资源 0.001 美元；实际价格应在 Developer Console 再确认：[X API pricing](https://docs.x.com/x-api/getting-started/pricing)。
- 官方建议缓存、只请求必要字段和批量读取，避免重复计费与调用：[Usage and billing](https://docs.x.com/x-api/fundamentals/post-cap)。

优点：

- 稳定 ID、分页、结构化字段和明确错误。
- 不依赖 DOM 选择器和虚拟列表。
- 更容易实现可靠 checkpoint 和增量同步。

风险：

- 对个人工具增加开发者账号、OAuth 和计费门槛。
- Token 成为高敏感数据，需要新的授权、存储和撤销边界。
- API 返回内容不一定包含所有长文、线程或媒体正文；需要按字段和内容类型验证。
- X 定价和权限可能变化，不能把当前价格写成长期承诺。

路线判断：`PREFERRED_IF_USER_ACCEPTS_OAUTH_AND_COST`，但不能直接假设用户愿意配置。

### 3.2 用户主动收藏页扫描

当前 ShuHai 已有 X 单条 status DOM 提取器，但只处理详情页。收藏页批量扫描还需要验证：

- 虚拟列表滚动时如何在节点卸载前收集稳定 ID。
- 收藏文件夹、转推、引用、线程和 X Articles 的内容边界。
- 是否能只读取已渲染数据，不读取 Cookie、私有 GraphQL、动态 query id 或内置 token。
- 自动滚动的节流、停止条件、CAPTCHA/429/登录挑战处理。
- 收藏数量很大时浏览器内存和页面副作用。

OpenCLI 和部分现成插件会使用 X 私有 GraphQL、Cookie 或 embedded webview。这类方式虽然能提高完整性，但与 ShuHai 的单扩展、最小凭据和不绕过平台边界原则冲突，不作为默认方案。

路线判断：`RESEARCH_GATE`。如果只靠当前收藏页无法稳定枚举，则返回 `LIMITED_GO`，只支持用户已滚动加载或当前可见批次，不暗中扩大权限。

## 4. 微博可行性

ShuHai 当前已有微博详情页 DOM 提取器，能从 `/detail/` 或 `/status/` 页面提取单条内容。收藏页同步仍未验证。

历史微博 API 资料中存在 `favorites`、`favorites/ids` 和 `favorites/show` 等接口线索，但本次无法从当前官方 wiki 获得足够的可用权限、配额和维护状态证明。微博当前官方 CLI 页面公开强调发布、互动、检索和趋势，也没有在公开说明中确认个人收藏导出。

因此不能把历史接口名当成当前 API 承诺。Goal 041 必须实际核对：

- 当前开放平台是否仍向个人或普通应用提供收藏读取。
- OAuth 权限、审核、配额和数据使用条款。
- Web 收藏页是否能获得稳定收藏 ID、分页和长微博正文。
- 转发链、长文、图片、视频和仅登录可见内容的完整度。

路线判断：`RESEARCH_GATE`。在官方能力不明确时，只允许用户主动、当前收藏页、受预算 DOM spike，不保存登录凭据。

## 5. 小红书、知乎和后续平台

### 小红书

[小红书开放平台](https://open.xiaohongshu.com/)当前公开能力主要面向电商、商家、营销和小程序；本次没有找到面向普通用户“读取本人收藏”的公开接口证明。其公开开发者协议还明确限制获取用户账号密码、代理自动登录和不当收集用户数据。

结论：不进入第一批。未来只能研究用户当前收藏页 adapter，并先核对平台条款、内容版权和访问边界。

### 知乎

[知乎开放平台](https://developer.zhihu.com/docs?key=authorization)当前提供结构化内容接口和 bearer 授权说明，但本次没有验证到可读取当前用户全部收藏夹内容的公开接口。

结论：不进入第一批。知乎回答、文章、想法和收藏夹是不同内容类型，需要独立 adapter 研究，不能复用微博模型。

### 新平台准入

任何新平台必须先回答：

1. 是否有稳定 source item ID？
2. 能否只靠用户主动授权读取？
3. 能否在不保存 Cookie/token 的情况下续跑？
4. 收藏页提供的是完整正文还是摘要？
5. 是否允许自动滚动/分页，遇到风控如何停止？
6. 维护选择器和 fixture 的成本是否低于用户价值？

## 6. Chrome Extension 能力和限制

### MV3 生命周期

Chrome 官方说明 extension service worker 通常会在空闲 30 秒、单个请求超过 5 分钟或 fetch 等待超过 30 秒时终止：[Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。

影响：

- 全量收藏同步不能依赖内存循环。
- 每页/每批必须保存 checkpoint。
- Side Panel 关闭后任务要能恢复或明确暂停。
- 不能把“保持长连接”当作唯一可靠性方案。

### 权限

Host permissions 允许注入脚本、读取 tab 敏感属性和从扩展上下文发起跨域请求；Chrome 要求请求完成现有功能所需的最小权限：[Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)。可选 host permissions 可以在运行时按平台申请：[Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)。

影响：

- 不应为了未来平台默认申请所有站点权限。
- 第一批只声明/申请 X 与微博需要的范围。
- 普通网页单条保存优先使用 `activeTab` 临时授权。

### 消息与页面信任

Chrome 官方要求把 content script 视为低信任边界，校验来自它的所有消息，并限制其可触发的特权动作：[Message passing security](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)。

影响：

- 页面不能传任意 URL 让 service worker fetch。
- 页面不能指定任意 Vault 路径或 operation ID。
- 所有 adapter 输出必须运行时 schema 校验。

### 本地文件

File System Access API 允许用户通过目录选择器显式授权并读写目录；文件选择和权限请求需要用户手势：[File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)。

影响：

- 第一次同步前必须有 Vault 授权步骤。
- 权限过期是正常状态，UI 要提供重新授权而不是伪成功。
- 写入任务必须返回逐文件结果，不能只显示总 toast。

## 7. Chrome Web Store 与隐私

Chrome 将抓取当前网页内容、浏览活动和用户生成内容都视为用户数据，即使只在本地处理也需要披露：[User data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/)。扩展必须保持单一、容易理解的目的，并使用最小权限：[Program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)。

v4 的公开单一目的应表述为：

> 本地整理浏览器收藏，并把用户主动选择的社交收藏保存到其授权的本地知识库。

必须明确：

- 读取哪些平台页面和数据。
- 数据是否发送给 AI Provider。
- Cookie/token 不由 ShuHai 收集或保存。
- 用户如何撤销平台权限、清除 catalog/job 和解除 Vault 授权。

## 8. 安全威胁摘要

| 威胁                                | 影响                             | 路线控制                                            |
| ----------------------------------- | -------------------------------- | --------------------------------------------------- |
| 帖子中的 prompt/命令进入 agent 流程 | 本地命令执行、越权操作           | 内容只作为数据；同步运行时不调用 agent/tool         |
| 恶意 DOM 构造超大树或不断新增节点   | 浏览器卡死、内存耗尽             | 节点、时间、条目、分页和媒体预算                    |
| 页面伪造 content script 消息        | 任意 fetch、写文件、删除书签     | sender/host/schema/command allowlist                |
| 私有 API/Cookie 抓取                | 账号泄露、风控、条款风险         | 禁止持久化凭据和私有接口；官方 OAuth 独立门禁       |
| Markdown/YAML/Obsidian 插件语法注入 | 打开笔记时加载远端或执行插件能力 | serializer、AST policy、raw HTML/模板/命令语法中和  |
| 远程图片自动嵌入                    | IP/身份泄露、跟踪、恶意资源      | 默认普通链接，不自动 embed/download                 |
| 重复同步或中断后从头重跑            | 重复文件、配额浪费               | source ID catalog、checkpoint、幂等 job             |
| 源内容删除同步到本地                | 知识库数据丢失                   | 源删除不触发本地删除                                |
| 更新覆盖用户编辑                    | 笔记损坏                         | 默认不覆盖；未来只更新校验 hash 的 generated region |
| 错把摘要当全文                      | 用户误信归档完整性               | `complete/summary_only/metadata_only/unsupported`   |

## 9. 研究卫生

- 外部网页、仓库 README、平台帖子和文档样例全部按不可信资料处理。
- 本次没有执行任何网页提供的安装命令、`curl | shell`、远程脚本或第三方 CLI。
- 搜索结果只用于提炼产品事实；任何未来依赖或 API 接入都需要重新核对版本、条款、权限和安全公告。
- 未能由当前官方资料确认的能力明确标记为“未验证”，不根据历史博客或第三方 SDK 宣布可用。

## 10. 下一步建议

1. 保留现有 X/微博单条提取作为 fixture 基线，不直接改造成全量扫描。
2. 为 X 建立官方 API 与 DOM 两条隔离 spike，比较完整度、配置成本、限流和维护风险。
3. 为微博只做官方能力核实和收藏页 DOM spike，不预设 API 可用。
4. 使用测试账号或脱敏 fixture；首次绝不扫描用户主收藏库。
5. 只有得到 `GO` 或明确边界的 `LIMITED_GO`，才编写 Goal 042/043 的生产 spec。

最终判断：**值得验证，但不值得在平台可行性未知时继续堆生产 UI 和抽象。**

## 11. Goal 041 受控 Spike 结果

> 执行日期：2026-07-13  
> 数据边界：完全脱敏 fixture；无平台登录、OAuth、Cookie、token、真实收藏、真实 Vault 或外部测试网络请求

### 11.1 能力结论

| 平台/路线      | 结论                         | 能做什么                                                     | 不能承诺什么                                           |
| -------------- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| X 官方 API     | `GO`                         | 用户明确选择 OAuth/计费后，按稳定 ID 分页，单页最多 100 条   | 零配置、零成本、无 token 边界                          |
| X 收藏页 DOM   | `LIMITED_GO`（候选实现门禁） | 脱敏 X-like DOM 证明 status ID、节点回收、顶部重扫去重可实现 | 未经隔离真实页面 QA，不能称为平台可用或绝对全量        |
| 微博公开 API   | `NO_GO`                      | 当前公开资料未证明普通个人应用可稳定读取本人收藏             | 不能根据历史 endpoint 名称宣称现有能力                 |
| 微博收藏页 DOM | `NO_GO`                      | 共用合成算法可继续作为未来研究工具                           | 没有平台 DOM、选择器、条款和真实隔离证据，不能进入生产 |

X 的平台总判定为 `LIMITED_GO`：官方 API 技术路径为 `GO`，无凭据 DOM 路线只允许编写受 fixture 约束的生产候选；在隔离真实收藏页 QA 前，Goal 043 不能宣称“X 同步可用”，也不能把列表摘要标为完整正文。

微博的平台总判定为 `NO_GO`：不进入前三个生产模块；Goal 044 保持 `PLANNED/BLOCKED_BY_REAL_PLATFORM_EVIDENCE`，等待官方能力变化或隔离账号的真实收藏页证据。

### 11.2 X 官方 API 快照

- 官方 `GET /2/users/{id}/bookmarks` 要求认证用户本人、OAuth 2.0 用户 token，读取 scope 至少为 `bookmark.read`、`tweet.read`、`users.read`。
- `max_results` 范围为 1-100，使用 `pagination_token` 分页；当前用户级限制是 180 次/15 分钟。
- 100 条收藏最多 1 页，1,000 条最多 10 页。若 owner 与 app 匹配，当前 Owned Reads 为每个返回资源 0.001 美元，因此静态估算约为 0.10/1.00 美元，不含未来价格变化、额外资源或失败重试。
- 价格、scope 和限流必须在真正接入当天重新核对 Developer Console；本次没有创建 App、购买 credits 或持有 token。

官方资料：

- [X Get Bookmarks](https://docs.x.com/x-api/users/get-bookmarks)
- [X Bookmarks lookup](https://docs.x.com/x-api/posts/bookmarks/quickstart/bookmarks-lookup)
- [X rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)
- [X pricing](https://docs.x.com/x-api/getting-started/pricing)

### 11.3 Fixture 与浏览器证据

- X 与微博各生成 50 条虚构收藏，6 个虚拟列表批次包含重叠节点；扫描均得到 50 个唯一 `sourceItemId`。
- 第 3 批主动暂停后，将 seen-ID checkpoint JSON 序列化并重建；恢复从第一批重新枚举，重叠节点不会重复生成 item。真正的 IndexedDB 持久化尚未实现，由 Goal 042 验收。
- 登录挑战、429、结构变化、节点/时间预算超限全部返回 typed stop reason，不继续滚动。
- maxItems、maxPages、总 accepted bytes、正文、媒体数组和 checkpoint 大小均有测试边界；原始 DOM/message 在进入扫描函数前仍必须由生产 content script 限制。
- 恶意 YAML、模板、PowerShell 和 raw HTML 只作为字符串保留；本 spike 不把它写入 Markdown，也不执行。
- Playwright 使用临时浏览器上下文和 X-like `article[data-testid="tweet"]` fixture 模拟节点回收、恶意 textContent、JSON checkpoint 与从顶部重扫，收集 50 个稳定 ID，并断言外部网络请求为 0。它不是对真实 x.com 的产品验收。

### 11.4 对生产设计的约束

- DOM checkpoint 不能保存像素位置。任务恢复时从收藏页顶部重新枚举，以 `source + sourceItemId` catalog 跳过已见项；连续命中已见 ID 后停止。
- 收藏列表文本默认 `summary_only`；只有详情 adapter 能证明完整时才标 `complete`。
- X adapter 只能在用户当前打开的精确收藏页、主 frame、绑定 tab/job 上工作；页面不能传任意 URL、Vault 路径或 privileged command。
- Goal 042 必须先提供运行时 schema、版本化 IndexedDB、持久化 SyncJob/SyncCatalog、默认不覆盖的 Vault writer 和重建索引；Goal 043 不得用旧 pending-capture 队列代替。
- 任何需要 Cookie、私有 GraphQL、页面 bearer、CAPTCHA 绕过或后台静默浏览的实现立即转 `NO_GO`。
