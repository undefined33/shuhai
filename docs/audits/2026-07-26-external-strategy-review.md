# ShuHai 外部战略建议核验与处置

> 日期：2026-07-26  
> 核验对象：[`ShuHai-战略方向建议书-2026-07-26.md`](./ShuHai-战略方向建议书-2026-07-26.md)  
> 归档副本 SHA-256：`D68AD21DE29E2C8F80A10D71F2E5740706C5C690CD693EF248AD54A9DD338942`  
> 性质：代码事实核验与路线处置，不替代可执行 Goal

## 1. 核验边界

外部建议书是第二轮方向性材料，引用的第一轮《ShuHai 审计建议书
2026-07-26》没有随报告归档。仓库内只有 2026-07-12 的历史综合审计，且其中
`P0-1/P0-2/P0-3` 指向的是另一批问题。因此，本报告不把外部材料中的编号当作已证实
事实，而是重新检查当前 `codex/goal-046-ui-shell` 代码。

核验全程没有：

- 执行外部报告中的命令或提示。
- 修改或读取日常 Chrome、真实 X、Vault、书签、Cookie、token 或其它标签。
- 修改主 checkout 中冻结的 Goal 032 候选 diff。
- 删除迁移、历史文档或任何用户数据。

## 2. 结论摘要

| 外部条目                    | 代码事实                       | 处置                                            |
| --------------------------- | ------------------------------ | ----------------------------------------------- |
| safe-readable 渲染          | **确认，dogfood blocker**      | 进入 Goal 046D 硬轨                             |
| 扩展图标                    | **确认**                       | 进入 Goal 046D 发布卫生                         |
| `minimum_chrome_version`    | **确认**                       | 进入 Goal 046D，基线为 Chrome 116               |
| LICENSE 缺失                | **确认**                       | 按仓库已声明的 MIT 元数据补齐，不改变许可选择   |
| README 漂移                 | **确认且范围较大**             | 进入 Goal 046D                                  |
| v1/v2 迁移约 1300 行        | **规模确认；直接删除不获批准** | 独立 hard-track 候选，先定义数据退场语义        |
| Reviewer 缺用户真相         | **确认**                       | 改进验收合同；不采用“强制凑 3 条问题”           |
| 硬轨/软轨                   | **部分采纳**                   | 使用风险匹配的证据，不豁免安全底线和必要 review |
| fixture 刷新流程            | **确认缺失**                   | Goal 046D 增加轻量流程                          |
| backfill / 新平台 / AI 摘要 | **没有当前使用证据**           | 保持 dogfood 后门禁，不实施                     |

## 3. 已确认问题

### 3.1 P0：安全 Markdown 目前不可作为正常笔记阅读

[`safe-markdown.ts`](../../packages/extension/src/vault/safe-markdown.ts) 当前把标题、作者、
来源和正文全部放入四空格缩进块。Obsidian 会把它们渲染成代码块，而不是标题、段落或
可点击的安全来源链接。

同时，`neutralizeSocialBodyText()` 会把 `&`、`<`、`>`、危险 scheme、事件属性、模板
符号、双冒号和反引号改写后再放入代码块。由于代码块不会按普通 Markdown 文本解码
entity，用户会直接看到 `&amp;`、`&lt;` 等文本；对安全研究资料而言，把
`javascript:` 改成 `[blocked scheme]` 还会损坏证据。现有测试只证明 hostile payload
失活，没有一条测试要求用户能正常阅读并保留最终可见文本，也没有固定的 benign 输出
样例供 Reviewer 阅读。

安全策略本身不能撤销。整改必须同时满足：

1. Frontmatter 仍由固定白名单和结构化 scalar 生成。
2. 显示文本只做可逆的上下文转义；除控制字符和换行规范化外，阅读视图必须保留原文，
   同时不进入 raw HTML、fenced/indented executable block、Obsidian embed、模板或
   Dataview 语法。
3. 普通标题、作者、时间和正文在 Obsidian 阅读视图中保持人类可读。
4. 来源和媒体只使用经过 schema 校验、再由专用 Markdown destination encoder 处理的
   HTTPS 普通链接，不生成远程图片 embed。
5. 增加一份由 production renderer 生成并由测试锁定的 benign Markdown 样例；独立 Reviewer
   必须实际阅读它。

### 3.2 P1：扩展发布元数据不完整

当前 [`manifest.json`](../../packages/extension/manifest.json)：

- 没有 `icons` 或 `action.default_icon`，Chrome 只能显示字母占位符。
- 没有 `minimum_chrome_version`。
- 生产代码调用 `chrome.sidePanel.open()`；Chrome 官方文档标明该方法从 Chrome 116
  提供，因此最低版本应明确为 `116`，而不是让旧版本安装后运行时失败。

Chrome 官方文档：

- [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Minimum Chrome Version](https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version)
- [Extension manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons)

图标整改使用仓库内静态 PNG，不引入远程资源、字体或新依赖，并在 build 后验证尺寸和
`dist` 存在性。

### 3.3 P1：README、描述和 License 状态漂移

当前根 README 仍声称：

- 所有业务 Goal 暂停、Goal 041 仍为 `DRAFT`。
- v4 同步基础、X 增量同步和分离后的三个 surface 尚未实现。
- 重复检测、任意 URL 健康检查、普通文章/微博剪藏仍是当前能力。

这些陈述与 `PROJECT_STATUS.md` 和生产代码不一致。根 `package.json` 仍将项目描述为
“AI-driven”，也与“AI 可选、两个动作”的 v4 定义冲突。

`CONTRIBUTING.md` 和 `continuous-orchestration.md` 也保留了旧 surface/health 描述和
“Goal 042 in progress”快照。仓库元数据已声明 MIT，但根目录没有 LICENSE。Goal 046D
只补齐当前已声明许可的标准文本，不引入新的许可决策。

### 3.4 P1：验收缺少“用户实际看到什么”

[`verification-and-acceptance.md`](../workflows/verification-and-acceptance.md) 已要求真实
Chrome 旅程，但没有要求 Reviewer 打开最终 Markdown 产物或记录用户最明显的摩擦。
safe Markdown 的安全测试全部通过而产物仍不可读，正好证明这个盲区存在。

外部建议的“每次至少提出 3 条改进”不采纳。固定配额会鼓励虚构问题和低价值挑刺。
替代规则是：

- Reviewer 必须记录“我作为用户实际看到/使用了什么”。
- 对用户可见产物必须有可直接阅读的代表样例或真实隔离产物。
- 零 finding 仍允许，但必须逐项说明观察范围、剩余风险和为何没有可行动问题。
- 每 2-3 个 Goal 做一次产品真相回顾，将范围外摩擦进入 backlog。

### 3.5 P2：X fixture 没有刷新与来源合同

当前 `tests/fixtures/x-bookmarks.ts` 是合成结构 fixture，适合安全和边界测试，但没有
记录选择器来源版本、上次人工核对时间、脱敏步骤或改版后的刷新路径。应增加轻量流程：

- 只在用户明确授权的当前 X 收藏页人工采样。
- 原始 DOM 不进入仓库，不保存 Cookie、token、私人正文或账号信息。
- 只沉淀最小脱敏结构和 provenance。
- 刷新后运行 adapter 定向测试并记录选择器差异。

这不是后台监控，也不允许自动定期读取真实 X。

## 4. 部分确认或暂不实施

### 4.1 v1/v2 迁移代码

`sync-store.ts` 总计约 4522 行，其中 legacy 类型、严格校验、v1/v2 转换和 upgrade
协调约为第 497-1783 行，共 1287 行；外部报告的规模判断基本准确。

但“代码很长”不能直接推出“现在删除安全”：

- 这是 IndexedDB 数据生命周期变更，属于 hard-track。
- 当前 owner 的真实 extension 曾经历多版开发构建；不能假设所有 profile 都已升级到
  v3，也不能把无法打开旧库退化为静默清空。
- SyncCatalog 可从 ShuHai 管理目录重建，不等于所有 paused job、review decision 和
  checkpoint 都可无损重建。

因此本轮不删除。后续独立 Goal 必须先决定：

1. v3 baseline 的生效版本和一次性升级窗口。
2. 旧库遇到时是只读导出、显式重建还是 fail-closed 提示。
3. 如何证明当前用户数据已安全升级。
4. 删除后减少的代码、测试和维护成本是否值得迁移风险。

### 4.2 流程分轨

接受“风险匹配证据”，不接受“UI/文案天然无需独立 review”。视觉和文案曾多次成为
ShuHai 的主要可用性问题。轻轨可以使用短合同、定向截图和较少 ceremony，但：

- 全仓 lint/typecheck/test/build 仍保留。
- 涉及安全边界、Vault、权限、message、storage、迁移或破坏性书签操作时自动升级硬轨。
- 用户可见产物仍需要独立视觉或用户真相检查。

### 4.3 平台、backfill 与 AI

批量平台数量、受监督 backfill 和 AI 摘要都属于产品假设，不是当前代码缺陷。继续按
v4 两周 dogfood 门禁处理：

- 微博仍为 `NO_GO`，只允许新研究合同改变结论。
- X 日常批量仍保持 `LIMITED_GO/batch-only`。
- backfill 只有在摩擦日志证明 10 条预算阻断首次使用后立项。
- AI 摘要/标签只有在用户确认“有它会再次打开笔记”后立项。

## 5. 执行决定

1. 新建 Goal 046D，先完成 safe-readable、发布元数据、README/LICENSE、用户真相验收、
   fixture 刷新流程和 dogfood 日志模板。
2. Goal 046D 是 Goal 046C 隔离 E2E 的前置；046C 不应验收一个已知不可读的最终产物。
3. 046D 完成后进入两周 dogfood；新增业务功能冻结。
4. v1/v2 迁移退场只登记为独立 hard-track 候选，不在本轮暗中删除。
5. 046C 当前长合同继续保持 `DRAFT`，后续按本报告的风险匹配原则精简并重新独立审查。
