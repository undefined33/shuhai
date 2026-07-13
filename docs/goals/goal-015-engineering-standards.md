# Goal 015: 工程规范基础设施

> **历史 Goal，不得直接执行。** 当前工程规则以根目录 [`../../AGENTS.md`](../../AGENTS.md) 和 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) 为准。

## 背景

当前项目没有任何自动化质量门禁：

- 无 CI 流水线（PR 没有自动 check）
- 无 pre-commit hooks（本地提交不拦截 lint 错误）
- 无测试覆盖率追踪（不知道测试覆盖了多少代码）
- 无 E2E 测试（单元测试过了不代表扩展真的能用）

这些是大型项目的基本规范，越早建立越好。

## 目标

建立完整的质量门禁体系：提交前拦截 → CI 自动验证 → 覆盖率可见 → 关键路径有 E2E。

## 改动范围

| 文件/目录                             | 用途                                |
| ------------------------------------- | ----------------------------------- |
| `.github/workflows/ci.yml`            | GitHub Actions CI 流水线            |
| `.husky/pre-commit`                   | pre-commit hook                     |
| `package.json` (root)                 | 添加 husky + lint-staged 配置和依赖 |
| `vitest.config.ts` (root)             | 添加 coverage 配置                  |
| `packages/extension/vitest.config.ts` | 添加 coverage 配置                  |
| `packages/extension/e2e/`             | E2E 测试目录                        |
| `playwright.config.ts`                | Playwright 配置                     |

## 具体改动

### Checkpoint 1: CI 流水线

创建 `.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push:
    branches: [main, feat/*]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test -- --coverage
      - run: pnpm build
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/
```

关键点：

- `--frozen-lockfile` 确保 CI 用的依赖和本地一致
- push 到 feat/\* 分支也跑 CI（当前开发分支是 feat/chrome-extension）
- coverage 作为 artifact 上传，后续可接入 Codecov 等服务

**提交条件**：CI 配置文件语法正确，本地 `pnpm lint && pnpm typecheck` 通过。

### Checkpoint 2: Pre-commit Hooks

安装 husky + lint-staged：

```bash
pnpm add -D -w husky lint-staged
```

根 `package.json` 添加：

```json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yml,yaml}": ["prettier --write"]
  }
}
```

创建 `.husky/pre-commit`：

```bash
pnpm lint-staged
```

关键点：

- 只检查暂存的文件（lint-staged），不全量跑 lint
- TypeScript 文件跑 eslint + prettier
- 配置文件只跑 prettier
- `prepare` script 确保 clone 后 `pnpm install` 自动安装 hooks

**提交条件**：`pnpm lint && pnpm typecheck && pnpm test` 通过。手动测试 hook 生效（故意提交一个 lint 错误，确认被拦截）。

### Checkpoint 3: 测试覆盖率

修改 `vitest.config.ts`（根目录）：

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/dist/**', '**/node_modules/**'],
      thresholds: {
        statements: 50,
        branches: 45,
        functions: 50,
        lines: 50,
      },
    },
  },
});
```

安装 coverage provider：

```bash
pnpm add -D -w @vitest/coverage-v8
```

关键点：

- 初始阈值设为 50%（当前覆盖率未知，先设一个合理基线）
- 如果当前覆盖率低于 50%，调整阈值到当前值，然后逐步提升
- `thresholds` 会让 `vitest --coverage` 在低于阈值时 exit 1，CI 会失败
- reporter 输出 lcov（可接入 Codecov）和 text（终端可读）

根 `package.json` 的 test script 改为：

```json
"test": "pnpm -r run test",
"test:coverage": "vitest run --coverage"
```

CI 中用 `pnpm test:coverage`。

**提交条件**：`pnpm test:coverage` 能正常输出覆盖率报告，阈值设置合理（不低于当前实际覆盖率）。

### Checkpoint 4: E2E 测试基础

安装 Playwright：

```bash
pnpm add -D -w @playwright/test
```

创建 `playwright.config.ts`：

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './packages/extension/e2e',
  timeout: 30000,
  use: {
    headless: true,
  },
});
```

创建第一个 E2E 冒烟测试 `packages/extension/e2e/smoke.spec.ts`：

```typescript
import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';

const EXTENSION_PATH = path.resolve(__dirname, '../dist');

test('extension loads and popup opens', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: false, // Chrome extensions require headed mode
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });

  // Get the extension's service worker
  const [background] = context.serviceWorkers();
  expect(background).toBeTruthy();

  await context.close();
});
```

根 `package.json` 添加 script：

```json
"test:e2e": "playwright test"
```

关键点：

- E2E 测试不在 CI 中默认运行（Chrome extension 需要 headed mode，GitHub Actions 默认无头）
- 后续可以用 `xvfb-run` 在 CI 跑，但初期只在本地跑
- 第一个测试只验证"扩展能加载、service worker 启动"
- 后续可以逐步添加更多场景（打开 popup、触发分类等）

**提交条件**：`pnpm lint && pnpm typecheck && pnpm test` 通过。`pnpm --filter @shuhai/extension run build && pnpm test:e2e` 本地能跑通。

### Checkpoint 5: 更新 CLAUDE.md

在项目 `CLAUDE.md` 中添加规范说明：

```markdown
## Quality Gates

- **Pre-commit**: husky + lint-staged 自动跑 eslint + prettier（只检查暂存文件）
- **CI**: GitHub Actions 在 push/PR 时自动跑 lint + typecheck + test + build
- **Coverage**: vitest --coverage，阈值 50%（逐步提升），低于阈值 CI 失败
- **E2E**: `pnpm test:e2e`（本地运行，需要先 build extension）
- **提交规范**: 所有提交必须在 `pnpm lint && pnpm typecheck && pnpm test` 通过后执行
```

**提交条件**：`pnpm lint && pnpm typecheck && pnpm test` 通过。

## 依赖安装清单

所有依赖使用精确版本（遵循 CLAUDE.md 供应链安全规范）：

| 包名                  | 用途           |
| --------------------- | -------------- |
| `husky`               | git hooks 管理 |
| `lint-staged`         | 只检查暂存文件 |
| `@vitest/coverage-v8` | 覆盖率收集     |
| `@playwright/test`    | E2E 测试框架   |

安装前需确认：

- 包名拼写正确（无 typosquatting 风险）
- 均为知名、活跃维护的包
- 使用当前最新稳定版的精确版本号

## 不改动的部分

- 业务代码（content scripts、popup、service worker）
- 现有测试文件
- 发布流程（本 Goal 不涉及）

## 验证

最终状态：

1. `pnpm lint` — pass
2. `pnpm typecheck` — pass
3. `pnpm test` — pass
4. `pnpm test:coverage` — 输出覆盖率，不低于阈值
5. `pnpm build` — pass
6. 故意引入 lint 错误 → `git commit` 被 hook 拦截
7. push 到 GitHub → CI 自动运行并通过
