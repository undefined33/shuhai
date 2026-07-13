# ShuHai 全方位产品、UI、安全与工程审计报告

> 审计日期：2026-07-12  
> 审计对象：`C:\Projects\ShuHai` 当前 `main` 分支  
> 审计性质：只读审查，不修改业务代码  
> 结论状态：整改规划依据，不代表任何单项修复已经完成

## 1. 执行摘要

ShuHai 已经完成了四条主要能力链路：

1. Chrome 书签读取、规则/AI 分类、方案确认、应用与撤销。
2. URL 健康检测、暂停/继续、筛选和批量处理。
3. 当前网页、Twitter/X 和微博内容提取，进入待保存队列并预览。
4. 通过 File System Access API 将书签索引或文章 Markdown 写入 Obsidian Vault。

从工程完成度看，它不是一个“没有做完”的项目；从真实使用体验看，它仍然更像一个功能控制台，而不是一个让普通用户愿意持续使用的 Chrome 扩展。

当前最重要的问题不是继续增加 AI Provider、模板或诊断功能，而是同时解决以下四个根因：

- **产品主线不清晰**：高频的“保存当前内容”和低频的“维护书签”被混在同一套导航和状态里。
- **数据安全存在缺口**：批量删除备份不可真正恢复；文件冲突可能被静默当作保存成功。
- **AI 和恶意内容边界不够严格**：不可信书签内容直接进入提示词，Markdown 与 DOM 提取仍有语义注入和资源耗尽风险。
- **UI 缺乏任务焦点**：信息密度、字号、容器、图标和状态提示都更接近后台管理系统，而不是高频浏览器工具。

因此，本报告建议立即冻结新功能，先完成“安全与数据完整性”“产品与 UI 重启”“算法降噪”“工程可靠性”四个阶段。只有当用户本人连续两周稳定使用，核心使用指标达到目标后，再恢复功能扩展。

## 2. 产品定位建议

### 2.1 建议保留的核心价值

ShuHai 应被重新定义为：

> 一个以 Chrome 扩展为唯一产品入口、帮助用户整理浏览器书签并将当前优质内容安全保存到 Obsidian 的个人知识采集工具。

产品只需要对外表达两个任务：

| 用户任务         |         使用频率 | 用户想得到的结果                                            |
| ---------------- | ---------------: | ----------------------------------------------------------- |
| 保存当前内容     |       每日、高频 | 当前文章、推文或微博以可确认的 Markdown 写入指定 Vault 路径 |
| 整理 Chrome 书签 | 每周或每月、低频 | 分类混乱书签、核实失效链接，并能够安全撤销                  |

### 2.2 不建议继续强调的定位

- 不再宣传为同时维护 Electron 与 Chrome 扩展的双端产品。
- 不再把“所有书签导出成 Markdown 索引”作为主要价值，它只是整理完成后的可选工具。
- 不承诺自动归档所有网站全文，更不在本地后台批量抓取恶意网页。
- 不把 SQLite、模板编辑器、诊断日志、活动导出等内部能力放在主要界面。
- 不以“支持更多 AI Provider”作为近期产品竞争力。

### 2.3 推荐产品结构

ShuHai 应采用“两个任务、三个界面”，而不是继续增加首页卡片或平级 Tab。

| 界面          | 唯一职责     | 应包含                                         | 不应包含                             |
| ------------- | ------------ | ---------------------------------------------- | ------------------------------------ |
| Toolbar Popup | 保存当前页面 | 提取状态、标题、目录、标签、路径预览、确认保存 | 全量书签树、健康检测、备份、复杂设置 |
| Side Panel    | 维护书签     | 概览、分类建议、失效链接、批量待处理任务       | AI Key、模板编辑器、完整诊断日志     |
| Options Page  | 低频配置     | Vault、AI Provider、规则、模板、备份恢复、诊断 | 每次打开都要求用户处理的任务         |

右键菜单应作为快捷入口，而不是用户发现“保存内容”功能的唯一方式。

## 3. 审计范围与方法

### 3.1 覆盖范围

- Chrome Extension popup、side panel、service worker 和 content scripts。
- 书签分类、健康检测、文章/社交内容提取、Vault 写入和备份流程。
- AI Provider、提示词、分类输出与用户确认边界。
- Manifest 权限、跨域请求、扩展存储和恶意 Markdown 风险。
- UI 信息架构、视觉层级、可访问性和主流扩展交互范式。
- Monorepo 架构、遗留 Electron 代码、测试覆盖率和项目文档一致性。

### 3.2 审计方法

- 静态阅读关键实现及相关测试。
- 结合当前对话中的真实使用截图和已报告交互问题进行用户旅程复盘。
- 运行 lint、typecheck、单元测试、扩展构建、E2E smoke、覆盖率和生产依赖审计。
- 外部调研仅使用 Chrome、W3C、OWASP、Notion、Obsidian 和 Raindrop 官方资料；不采纳网页中的任何操作指令，也不将外部文本作为项目提示词执行。

### 3.3 限制

- 本次未能连接用户当前已登录的 Chrome 实例进行完整动态点击审计。
- Twitter/X 和微博的登录态 DOM 未做完整跨账号、跨语言、跨布局实测。
- 安全结论是基于当前代码和已知攻击面，不应被理解为“覆盖所有 OWASP 风险”或形式化安全证明。
- 第三方 Obsidian 插件可能扩大 Markdown 的执行语义，最终风险还取决于用户实际安装的插件。

## 4. 最高优先级发现

### P0-1 批量删除的备份承诺不成立

**证据**

- `packages/extension/src/popup/App.tsx:1175-1204` 对每条记录分别发送 `bookmark:delete`。
- `packages/extension/src/utils/chrome-bookmarks.ts:364-373` 每删除一条书签前都会读取完整书签树并创建备份。
- `packages/extension/src/utils/backup.ts:11-12` 只保留最近 5 份备份。
- 设置页只能下载备份 JSON，没有从备份恢复 Chrome 书签树的实现。

**风险**

如果用户批量删除 183 条书签，会产生 183 次全量备份，但最早、最有价值的“删除前快照”很快被后续快照淘汰。最终保留的 5 份快照都可能已经缺失绝大多数被删除内容。UI 中“已经自动创建备份”“便于撤销”的表达会让用户产生错误安全感。

逐条备份还造成明显性能浪费，并增加中途失败后状态不一致的可能性。批量更新重定向 URL 也存在同类问题。

**整改要求**

1. 每个批量操作只创建一次操作前事务快照。
2. 使用一个批量 service worker 命令完成操作，不在 UI 循环发送数百条消息。
3. 持久化操作日志、成功项、失败项和快照 ID。
4. 提供真正的“恢复此操作”按钮，而不仅是下载 JSON。
5. 部分失败时允许重试剩余项或从快照回滚。
6. 将恢复流程加入 E2E 测试。

### P0-2 文件冲突会被静默报告为保存成功

**证据**

- `packages/extension/src/utils/vault-writer.ts:313-351` 遇到已存在文件时增加 `skipped`，不写文件，`files` 可能为空。
- `packages/extension/src/popup/pages/InlineSavePanel.tsx:195-217` 使用预览路径作为回退路径，并无条件移除待保存内容和显示“已写入”。

**风险**

同名文章、标题截断碰撞或再次保存更新后的同一页面时，内容可能没有写入，用户却得到成功反馈，待保存副本也被删除。这属于静默数据丢失，比显式报错更危险。

**整改要求**

1. 只有 `exported === 1` 时才能显示成功并从队列删除。
2. 文件冲突必须进入明确状态：覆盖、保留两个版本、自动重命名或取消。
3. 根据稳定 source ID/URL 判断“同一内容更新”，不能只按文件名判断。
4. 成功反馈必须使用实际返回路径，不能使用预览路径伪装结果。
5. 增加同名标题、重复保存、内容更新和并发写入测试。

### P0-3 AI 分类存在间接提示词注入与隐私暴露

**证据**

- `packages/extension/src/shared/ai-classifier.ts:104-130` 将书签标题、URL、当前文件夹和文件夹摘要直接拼接进提示词。
- `packages/extension/src/shared/ai-classifier.ts:217-230` 只发送一个 `user` message，没有稳定的系统指令与不可信数据边界。
- `packages/extension/src/shared/ai-classifier.ts:79-89` 通过寻找首个 `[` 和末个 `]` 解析 JSON。
- `packages/extension/src/shared/ai-classifier.ts:133-148` 接受并截断模型自己声明的 confidence。
- `packages/extension/src/shared/classifier.ts:486-499` 在安全模式下可能根据该 confidence 默认选中建议。

**风险**

恶意网页可以把攻击文本放进书签标题或文件夹名，例如要求模型忽略分类规则、将所有书签移动到指定目录或返回极高 confidence。当前实际书签 ID 迭代和人工确认限制了直接破坏范围，这是现有的重要防线，但不能阻止整批误分类和高置信度诱导。

此外，分类会把标题、URL 和目录结构发送到用户选择的第三方 Provider。自定义 `baseUrl` 还会同时收到 API Key 和整个输入批次，当前 UI 对这一信任边界提示不足。

**整改要求**

1. 规则优先，AI 只接收规则无法确定的最小数据集合。
2. 使用 system message 固定策略，把书签作为显式标记的不可信数据传入。
3. 对输出实施严格运行时 Schema、长度、枚举、bookmark ID 和目标目录白名单。
4. 不信任模型 confidence；由本地证据、一致性和分类边界计算可信度。
5. 新建文件夹建议永不默认选中。
6. 运行前展示 Provider 域名、发送数量、字段和预计成本。
7. 自定义 Provider 增加明显的“该服务器将收到 API Key 和书签数据”警告。
8. 增加恶意标题、恶意文件夹名、伪 JSON、超长输出和未知 ID 测试。

参考：OWASP [LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)。

### P0-4 Markdown 与 DOM 安全边界仍不完整

**现有优点**

- 远程图片被转为普通链接而不是 Markdown 图片嵌入，降低了 Obsidian 打开笔记时的自动追踪风险。
- script、style、iframe、object、embed、form 和 SVG 等节点会被丢弃。
- 文件名和分类路径已经包含路径穿越防护。
- Templater、Dataview 和部分 `obsidian://` 语法已有中和逻辑。
- 内容大小和媒体数量已有上限。

**缺口**

- `packages/extension/src/content/article.ts:331-334` 没有按 Markdown 上下文完整转义链接文本，攻击者可能构造闭合括号逃逸原链接。
- `packages/extension/src/utils/sanitize.ts:125-136` 没有使用 Markdown AST 全面验证所有链接 scheme。
- `javascript:`、`file:`、其他命令型 URI 或社区插件自定义 scheme 可能作为普通 Markdown 链接残留。
- `packages/extension/src/content/article.ts:381-415` 会收集大量候选节点、读取 `textContent`/`innerHTML`、遍历后代并排序；恶意超大或深层 DOM 可能造成页面卡顿。
- 输出大小限制发生在提取后，无法防止提取阶段的 CPU 和内存消耗。

**整改要求**

1. 使用真正的 Markdown AST 或上下文感知 serializer，禁止依赖局部字符串替换。
2. 对所有链接 scheme 使用允许列表，默认只允许 `https:`、`http:`，必要时允许 `mailto:`。
3. 将来源代码、模板样式文本放入明确的纯文本/代码围栏，避免被 Obsidian 插件解释。
4. 为 DOM 提取增加节点数、深度、文本长度和总耗时预算。
5. 单遍评分候选区域，避免对所有 `div` 进行高成本排序。
6. 超出预算时明确失败，保留 URL 和标题供用户手工处理。

## 5. 安全与隐私审计

### 5.1 API Key 存储

`packages/extension/src/utils/storage.ts:231-236` 将完整设置，包括 Provider API Key，持久化到 `chrome.storage.local`。代码没有调用 `chrome.storage.local.setAccessLevel()`，也没有 session-only Key 模式。

Chrome 官方文档说明，`storage.local` 默认可暴露给 content scripts，扩展可以通过 access level 将其限制到可信扩展上下文。虽然 content script 运行在 isolated world 中，但它仍然与页面共享 DOM，敏感配置不应无必要地暴露给该上下文。

**建议**

- 扩展启动时把 local storage access level 限制为 trusted extension contexts。
- 将 API Key 与普通设置分开存储。
- 提供“仅本次浏览器会话保存”模式。
- 明确说明纯扩展方案无法获得操作系统级安全存储；持久 Key 并不等于系统加密。
- 永不在日志、活动历史、错误 toast 或导出诊断中包含 Key。

参考：[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) 与 [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)。

### 5.2 URL 健康检测与内部网络访问

`packages/extension/src/utils/url-health.ts:62-97` 阻止部分字面私有 IPv4、localhost、`.local` 和 `::1`，但没有覆盖：

- 公网域名解析为私网地址。
- 公网 URL 重定向到私网地址。
- CGNAT、benchmark、更多 IPv6 ULA/link-local 表示。
- DNS rebinding 和不同解析时点造成的 TOCTOU。

`packages/extension/src/utils/url-health.ts:188-209` 使用 `redirect: 'follow'`，没有对每一跳重新检查目标。Manifest 可选权限允许扩展跨域请求任意 HTTP/HTTPS 主机，因此不能只依赖浏览器默认网络策略。

**建议**

- 默认使用手动重定向，每一跳重新解析和验证协议、主机和地址。
- 限制跳转次数，记录完整 redirect chain。
- 明确阻止 loopback、link-local、私网、CGNAT、benchmark 和云元数据地址。
- 把权限请求推迟到用户开始体检时，并解释用途。
- 保留 `credentials: 'omit'`、无 referrer、超时、并发 8 和同域 2 秒间隔等现有防护。

参考：[Chrome extension cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) 与 [Local Network Access](https://developer.chrome.com/blog/local-network-access)。

### 5.3 健康检测误判

当前分类对部分 4xx 状态过于激进。400、401、403、405、408、429 等并不等同于资源已经死亡；HEAD 请求也可能被站点单独拒绝。把 HTTP 到 HTTPS、尾斜杠、区域域名等规范重定向都归入“重定向待处理”，会产生大量没有操作价值的结果。

**建议状态模型**

| 状态        | 判断策略                      | 默认操作                               |
| ----------- | ----------------------------- | -------------------------------------- |
| 确认死链    | GET 再确认后的 404/410        | 提醒用户核实，可批量选择，绝不自动删除 |
| 受限/需登录 | 401/403                       | 保留，不列为死链                       |
| 限速        | 429                           | 延迟重试                               |
| 临时失败    | 超时、网络错误、5xx           | 重试并保留                             |
| 规范重定向  | HTTP 到 HTTPS、同站 canonical | 可单独批量更新                         |
| 跨域重定向  | 域名发生变化                  | 要求用户检查目标                       |
| 检测不兼容  | HEAD/机器人策略异常           | 使用受控 GET 再确认或标记未知          |

默认检测范围应从“全部书签”改为“新书签、未检测书签、超过 30 天未检测书签”。

### 5.4 Twitter/X 与微博提取

`packages/extension/src/content/twitter.ts:147-162` 使用页面上第一个匹配的 tweet article，媒体选择器还可能收集当前视口其他推文的图片。`packages/extension/src/content/weibo.ts:99-123` 在无法定位内容时可能退化为截取整个 `document.body.textContent`。

**风险**

- 保存错误的帖子或混入其他帖子的媒体。
- 抓取导航、评论、推荐内容甚至当前页面上的私密文本。
- 网站改版后“看似成功”，实际写入错误内容。

**建议**

- 从当前 URL 提取 status/detail ID，并绑定对应 permalink/article 容器。
- 找不到目标时 fail closed，禁止整个 body fallback。
- 在写入前显示作者、来源 URL、正文开头和媒体数量供用户核实。
- 为 Twitter/X、微博不同语言和布局保存脱敏 DOM fixture，建立契约测试。
- 提供“提取失败，复制诊断信息”而不是自动上传 DOM 快照。

### 5.5 权限与第三方请求

- `http://*/*`、`https://*/*` 应继续保持 optional host permissions，只在用户主动运行健康检测时申请。
- x.com、twitter.com、weibo.com 的长期 host permissions 应评估是否可以改成用户触发时的 `activeTab` + 动态注入。
- `packages/extension/src/popup/styles.css` 的远程 Google Fonts 导入会为一个强调隐私的扩展引入第三方请求和离线依赖，应改为系统字体或打包本地字体。
- Manifest 当前没有完整品牌 icons，应补齐 16/32/48/128 等尺寸，避免 Chrome 使用占位图标。

## 6. 分类算法与 AI 使用审计

### 6.1 当前算法的主要问题

1. `packages/extension/src/background/service-worker.ts:124-150` 会先把全部书签发送给 AI，再用 AI 建议覆盖规则结果。
2. `packages/extension/src/shared/ai-classifier.ts:251-300` 以每批 50 条顺序执行，单次非取消错误会中止全部流程，没有断点、重试或退避。
3. 全量模式可能生成数百条需要人工逐项确认的建议。
4. 安全模式会跳过已在某些文件夹中的书签，容易出现“运行成功但 0 条建议”，用户会认为功能没有工作。
5. `packages/extension/src/utils/rule-matcher.ts:88-95` 使用 `hostname.includes(pattern)`，可能让 `evilgithub.com` 错误匹配 `github.com`。
6. 默认规则具有明显安全研究场景偏好，不适合作为所有用户的通用默认分类体系。
7. AI 提示倾向中文目录，但现有 Chrome 目录可能是英文，容易形成双语重复分类。

### 6.2 推荐算法

1. **先确定处理范围**：默认只处理未分类、最近 30 天新增或自上次分类后变化的书签。
2. **规则优先**：精确域名或子域边界、用户固定规则、已有目录高置信映射先执行。
3. **AI 补充**：只发送规则无法确定的书签和精简后的候选 taxonomy。
4. **本地验证**：忽略模型自报 confidence，检查候选目录、同组一致性和已有用户行为。
5. **分组审批**：按目标目录展示，每组给 3-5 个样例，允许“一组接受”，而不是审核数百张卡片。
6. **增量缓存**：使用 `hash(title,url,currentFolder,taxonomy,promptVersion,provider)` 缓存结果。
7. **断点恢复**：每批保存 checkpoint，失败后继续未完成批次。
8. **成本透明**：运行前显示待发送数量、Provider、预计批次和粗略成本。
9. **学习但不擅自执行**：记录用户接受/拒绝结果以调整规则，但不自动移动书签。
10. **目录治理**：新建目录单独审批；优先复用用户现有目录，避免生成近义重复目录。

### 6.3 推荐的默认工作方式

- 新用户先使用纯规则预览，不强迫配置 AI。
- AI 是“提高分类建议质量”的可选增强，不是使用书签整理的前置条件。
- Vault 与书签整理互不依赖；用户只想整理 Chrome 书签时不需要选择 Obsidian 目录。

## 7. 产品体验审计

### 7.1 当前心智负担

用户打开 ShuHai 时通常只有两个问题：“把当前内容保存下来”或“整理一下书签”。当前产品却要求用户理解：

- Popup 和 side panel 的区别。
- 浏览、分类方案、链接体检、收藏内容、历史和设置等内部模块。
- “提取”“加入队列”“待入库”“写入 Vault”“导出书签索引”之间的关系。
- AI 模式、规则模式、安全模式和全量模式。
- 健康检测中死链、错误、重定向、跳过、更新和替换的差异。

这些概念单独看都合理，但同时出现在一个小尺寸扩展界面中，会把系统内部状态转嫁给用户。

### 7.2 首次使用问题

`packages/extension/src/utils/onboarding.ts:17-47` 把 Vault、AI Provider、第一次分类和第一次导出都作为完成 onboarding 的条件。这会产生两个错误暗示：

- 用户不配置 AI 就不能整理书签。
- 用户不配置 Vault 就不能使用 ShuHai。

建议拆成两条独立首次任务：

- “我要整理书签”：无需 Vault，规则模式立即可用，AI 后续可选。
- “我要保存到 Obsidian”：选择 Vault，随后立即保存当前页面；无需先运行分类。

### 7.3 保存内容流程

单条内容不应默认进入批量队列。推荐流程：

1. 用户点击扩展图标。
2. Popup 自动提取当前可见内容并显示摘要。
3. 用户确认标题、目录、标签和实际目标路径。
4. 点击“保存到 Obsidian”。
5. 原位显示成功、实际文件路径和“在 Obsidian 中打开”。

队列只处理三个例外：用户主动选择“稍后处理”、一次捕获多条内容、写入失败待恢复。

### 7.4 书签整理流程

不建议使用强制线性向导，因为用户可能只想分类或只想查失效链接。推荐 Side Panel 工作区：

- 概览：书签数量、最近新增、未分类、待核实失效链接、最近一次操作。
- 分类：选择范围、生成建议、按目标目录分组审核、应用、撤销。
- 失效链接：运行/暂停/继续、分类结果、核实、批量操作。
- 历史：最近操作和恢复入口，不展示底层日志细节。

“生成书签目录”只在整理完成后的“其他操作”中出现。

## 8. UI 与视觉审计

### 8.1 核心视觉问题

1. **信息密度过高**：小尺寸窗口内同时存在 header、导航、告警、任务卡、统计、表单和列表。
2. **缺少唯一主动作**：多个绿色按钮、Card 和 Badge 权重接近，视线没有明确落点。
3. **字号过小**：大量 11px/12px 文字在 Windows 深色环境中阅读困难。
4. **容器过度**：大量边框 Card、Card 内分组和 Badge 让界面像后台管理台。
5. **图标泛滥**：几乎所有标题和按钮都使用通用 Lucide 图标，图标失去强调作用。
6. **状态反馈弱**：toast、spinner 和文字状态无法建立“正在执行、可以离开、已经完成”的稳定预期。
7. **品牌识别弱**：当前缺少正式 manifest 图标和一致视觉标识。
8. **可访问性不足**：颜色对比、键盘焦点、缩放、屏幕阅读器和 reduced motion 没有系统验收。

### 8.2 外部产品调研结论

- [Notion Web Clipper](https://www.notion.com/en-gb/help/web-clipper) 将 popup 限定为当前页面、目标位置和保存动作。
- [Obsidian Web Clipper](https://obsidian.md/help/web-clipper/capture) 打开 popup 后围绕当前页面提取结果组织少量区域，并把 Add to Obsidian 作为明确的最终动作。
- [Raindrop.io](https://help.raindrop.io/install-extension/) 将工具栏扩展用于快速保存，把高级管理交给更大的界面。
- Chrome 官方建议 side panel 帮助用户以较少干扰完成相关任务，而不是把所有产品模块都塞进 popup：[Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) 与 [Chrome Web Store best practices](https://developer.chrome.com/webstore/best_practices)。

共同规律不是“界面更漂亮”，而是：

- 首屏只服务一个任务。
- 主按钮只有一个。
- 状态和下一步紧邻当前操作。
- 高级管理不占用高频入口。
- 用户不需要理解内部队列、模块和数据结构。

### 8.3 推荐设计系统

| 项目       | 建议                                                                |
| ---------- | ------------------------------------------------------------------- |
| Popup 宽度 | 360-400px，内容驱动高度，不固定塞满 600px                           |
| Side panel | 适配 320-600px，不依赖单一宽度截图                                  |
| 字号       | 页面标题 16px；标题/按钮 14px；正文 13-14px；辅助信息最低 12px      |
| 间距       | 8/12/16/24px 四级体系                                               |
| 控件高度   | 常用按钮和输入框 36-40px                                            |
| 圆角       | 6-8px，避免大量胶囊形容器                                           |
| 色彩       | 中性灰 + 一个可靠主色 + 明确 warning/danger，不使用单一色系铺满页面 |
| 图标       | 只用于明确工具和状态；标题不必全部配图标                            |
| 字体       | 系统 sans 或随扩展打包字体，不远程加载 Google Fonts                 |
| 动效       | 只用于进度、状态转换和完成确认，并尊重 `prefers-reduced-motion`     |
| 成功反馈   | 原位显示实际结果、路径和下一步，不仅依赖 toast                      |
| 空状态     | 说明为什么为空，并提供唯一下一步按钮                                |

当前暗色主色 `#1a9a7a` 搭配白色普通文字的对比度约为 3.53:1，低于 WCAG 对普通文字建议的 4.5:1。颜色、焦点和动态效果应按 [WCAG 2.2](https://www.w3.org/TR/WCAG22/) 验收；非必要动画应支持 [prefers-reduced-motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)。

### 8.4 对现有 Goal 030/031 的复核

`docs/goals/goal-030-visual-polish.md` 中以下方向仍然正确：

- Popup 轻量化和按需加载。
- 提高字号下限。
- 减少 Card、Badge 和装饰性图标。
- 操作完成后提供原位反馈和实际路径。
- 统一间距与完成状态。

但 Goal 030 仍把“当前页面保存”和“AI 整理书签”动态切换为 popup 主角。建议进一步明确：popup 永远优先保存当前页面；书签整理进入 side panel，避免入口行为随网页类型变化。

`docs/goals/goal-031-visual-character.md` 不建议原样实施，原因包括：

- 远程导入 Google Fonts 会增加第三方请求和 CSP/离线依赖。
- 暖米色、暖黑、朱砂橙和衬线数字可能形成过强的单一风格，不符合安静、重复使用的工具界面。
- “标题最后一个汉字换衬线”等字符级装饰会增加实现复杂度，却不能解决任务层级和数据反馈问题。
- CSS 文字方块不能替代正式、可缩放、可识别的品牌图标资产。
- 渐隐分隔线和视觉个性不应优先于对比度、焦点、布局稳定性和状态一致性。

推荐先完成信息架构和基础设计系统，再通过正式图标、排版比例和少量品牌色建立识别度，不采用装饰性国风元素补救产品结构。

## 9. 工程与代码审计

### 9.1 过度集中的模块

审计时主要大文件约为：

| 文件                                                    |      规模 | 问题                                          |
| ------------------------------------------------------- | --------: | --------------------------------------------- |
| `packages/extension/src/popup/App.tsx`                  |   1657 行 | 路由、状态、消息、业务 handler 和 UI 编排集中 |
| `packages/extension/src/background/service-worker.ts`   | 约 850 行 | 多个领域命令和持久状态集中                    |
| `packages/extension/src/popup/pages/Settings.tsx`       | 约 797 行 | Provider、Vault、规则、模板、备份和帮助混合   |
| `packages/extension/src/popup/pages/CollectionPage.tsx` | 约 683 行 | 队列、预览、编辑、保存和历史混合              |
| `packages/extension/src/shared/classifier.ts`           | 约 561 行 | 规则、AI 合并、方案生成和默认选择策略耦合     |

**建议边界**

- `AppShell` 只负责界面模式、路由和公共布局。
- `capture` 负责当前页面提取、待保存和 Vault 写入。
- `organize` 负责范围、规则、AI 建议、审核与应用。
- `health` 负责持久任务、调度、结果和批量处置。
- `settings` 负责配置和 schema migration。
- service worker 按命令域拆分 handler，并对所有消息进行运行时 schema 校验。
- 长任务状态持久化到 service worker/IndexedDB，页面切换或 popup 关闭不应中断任务。

### 9.2 重复模型与遗留代码

- Extension 在 `packages/extension/src/shared` 内维护了自己的模型和分类逻辑，而 `packages/shared` 实际复用很少。
- `ExportPage.tsx` 和 `HelpPage.tsx` 仍存在但没有活动入口或引用。
- Desktop/Electron 代码仍在 workspace 中，README 仍以 Electron、SQLite 和直接读取 Chrome 文件为当前架构。
- `README.md` 与当前 Extension、File System Access API、Provider 抽象和内容捕获能力明显不一致。
- `docs/product-roadmap-v2.md` 仍描述 Electron 主线和未开始的 Twitter/微博同步，与当前实现相反。

**建议**

1. 明确 Extension 是唯一活跃产品。
2. 将 Electron 标记为 `legacy/archived`，停止同时演进；确认无复用后再决定移出 workspace。
3. 建立唯一共享模型来源，删除 extension 内重复类型和过时页面。
4. 为 storage schema 增加版本号和迁移函数。
5. 重写 README、架构图和产品路线，删除已经失真的承诺。
6. 将当前未跟踪的 Goal 文档纳入版本管理或明确归档，不应让产品决策只存在于本地目录。

### 9.3 工作流治理

仓库 `AGENTS.md` 规定 feature 先合并到 `dev`，再由 release PR 进入 `main`。当前项目历史和工作分支实践应重新核对这一规则，避免规范与实际流程长期分离。

建议每个整改 Goal 都包含：

- 产品验收条件，而不仅是组件改动清单。
- 数据迁移和回滚策略。
- 安全负面测试。
- 用户旅程 E2E。
- 截图、键盘操作和 200% 缩放证据。
- 实际变更文件范围和不允许修改的边界。

## 10. 测试与质量基线

本次审计执行结果：

| 命令                                                      | 结果                                             |
| --------------------------------------------------------- | ------------------------------------------------ |
| `pnpm lint`                                               | 通过                                             |
| `pnpm typecheck`                                          | 通过                                             |
| `pnpm test`                                               | 通过，共 119 项测试                              |
| `pnpm --filter @shuhai/extension run build`               | 通过                                             |
| `pnpm test:e2e`                                           | 通过，但只有 1 个 service worker 启动 smoke test |
| `pnpm test:coverage`                                      | 通过；全仓 statements 约 34.19%                  |
| `pnpm audit --prod --registry=https://registry.npmjs.org` | 未发现已知生产依赖漏洞                           |

覆盖率的主要问题：

- `service-worker.ts` 约 0%。
- Popup `App.tsx` 约 3.79%。
- Popup pages 总体约 5.93%。
- Settings、Collection、Health 和 InlineSave 等关键 UI 大多只有约 2%-4%。
- 当前覆盖率阈值接近现状下限，不能防止高风险流程发生回归。

必须补充的测试：

1. 批量删除只创建一个快照、部分失败和恢复。
2. 文件冲突、重复保存、更新同一文章和真实返回路径。
3. Popup 保存当前页面完整 E2E。
4. 分类分组确认、应用与撤销完整 E2E。
5. 健康检测暂停、恢复、误判分类和批量处理完整 E2E。
6. Service worker message contract 和 storage migration。
7. 提示词注入、伪造模型输出和自定义 Provider 风险。
8. 重定向到私网、DNS 私网解析和重定向链循环。
9. 恶意超大 DOM、深层 DOM、Markdown 链接逃逸。
10. Twitter/X 和微博目标帖子绑定。
11. 键盘导航、焦点、对比度、200% 缩放和 reduced motion。

## 11. 完整改造路线

### Phase 0：冻结与重新建立产品事实源

**目标**：停止增加功能，让团队对“产品是什么”达成一致。

- 冻结新增 Provider、模板能力、统计页面和高级导出。
- 更新 README、产品定位、架构图和活跃/遗留模块说明。
- 将本报告作为整改总入口，将具体实施拆成小型 Goal。
- 确认 Extension 为唯一产品入口，Electron 进入 legacy 状态。
- 定义下面第 12 节的使用指标。

### Phase 1：安全与数据完整性

**目标**：消除任何可能造成静默丢失、不可恢复删除和高风险输入解释的问题。

- 实现批量事务快照、操作日志和一键恢复。
- 修复 Vault 文件冲突和错误成功反馈。
- 使用安全 Markdown serializer 与 URL scheme allowlist。
- 限制 DOM 节点、深度、文本量和运行时间。
- 限制 storage access level，分离 API Key，增加 session-only 模式。
- 加固提示词边界、模型输出 Schema 和本地 allowlist。
- 手动验证健康检测每一跳重定向和私网地址。
- 精确绑定 Twitter/X、微博目标内容。

在 Phase 1 完成前，不建议向更多用户分发扩展。

### Phase 2：产品与 UI 重启

**目标**：让第一次使用的人不看说明也能完成一次保存或一次书签整理。

- Popup 重做为当前页面保存器。
- Side Panel 重做为书签维护工作区。
- 新建 Options Page，迁移所有低频配置。
- 拆分“整理书签”和“保存到 Obsidian”的 onboarding。
- 单条保存取消默认队列步骤。
- 统一字号、间距、控件、颜色、图标和状态反馈。
- 补齐扩展 icon 和品牌资源，自托管或移除远程字体。
- 完成键盘、焦点、对比度、缩放和 reduced motion 验收。

### Phase 3：分类与体检算法降噪

**目标**：降低等待、Token、误判和人工审核数量。

- 默认处理新书签、未分类书签和发生变化的书签。
- 规则优先，AI 只处理不确定项。
- 精确域名边界匹配。
- 分类结果按目标目录分组审批。
- 增加缓存、checkpoint、timeout、retry 和 backoff。
- 明确成本与 Provider 数据流。
- 健康检测区分确认死链、受限、临时失败、规范跳转和跨域跳转。

### Phase 4：工程可靠性与真实验收

**目标**：让核心流程不依赖人工碰运气测试。

- 拆分 `App.tsx` 和 service worker 领域模块。
- 建立统一共享模型和运行时消息 Schema。
- 持久化长任务，页面切换不再丢失状态。
- 至少建立三个真实 E2E 用户旅程。
- 增加恶意 fixture、安全回归和无障碍自动检查。
- 在 Windows 常用缩放、浅色/深色和窄 side panel 下保存截图证据。

### Phase 5：两周自用验证

**目标**：证明产品已经成为真实习惯，而不是继续凭功能清单开发。

- 连续两周记录实际打开次数、保存次数、失败原因和放弃步骤。
- 不在这两周增加新功能，只修复阻断使用的问题。
- 达到核心指标后再讨论 Provider、模板或更深 Obsidian 集成。

## 12. 验收指标

| 指标                          |                          目标 |
| ----------------------------- | ----------------------------: |
| 首次成功保存当前页面          |                     30 秒以内 |
| Popup 打开后的保存操作        |         中位数不超过 2 次点击 |
| 文件冲突/写入失败的静默丢失   |                             0 |
| 批量破坏性操作可恢复率        |                          100% |
| 分类建议接受率                |                      高于 70% |
| AI 实际处理书签占本次范围比例 |  尽量低于 40%，其余由规则确定 |
| 健康检测“确认死链”误判率      |            必须测量并持续下降 |
| Popup 可操作时间              | 目标 200ms 级，重数据按需加载 |
| 核心 E2E 用户旅程             |                     至少 3 条 |
| 用户本人实际使用              |         连续两周每周至少 3 天 |

## 13. 建议隐藏或延后的功能

以下能力可以保留代码，但应移入 Options 的“高级设置”或暂时隐藏：

- Markdown 模板编辑器。
- 规则可视化编辑器的高级条件。
- 活动历史导出。
- 书签索引导出。
- 诊断日志和 DOM 诊断信息。
- 备份 JSON 下载细节。
- Provider 高级参数。

近期不建议新增：

- 更多 AI Provider。
- 后台自动全文抓取。
- Electron companion。
- Obsidian 社区插件依赖。
- 知识图谱、自动关联推荐和复杂统计仪表盘。
- 只为“显得高级”而增加的动效、插画或装饰性视觉主题。

## 14. 现有实现值得保留的部分

本报告并不否定已有工作。以下设计方向是正确的，应在重构中保留：

- 不在本地后台批量抓取任意恶意网页全文。
- 在浏览器已打开页面中提取用户当前可见内容。
- 远程图片默认转为链接而不是自动嵌入。
- 书签移动、删除和 URL 更新保留用户确认。
- 文件名和路径穿越防护。
- 健康检测的并发限制、同域 2 秒间隔、超时和无凭据请求。
- 规则模式作为 AI 的本地替代路径。
- File System Access API 让纯扩展产品无需额外桌面伴侣。
- Provider 抽象已经为后续兼容性提供基础，但近期不应继续扩张。

问题不在于这些能力没有价值，而在于它们缺少统一的用户任务、可靠的数据语义和清晰的界面层级。

## 15. 最终建议

ShuHai 下一阶段不应以“完成 Goal 数量”为成功标准。真正的成功标准是：用户在浏览文章时愿意打开它保存内容，在书签混乱时愿意用它整理，并且相信任何删除、覆盖或失败都可以看见、理解和恢复。

建议把整改顺序固定为：

> 数据不丢失与可恢复 > 输入和权限安全 > 主任务与信息架构 > UI 基础质量 > 算法效率 > 工程拆分 > 新功能。

如果顺序倒过来，只继续做视觉 polish 或增加功能，ShuHai 会变得更漂亮、更复杂，但仍然不会更好用。

## 16. 参考资料

- OWASP: [LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- Chrome: [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- Chrome: [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- Chrome: [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- Chrome: [Local Network Access](https://developer.chrome.com/blog/local-network-access)
- Chrome: [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- Chrome Web Store: [Best practices](https://developer.chrome.com/webstore/best_practices)
- W3C: [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
- W3C: [Using prefers-reduced-motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
- Notion: [Web Clipper](https://www.notion.com/en-gb/help/web-clipper)
- Obsidian: [Web Clipper capture](https://obsidian.md/help/web-clipper/capture)
- Raindrop.io: [Browser extension](https://help.raindrop.io/install-extension/)

## 17. 生态复审补充与路线落地

在初版审计之后，又针对 OpenCLI、内容提取/安全库和同类产品完成了专项调研。详细证据见：

- [OpenCLI、现成库与同类产品调研](../research/2026-07-12-opencli-ecosystem-library-study.md)
- [Chrome Extension 目标架构 v3](../architecture/extension-v3.md)
- [产品路线图 v3](../product-roadmap-v3.md)
- [当前项目状态](../PROJECT_STATUS.md)

### 17.1 对初版建议的修正

1. **不采用“动态任务启动器首页”。** Popup 不应根据当前页面在“保存”和“整理”之间切换主角。最终固定为 Popup 保存、Side Panel 整理、Options 设置，以获得稳定心智模型和按需加载边界。
2. **OpenCLI 不进入运行时。** 它需要 Browser Bridge、本地 daemon 和登录态浏览器自动化，会重新制造第二安装包与更大攻击面。只借鉴 adapter、typed error、fixture、结构化输出和失控保护。
3. **内容提取从“继续加固自研实现”调整为独立 spike。** Defuddle、DOMPurify、Turndown/remark、`yaml` 都值得评估，但先用真实 fixture、攻击 payload、包体和隐私测试决定，禁止直接迁移。
4. **依赖优先级明确。** `zod`、`idb`、`yaml` 和测试工具具有直接工程收益；`tldts` 仅用于域名语义，不能用于 URL 安全或 SSRF 判断。
5. **视觉方向收敛。** Goal 031 的暖色国风可以视为已完成的历史尝试，但不继续叠加；后续移除远程字体和装饰性末字衬线，回到系统字体、清晰层级、速度和可访问性。

### 17.2 从同类产品确认的原则

- Obsidian Web Clipper 和 MarkDownload 说明 Popup 应专注当前页面提取、预览与保存。
- Raindrop 的健康检查说明“broken”应按可信度分级并交由用户判断，不能把 timeout、403、429 或 5xx 当作删除结论。
- Raindrop 的重复项策略说明 URL 归一化必须可解释并始终显示原 URL。
- Karakeep/Linkwarden 说明主要位置与多维标签应分工：Chrome 文件夹负责单一归属，标签负责跨主题组织。
- OpenCLI 说明站点 adapter 应有结构化输出、版本、typed error、fixture 和分页/去重保护，但其私有 Twitter GraphQL/Cookie 方案不适合内置。

### 17.3 最终执行顺序

审计结论现已转化为 Goal 032-040。唯一可直接执行的是 [Goal 032](../goals/goal-032-transactional-bookmark-operations.md)：先修复书签批量操作日志、部分失败和真实恢复。Vault 写入正确性、运行时 schema、提取 spike、UI、算法和发布门禁依次后置。

这意味着后续不能从旧 Goal 002-031 继续“补功能”，也不能把更多 Provider、OpenCLI 集成或新视觉主题插到数据完整性之前。
