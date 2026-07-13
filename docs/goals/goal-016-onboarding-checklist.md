# Goal 016: 首次使用引导

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

## 背景

当前 onboarding 只是一个简单的 WelcomeGuide Dialog，展示三张功能卡片后就消失了。用户不知道接下来该做什么，也不知道哪些配置是必须的。

## 目标

用 checklist 式引导让新用户在 2 分钟内完成必要配置并体验核心功能。

## 改动范围

| 文件                                      | 改动                                     |
| ----------------------------------------- | ---------------------------------------- |
| `src/popup/pages/OnboardingChecklist.tsx` | 新增：引导 checklist 组件                |
| `src/popup/App.tsx`                       | 小改：未完成 onboarding 时显示 checklist |
| `src/utils/storage.ts`                    | 小改：新增 onboarding 进度存储           |
| `src/background/service-worker.ts`        | 小改：新增 onboarding 状态消息处理       |

## 具体设计

### Checklist 步骤

| #   | 步骤                     | 完成条件                                                | 动作                               |
| --- | ------------------------ | ------------------------------------------------------- | ---------------------------------- |
| 1   | 选择 Obsidian Vault 目录 | `vaultHandle` 存在于 IndexedDB                          | 点击跳转 Settings 的 vault 选择    |
| 2   | 配置 AI Provider         | `settings.providers.length > 0` 且有 `activeProviderId` | 点击跳转 Settings 的 provider 配置 |
| 3   | 试一次书签分类           | `lastMoveRecords` 存在（曾经 apply 过一次）             | 点击跳转 Organize tab              |
| 4   | 保存一篇内容             | `exportManifests.length > 0`（曾经写入过 vault）        | 提示用户右键保存文章               |

### 交互逻辑

- 未完成所有步骤时，App 顶部显示一个可折叠的 checklist banner（不是 modal，不阻塞使用）
- 每个步骤有：图标 + 描述 + 状态（待完成/已完成）+ 操作按钮
- 已完成的步骤显示绿色勾，不可点击
- 用户可以点"跳过引导"永久关闭（设置 `onboarded: true`）
- 所有步骤完成后自动消失，设置 `onboarded: true`

### 存储

```typescript
interface OnboardingProgress {
  vaultConfigured: boolean;
  providerConfigured: boolean;
  firstClassifyDone: boolean;
  firstExportDone: boolean;
}
```

存储在 `chrome.storage.local` key `'onboardingProgress'`。每次 App 加载时检查实际状态（vault handle 是否存在、providers 是否配置等），动态更新进度，不依赖用户手动标记。

### 替换现有 WelcomeGuide

移除现有的 WelcomeGuide Dialog，用 checklist banner 替代。保留 `ONBOARDED_KEY` 的语义（true = 引导已完成或已跳过）。

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

新增测试：验证 onboarding 进度计算逻辑（给定不同 state，输出正确的 progress）。
