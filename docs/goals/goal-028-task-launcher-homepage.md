# Goal 028: 首页任务启动器 + 保存当前页面内联确认

> **历史且已被 v3 信息架构替代。** 不再建设动态任务启动器首页；Popup 固定保存，Side Panel 固定整理，Options 固定设置。

## 背景

当前 ShuHai 的 UI 是"功能控制台"结构：3 个 Tab（整理书签 / 收藏内容 / 设置），每个 Tab 内部再有模式切换。用户打开扩展后需要先理解模块划分，再找到自己要做的事。

核心问题：**产品把内部实现模型暴露给了用户。**

用户实际只有三个意图：

1. 我的书签太乱了，帮我整理
2. 这篇内容有价值，帮我存进 Obsidian
3. 我的书签有没有死链

但 UI 让用户面对的是：浏览模式、分类方案模式、链接体检模式、导出索引、待保存队列、预览、最近写入……

## 目标

1. 首页从 Tab 导航改为**任务启动器**（3-4 张任务卡片）
2. "保存当前页面"从 6 步队列流程改为**内联确认**（2 步）
3. 保留队列作为批量模式入口，但不再是单条保存的默认路径

## 改动范围

| 文件                                  | 改动                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| `src/popup/App.tsx`                   | 重构：取消 Tab 结构，改为任务启动器首页 + 子页面路由 |
| `src/popup/pages/HomePage.tsx`        | 新增：任务卡片首页                                   |
| `src/popup/pages/InlineSavePanel.tsx` | 新增：内联保存确认面板                               |
| `src/popup/pages/OrganizePage.tsx`    | 小改：作为子页面，去掉模式切换入口                   |
| `src/popup/pages/CollectionPage.tsx`  | 改为"批量待入库"子页面，非默认入口                   |
| `src/popup/pages/HealthPage.tsx`      | 独立为子页面（从 OrganizePage 模式中拆出）           |
| `src/popup/pages/Settings.tsx`        | 不动（Goal 029 处理）                                |

## 具体设计

### 1. 首页结构（HomePage）

取消 `<Tabs>` 组件。首页是一个垂直卡片列表：

```tsx
<section className="flex h-full flex-col gap-3 p-3">
  <header>
    <h1>ShuHai</h1>
    <p>
      {bookmarkCount} 书签 · {folderCount} 文件夹
    </p>
  </header>

  {/* 如果当前页面可提取，优先显示保存卡片 */}
  {currentPageSaveable && <InlineSaveCard />}

  <TaskCard
    title="AI 整理书签"
    description="分析你的 Chrome 书签，建议分类"
    meta={`${bookmarkCount} 个书签`}
    action="开始整理"
    onClick={goToOrganize}
  />

  <TaskCard
    title="检查失效链接"
    description="找出死链和重定向，批量清理"
    action="开始检查"
    onClick={goToHealth}
  />

  {/* 待入库队列入口（仅当队列非空时显示） */}
  {pendingCount > 0 && (
    <TaskCard
      title="待入库内容"
      description={`${pendingCount} 条内容等待写入 Vault`}
      action="查看队列"
      onClick={goToCollection}
    />
  )}

  <footer>
    <Button variant="ghost" onClick={goToSettings}>
      ⚙️ 设置
    </Button>
  </footer>
</section>
```

### 2. "保存当前页面"内联确认

当用户在 Twitter/Weibo/文章页面打开 ShuHai 时，首页顶部显示一张特殊卡片：

```
┌─────────────────────────────────────────┐
│ 📄 保存当前页面到 Obsidian              │
│ x.com/user/status/123456...             │
│                                         │
│ [展开] 或 [提取并确认 ▾]               │
└─────────────────────────────────────────┘
```

点击"提取并确认"后，卡片**内联展开**为确认面板：

```
┌─────────────────────────────────────────┐
│ 📄 保存当前页面到 Obsidian              │
├─────────────────────────────────────────┤
│ 标题: @user - 推文正文前40字...         │
│ 作者: @user                             │
│ 正文预览: (前 200 字)                   │
│                                         │
│ 标签: [twitter, security] [编辑]        │
│ 路径: ShuHai/twitter/user - 推文...md   │
│                                         │
│ [写入 Vault]  [加入队列]  [取消]        │
└─────────────────────────────────────────┘
```

流程：

1. 用户点"提取并确认" → 调用 `onCaptureCurrentSocial` 提取内容
2. 提取成功后展开确认面板，显示标题/作者/预览/标签/路径
3. 用户点"写入 Vault" → 直接调用 `exportCaptureToVault`，跳过队列
4. 用户点"加入队列" → 走原有队列流程（批量场景）
5. 写入成功后显示完整路径 + 复制按钮

### 3. 页面路由

不使用 React Router（扩展 popup 不需要）。用简单的 state 路由：

```typescript
type Page = 'home' | 'organize' | 'health' | 'collection' | 'settings';
const [page, setPage] = useState<Page>('home');
```

每个子页面顶部有返回按钮回到首页。

### 4. 当前页面检测

复用现有的 `activeSocialSource` 逻辑（已在 CollectionPage 中实现），提升到 App 层级：

```typescript
const [currentTabInfo, setCurrentTabInfo] = useState<{
  url: string;
  source: 'twitter' | 'weibo' | 'article' | undefined;
}>();

useEffect(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url ?? '';
    setCurrentTabInfo({ url, source: detectSource(url) });
  });
}, []);
```

如果 `source` 非空，首页显示"保存当前页面"卡片。

### 5. 右键提取后自动聚焦

当前右键提取后内容进入队列，用户需要手动切到 ShuHai。

改为：右键提取成功后，如果 sidepanel 已打开，自动导航到首页并展开确认面板（通过 `chrome.storage` 事件触发）。如果 sidepanel 未打开，保持现有 toast 提示。

### 6. OrganizePage 瘦身

从 OrganizePage 中移除"链接体检"模式。OrganizePage 只保留：

- 浏览书签
- AI 分类（生成建议 → 预览 → 应用）
- 导出书签索引（降级为底部"还可以..."链接）

链接体检独立为 HealthPage（已存在，只需调整入口）。

### 7. PopupLauncher 处理

当前 popup 模式有一个 PopupLauncher 组件（引导用户打开 sidepanel）。保留这个行为，但 PopupLauncher 的内容也改为任务卡片风格，与 sidepanel 首页一致。

## 不改的

- Service Worker、vault-writer、classifier、diagnostics 等底层逻辑全部不动
- Settings 页面结构不动（Goal 029 处理）
- 命名不动（Goal 029 处理）
- 队列功能保留，只是不再作为单条保存的默认路径

## 迁移

- 用户已有的 `pendingCaptures` 数据不受影响
- `PREFERRED_VIEW_KEY` 逻辑保留但适配新路由
- Onboarding 逻辑保留，在首页显示（如果未完成）

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

重点验证：

- 首页显示任务卡片，无 Tab 导航
- 在 Twitter 页面打开 ShuHai 时，"保存当前页面"卡片出现
- 点击"提取并确认"后内联展开确认面板
- 点击"写入 Vault"后直接写入，显示完整路径
- 点击"加入队列"后进入原有队列流程
- "AI 整理书签"和"检查失效链接"分别进入独立子页面
- 待入库队列非空时显示入口卡片
- 返回按钮正常工作
- Popup 模式和 Sidepanel 模式都正常
