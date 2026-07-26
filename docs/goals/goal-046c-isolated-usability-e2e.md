---
id: goal-046c
title: Isolated Usability Visual And Mount E2E
status: DRAFT
version: 2
updated: 2026-07-26
depends_on:
  - goal-046b
branch: codex/goal-046-ui-shell
base_commit: 0b893cb
external_preaudit:
  status: PENDING
  note: 用户已转发 Goal 046 预审请求，尚未收到可核验结论。
contract_review:
  verdict: PENDING
  rounds:
    - reviewer: Beauvoir
      reviewed_at: 2026-07-26
      verdict: FAIL
      summary: 初版存在网络与浏览器能力过度声明、输出 allowlist、真实 Popup、zoom、teardown 和持久证据等 7 个 P1、8 个 P2、1 个 P3。
implementation_review:
  verdict: PENDING
---

# Goal 046C：隔离可用性、视觉与挂载 E2E

## 1. 用户问题

Goal 046A/046B 已把 ShuHai 收敛为上下文 Popup、单任务 Side Panel 和独立 Options，
但现有证据主要来自 jsdom、build graph 和 046A 的 production bundle 静态 fixture。
这些证据不能证明：

- 当前 `dist` 能被全新 Chrome profile 作为 unpacked extension 正常加载。
- Popup、Side Panel 和 Options 在真实浏览器布局、缩放、深浅主题和键盘下可用。
- 书签与 X 两条入口没有重新出现旧后台、重复主动作、遮挡或挂载副作用。
- Options 首次挂载不会弹 picker、请求权限、修改书签或写入文件。
- 页面没有外部请求、控制台异常或与真实用户环境串线。

本 Goal 只做隔离验收、可复跑测试和证据收口。它不新增产品能力，也不以自动化 E2E
替代后续两周真实 dogfood。

## 2. 用户结果

完成后可以准确声明：

1. 当前 production `dist` 可在已安装 Chrome 的全新临时 profile 中加载。
2. production bundle fixture 中，普通页、X 收藏页和 X 单条页的 Popup 都只有一个上下文
   主动作；隔离自动化不把直接导航扩展页面冒充真实 Toolbar Popup 点击。
3. Side Panel 空闲态、书签任务和 X 任务入口在目标宽度、主题、长文本和真实 200% 浏览器
   缩放下没有关键遮挡或横向溢出。
4. Options 首屏只有 Vault、X 权限和可选 AI；高级项默认折叠，挂载没有危险副作用。
5. 浏览器启动前配置的任务自有 deny proxy 和页面 route 共同拒绝非 loopback HTTP(S)；
   测试没有接触日常 Chrome、真实 X、真实 Vault、用户书签、Cookie、token 或其它标签页。
6. 可用性或安全失败会被记录为真实 `FAIL`，不会用截图存在或测试进程退出 0 冒充通过。

## 3. 非目标

- 不修改 Popup、Side Panel、Options、书签、X、Vault、AI、message 或 storage 生产代码。
- 不执行真实书签移动、删除、URL 更新、恢复或分类 apply。
- 不请求真实 `x.com` 权限，不扫描真实 X，不写真实或 disposable Vault。
- 不测试 Provider，不发外部网络请求，不下载浏览器、驱动、依赖、字体、图片或 fixture。
- 不新增运行时或开发依赖，不更改 Playwright 全局配置。
- 不声称同步全部 X 历史收藏，不改变 `LIMITED_GO/batch-only`。
- 不把一次隔离验收写成“两周 dogfood 完成”或“真实用户价值已验证”。
- 不顺带美化 UI、加入动效、模板、平台或诊断功能。

## 4. 验收架构

046C 使用两层互补证据，二者都必须读取刚完成 build 的 production `dist`。

### 4.1 A 层：真实 unpacked extension 挂载

- 只使用 `@playwright/test@1.60.0` 的 `chromium.executablePath()` 当前解析到的既有
  `C:\Users\ASUS\AppData\Local\ms-playwright\chromium-1223\chrome-win64\chrome.exe`。
  运行前以 `existsSync` 和普通文件检查确认；不存在时进入
  `BLOCKED_BY_BROWSER_CAPABILITY`，不得下载或改用未审查的 branded Chrome。
- 每次运行创建新的
  `node_modules/.cache/shuhai-goal-046c/<run-id>/profile/`，不得复用、清理或读取日常
  profile。
- 只加载当前 worktree 的 `packages/extension/dist`，并校验 service worker bundle
  SHA-256 与磁盘 build 完全一致。
- fixture server 与 deny proxy 分别只监听系统分配的 `127.0.0.1` 空闲端口。deny proxy
  在启动浏览器前就绪，拒绝所有 forward request 与 `CONNECT`，从不连接 upstream；
  loopback fixture 走 Chrome 默认 loopback bypass。测试只关闭自己创建的 Playwright
  context、fixture server 和 proxy handle。
- 启动后必须发现 `chrome-extension://<id>/background/service-worker.js`，并校验其 bundle
  SHA-256；没有发现时进入 `BLOCKED_BY_BROWSER_CAPABILITY`，不能写成产品 E2E 失败。
- Chrome 中只打开测试创建的 fixture、extension Popup、Side Panel 和 Options 页面。
- 可在该全新 profile 中创建最多 12 个明确命名为 `ShuHai 046C Fixture` 的合成书签，
  只用于只读树和搜索布局；运行前后必须比较 title/URL/parentId 有序摘要，任何意外变化
  都是 `FAIL`。
- 不授予 optional host permission，不启动 X 扫描，不创建 SyncJob，不写 Vault。

A 层只验收 production extension 的加载、身份、ordinary direct-page surface、只读挂载和
无副作用。自动化直接导航到 `popup/index.html` 时必须标记为
`direct_extension_page`；它不等价于用户点击 Toolbar action，不声明已验证
`activeTab` user gesture、Popup 生命周期或浏览器工具栏几何。X 收藏页、X 单条页和
active-task 的上下文选择由 B 层 production bundle fixture 覆盖；真实 Toolbar Popup
仍属于后续人工 dogfood。

Side Panel API 在 headless Chrome 中若无法展示真实浏览器侧栏，允许直接导航到当前
extension 的 `sidepanel/index.html`，但必须在报告中写成 `direct_extension_page`，
不能冒充“浏览器侧栏自动打开”证据。

### 4.2 B 层：production bundle 状态与视觉 fixture

- 通过同一个 loopback server 提供当前 `dist` 的 Popup、Side Panel 和 Options 文件。
- 在文档加载前安装 strict fake Chrome API。每次调用只持久化 bounded 安全标签，例如
  `runtime:surface:summary`、`runtime:settings:get`、
  `permissions:contains:x-origin`、`bookmarks:move`；原 payload 只在页面内存中按场景
  schema 校验后立即丢弃，不写 report、console 或 trace。
- fixture 只使用公开假数据，例如 `fixture.invalid`、固定 X ID 和合成书签标题。
- 未在场景白名单中的 Chrome API 一律抛出 `unexpected_api_call`。
- picker、`permissions.request/remove`、Vault write、bookmark
  `create/move/remove/update`、X scan/write 在 mount-only 场景中的调用数必须为 0。
- B 层用于覆盖不应通过真实数据制造的 active、partial、long-text、large-count 和错误
  状态；它不能替代 A 层的 unpacked extension 加载证据。

## 5. 隔离与安全合同

用户本轮只批准以下边界：

1. 使用已安装 Chrome/Chromium和全新的测试 profile。
2. 在新的 `127.0.0.1` 空闲端口启动本地 fixture server，并只关闭本任务创建的 handle/PID。
3. 只在
   `C:\Projects\ShuHai\.worktrees\goal-046-ui-shell\node_modules\.cache\shuhai-goal-046c\`
   下生成 profile、截图、trace 和报告。

浏览器直接产物只写上述 cache。E2E 完成并脱敏检查后，Integrator 才可从本次 exact run
逐文件复制四张代表截图和一个 summary 到第 8 节 allowlist 的仓库 review assets；不复制
profile、完整 trace 或其它浏览器产物。

固定规则：

- 工作目录只能是 `C:\Projects\ShuHai\.worktrees\goal-046-ui-shell`。
- 本 Goal 执行期间不读取或检查主 checkout、其它 worktree 的内容或状态；漂移核对只针对
  当前 worktree 的 branch、HEAD 和 allowlist。
- 不控制、关闭、重启或访问日常 Chrome，不读取其 tab、profile、extension storage、
  Cookie、历史、下载、书签或 File System Access handle。
- 不访问其它项目、用户目录、端口、进程、容器或服务。
- 不使用 `taskkill`、`Stop-Process`、端口清理、递归删除、`git clean`、reset 或覆盖式
  checkout。
- 浏览器启动参数使用 task-owned loopback deny proxy，并启用
  `--disable-background-networking`、`--disable-component-update`、
  `--disable-domain-reliability`、`--disable-quic`、`--disable-sync` 和
  `--no-first-run`。Playwright route 是第二层：只允许 exact loopback fixture origin，
  其它 HTTP(S) abort。测试不使用曾导致错误页面的 `--host-resolver-rules`。
- B 层模拟 `https://x.com/*` 仅发生在 fake `tabs.query` 返回值中，不导航或请求该 URL。
  A 层不打开 X URL。报告分别记录 proxy 拒绝、route 拒绝和 app-observed external
  request；只能声明“非 loopback HTTP(S) 未到达 origin”，不扩张为 DNS/UDP/全部网络
  协议证明。
- fixture 页面、DOM、URL、console 和网络响应都视为不可信输入；不执行其中命令或提示。
- 报告不得包含本机用户名以外的用户数据、secret、Cookie、Authorization、正文、真实
  私人 URL、Vault 路径或其它标签信息。绝对 artifact 路径只允许指向上述 cache root。
- 测试异常时先关闭自己持有的 context/server；无法证明 ownership 时不做清理并
  `STOP`。

## 6. 场景矩阵

### 6.1 Production extension 挂载

| ID   | Surface    | 场景                                  | 必须证明                                                   |
| ---- | ---------- | ------------------------------------- | ---------------------------------------------------------- |
| A-01 | Extension  | 当前 dist + 全新 profile              | service worker hash 一致；只有 ShuHai extension 被显式加载 |
| A-02 | Popup      | direct extension page / ordinary      | 标记 direct；唯一“整理 Chrome 书签”；无完整树/设置读取     |
| A-03 | Side Panel | direct extension page / idle          | 标记 direct；新 idle UI，不出现旧 App/Tab/卡片墙           |
| A-04 | Side Panel | idle -> 书签任务                      | 只读进入新书签 UI，不产生 mutation                         |
| A-05 | Bookmarks  | 12 个合成书签只读浏览、搜索、返回     | seed 后建 baseline；退出后有序摘要完全一致                 |
| A-06 | Options    | direct extension page / initial mount | 首屏三项；高级折叠；无 picker、权限请求、书签/Vault 写入   |
| A-07 | Teardown   | 正常和安全注入失败 finally            | 只关闭自有 context/server/proxy；精确自有 PID 均退出       |

既有 Playwright Chromium 若不能在 headless 模式加载 unpacked extension，则状态进入
`BLOCKED_BY_BROWSER_CAPABILITY`，不得退化成只跑 B 层后写 `PASS`，也不得改用日常 Chrome。
允许在相同临时 profile、deny proxy 和 route 下将同一 executable 改为 headed 模式；它
仍由 Playwright 创建独立进程和 profile，且必须通过同一 ownership/teardown 检查。

### 6.2 Popup 视觉与交互

| ID   | 状态                    | Viewport / 主题                    |
| ---- | ----------------------- | ---------------------------------- |
| P-01 | 普通页 / 0 项           | 420x600 / light                    |
| P-02 | X 收藏 / 1 项           | 420x600 / dark                     |
| P-03 | X status / 长中英文标题 | 420x600 / light                    |
| P-04 | active task / 1,000+    | 420x600 / dark                     |
| P-05 | 固定错误与重试          | 420x600 / light                    |
| P-06 | 设置打开失败            | 420x600 / dark                     |
| P-07 | 普通页                  | 420x600 / actual browser zoom 200% |

每个状态都必须：

- 只有一个非 icon primary CTA；设置 icon 不计为任务主动作。
- 无横向 overflow、文字覆盖、按钮出界或底部 ActionBar 遮挡。
- 主动作、设置和重试均有可访问名称。
- Tab 顺序与 DOM 一致；可交互元素 focus-visible。
- 页面稳定后不再发生大于 4 CSS px 的意外 layout shift。

### 6.3 Side Panel 视觉与交互

| ID   | 状态                               | 宽度 / 主题 / 特殊条件                 |
| ---- | ---------------------------------- | -------------------------------------- |
| S-01 | idle                               | 360 / light                            |
| S-02 | 书签浏览 / 空树                    | 360 / dark                             |
| S-03 | 书签浏览 / 长中英文 / 1,000+       | 480 / light                            |
| S-04 | 分类 consent / authorizing         | 360 / dark                             |
| S-05 | plan ready / zero selection        | 480 / light                            |
| S-06 | plan ready / long title            | 360 / dark                             |
| S-07 | apply complete                     | 480 / light                            |
| S-08 | apply partial/conflict             | 720 / dark                             |
| S-09 | recovery / retained operations     | 360 / light                            |
| S-10 | X prepared                         | 360 / dark                             |
| S-11 | X paused                           | 480 / light                            |
| S-12 | X ready for review / metadata-only | 720 / dark                             |
| S-13 | X terminal / return                | 360 / light                            |
| S-14 | fixed error                        | 360 / dark                             |
| S-15 | plan ready                         | 360 / light / actual browser zoom 200% |

验收重点：

- TaskHeader 和品牌标题各只出现一次。
- 运行或 mutation 状态的返回/Escape 与 046B 状态矩阵一致。
- `ActionBar` 在最长内容和 200% zoom 下不覆盖最后一个可操作项；页面可滚动到末尾。
- 一屏最多一个 Jade primary CTA；同一动作没有顶部/底部重复入口。
- `partial` 明确显示 succeeded/failed/conflict/recoverable，不出现笼统“全部成功”。
- X active 状态不返回 idle；terminal 状态有唯一“返回任务入口”。
- `metadata_only` 不默认选中；本批结果不出现“已同步全部历史收藏”。

### 6.4 Options 视觉与挂载

| ID   | 状态                             | Viewport / 主题 / 特殊条件         |
| ---- | -------------------------------- | ---------------------------------- |
| O-01 | Vault 未配置、X 未授权、AI 关闭  | 960x900 / light                    |
| O-02 | 长 Vault 名、X 已授权、AI 已配置 | 720x900 / dark                     |
| O-03 | 高级设置全部折叠                 | 640x900 / light / actual zoom 200% |
| O-04 | 展开单个高级 section             | 720x900 / dark                     |
| O-05 | 固定 bootstrap error             | 640x900 / light                    |

挂载调用白名单固定为：

```text
runtime:security:getBootstrapStatus
runtime:settings:get
indexeddb:shuhai-vault:get-handle
filesystem:queryPermission:readwrite  # 仅当 fixture handle 存在
permissions:contains:x-origin         # 内存校验 exact https://x.com/*
```

初始挂载必须为 0：

```text
showDirectoryPicker
permissions.request
permissions.remove
Vault file write
bookmarks.create/move/remove/update
xSingle:start
xSync:*
state:get
state:summary
backups:list
health:listRecords
```

## 7. 浏览器、可访问性与性能断言

### 7.1 真实 200% 浏览器缩放

- 先发送 `Control+0`，通过当前测试 extension service worker 的
  `chrome.tabs.getZoom(exactTestTabId)` 记录 `1.0` 基线，同时记录 DPR 与 innerWidth。
- 再按 Chrome 固定档位发送 `Control+Equal`，每次读取 exact tab zoom，直到精确
  `2.0`；最多 8 次，不按次数猜测结果。
- 断言 `getZoom` 为 `2.0`、DPR/baseline DPR 比例在 `1.9..2.1`，innerWidth/baseline
  innerWidth 比例在 `0.45..0.55`，并保存前后截图。
- DPR 2、CSS `zoom: 2` 或放大截图不能替代浏览器 zoom；若无法可靠达到 200%，对应场景
  标记 `FAIL/UNVERIFIED`。如果 browser capability 本身不支持读取/设置 zoom，则进入
  `BLOCKED_BY_BROWSER_CAPABILITY`，不得伪报通过。

### 7.2 可访问性

在不新增 axe 等依赖的前提下只声明直接测得的范围：

- 可见 button/link/input 都有 accessible name。
- 页面无 duplicate `id`，label 与输入关联。
- Tab 可到达主动作、返回、设置和展开控件，焦点顺序与 DOM 一致。
- focus 状态相对 unfocused 状态出现可见 outline/ring/box-shadow 变化。
- progress/result/error 使用既有 `progressbar`、`status`、`alert` 或 live region 语义。
- `prefers-reduced-motion: reduce` 下没有非必要位移动画。
- 普通正文 computed font size 至少 13px，辅助文字至少 12.5px；图标 glyph 不计。
- 对主要 token 组合检查 WCAG 2.2 AA 的 4.5:1 正文和 3:1 控件/大字阈值。没有完整
  accessibility tree/axe 审计时，不声称“全站 WCAG 合规”。

### 7.3 性能与副作用

- 在 navigation 前通过 `addInitScript` 安装 `PerformanceObserver("layout-shift")` 和
  monotonic `performance.now()` 起点；禁止测试重试，所有超时只运行一次。
- 每个场景的 ready 定义为：`page.goto()` 发起后，合同列出的 heading 与唯一主动作
  locator 都 visible，`document.fonts.ready` 完成，再经过两个
  `requestAnimationFrame`。A 层 cold surface 必须在 5,000 ms 内 ready；B 层每个场景
  使用 3 个独立 page 样本，单样本 <=2,000 ms，并记录 median/max。
- ready 后连续观察 500 ms；CLS 累计必须 <=0.1，合同列出的 header/action bar 最后
  一次单轴移动 <=4 CSS px。
- Popup API ledger 不得出现完整书签树、健康记录、Options 全量或任务模块请求。
- Side Panel idle 只允许 surface summary/ack；task 模块只在相应 route 加载。
- Options 挂载只允许 6.4 的白名单；不得出现隐式 user-gesture API。
- A 层 wrapper 只旁路记录 production API 的 bounded safe tag，并把原调用转发给真实
  extension API；它负责 service worker/build 身份、页面实际挂载、synthetic bookmark
  baseline、optional permission before/after 和 teardown。B 层 strict fake 负责精确
  request subtype/origin schema、状态矩阵与 forbidden-call=0；不能用 A 层粗粒度日志
  支撑 B 层的禁止调用结论。
- 浏览器 console error、uncaught page error、unhandled rejection 均为 hard FAIL；明确由
  blocked external request 产生且已映射为预期 fixture 结果的记录必须单独列出，不能静默
  丢弃。

## 8. 允许文件

### 合同、状态与持久证据

- `docs/goals/goal-046c-isolated-usability-e2e.md`（新增）
- `docs/reviews/goal-046c-isolated-usability-e2e-review.md`（新增）
- `docs/PROJECT_STATUS.md`
- `docs/product-roadmap-v4.md`
- `docs/goals/README.md`
- `docs/workflows/README.md`
- `docs/proposals/2026-07-17-ui-shell-redesign.md`

### 可复跑隔离测试

- `packages/extension/e2e/goal-046c-isolated-ui.spec.ts`（新增）

### Build 与忽略的运行产物

- `packages/extension/dist/**`（只允许由精确 extension build 生成；不 stage）
- `node_modules/.cache/shuhai-goal-046c/<run-id>/**`
- `node_modules/.cache/shuhai-goal-046c/runner-output-<run-id>/**`

Playwright runner 必须通过 `--output` 写入上述唯一 run-specific cache；不得创建、读取或
清理默认 `test-results/`。

### 持久视觉证据

- `docs/reviews/assets/goal-046c/report-summary.json`（新增，脱敏）
- `docs/reviews/assets/goal-046c/popup-context.png`（新增）
- `docs/reviews/assets/goal-046c/sidepanel-360-zoom200.png`（新增）
- `docs/reviews/assets/goal-046c/sidepanel-partial-720-dark.png`（新增）
- `docs/reviews/assets/goal-046c/options-zoom200.png`（新增）

除以上文件外一律只读。`playwright.config.ts`、manifest、package manifests、lockfile、
production `src/**`、其它 e2e、其它 Goal、主 checkout 和用户目录均不得修改。

发现 production P0/P1/P2 或必须改生产代码时立即 `STOP`：

1. 在本 Goal 记录失败场景和最小根因。
2. 写明需要修改的精确文件、行为和测试。
3. 独立审查合同 amendment。
4. 只有 amendment `PASS` 后才允许修改；不得以“E2E 小修”绕过范围。

P3 纯文案或像素问题也不得暗改；记录为后续候选，除非其直接阻断本 Goal 验收且 amendment
通过。

## 9. E2E 报告合同

每次运行写入：

```text
node_modules/.cache/shuhai-goal-046c/<run-id>/
  report.json
  screenshots/*.png
  traces/*                  # 仅失败保留
  profile/*                 # 临时测试 profile，不复用
```

`report.json` 至少包含：

- worktree、branch、HEAD、dist build timestamp 与关键 bundle SHA-256。
- Chrome executable、版本、headless/headed、profile 相对 artifact root。
- loopback host/port、外部请求阻断计数、任何本地 fulfill URL 的固定场景 ID。
- 每个场景的 viewport、theme、zoom、DPR、ready time、overflow、layout shift。
- accessible-name、focus order、focus-visible、duplicate ID 和 live-region 结果。
- A/B 分层的 bounded safe-tag API ledger 与 forbidden-call count；不包含请求 payload。
- 合成书签 before/after 摘要与 mutation count。
- console/page errors、截图和 trace 相对路径。
- teardown 是否确认 context/server/proxy 都由本任务创建并关闭；启动后通过 browser-level
  CDP `SystemInfo.getProcessInfo` 记录本 context 精确 PID，关闭后只以 signal 0/pid-exists
  检查这些 PID，绝不枚举或终止其它进程。
- overall `PASS`/`FAIL` 与失败场景，不允许 `partial` 自动提升为 PASS。

持久 review 文档只记录经脱敏的摘要、artifact 相对路径、关键数值和 verdict，不复制完整
profile、trace、DOM 或用户数据。最终 report 另写脱敏 `report-summary.json`，四张代表
截图复制到 allowlisted review assets；所有完整截图仍留在 ignored cache。

## 10. STOP 条件

任一条件出现立即停止自动验收并报告：

- 精确 Playwright Chromium 不可用、不能加载当前 extension service worker，或需要下载
  浏览器/依赖：进入 `BLOCKED_BY_BROWSER_CAPABILITY`。
- 临时 profile 不能证明位于批准 cache root，或发现其已指向/复用日常 profile。
- 需要访问真实 X、真实 Vault、真实书签、其它标签、Cookie、token 或外部 Provider。
- HTTP(S) 请求越过 loopback 或 route 无法证明已拦截。
- fixture 意外调用 picker、permission request/remove、Vault write 或 bookmark mutation。
- 无法识别并只关闭本任务创建的 browser/server。
- 端口冲突需要停止其它进程；应改用系统分配新端口。
- 发现 P0/P1/P2 需要修改未 allowlist 的 production 文件。
- 实际 Chrome zoom 无法证明达到 200%：能力缺失进入
  `BLOCKED_BY_BROWSER_CAPABILITY`，页面布局失败则保持 `FAIL`。
- GLM 预审返回未解决 P0/P1。

## 11. 执行与门禁

状态推进：

```text
DRAFT
  -> independent contract PASS
  -> current user orchestration/E2E approval recorded
  -> Integrator synchronizes Goal frontmatter + goals/README + PROJECT_STATUS
  -> READY
  -> IN_PROGRESS
  -> isolated E2E PASS
  -> complete repo gates PASS
  -> READY_FOR_REVIEW
  -> independent evidence/implementation PASS
  -> DONE
```

用户已于 2026-07-24 批准隔离 E2E 1-3，并已授权本轮自动编排；因此合同独立 `PASS`
后无需再次等待一轮授权，但 Integrator 仍必须显式同步三处状态并在开工前写
`IN_PROGRESS`。环境阻断必须使用具体 `BLOCKED_BY_BROWSER_CAPABILITY` 或
`BLOCKED_BY_ENVIRONMENT`，不能留在模糊 `IN_PROGRESS`。

执行顺序：

1. 运行 `pnpm lint`、`pnpm typecheck` 和 `pnpm test`。
2. 运行最后一次 `pnpm --filter @shuhai/extension run build`，记录关键 bundle hash。
3. 运行唯一 046C Playwright spec，固定 `--workers=1 --retries=0`。
4. 检查 report、截图、trace、测试 profile 边界和进程/端口 teardown。
5. 重新计算磁盘关键 bundle hash；与 E2E report 不一致则从步骤 1 重跑，不接受旧证据。
6. 对新增 spec 额外运行精确 ESLint、Prettier 和 TypeScript：

```bash
pnpm exec eslint packages/extension/e2e/goal-046c-isolated-ui.spec.ts
pnpm exec prettier --check packages/extension/e2e/goal-046c-isolated-ui.spec.ts
pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node,@playwright/test packages/extension/e2e/goal-046c-isolated-ui.spec.ts
```

7. 运行 `git diff --check`、精确 allowlist、文档链接和 Prettier check。
8. 独立 Reviewer 读取实际 diff、report 和持久截图，明确 P0/P1/P2/P3。
9. 文档收口、精确 stage 和独立 commit。用户已有“后续 Git 命令默认允许”的长期授权；
   push/PR 属于 Git 交付，不属于浏览器 HTTP(S) 隔离证明，只有 Git remote 连接可以在
   最终本地验收通过后使用。

E2E 命令必须是一行 PowerShell；`<run-id>` 由 Integrator 替换为只含
`[A-Za-z0-9_-]`、且当前不存在的本次运行 ID：

```bash
pnpm exec playwright test packages/extension/e2e/goal-046c-isolated-ui.spec.ts --workers=1 --retries=0 --reporter=list --output=node_modules/.cache/shuhai-goal-046c/runner-output-<run-id>
```

## 12. 完成条件

- 本合同经独立 review `PASS` 后才开始 E2E。
- A/B 两层所有 hard 场景通过；没有未解释 console/page/network 错误。
- 当前 dist、真实 unpacked extension 身份和 bundle hash 有证据。
- 真实 browser zoom 200%、360/420/480/640/720/960 布局、light/dark、长文本、0/1/1000+
  和 ActionBar 无遮挡有截图与几何数据。
- Options 挂载 forbidden side effects 为 0。
- 合成书签按 `seed -> baseline -> journey -> compare` 执行，fixture 创建数单独记录且
  baseline/after 完全一致；日常 Chrome、真实 X/Vault 和用户书签访问为 0。
- 完整仓库门禁通过。
- 独立 evidence/implementation review 为 `PASS`，P0/P1/P2 均为 0。
- 外部 GLM 状态保持真实；未返回时继续写 `PENDING`。
- 持久 review 和 current docs 收口；两周 dogfood 仍明确未完成。
