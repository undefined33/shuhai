# Goal 018: 失败与恢复体验

> **历史 Goal，不得直接执行。** 当前数据恢复基线见 Goal 032。

## 背景

当前异常处理模式：try/catch → `Alert variant="destructive"` 显示错误消息。问题：

- 错误消息是技术性的（如 `Failed to fetch`、`signal is aborted without reason`），用户不知道该怎么办
- 没有"下一步"引导（重试按钮、跳转设置、检查网络等）
- Vault 权限丢失后没有明确的恢复路径
- AI 分类失败时没有降级提示（可以用规则分类）

## 目标

让每个可预见的失败状态都有：人话描述 + 原因推测 + 下一步操作按钮。

## 改动范围

| 文件                                 | 改动                                 |
| ------------------------------------ | ------------------------------------ |
| `src/utils/error-messages.ts`        | 新增：错误分类和人话映射             |
| `src/components/ErrorRecovery.tsx`   | 新增：统一的错误恢复组件             |
| `src/popup/App.tsx`                  | 改：用 ErrorRecovery 替代裸 Alert    |
| `src/popup/pages/CollectionPage.tsx` | 改：vault 权限失败的恢复流程         |
| `src/popup/pages/HealthPage.tsx`     | 小改：检查失败项的文案优化           |
| `src/background/service-worker.ts`   | 小改：返回结构化错误（含 errorCode） |

## 具体设计

### 1. 错误分类体系

```typescript
// src/utils/error-messages.ts

type ErrorCode =
  | 'AI_KEY_INVALID'
  | 'AI_KEY_MISSING'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_NETWORK_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_RESPONSE_INVALID'
  | 'VAULT_PERMISSION_DENIED'
  | 'VAULT_NOT_CONFIGURED'
  | 'VAULT_WRITE_FAILED'
  | 'EXTRACT_EMPTY'
  | 'EXTRACT_NOT_DETAIL_PAGE'
  | 'EXTRACT_DOM_CHANGED'
  | 'HEALTH_NETWORK_ERROR'
  | 'HEALTH_ABORTED'
  | 'UNKNOWN';

interface StructuredError {
  code: ErrorCode;
  message: string; // 人话描述
  suggestion: string; // 建议操作
  action?: {
    // 可选的操作按钮
    label: string;
    handler: 'retry' | 'openSettings' | 'selectVault' | 'checkNetwork';
  };
}
```

### 2. 错误映射表

| 原始错误                   | code                      | 人话                       | 建议                               | 按钮     |
| -------------------------- | ------------------------- | -------------------------- | ---------------------------------- | -------- |
| 401/403 from AI            | `AI_KEY_INVALID`          | API Key 无效或已过期       | 请检查 AI 设置中的 Key 是否正确    | 打开设置 |
| No provider configured     | `AI_KEY_MISSING`          | 未配置 AI 服务             | 请先在设置中添加 AI Provider       | 打开设置 |
| 429 from AI                | `AI_QUOTA_EXCEEDED`       | AI 调用额度已用完          | 请检查 Provider 账户余额或稍后重试 | 重试     |
| fetch failed / network     | `AI_NETWORK_ERROR`        | 网络连接失败               | 请检查网络后重试，或切换到规则分类 | 重试     |
| timeout                    | `AI_TIMEOUT`              | AI 响应超时                | 可能是网络不稳定，请重试           | 重试     |
| JSON parse error           | `AI_RESPONSE_INVALID`     | AI 返回了无法解析的内容    | 可能是模型不兼容，请尝试切换模型   | 打开设置 |
| Permission denied on vault | `VAULT_PERMISSION_DENIED` | Vault 目录访问权限已失效   | 请重新选择 Vault 目录              | 选择目录 |
| No vault handle            | `VAULT_NOT_CONFIGURED`    | 未选择 Obsidian Vault 目录 | 请在设置中选择 Vault 目录          | 打开设置 |
| Write error                | `VAULT_WRITE_FAILED`      | 写入文件失败               | 目录可能已被移动或删除，请重新选择 | 选择目录 |
| Empty extraction           | `EXTRACT_EMPTY`           | 未检测到内容               | 页面结构可能已更新，提取失败       | —        |
| Not detail page            | `EXTRACT_NOT_DETAIL_PAGE` | 请先打开详情页             | 点击推文/微博进入详情页后再保存    | —        |
| signal aborted             | `HEALTH_ABORTED`          | 检查被中断                 | 可能是暂停或网络波动，可重试       | 重试     |

### 3. ErrorRecovery 组件

```tsx
interface ErrorRecoveryProps {
  error: StructuredError;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onSelectVault?: () => void;
  onDismiss?: () => void;
}
```

渲染为一个 Alert 卡片：

- 图标（根据 code 类型选择：网络/钥匙/文件夹/警告）
- 标题：`error.message`
- 描述：`error.suggestion`
- 操作按钮：根据 `error.action.handler` 渲染对应按钮
- 关闭按钮

### 4. Service Worker 结构化错误

当前 service worker 返回 `{ ok: false, error: string }`。改为：

```typescript
{ ok: false, error: string, errorCode?: ErrorCode }
```

在 AI 调用、vault 写入等关键路径中，catch 到错误后根据 HTTP status / error message 推断 errorCode。

### 5. AI 分类失败降级提示

当 AI 分类失败时，ErrorRecovery 额外显示：

> 也可以使用规则分类（不需要 AI），在设置中配置自定义规则。

带一个"切换到规则分类"按钮。

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

新增测试：

- `error-messages.ts` 的错误分类函数（给定原始错误，输出正确的 StructuredError）
- ErrorRecovery 组件渲染（可选，如果项目有组件测试模式）
