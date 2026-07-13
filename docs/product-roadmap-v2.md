# ShuHai 产品方案 v2 — 修订版路线图

> **状态：已废止，仅供历史追溯。** 当前路线是 [`product-roadmap-v4.md`](./product-roadmap-v4.md)，v3 也已保留为历史版本；当前事实以 [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) 为准。不得从本文件继续实施 Electron、SQLite、API/Cookie 社交同步或旧 Goal 编号。

## 产品定位

**个人书签知识管理工具**：从 Chrome / Twitter / Weibo 收集书签，用 AI 分类整理，导出结构化 Markdown 到 Obsidian。

核心价值：**整理和分类**，不是内容归档。

---

## 当前状态（Goal 001-003 已完成）

| 能力                               | 状态      |
| ---------------------------------- | --------- |
| Chrome 书签读取 + 增量同步         | ✅ 完成   |
| 规则分类 + DeepSeek AI 分类        | ✅ 完成   |
| SQLite 持久化                      | ✅ 完成   |
| URL 健康检测 + 死链审查面板        | ✅ 完成   |
| Markdown 导出（元数据）            | ✅ 完成   |
| Electron GUI + Setup 向导          | ✅ 完成   |
| 安全加固（SSRF、CSP、safeStorage） | ✅ 完成   |
| 结构化日志 + Token 用量追踪        | ✅ 完成   |
| Windows 打包分发                   | ✅ 完成   |
| Twitter 书签同步                   | ❌ 未开始 |
| Weibo 收藏同步                     | ❌ 未开始 |
| AI 摘要生成                        | ❌ 未开始 |

---

## 数据源策略

### Chrome 书签

```
Chrome Bookmarks JSON → 读取元数据 → AI 分类/打标签 → 导出 .md
```

- **不抓取网页内容**（书签中有恶意页面，风险不可控）
- 用 AI 根据 URL + 标题生成简短摘要（纯文本推理，不访问页面）
- 死链检测保留（HEAD 请求，不读 body，风险可控）
- 用户想看内容 → 点链接在浏览器打开

### Twitter 书签

```
Twitter API / Cookie → 获取结构化推文数据 → 保存正文+媒体引用 → 导出 .md
```

- Twitter 内容是**结构化 JSON**（推文文本、图片 URL、作者、互动数据）
- 没有任意 HTML 注入风险
- 内容有消失风险（删推、封号），归档有真实价值
- 媒体文件（图片/视频）：保存 URL 引用，可选下载到本地 vault

### Weibo 收藏

```
Weibo API / Cookie → 获取结构化微博数据 → 保存正文+图片 → 导出 .md
```

- 同 Twitter，结构化数据，安全可控
- 微博内容同样有消失风险
- 需要处理：长微博展开、转发链、评论

---

## 修订后的 Goal 路线

### Goal 004: Twitter 书签同步（下一个）

**为什么优先 Twitter：**

- Twitter 书签 API 相对成熟
- 推文内容结构简单（text + media + author）
- 删推/封号导致内容丢失是真实痛点
- 与现有架构契合度高（RawBookmark 模型已支持 author/engagement/media）

### Goal 005: Weibo 收藏同步

**为什么在 Twitter 之后：**

- Weibo API 限制更多，可能需要 Cookie 模拟
- 内容结构更复杂（长微博、转发、话题）
- 可以复用 Goal 004 建立的多源同步框架

### Goal 006: AI 增强 — 智能摘要 + 关联推荐

**在多源数据汇聚后做：**

- 用 DeepSeek 为每个书签生成 1-2 句摘要（基于标题+URL，不访问页面）
- 跨源关联：发现 Chrome 书签和 Twitter 书签讨论同一话题
- 标签聚合：自动建立知识图谱

### Goal 007: 高级导出 + Obsidian 深度集成

- Obsidian 插件（可选）：在 Obsidian 内直接浏览/搜索书签
- MOC (Map of Content) 自动生成
- 按主题/时间线/来源多维度组织

---

## Goal 004 详细方案：Twitter 书签同步

### 技术方案选择

Twitter 书签获取有几种方式：

| 方案                      | 优点                           | 缺点                                                                   |
| ------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| A. Twitter API v2 (OAuth) | 官方、稳定、合规               | 需要开发者账号，免费 tier 限制多，书签 API 需要 OAuth 2.0 User Context |
| B. Cookie + 内部 API      | 无需开发者账号，能获取所有书签 | 非官方、可能违反 ToS、接口可能变化                                     |
| C. 浏览器扩展导出         | 用户主动触发，安全             | 需要额外开发扩展，增加产品复杂度                                       |
| D. 导入 Twitter 数据归档  | 最安全，离线处理               | 用户需要手动申请下载，数据可能不是最新                                 |

**我的建议：A + D 组合**

- 主路径：Twitter API v2（OAuth 2.0 PKCE，桌面应用适用）
- 备选：支持导入 Twitter 数据归档 ZIP（`data/bookmarks.js`）
- 不用 Cookie 方案（不稳定，可能违反 ToS）

### 数据模型

Twitter 书签映射到现有 `RawBookmark`：

```typescript
// Twitter 推文 → RawBookmark 映射
{
  url: 'https://twitter.com/user/status/123456',
  title: '推文前 100 字...',
  source: 'twitter',
  contentType: 'short-post' | 'thread',
  createdAt: tweet.created_at,
  tags: tweet.entities.hashtags,
  author: {
    name: tweet.author.name,
    handle: tweet.author.username,
    url: `https://twitter.com/${username}`,
    avatar: tweet.author.profile_image_url,
  },
  engagement: {
    likes: tweet.public_metrics.like_count,
    shares: tweet.public_metrics.retweet_count,
    comments: tweet.public_metrics.reply_count,
    views: tweet.public_metrics.impression_count,
  },
  media: tweet.attachments.media.map(m => ({
    type: m.type,  // 'image' | 'video'
    url: m.url,
    thumbnail: m.preview_image_url,
    alt: m.alt_text,
  })),
  content: tweet.text,  // 推文全文（结构化文本，非 HTML）
}
```

### 导出格式

```markdown
---
title: '推文摘要...'
url: https://twitter.com/user/status/123456
source: twitter
author: '@username'
created: 2026-05-20
category: 安全研究
tags: [APT, malware-analysis]
engagement: { likes: 234, retweets: 56 }
shuhai_format: 1
---

# @username

> 推文正文内容...
>
> 如果是 thread，展开所有推文

## 媒体

[图片: alt-text](https://pbs.twimg.com/media/xxx.jpg)

## 引用/转发

> 原始推文内容...

## 笔记

（用户自己的笔记）
```

### 安全考虑

- OAuth token 使用 safeStorage 加密存储（同 DeepSeek API Key）
- 推文文本是纯文本，但可能包含 URL → 用现有 `safeMarkdownUrl` 消毒
- 媒体 URL 来自 Twitter CDN（pbs.twimg.com），可信来源
- 不执行推文中的任何链接
- Rate limit 处理：Twitter API 有严格限速，需要优雅处理 429

### 增量同步

- 首次：拉取所有书签（Twitter API 支持分页）
- 后续：记录上次同步的最新 tweet ID，只拉取新增
- 检测已删除的书签（用户取消收藏）

---

## Goal 005 概要：Weibo 收藏同步

### 技术挑战

- Weibo 开放 API 限制严格，收藏接口可能不在公开 API 中
- 可能需要：
  - 方案 A：Weibo 开放平台 API（如果有收藏接口）
  - 方案 B：用户手动导出（如果微博提供数据下载）
  - 方案 C：Cookie + 移动端 API（风险：接口不稳定）

### 数据特点

- 微博正文：纯文本 + @提及 + #话题# + 表情
- 长微博：需要展开获取全文
- 图片：多图微博常见
- 转发链：A 转发 B 转发 C，需要保留层级

### 导出格式

类似 Twitter，但适配微博特点（话题标签、转发链）。

---

## 讨论点

以下几个问题需要你确认：

### 1. Twitter API 接入方式

你有 Twitter 开发者账号吗？免费 tier 的 API v2 对书签的支持有限。
如果没有，我们可以先做"导入 Twitter 数据归档"作为 MVP，后续再接 API。

### 2. Weibo 接入可行性

你平时用什么方式访问微博？是否有开发者账号？
Weibo 的 API 限制比 Twitter 更严格，可能需要探索其他方案。

### 3. AI 摘要的时机

- 方案 A：导入时立即生成摘要（消耗 token，但用户马上能看到）
- 方案 B：后台批量生成（不阻塞导入流程）
- 方案 C：用户手动触发（最省 token）

### 4. 媒体文件处理

Twitter/Weibo 的图片和视频：

- 方案 A：只保存 URL 引用（轻量，但图片可能被删）
- 方案 B：下载到 vault 本地（占空间，但永久保存）
- 方案 C：用户可选（默认只引用，手动触发下载）

### 5. 全文抓取是否完全放弃？

还是说保留为一个"高级功能"，但默认关闭，且加上所有安全防护？
比如用户可以对单个书签手动触发"抓取全文"，而不是批量操作。

---

## 时间线估算

| Goal | 内容              | 复杂度                            |
| ---- | ----------------- | --------------------------------- |
| 004  | Twitter 书签同步  | 中（API 对接 + OAuth + 增量同步） |
| 005  | Weibo 收藏同步    | 中-高（API 不确定性）             |
| 006  | AI 摘要 + 关联    | 中（复用现有 AI 基础设施）        |
| 007  | Obsidian 深度集成 | 低-中                             |

---

## 架构变化

当前架构只有一个 Reader（ChromeFileReader）。多源后需要：

```
┌─────────────────────────────────────────────────┐
│                   ShuHai Core                     │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Chrome   │  │ Twitter  │  │  Weibo   │       │
│  │  Reader   │  │  Reader  │  │  Reader  │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │             │
│       └──────────────┼──────────────┘             │
│                      ▼                            │
│            ┌─────────────────┐                    │
│            │  RawBookmark[]  │  ← 统一数据模型     │
│            └────────┬────────┘                    │
│                     ▼                             │
│  ┌─────────────────────────────────────┐         │
│  │  Pipeline: Normalize → Classify →   │         │
│  │  AI Enrich → Persist → Export       │         │
│  └─────────────────────────────────────┘         │
│                                                   │
└─────────────────────────────────────────────────┘
```

好消息：`RawBookmark` 模型已经设计了 `source`、`author`、`engagement`、`media`、`content` 字段，
说明最初的架构就考虑了多源。Pipeline 后半段（分类、持久化、导出）可以完全复用。
