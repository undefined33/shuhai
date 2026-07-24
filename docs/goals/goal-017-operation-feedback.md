# Goal 017: 操作反馈系统

> **历史 Goal，不得直接执行。** 当前反馈语义由 Goal 032-033 优先修正。

## 背景

当前操作反馈依赖 App.tsx 的 `notice` state（inline Alert banner）和页面级 `status`/`error` state。问题：

- 保存推文/文章后，用户在当前网页上没有任何视觉反馈（sidepanel 打开了但用户可能没注意）
- Vault 写入成功后没有明确告知写了什么、写到哪里
- 成功通知 3 秒自动消失，用户可能错过

## 目标

建立统一的操作反馈机制：content script toast + sidepanel/popup 内的结构化通知。

## 改动范围

| 文件                                 | 改动                                        |
| ------------------------------------ | ------------------------------------------- |
| `src/content/toast.ts`               | 新增：注入式 toast 通知（shadow DOM 隔离）  |
| `src/components/ui/toast.tsx`        | 新增：popup/sidepanel 内的 toast 组件       |
| `src/popup/App.tsx`                  | 小改：用 toast 替代部分 notice Alert        |
| `src/background/service-worker.ts`   | 小改：捕获成功后向 tab 发送 toast 消息      |
| `src/popup/pages/CollectionPage.tsx` | 小改：写入成功后显示结构化确认              |
| `manifest.json`                      | 可能需要调整：toast content script 注入方式 |

## 具体设计

### 1. Content Script Toast（网页内通知）

用户右键保存文章/推文/微博后，在当前网页右上角显示一个浮动 toast：

```
✓ 已保存到 ShuHai，等待写入 Vault
```

实现方式：

- 创建 `content/toast.ts`，通过 `chrome.scripting.executeScript` 动态注入
- 使用 Shadow DOM 隔离样式，避免被网页 CSS 影响
- Toast 3 秒后自动消失，带淡出动画
- 不需要在 manifest content_scripts 中声明（动态注入）

触发流程：

1. Service worker 处理完 `social:extract` / `article:extract` 成功后
2. 向该 tab 发送 `{ type: 'toast:show', message: '已保存到 ShuHai，等待写入 Vault' }`
3. 如果 tab 中没有 toast listener（首次），先注入 `content/toast.js`，再发消息

### 2. Popup/Sidepanel Toast 组件

创建 `components/ui/toast.tsx`：

- 固定在视口右上角的浮动通知
- 支持 `success` / `error` / `info` 三种类型
- 自动消失（success 3s，error 需手动关闭）
- 支持队列（多个 toast 堆叠）

用一个 `useToast` hook + `ToastProvider` 管理：

```typescript
const { toast } = useToast();
toast({ kind: 'success', message: '已写入 3 个文件到 ShuHai/Articles' });
```

### 3. Vault 写入确认

CollectionPage 写入成功后，toast 显示：

- 单个文件：`已写入「{title}」到 {directoryPrefix}/`
- 批量写入：`已写入 {count} 个文件到 {directoryPrefix}/`

### 4. 替换现有 notice 机制

App.tsx 的 `notice` state + inline Alert 保留用于持久性警告（如 vault 权限丢失）。短暂的操作成功/失败反馈改用 toast。

迁移规则：

- 成功通知 → toast (success, auto-dismiss)
- 操作错误 → toast (error, manual dismiss)
- 持久警告（需要用户操作才能解决）→ 保留 inline Alert

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

新增测试：

- toast.ts 的 shadow DOM 创建和消息监听逻辑
- useToast hook 的队列管理
