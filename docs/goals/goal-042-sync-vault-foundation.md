---
id: goal-042
title: Persistent Sync and Vault Safety Foundation
status: DONE
version: 2
updated: 2026-07-13
depends_on: [goal-041]
branch: codex/social-sync-v4
---

# Goal 042：持久化同步与 Vault 安全基础

> Goal 041 已独立 `PASS`，用户已授权持续完成前三个模块。本合同实现已通过完整质量门禁与独立 Product/Security review，状态为 `DONE/PASS`；它交付 X/微博共用的确定性同步底座，不接入平台页面和 UI。

## 1. 用户问题

用户关闭 Side Panel、MV3 service worker 被终止或 Vault 写入部分失败后，任务不能消失、从头重复导出、覆盖已有笔记或把 partial 写成成功。扩展存储被清除时，还需要从 ShuHai 管理目录的固定 properties 重建去重目录。

## 2. 用户结果

- 同步任务、checkpoint、待写 item、逐文件结果和 catalog 跨 service worker 生命周期持久化。
- 同一 `source + sourceItemId` 默认只对应一条本地记录；重试不生成重复文件。
- Vault 已存在、改名、权限失效和写入中断都有明确结果，默认不覆盖、不删除。
- Markdown properties 可重建，正文中的命令、HTML、模板、远程媒体和恶意 URL 保持惰性数据。
- 没有平台 adapter、UI 或真实 Vault 时，也能通过注入式 writer 与 IndexedDB 测试证明崩溃恢复协议。

## 3. 非目标

- 不扫描 X/微博，不改 content script、manifest、Popup、Side Panel 或 service-worker route。
- 不实现 OAuth、AI、书签整理、远程媒体下载、全文 HTML 转 Markdown或真实 Vault 迁移。
- 不复用旧 pending-capture 队列代替 SyncJob/SyncCatalog。
- 不覆盖、重命名或删除用户已有笔记；不因源平台删除而删除本地文件。

## 4. 数据契约

### 4.1 SocialItem

必须由运行时 schema 验证，至少包含：

```ts
type SocialSource = 'x' | 'weibo';
type CaptureCompleteness = 'complete' | 'summary_only' | 'metadata_only' | 'unsupported';

interface SocialItem {
  schemaVersion: 1;
  source: SocialSource;
  sourceItemId: string;
  canonicalUrl: string;
  title?: string;
  text?: string;
  author?: { displayName?: string; handle?: string };
  publishedAt?: string;
  capturedAt: string;
  completeness: CaptureCompleteness;
  media: Array<{ type: 'image' | 'video' | 'link'; url: string; alt?: string }>;
  contentHash: string;
  extractorVersion: number;
}
```

URL 只允许无凭据的 `https:`；文本、数组、对象深度和字节数有硬上限。类型断言不能替代 parse。

### 4.2 SyncJob

状态机：

```text
prepared -> scanning -> paused | ready_for_review | failed | cancelled
ready_for_review -> writing -> partial | complete | paused | failed
partial -> writing | cancelled
paused -> scanning | writing | cancelled
```

禁止跳过 `ready_for_review` 自动写 Vault，禁止 `complete` 仍有 pending/error。Checkpoint 保存平台 adapter version、扫描计数、连续已知 ID 计数和平台明确提供的 cursor；DOM 像素位置不是 checkpoint。

### 4.3 SyncCatalog 与写入 intent

主键为 `${source}:${sourceItemId}`，canonical URL 次之，content hash 只作为低置信 fallback。记录固定 relative path、capture completeness、content hash、extractor version、imported/last-seen 时间。

IndexedDB 与文件系统不能原子提交，必须使用协议：

```text
persist write intent
-> writer create/skip/error and close
-> one IndexedDB transaction commits record + outcome and removes intent
```

若在文件 close 后、catalog commit 前崩溃，重启从目标文件白名单 properties 核实身份后提交 catalog；不得再次创建同内容文件。

## 5. IndexedDB

- 新建独立数据库 `shuhai-sync`，不迁移或修改旧 `shuhai-vault` handle 数据库。
- 版本 1 stores：`jobs`、`items`、`records`、`intents`、`meta`；索引只使用受限字符串字段。
- 所有写操作使用明确事务；升级 blocked、VersionError、事务 abort、损坏 row 和未知 schema fail closed。
- 同一 source 同时最多一个 active job；重复 command 或双 Side Panel 不得创建第二任务。
- 仅保存结构化必要字段，不保存完整原始平台对象、DOM、Cookie、token、Authorization 或网络日志。

## 6. Vault 与 Markdown

- 只在用户授权 handle 下访问配置的安全相对目录；路径 segment 单独验证，拒绝 traversal、空 segment、设备名、尾点/空格、规范化和大小写碰撞。
- writer 结果枚举：`created`、`already_exists`、`changed`、`renamed`、`skipped`、`error`。本 Goal 只允许 `created/already_exists/skipped/error`，其它状态保留给未来显式策略。
- 默认冲突策略是 `skip`。ShuHai 自身并发写入使用 Vault 身份注册表和单 Vault 全局 writer mutex 串行；每级目录与最终文件在创建前后做最多 20,000 项的同级碰撞扫描，碰撞键统一为 `NFKC -> uppercase -> NFC`。
- 新文件名使用已持久化 write intent 的安全随机 token，例如 `<sourceItemId>-<intentId>.md`；崩溃恢复和错误重试必须复用该 relative path，不能重新随机或改写其它路径。
- File System Access API 没有 OS `O_EXCL` 等价的原子“仅不存在时创建”。本 Goal 可以拒绝检查时已存在的目标、外部竞态产生的非空文件和 ShuHai 内部并发，但无法绝对区分外部进程在检查后创建的零字节文件，也无法阻止不协作进程在最后一次检查后修改文件。随机托管文件名、同级扫描、exclusive writer 和 intent reconciliation 用于缩小风险，不宣称消除该浏览器 API 边界；若产品要求对任意外部进程提供绝对原子保证，必须停止并重新做架构决策。
- properties 使用固定白名单与安全 scalar serializer，不接受页面提供的 key、YAML 片段或模板。
- 正文以惰性文本形式输出；中和 raw HTML、`javascript:`/`data:`、Markdown/Obsidian embed、wiki link、Templater、Dataview、callout 和插件命令语法。
- 远程媒体只写普通文本 URL，不生成 `![]()`、`![[...]]` 或 HTML `<img>`。
- 索引重建只扫描配置的 ShuHai 子目录，最大深度 4、最多 10,000 个 `.md`、每个 frontmatter 最多 8 KiB；不扫描整个 Vault。

## 7. 文件合同

### 7.1 允许读取

- `AGENTS.md`、`CONTRIBUTING.md`、当前 v4 架构/路线/workflow、Goal 041 结论。
- `package.json`、`pnpm-lock.yaml`、`packages/extension/package.json`、TypeScript/Vitest 配置。
- `packages/extension/src/utils/storage.ts`、`vault-writer.ts`、`markdown-generator.ts`、`sanitize.ts`。
- `packages/extension/tests/storage.test.ts`、`vault-writer.test.ts`、`markdown-generator.test.ts`、`setup.ts`。

### 7.2 允许写入

- `package.json`
- `pnpm-lock.yaml`
- `packages/extension/package.json`
- `packages/extension/src/social/sync-schema.ts`
- `packages/extension/src/social/sync-store.ts`
- `packages/extension/src/social/sync-engine.ts`
- `packages/extension/src/vault/safe-markdown.ts`
- `packages/extension/src/vault/vault-index.ts`
- `packages/extension/src/utils/vault-writer.ts`
- `packages/extension/tests/sync-schema.test.ts`
- `packages/extension/tests/sync-store.test.ts`
- `packages/extension/tests/sync-engine.test.ts`
- `packages/extension/tests/safe-markdown.test.ts`
- `packages/extension/tests/vault-index.test.ts`
- `packages/extension/tests/vault-writer.test.ts`
- `docs/PROJECT_STATUS.md`
- `docs/goals/README.md`
- `docs/goals/goal-042-sync-vault-foundation.md`
- `docs/reviews/goal-042-sync-vault-foundation-review.md`

禁止修改 `packages/desktop`、`packages/shared`、manifest、content、UI、service worker、旧 Goal 032 候选文件及 allowlist 外文件。

## 8. 依赖门禁

允许精确新增：

| 包               | 类型     | 版本    | 许可       | 用途                          |
| ---------------- | -------- | ------- | ---------- | ----------------------------- |
| `zod`            | runtime  | `4.4.3` | MIT        | 不可信 message/storage schema |
| `idb`            | runtime  | `8.0.3` | ISC        | 版本化 IndexedDB 事务封装     |
| `fake-indexeddb` | dev/test | `6.2.5` | Apache-2.0 | Node 中测试真实 IDB 语义      |

核对日期为 2026-07-13。`zod`、`idb` 没有 install/postinstall；`fake-indexeddb` 没有 install/postinstall，包内开发/打包脚本不会执行。`fake-indexeddb` 要求 Node >=18，仓库要求 >=20.17。安装只允许 pnpm 访问 registry.npmjs.org 获取这三个精确 tarball 与 metadata；不得执行第三方 README 命令、Git dependency、全局安装或未锁定 `npx/pnpm dlx`。

安装后必须检查：

- `package.json` 为精确版本，无 `^`/`~`。
- lockfile 只出现预期 direct/transitive 变化。
- 候选 `pnpm audit --prod` 必须为 0；完整 audit 按下述“基线与增量门禁”处理。
- 若新增依赖闭包出现 high/critical、install/postinstall、额外二进制下载或版本漂移，立即 STOP。

根 `pnpm typecheck` 当前依赖隐式 hoist 的 `tsc`。允许只修改脚本为从 `@shuhai/shared` 已锁定的 `typescript@5.8.3` 执行，不新增根 TypeScript 依赖，不修改全局 PATH。

### 8.1 Audit 基线与增量门禁

本 Goal 在 v1 的绝对门禁下因既有 dev toolchain 的 high/critical advisory 正确触发过 STOP。本节是独立 Product/Security review 后的前瞻性澄清，不追溯改写该事实，也不表示接受、修复或忽略既有漏洞。

只有同时满足以下条件才可继续：

1. 候选 lockfile 的 `pnpm audit --prod` 为 0。
2. 使用相同 Node、pnpm、官方 registry、命令和审查窗口，分别审计未增加本 Goal 三项依赖的基线 checkout 与候选 checkout。
3. 比较 advisory ID、severity、package、affected range 和 dependency path；候选相对基线不得新增、恶化或进入 production path，不能只比较数量。
4. `zod@4.4.3`、`idb@8.0.3`、`fake-indexeddb@6.2.5` 及其新增依赖闭包不得包含 advisory、install/postinstall、原生二进制、额外下载、integrity/license/version 漂移或未说明的 lockfile 变化。
5. Goal 042 只允许运行非监听式命令，包括 `vitest run` 和 `vite build`；禁止 Vite dev/preview、Vitest UI/API/browser server、`--host` 及任何对本机或局域网开放端口的模式。
6. 每个既有 high/critical 必须在 review 记录 advisory、依赖路径、利用前提、当前缓解、owner 和修复门禁；不得写成“安全”或“已解决”。
7. 保存 baseline/candidate 两组机器可读 audit 摘要与 lockfile SHA-256；最终依赖 diff 必须只包含三项 direct dependency 和预期的 OpenAI optional `zod` edge。
8. 构建产物不得包含 `fake-indexeddb`。
9. 任一条件无法证明，或后续最终 lockfile/audit 出现 delta，立即 STOP。

既有 dev toolchain 债务必须在 Goal 043 转 `READY_FOR_REVIEW` 或首次启动任何监听服务前完成修复或重新独立审批。

## 9. 测试与预算

### Schema

- 未知 key、原型污染、错误 source、凭据 URL、危险 scheme、超长正文/数组、畸形时间/hash、未知 schema version。
- storage/message 旧对象不能仅靠 TypeScript cast 通过。

### Store 与 job

- 首次建库、升级 blocked/VersionError、事务 abort、非法状态迁移、重复 active job。
- scanning、ready_for_review、writing 中断；checkpoint 重放不重复 item。
- 100/1,000/10,000 records 的去重与查询；10,000 条测试预算 10 秒、峰值 fixture 数据 32 MiB。

### Writer 与 reconciliation

- created、already exists、权限 prompt/denied、中途撤权、create/write/close 失败、同名不同身份和 partial。
- 大小写或 compatibility 变体通过同一 root/alias handle 并发时只能创建一条路径，包括祖先目录不同而叶文件名不同的情况；`isSameEntry` 失败必须返回显式 outcome，不能裸 reject。
- 非空外部创建竞态必须拒绝；零字节外部创建竞态作为 File System Access API 的已知不可判定边界由测试固定并在 review 中披露。
- close 后/catalog 前崩溃，重启从 properties 恢复；不覆盖用户编辑。
- catalog orphan、文件 orphan、用户改名、重复 properties 和文件缺失。

### 攻击 fixture

- YAML 注入、路径穿越、保留设备名、JS/data URL、raw HTML、事件属性、iframe/form。
- Markdown image、Obsidian embed/wiki、Templater、Dataview、callout、超长 fence、远程媒体。

完整门禁：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

不运行根/package `clean`。不访问真实 Vault、平台、浏览器 profile、端口或进程。

## 10. 验收

- 所有新数据经过运行时 schema，未知/损坏数据 fail closed。
- 任务在持久化 store 中可恢复，状态与逐项结果不伪装成功。
- 50 条写入模拟在每个崩溃窗口重试后仍是 50 个 catalog/文件身份，无重复。
- 生成的 Markdown 不包含可激活的远程媒体、危险 URL、raw HTML、模板或插件执行语法。
- 默认不覆盖、重命名或删除检查时已存在的真实文件；本 Goal 只在 fake IndexedDB 和 mock Vault 中验收，并明确保留第 6 节的外部零字节竞态限制。
- 独立 Reviewer 检查实际 diff、事务语义、攻击 fixture 和依赖变化后，才允许 Goal 043 转 `READY`。

## 11. STOP 条件

- Goal 041 未得到 X `GO/LIMITED_GO` 或独立 review 不通过。
- 需要修改 UI、manifest、service worker、content、shared/desktop 或旧 Goal 032 diff。
- 需要真实 Vault/账号才能首次证明破坏性语义。
- 依赖版本、许可证、脚本、审计或 lockfile 变化与第 8 节不符。
- 无法区分 `complete/partial/failed`，或无法在崩溃窗口保持幂等。
- 需要执行危险命令、宽清理、杀进程、全局配置或读取 secrets。
