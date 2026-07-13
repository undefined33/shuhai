---
id: goal-041
title: Social Favorites Sync Feasibility Spike
status: DRAFT
version: 1
updated: 2026-07-13
depends_on: []
branch: TBD
---

# Goal 041：X/微博收藏同步可行性 Spike

> 本 Goal 尚未 `READY`，不得执行。它用于把 v4 最大的不确定性变成可验证结论，而不是提前建设生产同步功能。

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

## 4. 开工前必须补齐

转为 `READY` 前，Product/Architect 必须写清：

1. 隔离测试账号或完全脱敏 fixture 的来源。
2. 精确允许读取和写入的文件。
3. 临时产物目录及窄清理边界。
4. 是否允许真实 X API OAuth；若允许，凭据如何只由用户本地持有。
5. 最大扫描条目、分页、时间、内存和网络预算。
6. 平台条款与停止条件。
7. 真实浏览器验证由谁执行，如何避免影响用户主账号和其它 Chrome profile。

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
- 中途停止并从 checkpoint 继续的证明。
- 未登录、选择器变化、429、超预算和恶意文本 fixture。
- `git status --short --branch` 和实际变更文件。

## 10. 后续决策

- 两个平台都 `NO_GO`：停止社交全量同步路线，只保留单条保存或采用现成产品。
- X `GO`、微博 `NO_GO`：只做 X，不为“多平台”强行扩大边界。
- 任一 `LIMITED_GO`：UI 必须把范围和完整度写进产品承诺，不能叫“完整同步”。
- 至少一个 `GO`：再写 Goal 042 的生产数据模型、Vault 和 job spec。
