# Goal 014: Twitter/Weibo 内容提取加固与测试

> **历史 Goal，不得直接执行。** 新 adapter 与提取安全方向见 Goal 035-036 路线。

## 背景

Goal 008 已搭建了 Twitter/Weibo Content Script 的基础管线：

- `content/twitter.ts` — 提取推文文本、作者、时间、媒体
- `content/weibo.ts` — 提取微博文本、作者、时间、媒体
- manifest 已声明 content_scripts（x.com/twitter.com/weibo.com/m.weibo.cn）
- 右键菜单 "Save this tweet" / "Save this weibo" 触发提取
- 提取结果存入 pendingCaptures → sidepanel 预览

但当前实现存在以下问题：

1. **无测试覆盖** — 提取函数没有单元测试，选择器变了不会被发现
2. **选择器脆弱** — Twitter/Weibo 频繁改版，当前选择器可能已过时
3. **提取质量粗糙** — 微博的 img 选择器会抓到头像、表情包等无关图片
4. **缺少用户反馈** — 提取失败时用户看不到有意义的错误信息
5. **没有"书签导出"入口** — 只有右键菜单，没有从 popup/sidepanel 触发的路径

## 目标

让 Twitter/Weibo 内容保存功能真正可用、可测试、有容错。

## 改动范围

| 文件                                              | 改动类型                              |
| ------------------------------------------------- | ------------------------------------- |
| `src/content/twitter.ts`                          | 加固提取逻辑                          |
| `src/content/weibo.ts`                            | 加固提取逻辑                          |
| `src/content/__tests__/twitter.test.ts`           | 新增                                  |
| `src/content/__tests__/weibo.test.ts`             | 新增                                  |
| `src/background/service-worker.ts`                | 小改：提取失败时返回结构化错误        |
| `src/popup/pages/CapturePage.tsx`（或现有保存页） | 小改：添加"保存当前推文/微博"按钮入口 |

## 具体改动

### Checkpoint 1: 提取函数加固 + 单元测试

#### Twitter (`content/twitter.ts`)

加固点：

- **作者提取**：当前用 `textContent` 取整个 User-Name 区域，可能包含显示名+@handle 混在一起。改为分别提取 displayName 和 @handle。
- **推文定位**：当前 `collectTweetText` 取页面所有 `[data-testid="tweetText"]`，在 timeline 页会抓到多条推文。改为：如果 URL 是 `/status/xxx` 详情页，只取第一条（主推文）；如果不是详情页，提示用户先打开推文详情。
- **媒体过滤**：排除 profile 头像（通常 URL 含 `profile_images`）和 emoji 图片（通常尺寸很小或 URL 含 `emoji`）。
- **视频占位**：Twitter 视频无法直接提取 URL，但可以检测 `[data-testid="videoPlayer"]` 存在并在 media 中标记 `{ type: 'video', url: '(视频无法直接提取)' }`。
- **引用推文**：检测 `[data-testid="quoteTweet"]`，如果存在则提取引用内容追加到 text 末尾，用分隔线标记。

#### Weibo (`content/weibo.ts`)

加固点：

- **媒体过滤**：当前抓所有 `img`，会包含头像、表情、广告图。改为：
  - 只取 `[class*="pic"]` 或 `[class*="media"]` 容器内的图片
  - 排除尺寸 < 100px 的图片（表情包）
  - 排除 URL 含 `face/` 或 `emoticon` 的图片
- **长微博展开**：检测"展开全文"按钮存在时，提示用户先展开（或尝试读取 `[class*="detail_wbtext"]` 的完整内容）。
- **转发微博**：检测转发结构，分别提取原文和转发评论。
- **微博 ID**：当前用 `crypto.randomUUID()`，改为从 URL 提取微博 ID（`/detail/xxx` 或 `/status/xxx`）作为稳定标识。

#### 单元测试

为 `extractTwitterContent` 和 `extractWeiboContent` 编写测试：

- 构造 mock DOM（用 `jsdom` 或直接构造 `Document` fragment）
- 测试正常提取、空页面、缺少关键元素等场景
- 测试媒体过滤逻辑

测试文件：

- `src/content/__tests__/twitter.test.ts`
- `src/content/__tests__/weibo.test.ts`

**提交条件**：`pnpm lint && pnpm typecheck && pnpm test` 全部通过后提交。

### Checkpoint 2: 错误处理与用户反馈

#### Service Worker 改进

当前 `social:extract` 消息如果 content script 返回空内容或异常，background 没有结构化处理。改为：

```typescript
// content script 返回
sendResponse({ ok: false, error: '未检测到推文内容，请确认已打开推文详情页' });

// background 收到 ok: false 时
// 不存入 pendingCaptures，而是通知 popup 显示错误
```

错误场景及文案：

- 页面不是推文详情页：`请先打开一条推文的详情页（点击推文进入）`
- 页面不是微博详情页：`请先打开一条微博的详情页`
- DOM 中未找到内容：`页面结构可能已更新，提取失败。请反馈此问题。`
- 长微博未展开：`请先点击"展开全文"后再保存`

#### Popup 入口

在现有的保存/捕获页面中，添加两个按钮：

- "保存当前推文"（仅当 activeTab URL 匹配 x.com/twitter.com 时启用）
- "保存当前微博"（仅当 activeTab URL 匹配 weibo.com/m.weibo.cn 时启用）

点击后执行与右键菜单相同的逻辑（发送 `social:extract` 消息到当前 tab）。

**提交条件**：`pnpm lint && pnpm typecheck && pnpm test` 全部通过后提交。

### Checkpoint 3: 提取结果预览优化

当前 sidepanel 的 pendingCaptures 预览对 Twitter/Weibo 内容的展示可能不够友好。确认以下展示正常：

- 作者 + handle 显示
- 推文/微博正文（保留换行）
- 媒体缩略图列表（不用 `![]()` 渲染远程图片，只显示 URL 列表或占位图标）
- 来源标签（twitter/weibo badge）
- 捕获时间

如果现有预览已经能正常展示 CapturedContent，此 checkpoint 可跳过。如果需要调整，改动应限制在预览组件内。

**提交条件**：同上。

## 不改动的部分

- Obsidian 导出逻辑（那是后续 Goal）
- 批量收藏同步（明确不做）
- manifest 权限（已经够用）
- 健康检测相关代码

## 安全约束

- Content Script 提取的内容在存入 state 前不需要消毒（只是结构化数据）
- 消毒在写入 Obsidian 时统一做（后续 Goal）
- 媒体 URL 只存储不渲染（不用 `<img src>` 直接加载远程图片到 popup/sidepanel）
- 提取逻辑不发送任何数据到外部服务器

## 验证

每个 Checkpoint 提交前：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

全部通过才提交。新增的测试应覆盖核心提取逻辑的正常路径和主要边界情况。
