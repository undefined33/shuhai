---
id: goal-041
title: Social Favorites Sync Feasibility Spike
status: DONE
version: 2
updated: 2026-07-13
depends_on: []
branch: codex/social-sync-v4
---

# Goal 041：X/微博收藏同步可行性 Spike

> 用户已于 2026-07-13 明确授权 v4 持续编排。本 Goal 已完成受控 spike、实现者门禁和四轮独立 review，最终 verdict 为 `PASS`。它把 v4 最大的不确定性变成了有边界的结论，而没有提前建设生产同步功能。

## 1. 用户问题

用户希望在 X 或微博收藏页点击一次，扫描自己的收藏，与本地 Obsidian 中已同步记录比较，只写入新增内容，并在中断后继续。

当前代码只能提取单条详情页，尚未证明：

- 收藏页能稳定枚举全部或明确范围内的收藏。
- 能获得稳定 ID、正文、作者、时间和媒体引用。
- 不依赖 Cookie、私有 GraphQL、动态 token 或绕过平台限制。
- 大量收藏下可以停止、暂停、去重和恢复。
- X 官方 API 的 OAuth、成本和内容完整度适合个人工具。

## 2. 目标

分别为 X 与微博给出：

- `GO`：在安全、权限和维护边界内可实现可靠增量同步。
- `LIMITED_GO`：只能支持当前可见批次、摘要或其它明确限制。
- `NO_GO`：需要凭据抓取、私有接口绕过、无法稳定去重或维护成本不合理。

## 3. 非目标

- 不修改生产 manifest、service worker、Popup、Side Panel、Vault writer 或现有 adapter。
- 不安装 npm 运行时依赖。
- 不实现真实用户主收藏库导入。
- 不把实验脚本发布进扩展构建。
- 不读取或保存 Cookie、Authorization、localStorage token、私有 bearer 或完整网络日志。
- 不研究小红书、知乎或其它平台。

## 4. 执行合同

### 4.1 数据与账号边界

- 只使用由测试代码生成的完全脱敏 fixture；ID、作者、URL、正文和媒体地址均为虚构值。
- 不登录 X/微博，不读取用户主收藏库，不访问 Chrome profile、Cookie、token、localStorage、网络日志或平台私有接口。
- X 官方 API 只核对官方文档和做静态调用量估算；本 Goal 不执行 OAuth，也不发送真实 API 请求。

### 4.2 允许读取

- `AGENTS.md`、`CONTRIBUTING.md` 与当前 v4 文档、workflow。
- `packages/extension/package.json`、`tsconfig.json`、`vitest.config.ts`。
- `packages/extension/src/content/twitter.ts`、`weibo.ts` 及其现有测试。
- `packages/extension/manifest.json`，仅核对当前权限，不修改。

### 4.3 允许写入

- `docs/PROJECT_STATUS.md`
- `docs/product-roadmap-v4.md`
- `docs/goals/README.md`
- `docs/goals/goal-041-social-sync-feasibility-spike.md`
- `docs/research/2026-07-13-social-favorites-sync-feasibility.md`
- `docs/reviews/goal-041-social-sync-feasibility-review.md`
- `docs/workflows/README.md`
- `docs/workflows/continuous-orchestration.md`
- `packages/extension/tests/fixtures/social-sync-spike.ts`
- `packages/extension/tests/social-sync-spike.test.ts`
- `packages/extension/e2e/social-sync-spike.spec.ts`

禁止修改生产 `src/`、manifest、依赖、lockfile、Popup、Side Panel、service worker、Vault writer 和现有 adapter。

### 4.4 预算与临时产物

- 每个平台 fixture 50 条唯一收藏；每次运行最多观察 200 个虚拟列表节点、20 批、15 秒。
- 单条正文最多 8 KiB，媒体最多 12 个；整个 fixture 运行时数据不超过 16 MiB。
- 测试网络预算为 0；任何未 mock 的外部请求都使测试失败。
- Playwright 只使用自身创建的临时浏览器上下文和 `page.setContent()`；不指定、不读取、不复用用户 Chrome profile。
- 不创建需手工清理的持久临时目录；Playwright 自己产生的失败证据保留并报告，不运行宽泛清理命令。

### 4.5 允许命令与风险

- R0/R1：只读检查、精确 `apply_patch`、Prettier、lint、typecheck、Vitest、extension build、精确 Git stage/commit。
- R2：一次隔离 Playwright fixture 旅程；不访问真实平台和真实 Vault。
- R3/R4：依赖安装、真实 OAuth、真实收藏扫描、真实 Vault 写入、浏览器 profile 访问及危险命令均不授权。

### 4.6 STOP 条件

除第 8 节外，发现 fixture 不能证明稳定 ID、扫描需要真实凭据、测试试图联网、页面进入登录挑战/CAPTCHA/429、资源预算无法硬限制或需要修改允许范围外文件时，立即停止对应路线并记录 `NO_GO`/`LIMITED_GO`。

## 5. X 研究矩阵

### 官方 API 路线

- OAuth 流程和最小 scope。
- Bookmarks pagination、字段、media/quoted/thread/article 完整度。
- 401/403/429、计费不足和 token 撤销。
- 100、1,000 条收藏的调用量、成本和时间估算。
- token 是否能在不进入 content script、日志和 AI 的情况下使用。

### 收藏页 DOM 路线

- 虚拟列表卸载、自动滚动、停止和取消。
- source item ID 与 canonical URL 稳定性。
- 收藏文件夹、引用、长推、X Article、媒体和删除内容。
- 不读取 Cookie/private GraphQL 时的最大可达完整度。
- 页面改版和选择器变化的 typed error。

## 6. 微博研究矩阵

- 当前官方开放平台是否仍提供本人收藏读取及其权限。
- 收藏页稳定 ID、分页/滚动、长微博、转发链、文章和媒体。
- `weibo.com` 与 `m.weibo.cn` 的差异。
- 登录挑战、频控、页面改版和内容不完整的停止语义。
- 在不保存凭据、不调用私有接口时的最大可达完整度。

## 7. 共用实验契约

实验输出统一为：

```ts
interface SpikeItem {
  source: 'x' | 'weibo';
  sourceItemId: string;
  canonicalUrl: string;
  title?: string;
  text?: string;
  completeness: 'complete' | 'summary_only' | 'metadata_only' | 'unsupported';
  mediaCount: number;
}
```

任何原始平台对象都不能进入长期 fixture。Fixture 只保留验证 parser 所需的最小脱敏字段。

## 8. 安全停止条件

出现以下任一情况立即停止该路线：

- 需要从页面或浏览器存储读取 Cookie、token 或 Authorization。
- 需要复制私有 GraphQL query id、内置 bearer 或远程脚本。
- 触发 CAPTCHA、登录挑战、账号警告或持续 429。
- 需要关闭浏览器安全功能、代理全局流量或安装额外 daemon。
- 页面数据含真实私人收藏正文且无法脱敏保存。
- 无法设定可靠的最大条目、时间和停止条件。
- 测试可能修改、删除或取消收藏。

## 9. 验收证据

每个平台至少提交：

- 能力矩阵和最终 `GO/LIMITED_GO/NO_GO`。
- 访问方式、权限、条款、限流和成本说明。
- 稳定 ID、分页/滚动、内容完整度和错误分类证据。
- 50 条脱敏/测试收藏的去重结果。
- 中途停止、JSON 序列化 checkpoint、从顶部重新枚举并跳过已见 ID 的证明；真正的跨进程持久化由 Goal 042 验收。
- 未登录、选择器变化、429、超预算和恶意文本 fixture。
- `git status --short --branch` 和实际变更文件。

## 10. 后续决策

- 两个平台都 `NO_GO`：停止社交全量同步路线，只保留单条保存或采用现成产品。
- X `GO`、微博 `NO_GO`：只做 X，不为“多平台”强行扩大边界。
- 任一 `LIMITED_GO`：UI 必须把范围和完整度写进产品承诺，不能叫“完整同步”。
- 至少一个 `GO`：再写 Goal 042 的生产数据模型、Vault 和 job spec。
