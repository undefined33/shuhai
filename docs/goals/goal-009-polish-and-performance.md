# Goal 009: 体验打磨 + 虚拟列表性能优化

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

修复实际使用中发现的体验问题，并为 1469+ 书签的长列表添加虚拟滚动，
确保大量书签时 UI 不卡顿。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过（测试数不能减少，当前 68）
2. pnpm --filter @shuhai/extension run build 成功
3. 1469 个书签的书签树页面滚动流畅（无明显卡顿）
4. 分类预览页 489 条建议滚动流畅
5. 体检结果列表滚动流畅
6. 用户反馈的体验问题已修复（见下方列表）

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/chrome-extension
当前状态：

- Goal 004-008 已完成，功能完整
- 用户有 1469 个书签、106 个文件夹
- 长列表滚动可能卡顿（DOM 节点过多）
- 需要实际体验中发现的问题修复

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 1. [Critical] 虚拟列表（Virtual Scrolling）

### 1.1 问题

当前所有列表都是完整渲染所有 DOM 节点：

- 书签树：1469 个书签 + 106 个文件夹 = 1575+ DOM 节点
- 分类预览：最多 489 条移动建议
- 体检结果：最多 1469 条检测结果

在 popup/side panel 的有限空间内，这么多 DOM 节点会导致：

- 首次渲染慢
- 滚动卡顿
- 内存占用高

### 1.2 方案：自实现轻量虚拟滚动

不引入外部虚拟列表库（如 react-virtual、react-window），自己实现：

```typescript
interface VirtualListProps {
  items: unknown[];
  itemHeight: number;        // 固定行高（简化实现）
  containerHeight: number;   // 可视区域高度
  overscan?: number;         // 上下额外渲染的行数（默认 5）
  renderItem: (item: unknown, index: number) => ReactNode;
}

function VirtualList({ items, itemHeight, containerHeight, overscan = 5, renderItem }: VirtualListProps) {
  const [scrollTop, setScrollTop] = useState(0);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);
  const visibleItems = items.slice(startIndex, endIndex);

  const totalHeight = items.length * itemHeight;
  const offsetY = startIndex * itemHeight;

  return (
    <div style={{ height: containerHeight, overflow: 'auto' }} onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, i) => renderItem(item, startIndex + i))}
        </div>
      </div>
    </div>
  );
}
```

### 1.3 应用到各页面

- **书签树**：文件夹列表使用虚拟滚动（折叠状态下只渲染文件夹行）
- **分类预览**：移动建议列表使用虚拟滚动
- **体检结果**：检测结果列表使用虚拟滚动
- **导出预览**：文件列表使用虚拟滚动

### 1.4 书签树特殊处理

书签树是嵌套结构（文件夹可展开），不是简单的平铺列表。

方案：将树"拍平"为可见行列表：

```typescript
interface FlatRow {
  type: 'folder' | 'bookmark';
  depth: number;
  item: FolderItem | BookmarkItem;
  expanded: boolean; // 仅 folder
}

function flattenTree(
  folders: FolderItem[],
  bookmarks: BookmarkItem[],
  expandedIds: Set<string>,
): FlatRow[] {
  // 只包含当前可见的行（折叠的文件夹内容不在列表中）
}
```

这样虚拟滚动只需要处理一维列表，展开/折叠时重新计算 flatRows。

## 2. [Major] 体验问题修复

以下是基于 Codex 反馈和实际使用可能遇到的问题：

### 2.1 文章保存流程优化

- 右键保存后，如果 side panel 未打开，自动打开 side panel 并跳转到导出页
- 保存成功后显示 toast 通知（不需要用户手动切换到导出页查看）
- 如果 vault 未授权，保存时直接提示"请先选择 Vault 目录"而不是静默失败

### 2.2 体检页面优化

- 体检进度显示当前正在检测的 URL（截断显示域名）
- 死链列表支持按"失败原因"分组（404、超时、DNS 失败、拒绝连接）
- "替换链接"输入框支持粘贴后自动验证新 URL 格式
- 批量操作：全选死链 → 批量删除（需二次确认）

### 2.3 分类预览优化

- 低置信度（<0.6）的建议用黄色/橙色高亮，提醒用户重点审查
- 支持按置信度排序 / 按文件夹分组查看
- "全选/全不选"快捷按钮

### 2.4 通用体验

- 所有长操作（AI 分类、体检、导出）支持取消
- 操作完成后的 toast/alert 3 秒后自动消失（成功类），错误类不自动消失
- Side panel 和 popup 之间状态同步（一边操作另一边能看到更新）
- 搜索框输入时 debounce 300ms（避免每次按键都重新过滤）

## 3. [Major] 搜索增强

当前搜索只过滤书签标题。增强为：

- 支持搜索 URL（输入域名能找到对应书签）
- 支持搜索文件夹名
- 搜索结果高亮匹配文字
- 搜索时虚拟列表只渲染匹配项

## 4. [Minor] 动画和过渡

- 列表项进入/退出：简单 opacity 过渡（不要复杂动画）
- 折叠/展开文件夹：height 过渡
- 页面切换：fade 过渡（已有，确认流畅）
- Progress bar：平滑动画（CSS transition）

## 5. [Minor] 键盘导航增强

- 书签树：上下箭头导航、Enter 展开/折叠、Space 选中
- 分类预览：上下箭头导航、Space 勾选/取消
- 全局：Tab 在交互元素间切换

═══════════════════════════════════════════
强制约束：
═══════════════════════════════════════════

【网络与代理】

- 所有 git push/pull/fetch 必须加代理：
  git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 push

【供应链安全】

- 本 Goal 不引入新 npm 依赖
- 虚拟列表自己实现（不用 react-virtual/react-window）
- 原因：功能简单（固定行高），不值得引入外部依赖

【代码规范】

- TypeScript strict 模式
- 单引号，尾逗号，100 字符行宽
- 不要引入 React import
- 组件拆分合理，VirtualList 作为独立可复用组件

【性能目标】

- 1469 个书签的书签树页面：首次渲染 < 100ms
- 滚动时帧率 > 55fps（无明显卡顿）
- 内存占用：虚拟列表只渲染可视区域 + overscan 的 DOM 节点

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 优先级：虚拟列表（1）→ 体验修复（2）→ 搜索增强（3）→ 动画（4）→ 键盘（5）
- 每完成一个功能后运行：pnpm lint && pnpm typecheck && pnpm test
- 每个功能一个 commit
- push 到远程后继续

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- 虚拟滚动与 shadcn ScrollArea 冲突 → 用原生 div overflow:auto 替代 ScrollArea
- 书签树拍平逻辑复杂 → 先只对分类预览和体检结果做虚拟滚动，书签树保持现状（106 个文件夹不算多）
- Side panel 和 popup 状态同步困难 → 用 chrome.storage.onChanged 事件监听
- 网络不可用无法 push → 本地 commit

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. 性能测试结果（如果能测量）
5. 需要人工介入的事项
