# ShuHai 书海

ShuHai 是一个本地优先的 Chrome 扩展，只帮助用户完成两个动作：

1. 整理 Chrome 书签。
2. 把 X 收藏增量保存到 Obsidian。

它不需要 Electron、Native Messaging、本地 daemon 或 Obsidian 社区插件。当前产品事实以
[`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md) 和
[`docs/goals/README.md`](./docs/goals/README.md) 为准。

## 整理 Chrome 书签

从 Popup 进入书签任务后，ShuHai 读取当前 Chrome 书签树，生成本地规则或可选 AI 分类建议，
再由用户复核并确认移动。实际操作会记录逐项结果、部分失败和可恢复信息。

当前没有可验收的重复书签检测算法，也不再对任意书签 URL 发起网络健康检查。ShuHai 不会把
403、429、timeout 或 5xx 当成死链，也不会自动删除书签。

## 保存 X 收藏

用户在当前打开的 `x.com/i/bookmarks` 页面主动启动扫描。ShuHai 在受界预算内读取当前页面
已经渲染的收藏，按稳定 X ID 与本地 catalog 去重，复核候选后把新内容写入已授权的
Obsidian Vault。

- 已存在项不会重复写入。
- `metadata_only` 或不完整项不会默认选中。
- 每个文件都显示真实的 created/existing/skipped/failed 结果。
- 远程图片和视频只保存为普通 HTTPS 链接，不自动下载或嵌入。
- 取消 X 收藏或删除源内容不会自动删除本地笔记。

X 当前结论是 `LIMITED_GO/batch-only`：页面没有稳定的 feed end marker，因此不能承诺一次
同步全部历史收藏。微博仍为 `NO_GO`，没有生产枚举；其它平台只有在真实 dogfood 证明需求并
通过独立研究门禁后才会加入。

## 界面

- **Toolbar Popup**：根据当前页面只显示一个主动作。
- **Side Panel**：显示当前书签整理或 X 同步任务。
- **Options Page**：配置 Vault、X 页面权限和可选 AI；低频设置默认折叠。

Popup 不加载完整书签树、历史记录或高级设置。

## 安全与隐私

页面 DOM、书签、URL、AI 响应、message、storage 和导入文件全部视为不可信输入。

- 社交扫描只由用户在当前支持页面主动启动，不后台监控浏览行为。
- 不读取、导出或持久化 Cookie、Authorization、站点 token 或私有 GraphQL query ID。
- 不绕过 CAPTCHA、登录挑战、429 或访问控制。
- 不批量抓取 Chrome 书签指向的网页。
- AI 只提供建议，不自动移动、删除、更新 URL 或写文件。
- Markdown 使用固定 frontmatter、可读的转义文本和凭据为空的 HTTPS 链接，防止 YAML、
  raw HTML、模板、Dataview、Obsidian embed 和危险 URL 注入。
- Vault 目录由 File System Access API 显式授权；ShuHai 不建设云端收藏库。

详细边界见 [`docs/architecture/extension-v4.md`](./docs/architecture/extension-v4.md)。

## 本地开发

要求：

- Chrome 116 或更新版本。
- Node.js `>=20.17.0`。
- pnpm `>=9.0.0`。

```bash
pnpm install
pnpm --filter @shuhai/extension run build
```

在 `chrome://extensions` 启用开发者模式，选择“加载已解压的扩展程序”，开发调试时加载：

```text
packages/extension/dist
```

这个目录会被下一次 build 重建，不是长期 dogfood 路径。长期使用只加载 Goal 046E 生成
并通过校验的版本化 `dogfood/releases/.../extension`；具体绝对路径、固定 ID 校验、升级
和回退见 [Dogfood Release 使用说明](./docs/dogfood/release-guide.md)。

开发模式：

```bash
pnpm --filter @shuhai/extension run dev
```

构建内容改变后，需要在 `chrome://extensions` 对已加载扩展执行重新加载。

## 质量门禁

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

平台 fixture 必须是合成或脱敏数据。真实 Chrome、X、Vault 或书签操作需要对应 Goal 明确
授权，不能用日常用户环境替代首次隔离验证。

## 仓库结构

```text
packages/
  extension/   当前产品：Manifest V3 Chrome Extension
  shared/      确实跨包使用的稳定模型
  desktop/     历史 Electron 实现，不是当前产品主线
docs/
  PROJECT_STATUS.md       当前事实入口
  product-roadmap-v4.md   当前路线与非目标
  goals/README.md         唯一 Goal 状态看板
  workflows/              实施、安全、验收与 fixture 流程
  audits/                 产品、安全、UI 与工程审计
  research/               平台和外部生态调研
  specs/                  历史 spec，保留用于复盘
```

旧路线图、Goal 和 spec 不删除。它们记录 ShuHai 从 Electron、书签管理后台和通用网页剪藏
收敛到当前两个动作的过程，但不构成实施授权。

## 当前路线

- Goal 046A/046B：Popup、Side Panel、两条旅程和独立 Options，已完成并独立验收。
- Goal 046D：可读安全 Markdown、发布卫生和 dogfood 前置收口，已完成并独立复审
  `PASS`。
- Goal 046C：最终隔离 E2E 与可用性验收，已完成并通过 Round 9 独立复审。
- Goal 046E：版本化、固定 ID、可校验的本地 dogfood release，当前已通过实现复审并进入
  集成与最终发布证据阶段。
- 两周真实 dogfood：只会在 046D/046C 完成且 owner 明确启动后开始。

参见：

- [产品路线图 v4](./docs/product-roadmap-v4.md)
- [扩展架构 v4](./docs/architecture/extension-v4.md)
- [Goal 状态索引](./docs/goals/README.md)
- [产品路线图 v3（历史）](./docs/product-roadmap-v3.md)

## Contributing

开发前按顺序阅读 [`AGENTS.md`](./AGENTS.md)、[`CONTRIBUTING.md`](./CONTRIBUTING.md)
和当前唯一 `READY`/`IN_PROGRESS` Goal。

## License

[MIT](./LICENSE)
