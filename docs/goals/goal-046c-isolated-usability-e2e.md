---
id: goal-046c
title: Isolated Usability Visual And Mount E2E
status: DONE
version: 10
updated: 2026-07-27
depends_on:
  - goal-046b
  - goal-046d
branch: codex/goal-046c-isolated-e2e
base_commit: 550be1dc70297506f78aa0aae929f297da99a5aa
external_preaudit:
  status: PENDING
  note: 用户已转发 Goal 046 预审请求，尚未收到可核验结论；若完成前返回 P0/P1，必须先处理。
contract_review:
  verdict: PASS
  rounds:
    - reviewer: Beauvoir
      reviewed_at: 2026-07-26
      verdict: FAIL
      summary: v1 存在网络与浏览器能力过度声明、输出 allowlist、真实 Popup、zoom、teardown 和持久证据等问题。
    - reviewer: Curie
      reviewed_at: 2026-07-27
      verdict: REWORK
      summary: v3 尚有 B 层状态来源、root-rem 证据命名、CTA 场景约束、E2E typecheck 和 run root 五项缺口。
    - reviewer: Curie
      reviewed_at: 2026-07-27
      verdict: REWORK
      summary: v4 已关闭四项，只剩 E2E TypeScript 门禁必须从 extension workspace 调用。
    - reviewer: Curie
      reviewed_at: 2026-07-27
      verdict: PASS
      summary: v5 已关闭全部 P0/P1/P2/P3，允许进入 READY 后转 IN_PROGRESS。
amendment_review:
  verdict: PASS
  rounds:
    - reviewer: Curie
      reviewed_at: 2026-07-27
      verdict: PASS
      summary: v6 的既有 046A 文案与 Windows PowerShell 参数引用修正未改变安全边界。
    - reviewer: Raman
      reviewed_at: 2026-07-27
      verdict: PASS
      summary: v8 的 direct-page fail-closed 证据分工、B-00、唯一可访问性生产例外和 Windows golden 测试修复均限域闭合。
    - reviewer: Raman
      reviewed_at: 2026-07-28
      verdict: PASS
      summary: v9 的两个无名称测试输入有直接运行证据，生产与测试 allowlist 精确且禁止范围闭合。
    - reviewer: Raman
      reviewed_at: 2026-07-28
      verdict: PASS
      summary: v10 的窄屏响应式 class 与截图时序调整精确闭合，既有 P2 有直接视觉证据。
  summary: v10 amendment 独立复核 PASS，P0/P1/P2/P3 均为 0。
implementation_review:
  verdict: PASS
  reviewer: Codex independent evidence reviewer
  reviewed_at: 2026-07-28
  counts:
    p0: 0
    p1: 0
    p2: 0
    p3: 1
  summary: Round 9 confirmed all three Round 8 P2 findings closed; the only P3 is pre-existing workflow status drift outside this Goal's write allowlist.
---

# Goal 046C：隔离可用性、视觉与挂载 E2E

## 1. 用户问题

Goal 046A、046B 和 046D 已完成当前产品主壳、两条核心旅程和 dogfood 前置收口，
但最终 production `dist` 仍缺少一套可复跑的隔离浏览器证据。现有 jsdom、build graph
和历史 fixture 不能单独证明：

- 当前 `dist` 能由全新测试 profile 作为 unpacked extension 加载。
- Popup、Side Panel 和 Options 在代表性宽度、深浅主题、长文本和键盘下仍可用。
- 两条核心旅程没有重新出现旧后台、重复主动作、遮挡或挂载副作用。
- Options 初始挂载不会弹 picker、申请平台权限、修改书签或写文件。

本 Goal 只补最终产物的隔离验收和持久证据。它不新增产品功能，也不替代用户随后进行的
真实 Chrome、X 和 Obsidian dogfood。

## 2. 用户结果

完成后只允许声明：

1. 当前 worktree 刚构建的 production `dist` 可由本机已经存在的 Playwright Chromium
   在全新项目 profile 中加载，实际 service worker 与磁盘 bundle hash 一致。
2. 代表性的 Popup 和任务状态主动作符合当前上下文，Side Panel idle 保留两个中性任务
   入口；没有关键遮挡、横向 overflow、重复动作或不可达的核心操作。
3. Popup 初始路径不加载完整后台；Options 初始挂载没有 picker、权限变更、书签 mutation、
   X 扫描或 Vault 写入。
4. 测试只使用公开合成数据、任务自有 loopback server 和全新 profile；没有接触日常 Chrome、
   真实 X、真实 Vault、用户书签、Cookie、token 或其它标签页。
5. 自动化直接导航 extension page 只证明页面身份、挂载和非正式 sender 被 fail-closed
   拒绝；可用状态由 B 层 production bundle fixture 验证，不冒充真实 toolbar 点击、
   Chrome Side Panel 外壳、系统显示缩放或两周 dogfood。

## 3. 非目标

- 除 `ClassifyPreview` 为每个整理建议 checkbox 增加由合成/本地书签标题构成的可访问名称，
  以及 `RulesEditor` 为“测试规则”的 URL/标题输入增加固定可访问名称外，不修改 Popup、
  Side Panel、Options、书签、X、Vault、AI、message 或 storage 生产代码。
- `RulesEditor` 例外不得改变规则测试值、布局、事件、持久化或其它规则字段；只允许增加
  `aria-label="测试 URL"` 与 `aria-label="测试标题"`，并在既有 Options shell 测试中断言。
- `ClassifyPreview` 的第二个例外只允许把选择/排序工具栏从固定两列改为窄屏一列、
  `sm` 及以上两列，避免 360px 下“默认 / 低置信 / 按文件夹”被压成单字竖排；不得改变
  按钮文本、顺序、状态、点击行为、列表或 sticky action。
- `safe-markdown` 测试只允许在读取 golden fixture 后把 CRLF 规范化为 LF；不得修改
  production Markdown、golden 内容或 visible-text oracle 语义。
- 不执行真实或合成书签的移动、删除、URL 更新、恢复或分类 apply。
- A 层不授予 X optional host permission，不启动 X 扫描、不创建 SyncJob、不写任何 Vault。
  B 层只允许在 fixture origin 的隔离 IndexedDB 中预置受界合成状态，不调用生产创建、扫描
  或写入命令。
- 不访问外部网络，不下载浏览器、驱动、依赖、字体、图片或 fixture。
- 不新增依赖，不修改 lockfile、package manifest、manifest 或 Playwright 全局配置。
- 不验证真实 toolbar `activeTab` user gesture、真实 Side Panel 打开动画、Obsidian Reading
  View、OS 级网络隔离或全部 X 历史收藏。
- 不顺带美化 UI、加入新平台、模板、诊断或性能优化。

## 4. 证据模型

046C 使用两层互补证据，二者都必须消费同一次最终 build 生成的 production `dist`。

### 4.1 A 层：真实 unpacked extension 挂载

- 只执行 `@playwright/test@1.60.0` 当前解析出的、已经存在的
  `chromium.executablePath()`；启动前验证它是普通文件。不存在或不能加载 extension 时
  标记 `BLOCKED_BY_BROWSER_CAPABILITY`，不得下载或改用日常 Chrome。
- 每次运行创建新的
  `node_modules/.cache/shuhai-goal-046c/<run-id>/artifacts/profile/`。路径必须是当前 worktree
  cache root 的普通子目录，不得预先存在、复用、链接到或读取其它 profile。
- 启动参数只显式加载当前 `packages/extension/dist`，并禁用后台联网、组件更新、同步和
  first-run。Playwright context 使用 `offline: true`；A 层不需要 HTTP fixture。
- 必须发现当前 extension service worker，比较其
  `background/service-worker.js` SHA-256 与磁盘 build；不匹配即 `FAIL`。
- 只直接打开当前 extension 的 Popup、Side Panel 和 Options 页面。报告统一标记
  `direct_extension_page`，不得把它写成 toolbar Popup 或 Chrome Side Panel 外壳证据。
  direct navigation 会产生与正式 Popup/Side Panel/Options 不同的 sender 上下文；A 层
  必须断言页面进入 bounded fail-closed 状态，不能要求 ready UI，也不能放宽生产 sender
  校验。普通 ready Popup、idle Side Panel 和 Options 首屏改由 B 层 strict fixture 覆盖。
- 记录全新 profile 的书签树有序摘要和 optional X permission before/after；两者必须
  完全不变。不得创建合成书签来制造数量状态。
- 只关闭测试持有的 Playwright context。不得枚举、终止或检查其它 Chrome 进程。

### 4.2 B 层：production bundle 状态 fixture

- 任务自有 Node HTTP server 只监听系统分配的 `127.0.0.1` 端口，并提供当前 `dist`。
- 在文档脚本运行前安装 strict fake Chrome API。未列入当前场景 schema 的调用抛出
  `unexpected_api_call`；只记录 bounded safe tag，不记录原 payload。
- context route 只允许 exact fixture origin；其它 HTTP(S) 请求立即 abort 并计数。此证据
  只证明 Playwright 观察到的 app 请求没有到达外部 origin，不声明 OS、DNS、UDP 或浏览器
  自身全部网络为零。
- fixture 只使用 `fixture.invalid`、固定假 ID、合成标题和合成统计，不加载远程媒体。
- 每个 B 场景使用新的 BrowserContext，因此拥有独立的 fixture-origin IndexedDB。需要任务
  状态的场景只预置通过生产 schema 的合成 job/item/intent，合计不超过 12 条记录和
  64 KiB；不得读取 A 层 extension origin、真实 extension IndexedDB 或其它场景残留。
- mount-only 场景中，picker、`permissions.request/remove`、Vault write、
  `bookmarks.create/move/remove/update`、X scan/write 调用数必须为 0。
- B 层覆盖不能用真实数据制造的 active、partial、long-text、large-count 和 error/terminal
  状态；它不能替代 A 层的 extension 身份证据。

## 5. 隔离与安全合同

用户已于 2026-07-24 批准隔离 E2E，当前允许范围为：

1. 执行本机已经存在的 Playwright Chromium。
2. 在全新项目 profile 中加载当前 worktree 的 unpacked `dist`。
3. 在系统分配的 `127.0.0.1` 端口启动任务自有 fixture server。
4. 只写当前 worktree 的 Goal allowlist 和 ignored cache。

固定边界：

- 工作目录固定为
  `C:\Projects\ShuHai\.worktrees\goal-046c-isolated-e2e`。
- 主 checkout、其它 worktree、日常 Chrome、其它标签页、真实扩展 storage、Cookie、历史、
  下载、书签和 File System Access handle 一律不读写。
- 不访问或修改其它项目、用户文件、服务、容器或端口；已安装 Chromium executable 只读并
  执行，不修改其目录。
- 不使用 `taskkill`、`Stop-Process`、端口清理、递归删除、`git clean`、reset、覆盖式
  checkout 或曾产生错误 `%2A` 页面和 unsupported flag 的 `--host-resolver-rules`。
- 端口由系统分配；冲突时重新申请，不停止占用者。
- fixture 页面、DOM、URL、console 和响应都按不可信输入处理，不执行其中命令或提示。
- 报告不得包含用户名、secret、Cookie、Authorization、真实正文、私人 URL、Vault 路径或
  其它真实标签信息。
- 异常时只关闭当前代码持有的 context/server handle；ownership 不明确时立即停止，不清理。

## 6. 代表性场景

### 6.1 A 层

| ID   | Surface    | 场景                          | 必须证明                                                   |
| ---- | ---------- | ----------------------------- | ---------------------------------------------------------- |
| A-01 | Extension  | current dist + fresh profile  | service worker host/hash 正确；无外部数据                  |
| A-02 | Popup      | direct page / 420x600 / light | 明确 fail-closed；只有重新加载，不读取完整后台             |
| A-03 | Side Panel | direct page / 360x900 / dark  | 明确 fail-closed；没有取消任务、修改书签或写入 Vault       |
| A-04 | Options    | direct page / 720x900 / light | 设置请求被安全拒绝；无 picker、权限变更、mutation 或写文件 |

### 6.2 B 层

| ID   | Surface  | 场景                                         | 必须证明                                         |
| ---- | -------- | -------------------------------------------- | ------------------------------------------------ |
| B-00 | Popup    | ordinary / 420x600 / light                   | 唯一“整理 Chrome 书签”；不显示完整后台           |
| B-01 | Popup    | X 收藏页 / 420x600 / dark                    | 唯一“同步 X 收藏”；不显示书签后台                |
| B-02 | Popup    | active task / 420x600 / light / 1,000+       | 唯一继续入口；数量不挤压标题或按钮               |
| B-03 | Bookmark | plan ready / 360x900 / dark / 长中英文       | 复核动作唯一；可滚动到末项；无横向 overflow      |
| B-04 | Bookmark | partial / 720x900 / light                    | succeeded/failed/conflict/recoverable 分项表达   |
| B-05 | X sync   | paused / 360x900 / light / 长文本            | 继续、使用本批、取消语义不重复；ActionBar 不遮挡 |
| B-06 | X sync   | review / 480x900 / dark / metadata-only      | 不完整项默认不选；本批边界清楚                   |
| B-07 | X sync   | terminal / 360x900 / light                   | 唯一“返回同步入口”；不保留 active CTA            |
| B-08 | Options  | AI configured / 640x900 / dark / root-rem 2x | 首屏三项和高级折叠；展开后仍可键盘访问和滚动     |

状态来源固定为：

| 场景           | 状态来源                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| B-00/B-01/B-02 | fake `tabs/windows` + schema-valid surface runtime response              |
| B-03           | fake bookmark snapshot + fake classification Port + 页面内“生成建议”交互 |
| B-04           | fake bookmark snapshot + schema-valid partial operation response         |
| B-05/B-06/B-07 | fixture-origin IndexedDB seed + fake bootstrap/runtime Port              |
| B-08           | fake settings/bootstrap/X permission + fixture-origin empty Vault store  |

B-05 至 B-07 的 seed 只制造页面读取的持久状态，不调用生产 SyncJob 创建、扫描、复核或写入
命令。报告必须把 fixture seed 数量/字节与 Chrome API ledger 分开记录。

`root-rem 2x` 只把根 `rem` 基准扩大为正常值两倍，并分别记录根节点、代表性正文和辅助文字
在基线/放大后的 computed font size。由于生产代码仍包含固定 px 文本，该场景只叫
`root-rem 2x stress`，不声明全部文字达到 200%，也不冒充 Chrome browser zoom。真实
browser zoom、Windows display scaling 和 Obsidian Reading View 明确保留给 owner dogfood。

## 7. 断言范围

所有交互场景都检查同一动作没有顶部和底部重复入口。CTA 数量按场景约束：

- B-00/B-01/B-02 Popup ready 状态恰好一个可见、非 icon primary CTA。
- Bookmark/X 执行、复核或终态至多一个 primary CTA，并使用场景表中的实际可访问名称。
- B 层 Side Panel idle 固定为两个中性任务入口，不要求 primary CTA。
- A-01 只有 extension identity，不适用 CTA 断言；A-02/A-03 fail-closed 各只有一个重新加载
  主动作；A-04 无可操作控件。
- B-07 不显示继续扫描、保存或 active-task primary CTA，只保留“返回同步入口”。

每个页面场景还至少检查：

- `document.documentElement.scrollWidth <= clientWidth`，关键标题、表单、列表尾项和
  ActionBar 没有几何重叠或越出 viewport。
- 可见 button/link/input 有 accessible name；页面无 duplicate `id`。
- 代表性主动作、返回、设置和高级折叠控件可由 Tab 到达；focus-visible 相对未聚焦状态有
  可见 outline、ring 或 box-shadow 变化。
- 正文 computed font size 至少 13px，辅助文字至少 12px。
- 进度、错误和结果使用已有的 progress/status/alert/live-region 语义；不声明完整 WCAG
  合规。
- 页面在 10 秒安全上限内出现合同指定 heading 和主动作。记录 ready time，但该上限只用于
  发现挂死，不作为性能基准或性能改进声明。
- console error、uncaught page error、unhandled rejection 和未解释的外部请求均为 hard
  `FAIL`。
- 代表截图在场景 ready 断言完成后、40 次 bounded `Tab` 键盘遍历前拍摄；键盘审计仍在
  同一页面和同一状态上随后执行并写入报告，避免审计自身滚动把截图变成中途位置。

API ledger 额外要求：

- Popup ordinary/X/active 场景不得读取完整书签树、健康记录、Options 全量或任务详情全集。
- Side Panel idle 只读取 surface summary/ack；任务模块只在对应 route 加载。
- Options initial mount 只允许 bootstrap status、settings get、已有 Vault handle permission
  query 和 exact X permission contains；所有 user-gesture API 为 0。

## 8. 允许文件

### 合同、状态与持久证据

- `docs/goals/goal-046c-isolated-usability-e2e.md`
- `docs/reviews/goal-046c-isolated-usability-e2e-review.md`
- `docs/PROJECT_STATUS.md`
- `docs/product-roadmap-v4.md`
- `docs/goals/README.md`
- `docs/reviews/assets/goal-046c/report-summary.json`
- `docs/reviews/assets/goal-046c/popup-x-context.png`
- `docs/reviews/assets/goal-046c/sidepanel-bookmark-narrow.png`
- `docs/reviews/assets/goal-046c/options-root-rem-2x.png`

### 可复跑隔离测试

- `packages/extension/e2e/goal-046c-isolated-ui.spec.ts`
- `packages/extension/e2e/helpers/goal-046c-harness.ts`

### P1 可访问性修复

- `packages/extension/src/popup/pages/ClassifyPreview.tsx`
- `packages/extension/tests/bookmark-task-shell.test.tsx`
- `packages/extension/src/popup/pages/RulesEditor.tsx`
- `packages/extension/tests/options-shell.test.tsx`

### Windows 测试门禁修复

- `packages/extension/tests/safe-markdown.test.ts`

### 忽略的运行产物

- `packages/extension/dist/**`（只由精确 extension build 生成，不 stage）
- `node_modules/.cache/shuhai-goal-046c/<run-id>/**`

Playwright 必须通过 `--output` 写入 `<run-id>/runner/`，不创建或清理默认
`test-results/`。除以上路径外一律只读；`playwright.config.ts`、manifest、package manifests、
lockfile、production `src/**`、其它 E2E 和其它 Goal 不得修改。

发现其它必须修改的生产代码时立即停止，在 review 中记录失败场景、最小根因、精确候选文件
和后续 Goal/amendment，不得以“E2E 小修”扩大当前范围。v8 amendment 允许修复运行实证发现的
`ClassifyPreview` checkbox 无可访问名称，以及 `safe-markdown` golden 在 Windows checkout
中只有 CRLF/LF 差异。v9 amendment 只允许修复 B-08 实证发现的 `RulesEditor` 两个测试输入
无可访问名称。v10 amendment 只允许改变 `ClassifyPreview` 工具栏的响应式 grid class、
对应 shell 断言，以及 `executeFixtureScenario` 内截图与键盘审计的先后顺序；不得借此修改
其它布局、行为、Markdown 生产输出、fixture 内容或其它组件。

## 9. 报告与持久证据

每次运行有两个均属于同一个、此前不存在的 task-owned run root：

```text
node_modules/.cache/shuhai-goal-046c/<run-id>/
  .goal-046c-owner.json      # preflight 独占创建，含当前进程继承的随机 token
  artifacts/                 # harness 创建
    report.json
    screenshots/*.png
    profile/*
  runner/                    # Playwright --output 创建
    **/*                     # test attachments 与失败 trace
```

`<run-id>` root 在 preflight 开始前必须不存在；preflight 独占创建 root 和 ownership
marker，并把随机 UUID token 传给同一个 Playwright 进程。Harness 只有在 marker 的 run-id
与 token 精确匹配、root 除 marker/本次 `runner/` 外没有其它条目时才写 `artifacts/`。
任何 runner-only 遗留 root、缺失/错误 token 或旧 artifacts 都立即失败；测试不删除、复用
或修补旧 run。失败 trace 由 Playwright 的 `retain-on-failure` 写入 `runner/`，不得复制到
`artifacts/`。

`artifacts/report.json` 至少包含：

- branch、HEAD、dist bundle SHA-256、Chromium 版本和 profile 相对路径。
- A/B 层、场景 ID、viewport、theme、text scale、ready time、overflow 和几何结果。
- accessible-name、focus order、focus-visible、duplicate ID 和语义结果。
- bounded API safe tags、forbidden-call count、external request blocked count。
- 书签摘要和 optional X permission before/after。
- console/page errors、截图与 runner trace 相对路径、overall `PASS`/`FAIL`；持久 summary
  至少保留每场景 console/page error count。
- context/server handle 是否由本任务创建并在 `finally` 中关闭；不记录或枚举 PID。

最终只从同一次通过的 run 的 `artifacts/report.json` 和 `artifacts/screenshots/` 复制
脱敏 `report-summary.json` 和三张代表截图到第 8 节持久 allowlist。不得提交 profile、
runner output、trace、完整 DOM、原 API payload 或绝对用户路径。

## 10. STOP 条件

任一条件出现立即停止自动验收并报告：

- 需要下载浏览器、依赖或驱动。
- 已有 Playwright Chromium 不存在、不是普通文件或不能加载当前 service worker。
- profile 不能证明位于当前 worktree 的批准 cache root，或路径已存在/指向其它位置。
- 需要访问真实 X、Vault、用户书签、Cookie、token、Provider 或其它标签页。
- app HTTP(S) 请求未被 exact fixture route 拦截。
- fixture 调用 picker、permission request/remove、Vault write、bookmark mutation 或 X scan。
- 无法只关闭当前代码持有的 context/server handle。
- 发现需要修改 allowlist 外文件或生产代码的 P0/P1/P2。
- 外部 GLM 预审在完成前返回未解决 P0/P1。

## 11. 状态与门禁

状态推进：

```text
DRAFT
  -> independent contract PASS
  -> READY
  -> IN_PROGRESS
  -> isolated E2E PASS
  -> complete repo gates PASS
  -> READY_FOR_REVIEW
  -> independent evidence/implementation PASS
  -> DONE
```

用户已批准隔离 E2E 和本轮自动编排，因此独立合同 `PASS` 后无需再次申请同一范围授权；但
Integrator 必须先同步 Goal、`docs/goals/README.md` 和 `docs/PROJECT_STATUS.md` 的
`READY/IN_PROGRESS` 状态，才能写 E2E 文件或启动浏览器。外部预审未返回时保持
`PENDING`，不得伪造结论；独立仓库合同 review 是本 Goal 的实施门禁。

实施后依次运行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
$env:SHUHAI_GOAL_046C_RUN_ID = '<run-id>'
$runToken = pnpm exec tsx packages/extension/e2e/helpers/goal-046c-harness.ts --goal-046c-preflight
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$env:SHUHAI_GOAL_046C_RUN_TOKEN = ($runToken | Out-String).Trim()
pnpm exec playwright test packages/extension/e2e/goal-046c-isolated-ui.spec.ts --workers=1 --retries=0 --reporter=list --output=node_modules/.cache/shuhai-goal-046c/<run-id>/runner
pnpm exec eslint packages/extension/e2e/goal-046c-isolated-ui.spec.ts packages/extension/e2e/helpers/goal-046c-harness.ts
pnpm exec prettier --check packages/extension/e2e/goal-046c-isolated-ui.spec.ts packages/extension/e2e/helpers/goal-046c-harness.ts
pnpm --filter @shuhai/extension exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib "ES2022,DOM,DOM.Iterable" --strict --esModuleInterop --skipLibCheck --types "node,@playwright/test,chrome" e2e/goal-046c-isolated-ui.spec.ts e2e/helpers/goal-046c-harness.ts
git diff --check
```

测试进程通过 `SHUHAI_GOAL_046C_RUN_ID=<run-id>` 接收同一个 ID，并通过
`SHUHAI_GOAL_046C_RUN_TOKEN` 接收 preflight 本次随机 token；任一环境变量与 marker 或
`--output` 所属 run root 不一致都立即失败。`<run-id>` 只含 `[A-Za-z0-9_-]` 且此前
不存在。最终 build 必须先于 preflight/E2E；E2E 前后重新计算关键 bundle hash，不一致就
废弃本轮证据。

独立 Reviewer 必须读取实际 diff、脱敏 summary 和三张代表截图，明确 P0/P1/P2/P3，
并从真实用户角度说明最明显摩擦和自动化未覆盖的风险。实现者自述不能替代 review。

## 12. 完成条件

- v5 合同经独立 review `PASS` 后才开始实施。
- A/B 两层全部代表场景通过，没有未解释 console/page/network 错误；整理建议 checkbox
  均有唯一、非空的可访问名称，“测试规则”的 URL 与标题输入也有稳定、非空的可访问名称。
- `safe-markdown` golden 比较在 Windows 与 LF checkout 上都保留逐字内容 oracle，不因
  checkout 换行风格失败。
- 当前 `dist`、真实 unpacked extension identity 和 bundle hash 有直接证据。
- B 层 Popup、360px Side Panel、640/720px Options、light/dark、长文本、partial、1,000+ 和
  `root-rem 2x stress` 无关键遮挡或横向 overflow；不声明全部文字达到 200%。
- 360px 整理建议截图中选择与排序工具分为两行，三个排序标签保持自然横排；代表截图不是
  bounded `Tab` 遍历造成的中途滚动位置。
- Options mount forbidden side effects 为 0；书签摘要和 X permission before/after 不变。
- 所有本任务创建的 context/browser/server 只有在 `close()` 成功后才记为 closed；关闭
  异常使 overall 失败但不阻止继续关闭其它 handle。持久 summary 的每场景 console/page
  error count 均为 0。
- 完整仓库门禁通过。
- 独立 evidence/implementation review 为 `PASS`，P0/P1/P2 为 0。
- 外部预审状态保持真实；若返回问题则在 `DONE` 前处理。
- 当前状态文档和持久证据收口；真实 Chrome/Obsidian 与两周 dogfood 仍明确未完成。
