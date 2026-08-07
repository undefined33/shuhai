# Contributing to ShuHai

## 1. 开始前

按顺序阅读：

1. [`AGENTS.md`](./AGENTS.md)
2. [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md)
3. [`docs/product-roadmap-v4.md`](./docs/product-roadmap-v4.md)
4. [`docs/goals/README.md`](./docs/goals/README.md)
5. [`docs/workflows/README.md`](./docs/workflows/README.md)
6. 当前唯一标记为 `READY` 或 `IN_PROGRESS` 的 Goal

旧 Electron spec 和 Goal 001-031 只用于追溯，不是当前任务队列。

## 2. Development Setup

要求：Node.js `>=20.17.0`、pnpm `>=9.0.0`。

```bash
node scripts/host-command/shuhai-command.cjs root-install
node scripts/host-command/shuhai-command.cjs extension-build
```

在 `chrome://extensions` 加载 `packages/extension/dist`。这个 mutable 目录只用于开发，
不能作为长期 dogfood release。开发时运行：

```bash
node scripts/host-command/shuhai-command.cjs extension-dev
```

长期加载使用版本化、不可覆盖的 release 目录，并按
[`docs/dogfood/release-guide.md`](./docs/dogfood/release-guide.md) 校验。创建 release
必须遵守当前 `READY/IN_PROGRESS` Goal；不能从 dirty checkout、过期 remote-tracking ref
或未合并分支手工复制 `dist` 冒充发布。

## 3. 工作流

1. 从最新 `main` 创建 `feat/<goal-name>` 或 `fix/<name>` 分支。
2. 只实现 `docs/goals/README.md` 中唯一标记为 `READY` 或 `IN_PROGRESS` 的 Goal。
3. 在修改前记录当前 `git status`，保留用户和其他会话已有改动。
4. 严格遵守 Goal 的文件范围、非目标、迁移和测试要求。
5. 运行全部质量门禁并记录手工验证证据。
6. 提交并 push feature branch，创建 PR 到 `main`。
7. CI、代码审查和必要的真实 Chrome 验证通过后才能 merge。

仓库当前没有有效 `dev` 集成分支；旧文档中的 `feature -> dev -> main` 流程已废止。

## 4. 代码范围

### 当前产品

- `packages/extension/src/background/`：命令、持久化任务、Chrome API 和可选 AI。
- `packages/extension/src/content/`：用户触发的 X 页面 adapter；不做静态后台监控。
- `packages/extension/src/popup/`：根据当前上下文显示单一主动作。
- `packages/extension/src/sidepanel/`：书签整理和 X 同步的当前任务工作台。
- `packages/extension/src/options/`：Vault、X 页面权限、可选 AI 与低频维护。
- `packages/extension/src/social/`：受界扫描、schema、catalog 和任务状态。
- `packages/extension/src/vault/`：安全 Markdown 与 Vault 边界。
- `packages/extension/src/components/`：共享 UI primitives。
- `packages/extension/src/lib/`、`utils/`、`shared/`：领域服务和边界策略。
- `packages/extension/tests/`：扩展测试。
- `packages/shared/`：确实跨包使用的稳定模型；不要为了方便扩大共享层。

### 历史代码

`packages/desktop/` 是旧 Electron 实现。除非当前用户和 `READY` Goal 明确要求，否则不要修复、扩展或把新功能同时实现两遍。

## 5. Engineering Standards

- TypeScript strict mode；不使用无解释的 `any`。
- 在所有外部边界做运行时校验，不能把 TypeScript 类型当作运行时安全。
- 页面、书签、AI、存储和导入数据均视为不可信。
- 破坏性操作必须有确认、逐项结果、部分失败和恢复语义。
- 不对任意书签 URL 发网络请求；允许的 Provider 请求必须使用固定官方 HTTPS origin、超时、
  取消、无站点凭据和严格响应预算。
- 不在日志中记录 API Key、Cookie、Authorization、完整正文或未经必要性论证的完整 URL。
- UI 文案说明用户结果，不暴露内部状态机名或模块名。
- 新注释只解释非显然的约束和安全原因。
- 代码改动保持 Goal 范围，不顺带重构无关文件。

## 6. 新依赖门禁

安装前必须在 Goal 或研究记录中说明：

- 替代的具体自研代码或风险。
- 精确版本和锁文件变化。
- 许可证、体积、维护状态和安全公告。
- 直接/传递依赖、安装脚本、原生模块。
- Chrome MV3/CSP、Node 和浏览器兼容性。
- 是否存在遥测、隐式网络访问或远程配置。
- spike、攻击 fixture 和回滚方案。

禁止使用范围版本代替精确锁定。调研文档中的版本是历史快照，安装时必须重新核对。

OpenCLI 当前只作为架构参考，不得添加为运行时依赖。

## 7. 测试要求

基础门禁：

```bash
node scripts/host-command/shuhai-command.cjs root-lint
node scripts/host-command/shuhai-command.cjs root-typecheck
node scripts/host-command/shuhai-command.cjs root-test
node scripts/host-command/shuhai-command.cjs extension-build
```

本地 install、dev、build、lint、typecheck、test、coverage、E2E、Husky、Prettier 和 dogfood
release 必须使用 `scripts/host-command/host-command-registry.json` 中的 named operation。
不要直接运行 pnpm/tool raw command 或 `_shuhai:*` internal script；heavy lane busy 时等待后重试，
不并发绕过。文档格式化使用例如：

```bash
node scripts/host-command/shuhai-command.cjs prettier-check CONTRIBUTING.md docs/goals/README.md
node scripts/host-command/shuhai-command.cjs prettier-write CONTRIBUTING.md docs/goals/README.md
```

传给 Prettier 的参数必须是存在的精确 repo-relative 文件，runner 会拒绝目录、路径逃逸、错误扩展、
metacharacter 和 reparse path。任意外部 shell 仍依赖执行者遵守这些项目规则。

按风险增加：

- 用户交互：Testing Library/`user-event` 和 Goal 明确授权的隔离 Chrome 步骤。
- UI：popup、窄 Side Panel、Options、深浅主题、键盘和焦点检查。
- 内容提取：脱敏 fixture、选择器变化、预算和攻击 payload。
- 破坏性书签操作：部分失败、重启恢复、冲突和回滚。
- Vault 写入：同名、权限失效、路径、空间/IO 错误和逐文件结果。
- 网络：mock fetch，不在单元测试中请求真实站点；X fixture 不得包含 Cookie、token 或完整
  私人正文。

测试通过不等于产品验收；PR 还要说明用户如何完成任务和失败时发生什么。

## 8. Commit 与 PR

使用 conventional commits：

- `feat:` 新用户能力
- `fix:` 缺陷修复
- `refactor:` 无行为变化的结构调整
- `docs:` 文档
- `test:` 测试
- `chore:` 工具和依赖

PR 必须包含：

- 对应 Goal/version。
- 用户可见变化。
- 数据、安全和权限影响。
- 修改文件清单。
- 执行的命令和结果。
- 手工验证步骤、截图或诊断证据。
- 已知限制和回滚方式。
