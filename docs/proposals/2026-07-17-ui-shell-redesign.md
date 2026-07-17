# ShuHai 主界面与视觉系统重构提案

> 日期：2026-07-17
>
> 状态：`DRAFT / SEQUENCE SUPERSEDED`
>
> 范围：Toolbar Popup、Side Panel、Options 的信息架构、视觉系统和前端加载边界
>
> 非范围：不修改书签、同步、Vault、AI、健康检测或平台 adapter 的业务语义

## 1. 结论

主页面尚未切换到 v4。当前只有 X 收藏同步的 Popup 入口和 Side Panel 工作台采用了新任务式交互；从任务返回后，用户仍会进入旧版通用 `App.tsx` 工作区。因此用户看到的不是缓存或加载错误，而是两代界面同时存在。

2026-07-17 深度安全审计修正了本提案的实施顺序：主壳切换不能先于书签 mutation 安全契约。当前顺序为：

```text
Goal 043 DONE
  -> 045A 删除/URL 更新/分类移动 journal
  -> 045B/045C P1 信任边界收口
  -> 046A 主壳、视觉系统与按需加载
  -> 046B Options、跨任务一致性与两周 dogfood
```

第一版可见切换仍在 046A 完成，但 046A 必须消费已经验收的书签操作和任务摘要合同，不能把旧的不可恢复 mutation 原样暴露在新界面中。视觉设计方向仍有效，旧的先后顺序不再作为实施依据。

## 2. 当前问题的代码证据

| 事实                      | 当前值                      | 用户影响                                  |
| ------------------------- | --------------------------- | ----------------------------------------- |
| `popup/App.tsx`           | 1,913 行、62,300 bytes      | 所有页面、handler 和 surface 路由耦合     |
| `Settings.tsx`            | 797 行、32,829 bytes        | 低频设置和日常任务一起进入主应用          |
| Popup 页面中的 `<Card>`   | 43 处                       | 容器层级过多，页面像管理后台              |
| Popup 页面中的 `<Badge>`  | 50 处                       | 大量状态争夺注意力                        |
| `text-[11px]` / `text-xs` | 32 / 89 处                  | Windows 和窄侧栏下阅读负担高              |
| 当前 production UI chunk  | 543.19 kB，gzip 164.22 kB   | Popup 为一个简单动作却加载完整应用        |
| `PopupLauncher`           | state 未到达/已到达两套布局 | 首屏结构会变化，用户看到旧新界面跳转      |
| Popup、Side Panel         | 共用同一个大型 `AppContent` | 两种 surface 无法独立控制数据和视觉复杂度 |

现有暖米色、棕黑背景、绿色与橙色同时竞争，加上 serif 尾字、标题图标、Card 和 Badge 的叠加，使界面有明显的模板拼装感。问题不只是配色，而是任务层级、加载边界和组件使用方式都没有统一。

## 3. 用户心智模型

ShuHai 只需要回答两个问题：

1. 我现在要整理 Chrome 书签。
2. 我现在要把当前平台的收藏增量同步到 Obsidian。

其它能力只能作为这两个任务内的步骤或低频设置出现：

- 分类、重复项、失效链接属于“整理书签”。
- 扫描、复核、去重、写入属于“同步收藏”。
- Vault、平台权限、AI、模板、备份和诊断属于“设置”。
- 历史记录是任务结果的一部分，不是主导航。

## 4. 新信息架构

### 4.1 Toolbar Popup

Popup 不再展示工作区卡片、快捷操作卡片、准备状态卡片和 onboarding 清单。它只根据当前上下文显示一个主动作：

```text
┌────────────────────────────┐
│ ShuHai                 设置 │
│                            │
│ X 收藏页                   │
│ 发现可同步的当前收藏页      │
│                            │
│ [ 同步 X 收藏 ]            │
│                            │
│ 上次：今天 · 已写入 5 条    │
└────────────────────────────┘
```

上下文规则：

| 当前上下文       | 唯一主动作       | 次级入口               |
| ---------------- | ---------------- | ---------------------- |
| 有未完成任务     | 继续当前任务     | 取消由 Side Panel 完成 |
| X 收藏页         | 同步 X 收藏      | 设置                   |
| 支持的单条内容页 | 保存当前内容     | 设置                   |
| 普通页面         | 整理 Chrome 书签 | 设置                   |
| 未支持平台收藏页 | 当前平台尚未支持 | 整理书签               |

Popup 只读取当前 tab、未完成任务摘要、书签数量摘要和必要的设置状态，不加载书签树、健康记录、Vault 历史或全部页面组件。

### 4.2 Side Panel

Side Panel 是唯一任务工作台，不再是带多个功能入口的后台首页。

- 从 X 收藏页启动时直接进入 X 同步任务。
- 从普通页面启动整理时直接进入书签任务。
- 没有任务时只显示两个紧凑任务行，不显示统计卡片墙。
- 任务中只有一个返回入口；返回后显示任务来源入口，不回到旧总控制台。
- 长任务的主动作固定在底部 Action Bar，页面滚动不改变按钮位置。

空闲态示意：

```text
┌──────────────────────────────────┐
│ ShuHai                       设置 │
│                                  │
│ 整理 Chrome 书签                 │
│ 1,371 个书签 · 上次整理 3 天前    │
│                         [开始]    │
│ ──────────────────────────────── │
│ 同步社交收藏                     │
│ 请先打开受支持平台的收藏页        │
│                         [查看]    │
└──────────────────────────────────┘
```

任务态统一采用：

1. `TaskHeader`：返回、任务名、简短状态，不重复品牌标题。
2. `TaskProgress`：只在运行或暂停时出现。
3. `TaskBody`：当前步骤内容，不套外层 Card。
4. `ActionBar`：一个主动作和最多两个次级动作。
5. `TaskResult`：逐项真实结果、partial 和恢复入口。

### 4.3 Options Page

Options 必须成为独立构建入口，不再复用 Side Panel 的页面树。

首屏只显示：

- Obsidian Vault。
- 平台权限。
- 可选 AI Provider。

模板、规则、备份、诊断和数据维护放入“高级设置”折叠区。Options 不读取完整书签树，也不显示日常任务进度。

## 5. 视觉方向

### 5.1 设计性格

目标是安静、可信、清晰的个人工具，不做营销页，也不做开发者后台。视觉参考原则是：少容器、强排版、明确状态、稳定动作位置。

推荐默认方向：`Graphite + Jade`。

| 角色        | Light     | Dark      | 用途                   |
| ----------- | --------- | --------- | ---------------------- |
| Background  | `#F7F8FA` | `#111315` | 页面背景               |
| Surface     | `#FFFFFF` | `#191C1F` | 必要的工具区域         |
| Text        | `#171A1F` | `#F2F4F5` | 正文                   |
| Muted text  | `#626A73` | `#A7AFB7` | 辅助说明               |
| Border      | `#DDE2E7` | `#30363B` | 分隔和输入框           |
| Primary     | `#0F766E` | `#2DB39A` | 唯一主动作、成功进度   |
| Warning     | `#B45309` | `#F0A34A` | 需用户判断             |
| Destructive | `#B42318` | `#F97066` | 删除、失败和高风险确认 |

不使用渐变、装饰 orb、远程字体和大面积品牌色。橙色只用于 warning，不再与绿色主动作竞争。

### 5.2 排版

| 层级       | 建议值                    |
| ---------- | ------------------------- |
| 页面标题   | 18px / 24px / 600         |
| 区域标题   | 15px / 20px / 600         |
| 正文       | 14px / 20px / 400         |
| 辅助文字   | 12.5-13px / 18px / 400    |
| 数字与状态 | system sans，tabular nums |

- 不再用 11px 承载状态、路径、时间或说明。
- 不混用 serif 尾字制造品牌感；品牌只由 logomark、名称和一致配色表达。
- 一屏最多三级字号，主要靠字重、间距和颜色建立层级。

### 5.3 布局与组件

- 使用 4/8/12/16/24px 间距尺度。
- 控件高度稳定在 36 或 40px；图标按钮为固定正方形。
- 圆角统一 6px，卡片只用于真正独立、可重复的 item。
- 页面 section 使用分隔线或留白，不使用 Card 套 Card。
- 一屏只有一个绿色主按钮；次级命令使用 outline/ghost。
- Badge 只表示短状态，不承载计数、分类、来源、完整度等所有元数据。
- 列表项通过标题、辅助行和右侧状态组织，不为每行增加独立工具栏。

### 5.4 反馈与动效

- 加载使用固定尺寸 skeleton，不能在 summary 到达后更换整套布局。
- 成功使用 160-220ms check transition 和明确结果文本，不使用 confetti。
- 暂停、partial、permission denied 和 `tab_changed` 使用不同语义颜色和下一步动作。
- 所有动画支持 `prefers-reduced-motion`。
- Toast 只报告短暂完成；需要用户处理的错误留在任务正文中。

## 6. 前端架构拆分

建议目标结构：

```text
src/
  popup/
    PopupApp.tsx
    popup-context.ts
    popup-summary.ts
  sidepanel/
    SidePanelApp.tsx
    task-router.tsx
  options/
    OptionsApp.tsx
  shell/
    Brand.tsx
    TaskHeader.tsx
    TaskProgress.tsx
    ActionBar.tsx
    EmptyState.tsx
  tasks/
    x-sync/
    bookmarks/
  design/
    tokens.css
```

拆分约束：

1. `PopupApp` 不 import 任何完整任务页。
2. `SidePanelApp` 按当前任务 lazy-load X 或书签页面。
3. `OptionsApp` 独立入口和 bundle，只加载设置依赖。
4. `App.tsx` 不再是 1,900 行总控制器；surface root 只负责路由、错误边界和 summary query。
5. 现有 service worker、sync store、Vault writer、书签 handler 和公开 message 合同默认不改。
6. 若 summary query 不足，单独增加 strict runtime read-only query；不得让 Popup 回退到加载完整 `ExtensionState`。
7. 首阶段不新增 UI 依赖，继续使用 React、Tailwind 和 lucide。

## 7. 建议实施顺序

### 046A-0：视觉基线与原型

- 固定 token、字体、间距、Action Bar 和任务状态语义。
- 为 Popup、Side Panel idle、X running/paused/review/result、bookmark idle 生成深浅主题静态原型。
- 用户确认原型后才改生产页面。

### 046A-1：Surface 拆分与新 Popup

- 建立独立 `PopupApp` 和 summary-only loading。
- 删除“打开工作区/快捷操作/准备状态/继续用弹窗”的重复入口。
- 保持现有 X one-shot launch intent 和权限模型不变。

### 046A-2：新 Side Panel 主壳

- 新增统一 TaskHeader、TaskBody 和 ActionBar。
- 先迁移已经验收的 X 同步页。
- 任务返回进入同一来源的 idle/preflight，不再返回旧总控制台。

### 046A-3：书签任务入口壳

- 只迁移书签任务入口和路由，不在本阶段重写分类、健康检测或 mutation。
- Goal 045 随后在这个新壳内收缩书签工作流。

### 046B：Options、清理与 dogfood

- 建立独立 Options bundle。
- 删除旧 Launcher、HomePage 和失去入口的管理后台页面。
- 完成两周 dogfood 后再决定保留哪些低频功能。

## 8. 验收标准

### 产品

- Popup 任一上下文只有一个主动作。
- 打开 Side Panel 后直接进入当前任务或两个任务的紧凑空闲态。
- X 任务完成、取消或返回后不再出现旧总控制台。
- 用户不需要理解“工作区、待入库、导出、方案、活动”等内部模块名。

### 视觉

- 重要文字最小 13px；无 `text-[11px]` 重要信息。
- 页面 section 不使用嵌套 Card；一屏最多一个 primary CTA。
- Popup 420x600、Side Panel 360/480/720px、深浅主题、200% Windows 缩放下无重叠或截断。
- 长标题、长路径、中英文混排和 0/1/1000+ 数量不引发布局跳动。

### 性能与架构

- Popup initial route 不 import 书签树、Settings、Health、Collection 或 X task 页面。
- Popup 初始 gzip JS 目标低于 130 kB；若不能达到，必须记录具体依赖和继续拆分方案。
- 打开 Popup 时不读取完整书签树、健康记录、备份和导出历史。
- Surface root、routing 和 summary query 有直接测试；生产 build 不再产生单一全应用入口的 500 kB warning。

### 可访问性与稳定性

- 完整键盘导航、可见 focus、ESC/返回语义和 screen-reader label。
- 运行中切换页面不会丢失持久任务；UI 局部 state 不冒充 SyncJob truth。
- `prefers-reduced-motion` 下禁用非必要位移动画。
- Playwright/Chrome 人工证据覆盖 Popup、窄 Side Panel、深浅主题和任务返回。

### 安全

- 不新增 host/named permission、远程字体、远程图片、analytics 或第三方 UI runtime。
- UI 重构不自动请求 Vault、X 或书签 mutation 权限。
- 所有破坏性动作继续显式确认并显示逐项结果和恢复入口。
- 不读取其它标签、Cookie、token、完整浏览历史或平台私有 API。

## 9. 非目标

- 不为“更漂亮”重写同步、分类、健康检测或 Vault 算法。
- 不恢复旧多 Tab 管理后台。
- 不新增 dashboard、图表、统计卡片墙或营销 onboarding。
- 不在 046A 加微博、小红书、知乎或其它平台。
- 不把所有旧页面一次性美化后继续保留；先判断是否属于两个核心任务。

## 10. 待确认决策

建议默认采用以下决定：

1. 046A 在 Goal 045A 的书签数据安全契约通过后实施；045B/045C 可按与 UI 的实际耦合在独立合同中确认最终门禁。
2. 采用 `Graphite + Jade`，去掉暖米色/棕黑主调和 serif 尾字。
3. Popup 保留上下文单条保存，但普通页面默认主动作仍是整理书签。
4. 先确认静态原型，再切生产主壳；不在没有视觉验收的情况下直接大改 `App.tsx`。

用户确认后，应把本提案转换为精确文件 allowlist、迁移/回滚、测试矩阵和 STOP 条件完整的 Goal 046A；在此之前状态保持 `DRAFT`，不得实施代码。
