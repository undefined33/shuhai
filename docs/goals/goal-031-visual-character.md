# Goal 031: 视觉个性——克制的国风 + Linear 留白

> **历史 Goal，相关实现已合并但方向不再扩展。** v3 将移除远程字体和装饰性末字衬线，先解决可读性、层级、速度与反馈。

## 背景

Goal 030 解决了**结构**（金字塔布局、字号下限、间距、Card 边框减少）。但视觉上仍然像"shadcn 默认模板 + 一个绿色"，缺乏**个性**：

- 只有一个 primary `#146c5b`，没有第二个语义/品牌色——状态、强调、数字全靠这一种绿。
- 字体只有 `Inter`/系统字，中文是默认无衬线。"书海"两个字没有任何呼应。
- `header` 只有纯文本 "ShuHai"，没有 logomark，没有视觉锚点。
- Badge/分隔/Card 仍有冗余边框，没有形成"页面有呼吸感"的整体调性。

本 goal 的目标是给 ShuHai 一个**可被一眼记住**的视觉调性：以 Linear/Notion 的留白克制为骨架（A），叠加少量中式知识工具的呼应（B）——但**不上水墨、不上古籍图案、不上整套衬线正文**，所有"国风"元素都用在数字、品牌字、单条分隔线这种"点"上。

## 目标

1. **配色双轴**：墨绿（primary，理性/操作）+ 朱砂橙（accent，强调/状态/数字）。两种色都做了暗色模式适配，对比度 AA。
2. **字体角色化**：正文/UI 仍是 `Inter` + 系统中文（不变）；**仅 logomark、页面 h1 末字、关键数字**使用 `Noto Serif SC`，体量小、不喧宾夺主。
3. **品牌锚点**：header 左上角加一个 16px 的方形 logomark（CSS 绘制，不引入图片资源），让每个页面都有视觉起点。
4. **Card 边框收尾**：完成 030 未做完的"去边框"——只有"需要明确容器"的场景（确认面板、设置区块、列表 hover row）保留视觉边界，其余一律靠背景色或留白。
5. **分隔线统一**：引入一条 1px 渐隐分隔线（中部实、两端淡），替代 `<Separator />` 的硬线，用在 section 之间。
6. **状态色重定义**：success/warning/danger 不再用 emerald/amber/red 三套独立色，统一在 primary 绿和 accent 橙的色阶里推导（danger 仍保留红，但收敛为单一暗红，不要 50/200/700 三段铺色）。

## 改动范围

| 文件                                  | 改动                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/popup/styles.css`                | 新增 accent 变量、字体导入（仅 Serif SC subset）、divider/logomark 工具类                   |
| `src/components/ui/badge.tsx`         | 状态色统一到设计系统，去掉 emerald/amber/red 三色铺底                                       |
| `src/components/ui/card.tsx`          | 删除 `default` 变体的 `shadow-sm`；默认 `variant='flat'`；`soft` 改为带 `accent` 微染的版本 |
| `src/components/ui/separator.tsx`     | 改为渐隐分隔线（中间实、两端透明）                                                          |
| `src/popup/App.tsx`                   | header 左侧加 logomark；h1 字符级处理（最后一个汉字用 serif）                               |
| `src/popup/pages/HomePage.tsx`        | 数字（书签数/文件夹数）用 serif tabular-nums；去掉残留的 Card 边框                          |
| `src/popup/pages/InlineSavePanel.tsx` | 主区域去边框，靠 `bg-primary/5` + accent 强调"已提取"                                       |
| `src/popup/pages/OrganizePage.tsx`    | 计划摘要数字用 serif tabular-nums                                                           |
| `src/popup/pages/HealthPage.tsx`      | 完成摘要数字用 serif tabular-nums                                                           |

**不动**的文件：`button.tsx`、所有 page 的业务逻辑、所有 `*-types.ts`、service worker。

## 具体设计

### 1. 色板（Light）

替换 `src/popup/styles.css` 的 `@theme` 块：

```css
@theme {
  /* 中性 */
  --color-background: #faf8f5; /* 米白，替代 #f8fafc 的冷灰 */
  --color-foreground: #1c1917; /* 墨黑，stone-900 */
  --color-card: #ffffff;
  --color-card-foreground: #1c1917;
  --color-popover: #ffffff;
  --color-popover-foreground: #1c1917;
  --color-muted: #f5f1ea; /* 米灰 */
  --color-muted-foreground: #57534e; /* stone-600 */
  --color-border: #e7e1d6; /* 比 slate 暖一点 */
  --color-input: #e7e1d6;

  /* 主色：墨绿（理性/操作） */
  --color-primary: #146c5b;
  --color-primary-foreground: #ffffff;
  --color-ring: #146c5b;

  /* 次色（保留作 outline 按钮底） */
  --color-secondary: #efeae0;
  --color-secondary-foreground: #1c1917;

  /* 强调色：朱砂橙（状态/数字/品牌点缀） —— 全新 */
  --color-accent: #c2410c; /* orange-700，克制版朱砂 */
  --color-accent-foreground: #ffffff;
  --color-accent-soft: #fff1e6; /* 浅染底 */

  /* 危险色：单一暗红，不再三段铺色 */
  --color-destructive: #991b1b;
  --color-destructive-foreground: #ffffff;

  /* 半径 / 字体 */
  --radius: 0.5rem;
  --font-sans:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Microsoft YaHei', sans-serif;
  --font-serif: 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', ui-serif, serif;
}
```

### 2. 色板（Dark）

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-background: #14110d; /* 暖黑，不是 slate */
    --color-foreground: #f5f1ea;
    --color-card: #1f1b16;
    --color-card-foreground: #f5f1ea;
    --color-popover: #1f1b16;
    --color-popover-foreground: #f5f1ea;
    --color-muted: #1a1712;
    --color-muted-foreground: #a8a29e; /* stone-400 */
    --color-border: #2d2820;
    --color-input: #2d2820;

    --color-primary: #1a9a7a;
    --color-secondary: #2d2820;
    --color-secondary-foreground: #f5f1ea;

    --color-accent: #ea580c; /* orange-600，暗色稍亮 */
    --color-accent-foreground: #14110d;
    --color-accent-soft: #2a1810; /* 暗色下的浅染 */

    --color-destructive: #dc2626;
    --color-destructive-foreground: #ffffff;
    --color-ring: #1a9a7a;
  }
}
```

### 3. 字体导入与角色

仅引入 Noto Serif SC 的 **subset**（避免拖慢 popup 启动）：

```css
/* styles.css 顶部，@import 'tailwindcss' 之后 */
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700&display=swap&subset=chinese-simplified,latin');
```

> 如果 Chrome 扩展 CSP 不允许远程字体，改为下载到 `packages/extension/public/fonts/` 并在 `manifest.json` 的 `web_accessible_resources` 中暴露。具体方案 Codex 自行选择，但**两种方案必须有暗号回退到 `Songti SC`/`SimSun`**，不能因为字体加载失败让正文塌掉。

**使用规则——非常克制**：

| 场景                             | 用 serif 吗                                            |
| -------------------------------- | ------------------------------------------------------ |
| 正文、按钮、列表项、说明         | 否（用 sans）                                          |
| 页面 h1 整段                     | 否（用 sans）                                          |
| 页面 h1 的**最后一个汉字**       | 是（用 `<span className="font-serif">字</span>` 包裹） |
| Logomark "书" 字                 | 是                                                     |
| 数字（书签数、计划数、检查摘要） | 是 + `tabular-nums`                                    |

例如 `<h1>整理书签</h1>` 在 HomePage 渲染为：

```tsx
<h1 className="text-base font-semibold tracking-tight">
  整理书<span className="font-serif font-bold">签</span>
</h1>
```

这是"中式知识工具"的味道点，但**整体节奏仍是 sans**，不会出现"全衬线正文"那种古板感。

数字示例：

```tsx
<p className="text-xs text-muted-foreground">
  <span className="font-serif tabular-nums text-foreground">{bookmarkCount}</span> 个书签 ·
  <span className="font-serif tabular-nums text-foreground">{folderCount}</span> 个文件夹
</p>
```

### 4. Logomark

不引入图片，纯 CSS 画一个 16px 的方块，里面是 serif 的"书"字：

```tsx
// 在 App.tsx 的 header 里、h1 之前
<div className="inline-flex h-5 w-5 items-center justify-center rounded-[4px] bg-primary text-[11px] font-serif font-bold text-primary-foreground leading-none">
  书
</div>
```

位置：popup 模式下在 PopupLauncher 的 h1 左侧；workspace 模式下在 header h1 左侧。**所有页面都显示**，作为统一的视觉锚点。

### 5. Card 收尾

`src/components/ui/card.tsx` 调整：

```tsx
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'flat' | 'soft' | 'outline';
}

// variant 行为：
// - 'flat'    (新默认): bg-transparent, 无边框、无阴影 —— 仅作为间距容器
// - 'soft'    : bg-accent-soft, 无边框 —— 主任务区/强调区
// - 'default' : bg-card, 无边框、无阴影 —— 一般容器
// - 'outline' : bg-card + border-border —— 仅用于"确认面板""设置分组"等需要明确边界的容器
```

**审查所有 `<Card>` 用法**，把"装饰性 Card"（只是为了视觉分组，不是真容器）换成 `variant='flat'` 或干脆 `<section>`。**只有 Settings 页面的设置组、所有 Dialog 内容、确认面板**应该是 `variant='outline'`。

`shadow-sm` 全部删除。整个扩展不应该再有 box-shadow（focus ring 除外）。

### 6. 分隔线

`src/components/ui/separator.tsx` 改为渐隐：

```tsx
export function Separator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      className={cn(
        'h-px w-full bg-gradient-to-r from-transparent via-border to-transparent',
        className,
      )}
      {...props}
    />
  );
}
```

用法：在 HomePage 的"主任务区 ↔ 次要入口 ↔ 底部链接"之间各插一条。在 Settings 的不同分组之间也插一条。不再用 `border-t` / `border-b` 做分隔。

### 7. Badge 重做

`src/components/ui/badge.tsx`：

```tsx
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        accent: 'bg-accent text-accent-foreground', // 新增：用于"待入库"等需要吸引注意的计数
        soft: 'bg-accent-soft text-accent', // 新增：低强度强调
        outline: 'border border-border text-muted-foreground',
        success: 'bg-primary/10 text-primary', // 不再用 emerald 三段
        warning: 'bg-accent-soft text-accent', // 不再用 amber 三段
        danger: 'bg-destructive/10 text-destructive', // 不再用 red 三段
      },
    },
    defaultVariants: { variant: 'outline' },
  },
);
```

调用方审查：

- "待入库 N" → `variant='accent'`
- "已配置/未配置" → `variant='success'`/`variant='outline'`
- 来源标签（"Twitter/X"等）→ **删掉**（Goal 030 已说过，再扫一遍残留）

### 8. h1 字符级处理表

| 页面                      | 当前 h1          | 改后                                   |
| ------------------------- | ---------------- | -------------------------------------- |
| PopupLauncher（无 state） | `ShuHai`         | logomark + `Shu<span serif>Hai</span>` |
| PopupLauncher（有 state） | `ShuHai`         | 同上                                   |
| HomePage                  | `今天要做什么？` | `今天要做什<span serif>么</span>？`    |
| OrganizePage header       | `整理书签`       | `整理书<span serif>签</span>`          |
| HealthPage header         | `检查失效链接`   | `检查失效链<span serif>接</span>`      |
| CollectionPage header     | `待入库`         | `待入<span serif>库</span>`            |
| ActivityPage header       | `历史记录`       | `历史记<span serif>录</span>`          |
| Settings header           | `设置`           | `设<span serif>置</span>`              |

规则：**所有页面标题的最后一个汉字**用 serif + 加粗。仅 1 字。

### 9. 数字 tabular-nums

全局搜索以下字段在 JSX 中的渲染位置，统一包成 `<span className="font-serif tabular-nums text-foreground">{n}</span>`：

- `bookmarkCount` / `bookmarks.length`
- `folderCount` / `folders.length`
- `pendingCount` / `pendingCaptures.length`
- `plan.moves.length` / `selectedCount`
- `progress.summary.dead` / `redirected` / `alive` / `error`
- `result.moved` / `result.undone`

**仅渲染层用 serif**，类型、props、变量名都不动。

## 不改的

- 业务逻辑、service worker、所有 `*-types.ts`、所有 message handler、所有 hook 逻辑。
- 组件 API：`<Button>` 的 props 不动，`<Badge>`/`<Card>` 只**新增** variant，不删旧的（虽然 `Card.default` 的实现变了，但 prop name 保留）。
- 页面路由、键盘快捷键、键盘焦点逻辑。
- 字号下限规则（Goal 030 已定的 12/13/14/16 标准沿用）。
- Goal 030 已经完成的 popup 轻量化（`state:summary`）。

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
pnpm test:e2e
```

视觉验证清单（人工，浏览器实际打开）：

- [ ] popup 在普通页面打开：header 左上有 16px 墨绿 logomark "书"
- [ ] 所有页面 h1 的最后一个汉字用 serif，**且只有 1 字**（不是整段衬线）
- [ ] HomePage 的 "N 个书签 · M 个文件夹" 中的 N、M 是 serif tabular-nums，色调与正文一致
- [ ] "待入库 N" badge 是朱砂橙底（不是默认绿）
- [ ] InlineSavePanel 的"已提取"状态用 accent 色而非 emerald 三段
- [ ] HealthPage 完成摘要："正常 1200 · 重定向 15 · 死链 3 · 错误 2" 中的数字是 serif tabular-nums
- [ ] 全扩展无 `shadow-sm`（grep 应该为零）
- [ ] 全扩展无 `border-emerald-*` / `border-amber-*` / `border-red-*` 直接使用（grep 应该为零，状态色统一走 design tokens）
- [ ] section 之间是渐隐分隔线，**不是** `border-t`
- [ ] Light 模式背景是米白（暖调），不是冷灰
- [ ] Dark 模式背景是暖黑 `#14110d`，不是 slate；朱砂橙在暗色下可读
- [ ] 字体加载失败时正文回退到系统字（仍可读），不出现方块或塌版
- [ ] 切换 prefers-color-scheme，accent 色在两种模式下都对比度 AA

## 风险与回退

- **字体加载阻塞**：Noto Serif SC 即使 subset 也有 100KB+。如果 popup 首屏 LCP 超过 200ms，砍掉 web 字体，**全部回退到系统衬生宋体**（`Songti SC` / `SimSun`），视觉损失可接受。
- **朱砂橙过抢戏**：如果 accent 色在实际场景中"喧宾夺主"（比如几个 badge 同时亮起），把 accent badge 收敛到**只用在"待入库"这一种**场景，其他改为 `variant='outline'`。
- **logomark 视觉违和**：如果墨绿方块 + 白色"书"字在 16px 下糊成一团，改为只用一个 serif 加粗的"书"字（无背景方块），保留 serif 但去掉块。
