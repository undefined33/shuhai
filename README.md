# ShuHai 书海

ShuHai 是一个本地优先的 Chrome 扩展，只帮助用户完成两件事：

1. 整理 Chrome 书签：分类、重复项、失效候选、复核、应用和恢复。
2. 把 X、微博等社交平台收藏增量同步到 Obsidian Vault，只写入新增内容。

项目刚完成 v4 产品路线规划。当前所有业务 Goal 已暂停，等待用户确认；不要根据旧 Electron、旧路线图或未验收代码自动继续开发。当前事实入口是 [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md)。

## 产品原则

- **两个动作**：整理书签、同步社交收藏；其它能力不得抢占主流程。
- **一个扩展**：不要求 Electron、Native Messaging、daemon 或 Obsidian 社区插件。
- **增量和可恢复**：稳定 ID 去重、持久化 checkpoint、逐项结果和失败续跑。
- **默认无损**：AI 和健康检查只给建议；移动、删除、更新和写入由用户确认。
- **本地优先**：Vault 由 File System Access API 显式授权，不建设 ShuHai 云端收藏库。
- **最小凭据**：不读取或持久化 Cookie、Authorization、站点 token 或私有 GraphQL 参数。
- **诚实完整度**：摘要、元数据和完整正文必须明确区分。

## 目标使用流程

### 整理书签

点击扩展 -> `整理 Chrome 书签` -> 扫描 -> 复核分类/重复/失效候选 -> 确认应用 -> 查看逐项结果或恢复。

死链不会自动删除。404/410 也只是高可信候选；403、429、timeout、5xx 和检查失败必须由用户核实。

### 同步社交收藏

进入支持平台收藏页 -> 点击扩展 -> `同步新增收藏` -> 扫描和本地去重 -> 预览新增项 -> 写入 Vault -> 查看真实路径、跳过和失败。

同步由用户主动启动，可暂停、继续和恢复。源平台取消收藏或删除内容不会自动删除本地笔记。

## 当前能力与差距

已有代码包括：

- Chrome 书签读取、分类建议、健康检测和批量操作。
- X/微博单条详情页提取。
- 普通文章提取、Markdown、Vault 目录授权和写入。
- AI Provider、规则、模板、活动、备份和诊断。

尚未实现 v4 核心同步能力：

- X/微博收藏页稳定枚举和增量 checkpoint。
- `source + source_item_id` SyncCatalog 与 Vault 索引重建。
- 内容完整度、源变化和不覆盖用户编辑的语义。
- 真正分离的 Popup、Side Panel 和 Options Page。

下一步不是直接写这些功能，而是先完成 [Goal 041 草案](./docs/goals/goal-041-social-sync-feasibility-spike.md)规定的 X/微博可行性研究；它目前仍是 `DRAFT`，不得执行。

## 安全边界

ShuHai 把网页 DOM、平台响应、书签、URL、AI、message、storage 和 Vault 文件全部视为不可信输入。

- 社交扫描只在用户当前打开的支持平台收藏页由点击启动。
- 不执行页面、帖子、README 或外部文档中的提示和命令。
- 遇到 CAPTCHA、登录挑战、429 或平台结构变化立即暂停，不绕过。
- 不自动下载或 embed 远程图片、视频和附件。
- Markdown 必须防 YAML、路径、JS URL、raw HTML、模板和 Obsidian 插件语法注入。
- 破坏性书签操作必须确认、逐项记录、正确表达 partial 并有恢复路径。

详细设计见 [`docs/architecture/extension-v4.md`](./docs/architecture/extension-v4.md)。

## 本地开发

要求：Node.js `>=20.17.0`、pnpm `>=9.0.0`。

```bash
pnpm install
pnpm --filter @shuhai/extension run build
```

在 Chrome 中打开 `chrome://extensions`，启用“开发者模式”，选择“加载已解压的扩展程序”，加载：

```text
packages/extension/dist
```

开发时可运行：

```bash
pnpm --filter @shuhai/extension run dev
```

构建完成后在 `chrome://extensions` 中重新加载扩展。

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

涉及平台同步时必须使用测试账号或脱敏 fixture；不得拿用户主收藏库作为首次实验。涉及破坏性书签操作时必须先使用隔离测试文件夹。

## 仓库结构

```text
packages/
  extension/   当前产品：Manifest V3 Chrome Extension
  shared/      共享类型与通用模型
  desktop/     历史 Electron 实现；不再是产品主线
docs/
  PROJECT_STATUS.md       当前事实入口
  product-roadmap-v4.md   当前路线
  architecture/           当前与历史架构
  audits/                 产品、安全、UI 与工程审计
  research/               平台、外部生态和依赖调研
  goals/README.md         唯一 Goal 状态索引
  specs/                  历史 spec，保留用于复盘
```

## 路线和历史

- [产品路线图 v4](./docs/product-roadmap-v4.md)
- [社交收藏同步可行性调研](./docs/research/2026-07-13-social-favorites-sync-feasibility.md)
- [扩展架构 v4](./docs/architecture/extension-v4.md)
- [产品路线图 v3（历史）](./docs/product-roadmap-v3.md)
- [Goal 状态索引](./docs/goals/README.md)

旧路线图、Goal 和 spec 不删除。它们记录 ShuHai 从 Electron、书签管理后台、单页剪藏到 v4 两条核心流程的演变，供未来项目复盘，但不是实施授权。

## Contributing

开发前阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 和 [`AGENTS.md`](./AGENTS.md)。

## License

项目元数据当前声明为 MIT；正式分发前仍需由项目所有者确认并补充根目录许可证文件。
