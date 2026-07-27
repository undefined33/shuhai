# Goal 046D v2 独立合同审查

> 日期：2026-07-26；Reviewer：Codex（第二位独立合同 Reviewer）；审查对象：
> `docs/goals/goal-046d-dogfood-readiness.md` version 2
> Verdict：`FAIL`

## Findings

### P1：可见文本保真仍由 renderer 自己证明，不能证明实际阅读视图

合同要求“阅读视图解码后”等于规范化原文，但验收方法只是：

- production renderer 输出与仓库 fixture 完全相等；
- 解码“renderer allowlist 中的 entity/escape”后做字符串比较；
- Reviewer 打开 Markdown fixture 阅读。

参见：

- `docs/goals/goal-046d-dogfood-readiness.md:178-180`
- `docs/goals/goal-046d-dogfood-readiness.md:196-211`
- `docs/goals/goal-046d-dogfood-readiness.md:333-334`

这个合同允许实现者同时定义 encoder、allowlist decoder 和 golden fixture，三者即使共同偏离
Markdown/Obsidian 的实际解析语义也能通过。尤其是 entity、行首块语法、反斜杠、连续换行和
tab 在阅读视图中的行为，不能由同源字符串 round-trip 证明。该缺口直接影响本 Goal 的核心
用户结果“安全研究内容仍可读且保真”。

修正要求：

1. 固定一个独立于 production encoder 的参考验证器或解析证据，不能复用 production
   escape/decode 实现；
2. 明确验证标题、正文、`javascript:`、事件属性、模板、wikilink、反引号、fence、行首
   block marker、反斜杠、换行和 tab 的最终可见文本；
3. 若仓库内没有足以模拟 Obsidian 语义的既有工具，则把“实际 Obsidian 阅读视图检查”列为
   独立隔离验收门禁，而不是仅阅读 raw fixture 后宣称保真。

### P2：网络边界自相矛盾

合同非目标明确禁止访问网络，但 Implementer 允许读取 Chrome 官方在线文档：

- `docs/goals/goal-046d-dogfood-readiness.md:64`
- `docs/goals/goal-046d-dogfood-readiness.md:84-93`
- `docs/goals/goal-046d-dogfood-readiness.md:328`

这会让执行者无法判断读取官方文档是允许动作还是 STOP 条件。

修正要求：删除在线文档读取项，改为只依赖已归档的审计证据；或者明确仅允许访问列出的
Chrome 官方只读 URL，并同步修改“禁止网络”和 STOP 条件。两种规则只能保留一种。

## Euclid 8 项复核

| 项目                            | 结论           | 证据                                                                    |
| ------------------------------- | -------------- | ----------------------------------------------------------------------- |
| 可见文本保真                    | **未完全闭合** | 规范已写入，但独立于 renderer 的实际阅读视图证据不足，见 P1             |
| HTTPS link destination          | 已闭合         | 专用 renderer、固定 label、destination 编码和攻击测试已写入 `213-223`   |
| 角色 allowlist                  | 已闭合         | Implementer、Integrator、Reviewer 和只读审计材料已拆分于 `95-147`       |
| `046D -> 046C -> owner dogfood` | 已闭合         | 顺序明确记录于 `280` 与 `304-317`                                       |
| manifest 名称描述               | 已闭合         | `name`、`short_name`、`description` 已纳入 `233-234` 与完成条件         |
| 图标证明                        | 已闭合         | 尺寸、非透明/非空白像素、dist 与独立视觉检查已纳入 `229-236`、`296-300` |
| 模板命名                        | 已闭合         | 使用无日期的 `friction-log-template.md`，见 `269-280`                   |
| GLM 门禁语义                    | 已闭合         | frontmatter 明确 `NOT_REQUIRED` 并记录理由，后续真实意见仍受 STOP 约束  |

## Verdict

`FAIL`

- P0：0
- P1：1
- P2：1
- P3：0

在上述 P1/P2 修正并重新独立审查前，Goal 046D 不应从 `DRAFT` 推进到 `READY`。

本轮只读取仓库内材料，只新增本审查文件；没有修改实现、合同、状态、审计或其它文件，
没有执行测试、Git 写操作、网络、Chrome、X、Vault、书签、依赖或进程/端口操作。

## Round 3

> 日期：2026-07-26；Reviewer：Codex（第三轮独立合同 Reviewer）
> 审查对象：`docs/goals/goal-046d-dogfood-readiness.md` version 3

Verdict: PASS

- P0：0
- P1：0
- P2：0
- P3：0

简短证据：

- 独立 oracle 位于测试专用 helper，禁止引用 production renderer、helper、escape 表或常量；
  它只解析固定 Markdown 子集，并与手写 `.visible.txt` 完全比较。合同同时明确该证据不模拟
  Obsidian，实际 Reading View 留到 046C 完成后的 owner dogfood 首日门禁。
- 网络边界已统一：实施、验证和 STOP 条件均禁止外部网络、真实 Chrome、X 与 Vault；
  Chrome 116、Side Panel 和 icon 依据只读取仓库内已归档审计，不再允许访问在线文档。
- 新增 Markdown fixture、手写 visible fixture 和 oracle helper 均进入 Implementer 精确
  allowlist；定向测试、canary corpus、独立性检查及完成条件均明确覆盖这些产物。
- 未发现 version 3 新增的 P0/P1/P2 自相矛盾；Round 2 的 P1 与 P2 均已修复。

本轮仅读取用户指定的四个仓库内文件，只在本 review 文件末尾追加 Round 3；未运行测试、
Git、网络、Chrome、X 或 Vault 操作，也未修改实现、合同、状态或审计文件。

## Implementation Review

### Findings

1. **P1：worktree 存在 Goal allowlist 外修改。** 只读 `git status --short --untracked-files=all` 显示
   `ShuHai-ClaudeCode-audit-2026-07-26-194008.zip`、两份 `docs/audits/` 外部报告以及
   `docs/goals/goal-046c-isolated-usability-e2e.md`。这些路径不在 Goal 046D 的 Implementer、
   Integrator 或 Reviewer 写入 allowlist；因此当前提交状态不满足“所有修改在 Goal allowlist”，
   也不满足发现越界文件后才能继续收口的 STOP 条件。

2. **P2：动态文本的可见字符保真仍丢失首尾空白。**
   `packages/extension/src/vault/safe-markdown.ts:94-99` 的 `normalizeUntrustedText()` 使用
   `.trim()`，会删除动态标题、作者或正文的首尾空格以及首尾换行。046D 合同只允许 NFC、换行
   和不可见控制字符规范化，并要求显示文本保持可见字符保真；现有 canary/benign fixture 没有
   覆盖这些边界，因此该行为未被独立 oracle 锁定。

### 用户真相

- **我作为用户实际看到或使用了什么：** 通过固定 benign fixture 和独立测试 oracle，可核对标题、
  元数据、正文、来源 HTTPS 链接和远程媒体普通链接；hostile 文本保持可见且不形成 YAML、raw
  HTML、模板、Dataview、wikilink、embed、fence 或危险链接语法。
- **最明显的摩擦，或为何没有可行动问题：** 主要可读路径清晰；首尾空白丢失是边界保真问题，
  需要补实现与 fixture 后再收口。
- **代表产物、截图或路径：** `packages/extension/tests/fixtures/safe-readable-social.md`、
  `packages/extension/tests/fixtures/safe-readable-social.visible.txt`，以及
  `packages/extension/tests/helpers/markdown-visible-text-oracle.ts`。本轮没有 Chrome、Obsidian
  Reading View 或截图证据。
- **测试没有覆盖的用户风险：** 独立 oracle 只覆盖 Goal 固定 Markdown 子集，不模拟 Obsidian；
  首尾空白保真、真实 Reading View、build 后 dist 资源和真实 dogfood 仍未由本轮独立验证。

### 门禁证据

- `safe-markdown.ts` 使用十进制 character reference 保护动态显示文本；HTTPS destination 经过
  `URL` 二次规范化、固定 label、分隔符 percent-encoding，并拒绝非 HTTPS 与 credentials。
- oracle 位于测试 helper，未 import production renderer、helper、escape 表或常量；两个 safe-readable
  fixture 为手写期望产物。
- manifest 声明 Chrome `116`、16/32/48/128 本地图标和 action 图标；manifest test 包含 PNG header、
  尺寸、透明像素与非单色可见像素检查。
- README、CONTRIBUTING、package description 与 MIT LICENSE 已按当前纯扩展、两个动作、AI 可选边界
  收口；README 明确 X 为 `LIMITED_GO/batch-only`、微博无生产枚举，也没有宣称健康检测或完整历史。
- 已知历史门禁记录中有两次既有 flaky 失败，随后最终原始 `pnpm test` 为 `849/849 PASS`；本轮按
  用户指令未运行测试、lint、typecheck、build、Prettier 或其它命令，不能把该历史结果当成本轮重跑证据。
- 本轮只读核对了 `git status`/diff；没有 Git 写入、网络、Chrome、X、Vault、用户目录或其它 worktree
  操作。

### 残余风险

真实 Obsidian Reading View、dist 图标落盘结果、完整仓库门禁和两周 dogfood 仍需后续授权的独立门禁；
046C 仍是最终隔离 E2E/可用性验收，不应因本 review 提前开始。

### 计数与 Verdict

- P0：0
- P1：1
- P2：1
- P3：0

`Verdict: FAIL`

## Implementation Re-review

> 日期：2026-07-27；Reviewer：Codex（限域 Implementation Re-review）
> 复核范围：仅上一轮 P1/P2 两项 finding；未运行测试或其它门禁命令

### Findings

1. **P1：CLOSED。** `git log` 确认 `82d98f5`（外部审计归档）和 `7767fb7`（Goal 046C
   草案）均已进入当前 `HEAD`，`git diff HEAD --name-status` 不包含它们。当前状态中唯一
   范围外未跟踪项是预先存在的 `ShuHai-ClaudeCode-audit-2026-07-26-194008.zip`；按既定
   Integrator 边界精确 stage 排除，不将其视为待提交的 046D diff，且本轮未删除、移动或修改。

2. **P2：CLOSED。** `normalizeUntrustedText()` 已移除 `trim()`；`encodeDisplayLine()` 通过
   倒序循环识别尾部空格，并将首尾空格编码为 `&#32;`。`renderBlockDisplayText()` 将空白行
   编码为 `&#10;`，避免空白保真依赖可触发 Markdown block 语义的原始行。新增
   `preserves visible boundary whitespace without exposing block syntax` 测试验证标题、作者和
   正文的首尾空格/空行；独立 oracle 要求 renderer 最终换行并解码 `&#10;`。同一测试还断言
   内容不会形成四空格代码块、列表、标题或引用标记；现有 hostile payload 断言继续覆盖
   raw HTML、危险 scheme、模板、Dataview、wikilink、embed 和 fence。

### 门禁证据

- 用户提供的最终门禁证据为：`pnpm lint PASS`、`pnpm typecheck PASS`、`pnpm test PASS`
  （shared 1/1、desktop 25/25、extension 850/850）、extension build PASS、targeted 21/21、
  Prettier PASS、`git diff --check` exit 0、dist manifest/icons 校验 PASS。本轮未重跑。
- 兼容修复已采用倒序循环，不依赖 `findLastIndex`。
- 未进行 Chrome、X、Vault、网络、用户数据或 Git 写操作。

### Verdict

- P0：0
- P1：0
- P2：0
- P3：0

`Verdict: PASS`

### Post-gate whitespace addendum

> 日期：2026-07-27；范围：仅复核 hard-break whitespace 修正；本轮未重跑门禁

- **A：PASS。** `renderBlockDisplayText()` 以固定 `.join('\\\n')` 生成单反斜杠
  hard-break；反斜杠仍在动态字符编码表中并输出为 `&#92;`，因此不可信文本不能闭合、追加或
  控制该结构。
- **B：PASS。** 独立 oracle 仅剥离每个内容行末的 renderer 固定单反斜杠，再独立解码
  `&#10;`、`&#32;` 和其它十进制 character reference；标题、作者、正文首尾空格及空白行的
  可见文本断言保持闭合。
- **C：PASS。** safe-readable fixture 已改用行末单反斜杠，边界测试新增
  `expect(markdown).not.toMatch(/[ \t]+$/mu)`，确认 renderer 输出不再依赖或包含行尾空格。
- 用户提供的重跑证据：targeted 21/21、lint PASS、typecheck PASS、shared 1/1、desktop
  25/25、extension 850/850、build PASS。本轮未独立重跑。

- P0：0
- P1：0
- P2：0
- P3：0

`Verdict: PASS`
