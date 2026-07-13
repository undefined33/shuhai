# Goal 022: Markdown 导出模板

> **历史 Goal，不得直接执行。** 模板是高级设置，当前优先修复 Vault 写入和 Markdown 安全。

## 背景

当前 `markdown-generator.ts` 中的输出格式完全硬编码：frontmatter 字段固定、正文结构固定、标签格式固定。不同用户的 Obsidian 工作流差异很大：

- 有人用 Dataview 查询，需要特定 frontmatter 字段名
- 有人用 Tags 插件，需要 `#tag` 格式而非 YAML list
- 有人想自定义正文模板（比如加固定的 callout block）

当前唯一的定制点是 `exportDirectory`（导出前缀），远远不够。

## 目标

让用户能自定义书签和内容导出的 Markdown 格式，同时保持安全消毒不被绕过。

## 改动范围

| 文件                               | 改动                          |
| ---------------------------------- | ----------------------------- |
| `src/utils/markdown-templates.ts`  | 新增：模板引擎                |
| `src/utils/markdown-generator.ts`  | 重构：从模板生成              |
| `src/popup/pages/Settings.tsx`     | 新增：模板编辑区              |
| `src/shared/bookmark-types.ts`     | AppSettings 加 templates 字段 |
| `tests/markdown-generator.test.ts` | 更新：覆盖模板路径            |

## 具体设计

### 1. 模板变量

| 变量              | 说明                                    | 可用于 |
| ----------------- | --------------------------------------- | ------ |
| `{{title}}`       | 标题（已消毒）                          | 全部   |
| `{{url}}`         | URL（已消毒）                           | 全部   |
| `{{date}}`        | 导出日期 YYYY-MM-DD                     | 全部   |
| `{{created}}`     | 创建/发布日期                           | 全部   |
| `{{source}}`      | 来源标识 (chrome/twitter/weibo/article) | 全部   |
| `{{tags}}`        | 标签 YAML list                          | 全部   |
| `{{tags_inline}}` | 标签 `#tag1 #tag2` 格式                 | 全部   |
| `{{folder}}`      | 书签文件夹路径                          | 书签   |
| `{{confidence}}`  | AI 分类置信度                           | 书签   |
| `{{author}}`      | 作者                                    | 内容   |
| `{{handle}}`      | 社交账号 handle                         | 内容   |
| `{{text}}`        | 正文内容（已消毒）                      | 内容   |
| `{{description}}` | 摘要                                    | 文章   |
| `{{site_name}}`   | 站点名                                  | 文章   |
| `{{word_count}}`  | 字数                                    | 文章   |
| `{{media_list}}`  | 媒体链接列表                            | 内容   |

### 2. 模板结构

```typescript
// src/shared/bookmark-types.ts 新增

interface MarkdownTemplate {
  id: string;
  name: string;
  scope: 'bookmark' | 'twitter' | 'weibo' | 'article';
  frontmatter: string; // 模板字符串，每行一个 key: value
  body: string; // 模板字符串，Markdown 正文
}

// AppSettings 新增
interface AppSettings {
  // ...existing
  templates: MarkdownTemplate[];
  activeTemplateIds: Record<string, string>; // scope → template id
}
```

### 3. 内置默认模板

三个内置模板对应当前硬编码输出，用户可以复制后修改：

**书签索引模板**（scope: bookmark）：

```
--- frontmatter ---
title: {{title}}
url: {{url}}
source: chrome
folder: {{folder}}
tags: {{tags}}
status: unchecked
created: {{created}}
exported: {{date}}
shuhai_format: 3

--- body ---
# {{title}}

- 来源: Chrome 书签 > {{folder}}
- 链接: [打开]({{url}})
- 分类置信度: {{confidence}}

## 笔记

```

**社交内容模板**（scope: twitter/weibo）：

```
--- frontmatter ---
title: {{title}}
url: {{url}}
source: {{source}}
author: {{author}}
created: {{created}}
exported: {{date}}
tags: {{tags}}
shuhai_format: 3

--- body ---
# {{title}}

- 作者: {{author}}
- 原文: [打开]({{url}})

## 内容

> {{text}}

{{media_list}}

## 笔记

```

### 4. 模板引擎

```typescript
// src/utils/markdown-templates.ts

function renderTemplate(template: MarkdownTemplate, variables: Record<string, string>): string;
```

实现要点：

- 简单的 `{{var}}` 替换，不支持条件/循环（避免复杂度和安全风险）
- 未定义的变量替换为空字符串
- **渲染后**仍然过 `sanitizeArticleMarkdown` 和 `neutralizeObsidianSyntax`
- 模板本身存储时也做 Obsidian 语法中和（防止模板注入）

### 5. 模板编辑器 UI

Settings 页面新增"导出模板"卡片：

- 下拉选择 scope（书签/推文/微博/文章）
- 当前模板的 textarea 编辑器（frontmatter 和 body 分开）
- 右侧或下方：可用变量列表（点击插入）
- "预览"按钮：用一条 mock 数据渲染，显示最终 Markdown
- "恢复默认"按钮

### 6. 安全保障

- 模板变量的值在注入前已经过 `sanitizeText` / `sanitizeUrl`
- 渲染后的完整 Markdown 再过一次 `sanitizeArticleMarkdown`
- 模板本身不允许包含 `dataview`、`templater`、`<%`、`{{` 以外的模板语法
- 用户无法通过模板引入 `![](remote-url)` 图片嵌入（sanitizer 会拦截）

### 7. 迁移

- `shuhai_format` 从 `'2'` 升级到 `'3'`
- 未配置模板时使用内置默认（行为与当前完全一致）
- 已有导出文件不受影响

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

新增测试：

- 模板渲染（正常变量、缺失变量、空值）
- 安全消毒在模板渲染后仍生效
- 模板本身的注入防护
- 默认模板输出与当前硬编码输出一致
