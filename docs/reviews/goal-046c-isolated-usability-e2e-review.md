# Goal 046C v3 独立合同审查

> 审查日期：2026-07-27
> 审查对象：`docs/goals/goal-046c-isolated-usability-e2e.md` version 3
> Verdict: **REWORK**
> 计数：P0 0 / P1 3 / P2 2 / P3 0

## Findings

### P1-1：B 层状态来源与“不得创建 SyncJob”自相矛盾

合同禁止创建 `SyncJob`，但 B-05、B-06、B-07 又要求渲染 paused、review 和 terminal
状态（Goal 046C:61,90-102,148-150）。生产 `XSyncPage` 不从 fake Chrome response 直接
取得这些状态；初始化会打开 SyncStore 并读取 active/recent job，随后再从 IndexedDB
读取 job、items 和 write intents
（`packages/extension/src/popup/pages/XSyncPage.tsx`:119-168,346-363）。因此，仅安装
strict fake Chrome API 无法构造合同要求的 X 状态。

**修正要求：**

- 将“不得创建 SyncJob”限定为 A 层真实 extension profile、真实 extension storage 和生产
  命令；明确允许 B 层只在 fixture origin 的隔离 IndexedDB 中预置受 schema 和容量限制的
  合成 job/item/intent。
- 为 B-03 至 B-08 增加简短的状态来源表：fake runtime response、fixture-origin IndexedDB
  seed、classification fake Port 或页面内用户交互分别负责什么。
- 每个 B 场景使用新的 fixture 状态命名空间，禁止读取 A 层 extension origin、真实
  extension IndexedDB 或其它场景残留；报告分别记录 fixture seed 与 Chrome API ledger。

### P1-2：根字号翻倍不能证明“200% text size”

合同把根字号设为正常值两倍，并据此声明 B-08 和完成条件通过了 `200% text size`
（Goal 046C:151-155,298-300）。但生产 CSS 把 `body` 固定为 `14px`
（`packages/extension/src/popup/styles.css`:40-51），大量关键说明继续使用固定
`12.5px`/`13px`，例如 Popup 摘要
（`packages/extension/src/popup/PopupApp.tsx`:264-265）、X 状态说明
（`packages/extension/src/popup/pages/XSyncPage.tsx`:826-829）和 Options 区域说明
（`packages/extension/src/options/OptionsApp.tsx`:177-185）。根字号翻倍只会放大 rem
尺寸，不会把这些固定 px 文本放大到 200%，当前名称会产生虚假保证。

**修正要求：**

- 若维持当前实现，改名为“root-rem 2x stress”，报告基线/放大后的代表节点 computed
  font-size，并从完成条件删除“200% text size 已验证”。
- 若仍要验收真正的 200% 文字放大，必须另写能证明代表性正文与辅助文字 computed
  font-size 均达到基线两倍的方案；不得把根字号、browser zoom、Windows display scaling
  三者互相冒充。
- 真实 browser zoom、Windows scaling 和 Obsidian Reading View 继续明确留给人工
  dogfood 是诚实边界，不需要在本 Goal 强行自动化。

### P1-3：全局“恰好一个 primary CTA”断言不符合代表场景

合同要求“每个场景”都只有一个可见、非 icon primary CTA（Goal 046C:157-173），但
A-01 没有页面 CTA；Side Panel idle 的生产设计是两个中性任务行，而不是一个 primary
按钮（`packages/extension/src/sidepanel/SidePanelApp.tsx`:102-155）；X terminal 的生产
入口文本是“返回同步入口”，不是 B-07 写死的“返回任务入口”
（Goal 046C:150；`packages/extension/src/popup/pages/XSyncPage.tsx`:812-823）。照当前
合同实施会让正确 UI 被测试判失败，或迫使实现者违反“不得修改生产代码”。

**修正要求：**

- 改为按场景定义 CTA：Popup ready 状态恰好一个 primary；执行/复核态至多一个
  primary；idle 允许两个中性任务入口；A-01 不适用 CTA 断言。
- B-07 使用生产语义和实际可访问名称“返回同步入口”，并断言不再显示继续扫描、保存或
  active-task primary CTA。
- “同一动作无重复入口”继续保留为所有交互场景的独立断言。

### P2-1：新增 E2E TypeScript 没有类型门禁

合同只对新增 spec/helper 运行 ESLint 和 Prettier（Goal 046C:274-285）。仓库
`pnpm typecheck` 会调用 extension 的 `tsc --noEmit`，但 extension tsconfig 只包含
`src/**/*` 和 `tests/**/*`，不包含 `e2e/**/*`
（`packages/extension/tsconfig.json`:1-10）。Playwright 能转译运行 TypeScript，不等于
执行类型检查。

**修正要求：**

- 恢复一个精确覆盖
  `packages/extension/e2e/goal-046c-isolated-ui.spec.ts` 与
  `packages/extension/e2e/helpers/goal-046c-harness.ts` 的 `tsc --noEmit` 门禁，且不得为此
  修改全局 tsconfig；或提供等价、可复跑的独立 typecheck 命令。

### P2-2：run artifact 与 Playwright output 的写入模型不一致

合同一方面写“每次运行只写”
`node_modules/.cache/shuhai-goal-046c/<run-id>/`（Goal 046C:214-224），另一方面允许并在
命令中指定兄弟目录
`node_modules/.cache/shuhai-goal-046c/runner-output-<run-id>/`
（Goal 046C:201-209,274-285）。trace 又被列在 `<run-id>/traces/`，但 Playwright
runner 默认会把自身附件放入 `--output`。当前文字不能唯一判断哪些文件应出现在哪里。

**修正要求：**

- 明确定义两个均为 task-owned、此前不存在的输出根：harness artifact root 与 Playwright
  runner output root。
- 明确 report、screenshots、profile、trace 分别由谁创建、写到哪里，以及最终 summary
  从哪个 exact run 复制；不得通过清理未知目录来补救路径冲突。

## 已核对且不构成阻塞的问题

- A 层使用锁定的 `@playwright/test@1.60.0`、fresh project profile、当前 `dist`、
  `offline: true` 和 direct extension page 的设计在合同层面可实现。现有 E2E 已展示
  persistent context、service worker 发现和 bundle hash 比对模式
  （`packages/extension/e2e/x-bookmarks-extension-fixture.spec.ts`:64-97,185-253）。
  本轮未启动浏览器，因此这里只是合同可实现性判断，不是运行证据。
- A 层没有把 direct page 冒充 toolbar Popup/Chrome Side Panel，也没有声称 OS 级网络
  隔离；不需要恢复 deny proxy、PID 枚举或日常 Chrome。
- B 层通过 loopback 提供 production bundle、在文档脚本前安装 strict fake Chrome API、
  对非 fixture HTTP(S) route abort 的总体方向可行；完成 P1-1 后才具备可执行的状态合同。
- 外部预审保持 `PENDING` 与当前 `DRAFT` 一致。合同已明确本地独立 review 是 READY
  门禁，外部结论若在 DONE 前返回 P0/P1 则必须先处理；因此外部 `PENDING` 本身不阻塞
  本地合同修订和下一轮独立 review，也不得被写成已通过。
- allowlist、fresh-profile 路径、无下载、无真实 X/Vault/书签、只关闭自有 handle 和
  STOP 边界总体风险匹配；修正 P2-2 后输出 ownership 才完全明确。

## 实际读取范围

- `AGENTS.md`
- `docs/PROJECT_STATUS.md`
- `docs/product-roadmap-v4.md`
- `docs/goals/README.md`
- `docs/workflows/README.md`
- `docs/goals/goal-046c-isolated-usability-e2e.md`
- `docs/architecture/extension-v4.md`
- `docs/proposals/2026-07-17-ui-shell-redesign.md`
- `docs/workflows/verification-and-acceptance.md`
- `docs/workflows/command-safety.md`
- `docs/workflows/dangerous-command-denylist.md`
- `package.json`
- `packages/extension/package.json`
- `playwright.config.ts`
- `packages/extension/tsconfig.json`
- `.gitignore`
- `packages/extension/e2e/smoke.spec.ts`
- `packages/extension/e2e/x-bookmarks-extension-fixture.spec.ts`
- `packages/extension/e2e/x-bookmarks-fixture.spec.ts`
- 与 Popup、Side Panel、Options、bookmark/X task、surface protocol 和样式直接相关的
  `packages/extension/src/**` 文件
- `git diff` 与 `git status`（只读）

## 未运行事项

按 Reviewer 合同未运行浏览器、网络、安装、测试、build、lint、typecheck、格式化、端口/
进程命令或 Git 写命令。未生成截图、trace、profile 或 runtime report；未访问真实
Chrome、X、Vault、书签、Cookie、token 或其它标签页。

## 结论

**Verdict: REWORK。** v3 已显著消除 v1/v2 的浏览器、网络、PID 和场景过度设计，但上述
3 个 P1 与 2 个 P2 会让 READY 后的实现产生不可构造状态、虚假 200% 证据、必然失败的
CTA 断言或未被类型检查的持久测试。修正后应再次独立合同审查；本轮不能推进为 `READY`。

## Round 2

> 审查日期：2026-07-27
> 审查对象：`docs/goals/goal-046c-isolated-usability-e2e.md` version 4
> Verdict: **REWORK**
> 计数：P0 0 / P1 0 / P2 1 / P3 0

### Finding

#### P2-1：E2E TypeScript 门禁仍从没有 `tsc` 的 workspace root 调用

v4 增加了同时覆盖 spec 与 helper 的独立 TypeScript 命令，但合同要求从固定工作目录执行
`pnpm exec tsc ...`（Goal 046C v4:310-320）。仓库根 `package.json` 只安装
`@playwright/test` 和 Node 类型，没有安装 `typescript` 或 `@types/chrome`
（`package.json`:23-36）；两者只属于 `@shuhai/extension` workspace
（`packages/extension/package.json`:36-45）。当前安装布局也只有
`packages/extension/node_modules/.bin/tsc.cmd` 和 extension 下的 Chrome 类型，根目录没有
对应 executable/type link。按合同原样执行时无法启动该类型门禁，因此上一轮 P2-1 尚未
闭合。

**修正要求：**

- 将命令改为从 extension workspace 调用其锁定的 TypeScript，例如
  `pnpm --filter @shuhai/extension exec tsc ... e2e/goal-046c-isolated-ui.spec.ts e2e/helpers/goal-046c-harness.ts`，
  并保留 Node、Playwright、Chrome 与 DOM 类型；文件参数须按该 workspace cwd 写成可解析
  路径。
- 不新增根依赖、不修改全局或 package tsconfig；修订后再次做一次限域合同复审。

### 上一轮逐项状态

- **P1-1 CLOSED**：A 层继续禁止创建任务；B 层明确只在每场景独立 fixture origin 的
  IndexedDB 预置 schema-valid、受容量限制的合成 job/item/intent，并给出 B-01 至 B-08
  状态来源表及 seed/Chrome ledger 分离要求（Goal 046C v4:65-67,96-111,162-173）。
- **P1-2 CLOSED**：场景已诚实改名为 `root-rem 2x stress`，要求记录 computed font size，
  明确不冒充全部文字 200%、browser zoom、Windows scaling 或 Reading View
  （Goal 046C v4:160,175-178,337-338）。
- **P1-3 CLOSED**：CTA 断言已按场景拆分，Side Panel idle 允许两个中性入口，A-01
  不适用，B-07 使用生产可访问名称“返回同步入口”并排除 active CTA
  （Goal 046C v4:159,182-188；`packages/extension/src/popup/pages/XSyncPage.tsx`:812-823）。
- **P2-1 OPEN**：见本轮唯一 finding。
- **P2-2 CLOSED**：单一、此前不存在的 `<run-id>` 下已明确区分 `artifacts/` 与
  `runner/` ownership，profile/report/screenshots/trace 的位置、复制来源和
  `--output`/run-id 一致性均已写清（Goal 046C v4:231-259,271-273,317,324-327）。

### 新增风险与状态一致性

- 未发现 v4 新引入的 P0、P1 或其它 P2。
- A 层 fresh profile、`offline: true`、direct extension page、service worker hash、书签
  摘要和 optional X permission before/after 合同在现有
  `@playwright/test@1.60.0` 与 production `dist` 模型下可实现；本轮没有运行浏览器，不能
  把合同可实现性写成运行证据（Goal 046C v4:78-94）。
- B 层 loopback production bundle、strict fake Chrome API、exact-origin route 与隔离
  IndexedDB 状态构造在修订后的范围内一致，不再要求调用生产 SyncJob 创建、扫描、mutation
  或 Vault 写入（Goal 046C v4:96-111,162-173）。
- 外部预审保持 `PENDING` 是真实状态。它不阻塞本地合同 review 和后续 READY 推进，但若在
  完成前返回 P0/P1，合同要求 STOP 并先处理，不能伪造通过
  （Goal 046C v4:12-14,287,305-308,342）。

### 实际读取与未运行

本轮按强制顺序重新读取 `AGENTS.md`、当前状态、路线图、Goal 索引、workflow、Goal 046C
v4 及其引用的架构、UI 提案、验收和命令安全文档；只读核对了根/extension package、
Playwright/TypeScript 配置、现有 extension E2E，以及 Popup、Side Panel、Options、
Bookmark task、X task、SyncStore 和 surface protocol 直接相关生产代码。另执行了只读
`rg`、`Get-Content`、`Test-Path`、`git diff` 和 `git status`。

按合同未运行浏览器、网络、安装、测试、build、lint、typecheck、格式化、端口/进程命令或
Git 写命令；未访问真实 Chrome、X、Vault、书签、Cookie、token 或其它标签页。

### Round 2 结论

**Verdict: REWORK。** v4 已关闭上一轮全部三个 P1 和输出目录 P2；仅剩 E2E TypeScript
门禁调用位置这一项 P2。修正精确命令并再次限域复审前，不能推进为 `READY`。

## Round 3

> 审查日期：2026-07-27
> 审查对象：`docs/goals/goal-046c-isolated-usability-e2e.md` version 5
> Verdict: **PASS**
> 计数：P0 0 / P1 0 / P2 0 / P3 0

### 上一轮唯一 Finding

- **P2-1 CLOSED**：精确 E2E TypeScript 门禁已改为从
  `@shuhai/extension` workspace 调用其锁定的 `tsc`，并使用该 workspace 下的
  `e2e/...` 相对路径（Goal 046C v5:314-324）。
- 当前安装布局中，TypeScript executable 与 Chrome 类型位于 extension workspace；
  Node 与 `@playwright/test` 类型位于上级根依赖。该命令的 cwd、可执行文件、类型来源和
  两个目标文件现在一致，不需要新增依赖或修改 tsconfig。

### 新增风险检查

本轮修订仅涉及上述一行门禁命令，没有改变 A/B 证据模型、fresh profile、offline mount、
production bundle 状态构造、CTA、`root-rem 2x stress`、artifact ownership、STOP、
外部预审 `PENDING` 或状态推进合同。未发现新引入的 P0、P1、P2 或 P3。

### 实际读取与未运行

本轮按强制顺序重新读取 `AGENTS.md`、当前状态、路线图、Goal 索引、workflow、Goal 046C
v5 及其引用的架构、UI 提案、验收和命令安全文档；只读核对 package/tsconfig、工具与类型
安装位置、Goal diff、原 review 和 `git status`。

按合同未运行浏览器、网络、安装、测试、build、lint、typecheck、格式化、端口/进程命令或
Git 写命令；未访问真实 Chrome、X、Vault、书签、Cookie、token 或其它标签页。

### Round 3 结论

**Verdict: PASS。P0/P1/P2/P3 均为 0。** version 5 已关闭上一轮唯一 P2，且该单行修订
未引入新的阻塞 finding。合同可按既定状态流程进入 `READY`；外部预审仍须保持真实
`PENDING`，若在完成前返回 P0/P1，继续执行既有 STOP 条件。

## Round 4

> 审查日期：2026-07-27
> 审查对象：`docs/goals/goal-046c-isolated-usability-e2e.md` version 6 amendment
> Verdict: **PASS**
> 计数：P0 0 / P1 0 / P2 0 / P3 0

### Amendment 核对

1. **B-01 文案 PASS**：代表场景已由“同步新增收藏”改为“同步 X 收藏”
   （Goal 046C v6:160-165），与 Goal 046A 的 Popup 合同
   （`docs/goals/goal-046a-surface-shell-and-popup.md`:62）、Goal 046B 的旅程命名
   （`docs/goals/goal-046b-two-journeys-and-options.md`:65）以及生产 Popup 的 heading/button
   文案一致（`packages/extension/src/popup/PopupApp.tsx`:201-203）。这只是让断言匹配现有
   可访问名称，没有改变上下文判断、动作语义或生产代码。
2. **PowerShell 参数引用 PASS**：精确 TypeScript 门禁已将
   `--lib "ES2022,DOM,DOM.Iterable"` 与
   `--types "node,@playwright/test,chrome"` 的逗号值放入双引号
   （Goal 046C v6:321-331）。Windows PowerShell 会把每个引用值作为一个 native argument
   传给 extension workspace 的锁定 `tsc`；workspace cwd、E2E 相对路径和既有类型来源均未
   改变，也没有新增依赖、配置或写入范围。

### 风险与状态

未发现 amendment 引入 P0、P1、P2 或 P3。v6 两项修订没有改变：

- A/B 证据模型与 production `dist` 身份边界（Goal 046C v6:85-122）。
- 文件 allowlist、task-owned run root 或持久证据范围（Goal 046C v6:223-284）。
- fresh profile、offline、loopback、真实 Chrome/X/Vault/书签禁区、STOP 和进程 ownership
  安全边界（Goal 046C v6:72-147,286-298）。
- 已经同步为唯一 `IN_PROGRESS` Goal 的实施状态、外部预审 `PENDING` 或后续独立验收门禁
  （Goal 046C v6:4,12-14,300-341；`docs/PROJECT_STATUS.md`:4；
  `docs/goals/README.md`:4-5）。

Round 3 已确认 v5 合同 P0/P1/P2/P3 为 0；本轮独立限域 amendment `PASS` 且没有新增
finding，因此本节就是 Integrator 将 Goal frontmatter 中
`amendment_review.verdict: PENDING` 更新为 `PASS` 的审查依据。按本 Reviewer 的唯一写入
边界，本轮不直接修改 Goal 或状态文件。

### 实际读取与未运行

本轮按强制顺序重新读取 `AGENTS.md`、当前状态、路线图、Goal 索引、workflow、Goal 046C
v6 及其引用的架构、UI、验收和命令安全文档；只读核对 Goal 046A/046B、生产 Popup 文案、
TypeScript/类型安装位置、原 review 和 `git status`。

按合同未运行浏览器、安装、网络、测试、build、lint、typecheck、格式化、端口/进程命令或
Git 写命令；未访问真实 Chrome、X、Vault、书签、Cookie、token 或其它标签页。

### Round 4 结论

**Verdict: PASS。P0/P1/P2/P3 均为 0。** v6 两项 amendment 均准确、限域且风险匹配，
可以关闭 `amendment_review: PENDING`；Goal 继续保持既有 `IN_PROGRESS` 实施状态。

## Round 5

> 审查日期：2026-07-27
> 审查对象：`docs/goals/goal-046c-isolated-usability-e2e.md` version 8 amendment
> Reviewer：Raman
> Verdict: **PASS**
> 计数：P0 0 / P1 0 / P2 0 / P3 0

### Amendment 核对

1. A 层 direct extension page 只证明真实 extension identity、bundle hash 和非正式 sender
   fail-closed；ready UI 由 B 层 strict fixture 驱动，未把普通标签页冒充 toolbar Popup 或
   Chrome Side Panel。
2. B-00 已补齐普通 Popup 的唯一“整理 Chrome 书签”入口；B-01/B-02 继续覆盖 X 上下文和
   active task，没有丢失原代表路径。
3. 隔离运行发现的 7 个无名称 checkbox 由
   `ClassifyPreview.tsx` 和一个对应 shell 测试构成唯一生产例外；不得修改布局、选择行为或
   其它组件。
4. Windows 完整门禁与精确复跑都显示 `safe-markdown` 只有 golden CRLF 与生产 LF 差异，
   其余测试通过。v8 只允许测试读取后规范化换行，禁止修改 production、golden 或
   visible-text oracle。
5. 独立 E2E TypeScript 命令使用 extension workspace 的锁定 `tsc`，并与仓库
   `strict`、`ESNext` 和 `bundler` 语义一致。

### Round 5 结论

**Verdict: PASS。P0/P1/P2/P3 均为 0。** direct-page 证据修正、B-00、可访问性修复和
Windows golden 门禁均有精确 allowlist、STOP 条件和完成断言。v8 amendment 可实施；
外部预审仍保持 `PENDING`，返回 P0/P1 时继续执行既有 STOP 条件。

## Round 6：v9 amendment review

> 审查日期：2026-07-28
> 审查对象：`docs/goals/goal-046c-isolated-usability-e2e.md` version 9 amendment
> Verdict: **PASS**
> 计数：P0 0 / P1 0 / P2 0 / P3 0

### Amendment 核对

1. **B-08 失败真实**：最新隔离运行的 `error-context.md` 在
   `audit.unnamedControls` 中只报告两个 `input:`。当前 `RulesEditor` 的“测试规则”区域
   恰好有两个受控 `Input`，分别更新 `testUrl` 与 `testTitle`，均没有关联 label、
   `aria-label` 或其它可访问名称来源，因此失败证据与生产代码一一对应。
2. **修复范围精确**：v9 只允许在上述两个输入增加
   `aria-label="测试 URL"` 与 `aria-label="测试标题"`，并在既有
   `packages/extension/tests/options-shell.test.tsx` 增加静态回归断言。合同明确禁止改变
   测试值、布局、事件、持久化、其它规则字段或其它组件。
3. **边界闭合**：`RulesEditor.tsx` 与 `options-shell.test.tsx` 已精确加入 P1 可访问性
   allowlist；非目标、allowlist、STOP 条件和完成条件共同要求只修复这两个稳定、非空名称，
   未放宽 production、fixture、浏览器、网络、真实数据或其它文件边界。

### 实际读取与未运行

本轮只读检查了用户指定的 `AGENTS.md`、Goal 046C v9、既有 review、`RulesEditor.tsx`、
`options-shell.test.tsx` 和最新失败 `error-context.md`。未运行浏览器、网络、下载、测试、
build、lint、typecheck、格式化或 Git 写命令；未访问主 checkout、日常 Chrome、真实 X、
Vault 或书签。

### Round 6 结论

**Verdict: PASS。P0/P1/P2/P3 均为 0。** B-08 的两个无名称输入有直接运行证据和精确代码
对应，v9 amendment 的生产改动、测试断言与禁止范围均闭合。**v9 amendment 可实施**；
实施结果仍须通过完整仓库门禁与后续独立 evidence/implementation review，外部预审继续
保持真实 `PENDING`。

## Round 7：v10 amendment review

> 审查日期：2026-07-28
> 审查对象：`docs/goals/goal-046c-isolated-usability-e2e.md` version 10 amendment
> Verdict: **PASS**
> 计数：P0 0 / P1 0 / P2 0 / P3 0

### Amendment 核对

1. **既有 P2 真实**：持久证据 `sidepanel-bookmark-narrow.png` 显示 360px Side Panel
   中选择按钮和三个排序按钮被固定 `grid-cols-2` 压在同一行的两个半宽区域内；“默认”、
   “低置信”和“按文件夹”出现逐字或多行断裂。当前 `ClassifyPreview` 工具栏确实使用固定
   两列，截图与代码直接对应。这是核心复核工具在合同目标宽度下的明显可读性摩擦，定级 P2
   合理。
2. **布局修复精确且无行为变化**：v10 只允许将工具栏容器改为
   `grid-cols-1 sm:grid-cols-2`，并在既有 `bookmark-task-shell.test.tsx` 增加对应静态断言。
   该 class 变化只令窄屏选择区与排序区分行、`sm` 及以上恢复两列，不要求修改按钮文本、
   DOM 顺序、`aria-pressed`、disabled 状态、点击回调、列表或 sticky action。
3. **截图时序更具代表性且不削弱审计**：当前 `executeFixtureScenario` 在
   `auditPage` 完成后截图，而该审计会执行最多 40 次 bounded `Tab`，可能滚动页面并留下
   中途焦点位置。v10 只把截图移到场景 ready 断言完成后、`auditPage` 调用前；随后仍在同一
   page/context 和同一业务状态运行完整 accessible-name、几何、focus order 与
   focus-visible 审计并写入报告。截图和键盘证据职责因此更清楚，没有删除门禁。
4. **合同边界闭合**：`ClassifyPreview.tsx`、`bookmark-task-shell.test.tsx` 和目标 E2E spec
   均已在既有 allowlist；非目标与 amendment 条款将写入限制为一个响应式 class、一个 shell
   断言和函数内截图/audit 顺序。STOP 条件继续拒绝 allowlist 外生产改动，完成条件要求
   360px 工具分行、排序标签自然横排、代表截图不受 Tab 遍历污染，并保留完整仓库门禁及后续
   独立 implementation review。

### 实际读取与未运行

本轮只读检查了用户指定的 `AGENTS.md`、Goal 046C v10、既有 review、持久 360px 截图、
`ClassifyPreview.tsx` 工具栏、`bookmark-task-shell.test.tsx` 和 E2E spec 的
`executeFixtureScenario`。未运行浏览器、网络、下载、测试、build、lint、typecheck、格式化
或 Git 写命令；未访问主 checkout、日常 Chrome、真实 X、Vault、书签或其它真实数据。

### Round 7 结论

**Verdict: PASS。P0/P1/P2/P3 均为 0。** 截图中的单字竖排是有直接证据的既有 P2，v10
amendment 对布局 class、静态回归断言和截图时序的授权精确且无行为扩张。截图提前提高了
视觉证据代表性，同时完整键盘审计仍保留。**v10 amendment 可实施**；实现后仍须以新截图、
完整仓库门禁和独立 evidence/implementation review 关闭该既有 P2。

## Round 8：implementation/evidence review

> 审查日期：2026-07-28
> 审查对象：Goal 046C v10 实际 tracked/untracked diff、`final-20260728-01` 脱敏 summary
> 与三张持久截图
> Reviewer：Codex（独立 evidence/implementation Reviewer）
> Verdict: **FAIL**
> 计数：P0 0 / P1 0 / P2 3 / P3 0

### Findings

#### P2-1：teardown 失败会被吞掉并被报告为成功关闭

主测试的 `finally` 对 persistent context、fixture browser 和 loopback server 都使用
`close().catch(() => undefined)`，随后无条件把对应 `*Closed` 标记设为 `true`
（`packages/extension/e2e/goal-046c-isolated-ui.spec.ts`:1635-1646）。因此即使
`close()` 真实失败，`fatalError` 仍可保持空，最终 `overall` 仍可为 `PASS`，持久 summary
也会把三个 handle 写成已关闭。`final-20260728-01` 的 closed 布尔值因此不能独立证明
teardown 成功，不满足合同对自有 handle 可靠关闭和诚实报告的要求。

**修正要求：** 只有 `close()` 成功后才设置 closed 标记；任一 teardown 失败必须进入
最终失败原因并使报告为 `FAIL`，同时仍继续尝试关闭其它本任务 handle，不能吞错后写成成功。

#### P2-2：harness 不能证明整个 run root 在命令开始前不存在

`prepareRunLayout()` 明确接受已经存在、且只包含 `runner/` 的 run root；它只在存在
其它条目时抛出 `goal_046c_run_root_reused`
（`packages/extension/e2e/helpers/goal-046c-harness.ts`:207-221）。这兼容 Playwright
可能在 spec 执行前创建 output 目录，但也无法区分“本次 runner 刚创建”与“同一 run-id
遗留的 runner-only 目录”。当前实现能证明 `artifacts/` 和 profile 未复用，却不能证明
合同要求的整个 `<run-id>` root 在命令开始前不存在。

**修正要求：** 在 Playwright 创建 output 前增加可复跑的 preflight/ownership 证明，或
采用等价的不可复用握手；不得仅凭 spec 启动时看见 runner-only root 就认定本次 run 全新。

#### P2-3：持久 summary 没有保存 console/page error 的零值证据

运行时确实用 `assertCleanDiagnostics()` 要求两个数组为空
（`packages/extension/e2e/goal-046c-isolated-ui.spec.ts`:714-716），完整内存 report 的
scenario 也包含 diagnostics；但 `persistPassingEvidence()` 映射脱敏 scenario 时省略了
`diagnostics`（`packages/extension/e2e/helpers/goal-046c-harness.ts`:1028-1043）。
实际 `report-summary.json` 的 13 个 scenario 均没有 `consoleErrors`、`pageErrors` 或对应
count。该 summary 可直接证明 network、unnamed、overflow、duplicate-id 等为 0，却不能
按持久证据直接证明用户要求的 console/page error 归零；A 层截图还发生在该场景最后一次
diagnostics 断言之后。

**修正要求：** 脱敏 summary 至少保存每场景 console/page error count，并在场景所有截图
和审计完成后做最后一次 clean assertion；任何非零值必须使整体失败。

### 已核对通过

1. **范围闭合**：相对 `origin/main` 的 9 个 tracked 修改和 7 个 untracked 文件全部位于
   v10 allowlist；未发现隐藏路径越界。生产行为变化仅为 `ClassifyPreview` checkbox
   accessible name、360px 工具栏响应式分行和 `RulesEditor` 两个固定 accessible name。
2. **窄修正确**：checkbox 名称含序号与标题，重复标题仍可区分；规则测试输入只增加固定
   `aria-label`；`safe-markdown` 只规范化读取到的 golden CRLF，production 输出和 visible
   text oracle 仍逐字比较，没有用宽松匹配掩盖问题。三个对应测试与修改一一对应。
3. **A/B 证据边界诚实**：summary 明确写
   `mountMode: direct_extension_page`，没有冒充 toolbar Popup 或 Chrome Side Panel shell；
   fresh profile、service worker/disk hash、固定 dist、exact loopback origin、外部 HTTP(S)
   拦截、strict fake Chrome ledger 和每场景独立 IDB seed 的实现方向均符合合同。
4. **最终数据**：`final-20260728-01` 为 13/13 scenario `PASS`；书签 digest 与节点数、
   X optional permission、Vault handle count 前后相同。B-05/B-06/B-07 seed 分别为
   7/6198、6/5104、4/3820（records/bytes），均低于 12 records/64 KiB；network、
   forbidden、picker、permission mutation、bookmark mutation、X command、unnamed control、
   overflow、duplicate-id 和 geometry failure 在 summary 中均为 0。
5. **真实用户视觉**：三张 PNG 尺寸分别为 420x600、360x900、640x900。Popup 主动作唯一且
   无遮挡；360px 整理建议的选择区与排序区已分两行，“默认 / 低置信 / 按文件夹”自然横排，
   末项与 sticky action 无关键重叠；Options 的 root-rem 2x stress 未见横向 overflow 或
   关键控件遮挡，但固定 px 正文没有被误写成 200%。
6. **状态诚实**：Goal、PROJECT_STATUS、roadmap 和索引均只到 `READY_FOR_REVIEW`；真实
   toolbar user gesture、Chrome zoom、Windows scaling、Obsidian Reading View、两周 owner
   dogfood 和外部 GLM preaudit `PENDING` 均明确保留，没有写成已完成。

### 未覆盖风险与未运行事项

- 本轮按用户合同未运行浏览器、网络、下载、真实 Chrome/X/Vault/书签、测试、build、lint、
  typecheck 或格式化；`851/851`、production build 和 E2E 运行结果只审查现有持久证据与
  实现逻辑，没有独立复跑。
- direct extension page 不能证明真实 toolbar user gesture 或 Chrome Side Panel shell；
  root-rem 2x 不能证明 Chrome zoom/Windows scaling；截图不能替代 Obsidian Reading View
  和两周真实 dogfood。
- `report-summary.json` 的 `head` 是未提交实现所基于的 HEAD，不是当前工作树内容身份；
  dist hash 与当前 diff 的对应关系仍依赖既有 build 流程和 before/after hash 门禁。

### Round 8 结论

**Verdict: FAIL。P0 0 / P1 0 / P2 3 / P3 0。** 实际产品窄修、截图和大部分隔离断言质量
良好，且没有发现 v10 allowlist 外生产变化；但 teardown、run-root non-reuse 和持久
console/page diagnostics 三项证据可靠性仍未闭合。按 Goal 046C 完成条件，P2 非零时不得
`PASS`，不得推进 `DONE`；修复后需生成全新 run-id 的持久证据并再次独立
evidence/implementation review。外部 GLM preaudit 继续保持真实 `PENDING`。

## Round 9：implementation/evidence re-review

> 审查日期：2026-07-28
> 审查对象：Round 8 修复后的完整 Goal 046C diff、task-owned
> `final-20260728-02` 原始证据、脱敏 summary 与三张持久截图
> Reviewer：Codex（独立 evidence/implementation Reviewer）
> Verdict: **PASS**
> 计数：P0 0 / P1 0 / P2 0 / P3 1

### Findings

- **P0：0 / none。**
- **P1：0 / none。**
- **P2：0 / none。**
- **P3-1：低优先级 workflow 仍残留旧状态。**
  `docs/workflows/README.md`:62,64 仍写 046C `DRAFT` 和“下一步只精简合同”，与
  `AGENTS.md` 指定的高优先级状态源中 `READY_FOR_REVIEW` 不一致。该文件自身又声明
  workflow 不维护瞬时状态，且当前 Goal 索引优先，因此不会误授权实施或影响本轮证据结论；
  这是未由 Goal 046C diff 引入的既有文档漂移，定级 P3，不阻塞 PASS。后续文档收口应删除
  workflow 中的瞬时状态副本或同步为非瞬时描述。

### Round 8 三项 P2 关闭情况

1. **P2-1 CLOSED：teardown 诚实失败。**
   主测试现在分别 `try/catch` 关闭 persistent context、fixture browser 和 loopback server，
   只在各自 `close()` 成功后设置 closed；失败收集到 `teardownErrors`，同时继续尝试其它
   handle，最后合并为 `AggregateError`
   （`packages/extension/e2e/goal-046c-isolated-ui.spec.ts`:1651-1685）。`overall` 额外要求
   所有已创建 handle 已关闭且无 fatal error（同文件:1690-1705）。每个 B 场景的独立
   BrowserContext 仍在 `finally` 直接关闭，失败会向外传播。原始 report 与脱敏 summary
   的三组 created/closed 均为 `true`。
2. **P2-2 CLOSED：run-root ownership fail closed。**
   preflight 在固定 worktree 和 cache root 下要求 run root 不存在，再以非递归 `mkdirSync`
   独占创建，生成 UUIDv4 token，并以 `flag: wx` 写 owner marker
   （`packages/extension/e2e/helpers/goal-046c-harness.ts`:206-229）。测试进程要求环境 token
   格式正确，root 只能含本次 marker/runner，marker 必须是普通文件且 schema、run-id、token
   精确匹配；missing、wrong token、runner-only、旧 artifacts 或其它条目均 fail closed
   （同文件:231-287）。cache 中 `final-20260728-02/.goal-046c-owner.json` 为 schema 1、
   正确 run-id、36 字符 UUIDv4 token；runner `.last-run.json` 为 `passed`。实现不删除、
   修补或复用旧 root。
3. **P2-3 CLOSED：持久 diagnostics 可直接核验。**
   脱敏映射现在为每个 scenario 写入 `consoleErrorCount` 和 `pageErrorCount`
   （`packages/extension/e2e/helpers/goal-046c-harness.ts`:1089-1097）；A 层也在截图后再次做
   clean assertion，B 层在截图和 audit 后断言。`report-summary.json` 的 13 个场景均为
   `consoleErrorCount: 0`、`pageErrorCount: 0`；task-owned 原始 report 对应 13 组 diagnostics
   数组也全部为空，场景 ID 与顺序一致。

### 完整实现与证据核对

1. **Scope**：相对 `origin/main` 的 9 个 tracked 修改与 7 个 untracked Goal 文件全部位于
   v10 allowlist；未发现 package、lockfile、manifest、Playwright 全局配置或 allowlist 外
   production 修改。生产变化仍仅为两个 accessible-name 修复和 360px 工具栏响应式分行；
   safe-markdown 只规范化读取后的 golden CRLF。
2. **最终 run**：原始 report、脱敏 summary 和 runner 状态均指向
   `final-20260728-02`、分支 `codex/goal-046c-isolated-e2e`、HEAD
   `550be1dc70297506f78aa0aae929f297da99a5aa`，13/13 场景与 overall 均为 `PASS`。
   service worker 与关键 dist hash 被持久记录；书签 digest/节点数、X optional permission、
   Vault handle count 前后不变。13 场景 external、unnamed、duplicate-id、overflow 和
   geometry 均为 0；B 层 forbidden/picker/permission mutation/bookmark mutation/X command
   均为 0。各 IDB seed 继续低于 12 records/64 KiB。
3. **证据同源与脱敏**：三张持久 PNG 与同一 run cache 中对应截图的 SHA-256 分别完全一致。
   summary 不含绝对盘符、owner token、extension ID、profile、Cookie、Authorization、
   私人 URL、真实正文或 raw diagnostics，只保留安全计数和合成标签；raw report 的 profile
   也是 run-root 相对路径，owner token 未进入 report。
4. **视觉复核**：420x600 Popup 仍只有一个明确主动作且无遮挡；360x900 Side Panel 的选择/
   排序区域稳定分两行，三个排序标签自然横排，末项和 sticky action 可见；640x900 Options
   root-rem stress 无横向 overflow 或关键控件遮挡。最明显的用户摩擦仍是 Options 放大场景
   中 rem 标题显著增大、固定 px 正文不变，sticky 保存栏占用较多垂直空间；合同已诚实把它
   限定为 stress，不冒充真实 200% zoom。
5. **状态与门禁**：Goal、PROJECT_STATUS、roadmap 和 Goal 索引均保持
   `READY_FOR_REVIEW`，未提前写 `DONE`；真实 toolbar user gesture、Chrome Side Panel
   shell、Chrome zoom、Windows scaling、Obsidian Reading View、两周 dogfood 与外部 GLM
   preaudit `PENDING` 均明确保留。

### 自动化未覆盖风险与未运行事项

- 本轮没有重新启动浏览器、网络、build、lint、typecheck、测试或格式化；Integrator 报告的
  lint/typecheck、1+25+851 tests、build、专项 ESLint/Prettier/strict E2E tsc 与
  `git diff --check` 通过，Round 9 只从实际 diff、runner 状态、原始 report、持久 summary、
  marker 和截图独立交叉核验。另只读执行的 tracked `git diff --check` 无错误。
- direct extension page 仍不证明真实 toolbar user gesture 或 Chrome Side Panel shell；
  root-rem stress 不证明 Chrome zoom/Windows scaling；fixture 不替代真实 X、Vault、
  Obsidian Reading View 或两周 owner dogfood。
- summary 的 HEAD 仍是未提交工作树所基于的 commit；dist 与当前未提交 source diff 的对应
  继续依赖已记录的 build 顺序、service-worker identity 及 E2E 前后 hash 门禁。

### Round 9 结论

**Verdict: PASS。P0 0 / P1 0 / P2 0 / P3 1。** Round 8 的 teardown、run-root ownership
和持久 diagnostics 三个 P2 均已被限域修复，并由同一全新
`final-20260728-02` run 的 marker、原始 report、runner 状态、脱敏 summary 与截图闭环验证。
未发现 scope 越界、生产行为扩张或持久证据泄漏；Goal 046C 满足独立
evidence/implementation review 的 PASS 条件。唯一 P3 是既有 workflow 瞬时状态漂移，
应在后续文档收口处理；真实用户环境门禁和外部 GLM preaudit 继续保持未完成/PENDING。
