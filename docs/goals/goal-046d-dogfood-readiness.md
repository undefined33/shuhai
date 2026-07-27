---
id: goal-046d
title: Dogfood Readiness And Safe Readable Output
status: DONE
version: 3
updated: 2026-07-27
depends_on:
  - goal-046b
precedes:
  - goal-046c
branch: codex/goal-046-ui-shell
base_commit: 0b893cb
user_authorization:
  status: RECORDED
  note: 用户于 2026-07-26 要求归档外部报告，并根据经代码核验的问题审查和修改。
contract_review:
  verdict: PASS
  rounds:
    - reviewer: Euclid
      reviewed_at: 2026-07-26
      verdict: FAIL
      summary: 初版缺少可见文本保真、专用 HTTPS link renderer、角色写权限隔离和一致的 dogfood 启动顺序，并有 4 个 P2 发布/流程缺口。
    - reviewer: Fermat
      reviewed_at: 2026-07-26
      verdict: FAIL
      summary: v2 的可见文本 round-trip 仍与 production renderer 同源，且“禁止网络”与在线 Chrome 文档读取范围冲突。
    - reviewer: Aristotle
      reviewed_at: 2026-07-26
      verdict: PASS
      summary: v3 以独立 oracle 和手写 visible fixture 闭合固定 Markdown 子集证据，明确不冒充 Obsidian UI，并统一离线边界；P0/P1/P2/P3 均为 0。
implementation_review:
  verdict: PASS
  reviewer: Anscombe
  reviewed_at: 2026-07-27
  summary: 两项初审 finding 均已关闭；P0/P1/P2/P3 为 0/0/0/0，完整门禁与 build 通过。
external_preaudit:
  status: NOT_REQUIRED
  note: 本 Goal 不改算法、迁移、权限、网络、依赖或破坏性数据语义；独立安全合同/实现 review 与攻击测试是强制门禁。若后续收到 GLM 意见，只作为真实 advisory 记录。
---

# Goal 046D：Dogfood 前置可读性与发布收口

## 1. 用户问题

Goal 046A/046B 已把扩展收敛为两个任务，但当前 X 笔记把全部动态内容输出为缩进代码块，
并在代码块中显示 HTML entity 和改写后的插件符号。安全测试通过不等于笔记能读。

同时，扩展没有图标和最低 Chrome 版本，根 README、包描述和 License 文件也与当前 v4
事实漂移。此状态不适合开始两周 dogfood，也不值得先投入大规模视觉 E2E。

依据：

- [`2026-07-26-external-strategy-review.md`](../audits/2026-07-26-external-strategy-review.md)
- [`ShuHai-战略方向建议书-2026-07-26.md`](../audits/ShuHai-战略方向建议书-2026-07-26.md)

## 2. 用户结果

完成后：

1. 新保存的 X 笔记以正常标题、元数据、正文段落和普通 HTTPS 链接呈现。
2. hostile DOM 内容作为安全研究证据仍保持可见文本保真，但不能生成 raw HTML、模板、
   Dataview、Obsidian embed、危险链接、executable code block 或远程媒体 embed。
3. Chrome 工具栏、扩展管理页和浏览器 Side Panel 标题栏使用一致的 ShuHai 图标。
4. Manifest 明确 Chrome 116 最低版本，旧版本不会安装后才发现 `sidePanel.open()` 不存在。
5. README、package 描述和 License 与当前“两个动作、纯扩展、AI 可选”事实一致。
6. Reviewer 必须并排阅读 production renderer 生成的 benign Markdown 和独立参考 oracle
   解析出的用户可见文本；本 Goal 不把该证据冒充实际 Obsidian UI 验收。
7. 仓库具备 fixture 刷新合同和两周 dogfood 摩擦日志模板，但本 Goal 不伪报 dogfood 已完成。

## 3. 非目标

- 不修改 Vault writer、路径、SyncCatalog、SyncStore、书签 mutation、权限、message、
  storage、X 扫描预算或 adapter。
- 不删除 v1/v2 IndexedDB 迁移。
- 不新增 backfill、新平台、AI 摘要/标签、通用剪藏或 Electron 能力。
- 不访问真实 Chrome、X、Vault、书签、Provider 或网络。
- 不静默重写或迁移 Vault 中已有的 Markdown；v2 只影响之后的新写入。
- 不安装依赖，不下载字体、图标工具或浏览器。
- 不把安全字符中和退化为“原样输出任意 Markdown”。
- 不完成或伪造 Goal 046C 和两周 dogfood。

## 4. 轨道与风险

本 Goal 整体按硬轨处理，因为它触碰进入 Vault 前的 Markdown 安全边界。图标、README 和
流程文档虽是轻轨内容，也随同一完整门禁验收，不单独降低安全标准。

风险等级：

- Markdown renderer 与测试：R1 代码变更，潜在 Vault 内容安全回归。
- Manifest、静态图标和元数据：R1 仓库内发布卫生。
- 文档和 dogfood 模板：R1 仓库内可逆编辑。
- 真实数据和发布：禁止；本 Goal 不执行 R3。

## 5. 精确允许范围

### 5.1 允许读取

- 根 `AGENTS.md`、current docs、当前 Goal、外部审计归档。
- `packages/extension/src/vault/safe-markdown.ts`
- `packages/extension/src/social/sync-schema.ts`
- `packages/extension/src/social/sync-engine.ts`
- `packages/extension/manifest.json`
- `packages/extension/vite.config.ts`（只读，确认 public asset build 行为）
- 本 Goal 直接相关测试和 `pnpm-lock.yaml`（只读）
- 已归档审计中记录的 Chrome 116、Side Panel 和 icon 证据；不重新访问在线文档

### 5.2 Implementer 允许修改

- `packages/extension/src/vault/safe-markdown.ts`
- `packages/extension/tests/safe-markdown.test.ts`
- `packages/extension/tests/fixtures/safe-readable-social.md`（新增，纯合成内容）
- `packages/extension/tests/fixtures/safe-readable-social.visible.txt`（新增，独立可见文本期望）
- `packages/extension/tests/helpers/markdown-visible-text-oracle.ts`（新增，测试专用参考 oracle）
- `packages/extension/manifest.json`
- `packages/extension/tests/manifest.test.ts`
- `packages/extension/src/public/icons/shuhai-icon.svg`（新增源文件）
- `packages/extension/src/public/icons/icon-16.png`（新增）
- `packages/extension/src/public/icons/icon-32.png`（新增）
- `packages/extension/src/public/icons/icon-48.png`（新增）
- `packages/extension/src/public/icons/icon-128.png`（新增）
- `README.md`
- `CONTRIBUTING.md`
- `LICENSE`（新增；只落实 package 已声明的 MIT）
- `package.json`（只修改 description，不改依赖、脚本、版本或 license 值）
- `docs/workflows/verification-and-acceptance.md`
- `docs/workflows/fixture-refresh.md`（新增）
- `docs/workflows/continuous-orchestration.md`
- `docs/workflows/README.md`
- `docs/dogfood/friction-log-template.md`（新增模板）

### 5.3 Integrator 状态收口允许修改

- `docs/goals/goal-046d-dogfood-readiness.md`
- `docs/PROJECT_STATUS.md`
- `docs/product-roadmap-v4.md`
- `docs/goals/README.md`

Integrator 只能在实施前处理合同 amendment，或在门禁/独立 review 后同步状态；不能在
Implementer 工作中暗改验收标准。合同若发生实质变化，回到 `DRAFT` 并重新独立审查。

### 5.4 Reviewer 专属写入

- `docs/reviews/goal-046d-dogfood-readiness-review.md`（新增）

独立 Reviewer 只写 review 文件；不得修改实现、合同、审计材料或 current 状态文档。

### 5.5 全程只读材料

- `docs/audits/ShuHai-战略方向建议书-2026-07-26.md`
- `docs/audits/2026-07-26-external-strategy-review.md`

### 5.6 禁止修改

- `packages/extension/src/social/sync-store.ts` 及其迁移测试。
- `packages/extension/src/utils/vault-writer.ts`、SyncCatalog 和路径逻辑。
- Popup、Side Panel、Options、adapter、service worker、message、permissions 生产逻辑。
- `packages/desktop/**`、`packages/shared/**`、lockfile、依赖和 scripts。
- Goal 046C E2E 实现文件、其它历史 Goal 和主 checkout Goal 032 diff。
- `dist/**` 只能由精确 build 生成且不 stage。

发现必须修改 allowlist 外文件时 `STOP`，写 amendment 并独立审查。

## 6. Safe-readable v2 合同

### 6.1 输出结构

固定结构至少包含：

```text
frontmatter
可读 H1 标题
作者 / 发布时间 / 捕获完整度 / 原文 HTTPS 链接
正文普通段落
远程媒体普通 HTTPS 链接列表（如有）
```

- 动态标题、作者和正文不能整体进入四空格缩进块或 fenced code block。
- 没有标题时使用固定、非误导的 fallback。
- `metadata_only`、`summary_only` 等完整度必须在正文区域可见。
- canonical URL 和媒体 URL 只来自 runtime schema 已验证的 HTTPS 值。
- 不生成 `![]()` 或 `![[...]]` 远程/本地 embed。

### 6.2 安全不变量

不可信动态文本分为两个不同上下文：

1. **显示文本**：使用可逆、上下文无关的 Markdown/Obsidian 转义。除 NFC、换行和不可见
   控制字符规范化外，不删除、替换、插入说明词或改变用户可见字符。
2. **链接目标**：只接受 schema 校验后的 HTTPS URL，经专用固定结构 renderer 规范化和
   编码后才能成为链接。

显示文本按 CommonMark/HTML character reference 语义解码后必须与规范化原文一致。
`javascript:`、`onerror=`、`{{...}}`、
`::`、wikilink、反引号和 fence 等安全研究内容必须仍可读，不能替换成
`[blocked scheme]`、`event-*` 或插入空格；它们只能通过 entity/escape 使语法失活。

raw source 必须保持：

- 没有可解析的 raw HTML tag、HTML block 或事件属性上下文；`onerror=` 等证据文本允许
  以 character reference 编码后存在并在可见文本中还原。
- 动态显示文本中的 `javascript:`、`data:`、`file:`、`obsidian:` 等不能成为链接或
  autolink；raw source 中的语法分隔符必须被可逆编码。
- 没有 `[[...]]`、`![[...]]`、模板 token、Dataview `::` 字段或 executable plugin block。
- 没有由动态内容形成的 YAML delimiter、heading、list、callout 或 fence。
- 原始反斜杠不能抵消 renderer 新增的 escape。
- 控制字符、CRLF 和 Unicode 继续按现有 bounded normalization 处理。
- Frontmatter 白名单、8 KiB 上限和 strict parser 不变。

允许安全的普通 emphasis 字符只在不能组成可执行/自动加载语义时保留；实现不需要完整支持
用户提供的 Markdown。

为避免 production encoder 与测试 decoder 共同犯错，v2 实现固定采用以下最小语法：

- 动态文本中可能形成 Markdown、Obsidian 或 HTML 语义的 ASCII 标点使用十进制 HTML
  character reference；不使用反斜杠 escape 作为安全边界。
- 动态换行先规范化，再由 renderer 拆成固定段落；动态行首空格和 tab 不得直接落入 raw
  source，tab 的规范化规则必须在测试期望中写死。
- production renderer 不导出 decoder、character-reference 表或测试 oracle 常量。
- 测试 oracle 只接受此固定文档结构和十进制 character reference；遇到未知 entity、
  raw HTML、代码块、autolink、embed、模板或未编码 block marker 必须失败。

### 6.3 可读性证据

新增纯合成 benign fixture，至少包含：

- 中英文标题和两段正文。
- `AT&T`、比较符号、反引号、括号和普通 HTTPS 文本。
- 作者、发布时间、完整度和两个远程媒体链接。

测试必须使用生产 `renderSafeSocialMarkdown()` 生成结果并与 fixture 完全相等。Reviewer
必须打开 raw fixture 和 `.visible.txt`，记录“标准解析后用户应看到的标题、正文、来源和
媒体”，并明确实际 Obsidian Reading View 仍由 046C 后的 owner dogfood 首日核验。

独立参考 oracle 必须满足：

- 位于 `tests/helpers/`，不得 import production renderer、其 helper、escape 表或常量。
- 从固定 Markdown 结构提取标题、作者、时间、完整度、正文、来源和媒体 label/URL，
  只以测试内独立实现解码十进制 character reference。
- 与手写 `.visible.txt` 完全比较；期望文件不得由 production renderer 在测试中生成。
- canary corpus 明确包含标题、正文、`javascript:`、`onerror=`、模板、wikilink、
  反引号、fence、行首 heading/list/callout、反斜杠、连续换行和 tab。
- oracle 只证明本 Goal 固定子集的标准可见文本，不声称完整模拟 Obsidian 或第三方插件。

hostile fixture 继续覆盖 YAML 注入、路径/URL scheme、raw HTML、模板、Obsidian embed、
Dataview、fence、事件属性和远程图片 payload。测试必须对每组 payload 同时证明：

- raw source 不能形成 active 语法。
- 仅解码 renderer allowlist 中的 entity/escape 后，文本等于规范化后的原文。

### 6.4 安全 HTTPS 链接

实现内部专用 `renderSafeHttpsLink()` 等价边界：

1. 再次通过 `new URL()` 规范化 schema 已接受的 HTTPS URL。
2. 固定 label 由 renderer 生成，不把动态文本用作 Markdown link label。
3. 对空白、圆/方/尖括号、反斜杠及其它 Markdown destination 分隔符做 UTF-8 percent
   encoding；不双重编码已有合法 `%HH`。
4. 只拼接一个固定 Markdown link 结构；不能由 URL 闭合 destination 或追加语法。
5. 测试覆盖空格、成对/不成对括号、百分号、Unicode、query、fragment 和 credentials
   拒绝。

## 7. Manifest 与发布卫生

1. `minimum_chrome_version` 固定为 `"116"`，依据生产代码调用
   `chrome.sidePanel.open()` 以及本仓库已归档审计证据。
2. Manifest 声明 16/32/48/128 PNG 图标，并为 action 声明对应图标。
3. 图标使用本地、原创、无远程字体的简单“书页/书海”几何标记；透明 PNG，正方形。
4. 测试读取 PNG header 验证真实尺寸，不只检查文件名。
5. extension build 后 `dist` 必须包含四个图标，manifest 路径可解析。
6. Manifest `name`、`short_name` 和 `description` 准确表达 ShuHai 品牌、两个动作和
   AI 可选，不再只叫 Bookmark Organizer。
7. PNG 检查除 signature/尺寸外，还验证至少一个非透明像素、不是单色空白，并由独立
   Reviewer 查看 16px 与 128px 代表图。
8. README 与 CONTRIBUTING 删除旧 Goal 041、未实现同步、health/duplicate/current
   surface 等漂移描述；`continuous-orchestration.md` 不再保留 042 in progress 快照。
9. 根 package description 改为两个动作和本地优先，不突出 AI。
10. LICENSE 只补齐当前 `license: MIT` 已表达的标准 MIT 文本，copyright 使用
    `2026 ShuHai Contributors`。

## 8. Workflow 与 dogfood

### 8.1 用户真相验收

`verification-and-acceptance.md` 新增固定小节：

- 我作为用户实际看到/使用了什么。
- 最明显的摩擦或为何没有可行动问题。
- 代表产物/截图/路径。
- 测试没有覆盖的用户风险。

不设置“至少 3 条 finding”配额，不以虚构问题换取形式完整。

### 8.2 风险匹配

文档明确：

- 轻轨可以缩短合同和证据，但不豁免全仓门禁。
- 用户可见 UI/文案仍需视觉或用户真相验收。
- 触碰 Vault、书签 mutation、权限、message/Port/storage、迁移或供应链时自动走硬轨。

### 8.3 fixture 刷新

新增 `fixture-refresh.md`，规定触发条件、用户授权、原始数据不落库、脱敏、provenance、
定向测试和 selector 差异记录。它不创建自动化定时任务。

### 8.4 dogfood 模板

新增无起始日期的 `friction-log-template.md`，字段至少包括：

- 日期、实际使用旅程、保存/整理数量。
- `挡路 / 烦人 / 小瑕疵`。
- 放弃步骤和恢复方式。
- 是否再次打开本次笔记。
- “若有一行摘要和标签，今天是否会更有用”。
- 证据路径和后续候选；没有日志证据的功能不立项。

046D/046C 都完成且 owner 明确开始真实 dogfood 时，才从模板创建真实起始日期文件。

## 9. 测试与证据

实施后依次运行：

```bash
pnpm --filter @shuhai/extension exec vitest run tests/safe-markdown.test.ts tests/manifest.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
pnpm exec prettier --check README.md CONTRIBUTING.md package.json packages/extension/manifest.json docs/goals/goal-046d-dogfood-readiness.md docs/workflows/verification-and-acceptance.md docs/workflows/fixture-refresh.md docs/workflows/continuous-orchestration.md docs/workflows/README.md docs/dogfood/friction-log-template.md docs/PROJECT_STATUS.md docs/product-roadmap-v4.md docs/goals/README.md
git diff --check
```

Build 后额外以只读脚本检查：

- `dist/manifest.json` 与源 manifest 的 icon/minimum version 一致。
- 四个 dist PNG 存在且尺寸正确。
- 没有新增远程资源、依赖或 host permission。
- 测试 oracle 未 import production renderer/helper，visible fixture 不是运行时生成产物。

不启动 Chrome，不写 Vault，不运行 X 扫描。

## 10. 状态推进与 STOP

```text
DRAFT
  -> independent contract review PASS
  -> READY
  -> IN_PROGRESS
  -> targeted + full gates PASS
  -> READY_FOR_REVIEW
  -> independent code/security/user-truth review PASS
  -> DONE
  -> Goal 046C isolated acceptance PASS/DONE
  -> owner 明确启动两周真实 dogfood
```

用户本轮修改请求已记录为 owner 授权；合同独立 `PASS` 后可由 Integrator 同步 current docs
并进入 `READY/IN_PROGRESS`，不把外部报告本身当授权。

以下任一条件立即 `STOP`：

- 可读性只能通过保留 active Markdown/Obsidian/plugin 语法实现。
- 需要新 Markdown sanitizer、图片、字体或其它依赖。
- Vite public asset 行为与只读检查不一致且需要修改未 allowlist build 逻辑。
- 必须更改 Vault、catalog、迁移、adapter、message、权限或书签逻辑。
- 发现真实用户数据、外部网络或日常 Chrome 才能验证。
- 独立 review 或 GLM 返回未解决 P0/P1。

## 11. 完成条件

- benign Markdown fixture 人类可读，且由 production renderer 锁定。
- 独立 oracle 与手写 visible fixture 证明固定 Markdown 子集的标准解码结果；实际
  Obsidian Reading View 保持为 046C 完成后 owner dogfood 首日门禁。
- hostile payload 覆盖全部既有攻击类，raw-source 安全不变量保持。
- Manifest 名称/描述、图标、Chrome 116、README、CONTRIBUTING、package description
  和 MIT LICENSE 一致。
- 用户真相、fixture 刷新和 dogfood 模板落地。
- 定向测试、完整门禁、build 和 Prettier 全部通过。
- 独立 Reviewer 同时检查安全与可读性，结论 `PASS`，没有未解决 P0/P1/P2。
- current docs 准确记录 046D 状态；046C 和迁移退场仍保持真实未完成，dogfood 只交付
  模板、没有提前开始。
- `git status`、commit、push 和 PR 只报告实际完成事实。
