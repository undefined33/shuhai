# Goal 025: 021-024 Review 修复

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

## 背景

Goal 021-024 实现后 code review 发现的问题，需要修复以保持代码质量和功能正确性。

## 问题清单

### 1. 诊断函数重复定义（优先级：高）

**现状**：`twitter.ts` 和 `weibo.ts` 各自定义了本地版本的 `sanitizeDiagnosticUrl`、`runSelectorProbes`、`missingRequiredProbeNames`、`createDiagnosticReport`、`structureErrorMessage`，与 `src/utils/extractor-diagnostics.ts` 导出的函数逻辑完全相同。

**风险**：修 bug 时只改一处，另一处漏掉。

**修复**：content script 直接 import `extractor-diagnostics.ts` 的导出函数，删除本地副本。Vite 会将它们打包到同一个 content bundle，不增加网络请求。

### 2. 降级提取的诊断上报路径不通（优先级：高）

**现状**：content script 的 message handler 调用的是 `extractTwitterContent`（无诊断版），它内部调用 `extractTwitterContentWithDiagnostics` 但只返回 `capture`，丢弃了 `diagnostic`。

```typescript
// twitter.ts:294
export function extractTwitterContent(documentRef: Document, url: string): CapturedContent {
  return extractTwitterContentWithDiagnostics(documentRef, url).capture;
}
```

**结果**：正常的"降级提取"（fallback 命中但提取成功）场景下，诊断数据不会被持久化。只有抛异常时（通过 `error.diagnostic`）才有诊断记录。

**修复**：message handler 改为调用 `extractTwitterContentWithDiagnostics`，将 diagnostic 一并返回给 service worker。service worker 收到后调用 `saveExtractorDiagnostic(diagnostic)` 持久化。weibo.ts 同理。

消息响应格式改为：

```typescript
sendResponse({
  ok: true,
  data: capture,
  diagnostic: diagnostic, // 新增
});
```

### 3. `renderTemplate` 对 frontmatter 做全文消毒可能破坏 YAML（优先级：中）

**现状**：`markdown-templates.ts:237` 对整个渲染结果（含 `---` frontmatter 块）调用 `sanitizeArticleMarkdown`。

**风险**：如果 `sanitizeArticleMarkdown` 会转义或删除 YAML 中合法的字符（如 `:` 后的空格、`[]` 方括号、`---` 分隔符），frontmatter 会被破坏。

**修复**：

- 分开处理：frontmatter 部分只对变量值做 `sanitizeYamlString`（已经在 `yamlVariables` 中做了），不对整个 frontmatter 块再过 `sanitizeArticleMarkdown`。
- body 部分单独过 `sanitizeArticleMarkdown`。
- 最终拼接时 frontmatter 原样输出。

```typescript
export function renderTemplate(
  template: MarkdownTemplate,
  variables: Record<string, string>,
): string {
  const frontmatterRendered = template.frontmatter.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => variables[key] ?? '',
  );
  const bodyRendered = template.body.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => variables[key] ?? '',
  );

  return ['---', frontmatterRendered, '---', '', sanitizeArticleMarkdown(bodyRendered)].join('\n');
}
```

### 4. 预设规则 `preset-news` 的 glob 不实用（优先级：低）

**现状**：

```typescript
{ id: 'preset-news', urlPattern: 'https://*.news/*', ... }
```

这只匹配 `.news` TLD 的域名，实际新闻站（bbc.com、reuters.com、theguardian.com）不会命中。

**修复**：改为 domain 类型规则，列出常见新闻站，或者改为 title-keyword 类型匹配"新闻|资讯|breaking"等关键词。建议：

```typescript
{
  id: 'preset-news',
  type: 'title-keyword',
  pattern: '新闻|资讯|breaking|headline',
  category: '阅读/新闻',
  tags: ['news'],
  enabled: true,
}
```

## 改动范围

| 文件                                 | 改动                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `src/content/twitter.ts`             | 删除本地诊断函数副本，import 共享模块；message handler 返回 diagnostic |
| `src/content/weibo.ts`               | 同上                                                                   |
| `src/utils/extractor-diagnostics.ts` | 确认导出完整（已完整）                                                 |
| `src/background/service-worker.ts`   | 收到 diagnostic 后调用 `saveExtractorDiagnostic`                       |
| `src/utils/markdown-templates.ts`    | `renderTemplate` 分开处理 frontmatter 和 body                          |
| `src/popup/pages/RulesEditor.tsx`    | 修改 `preset-news` 规则                                                |
| `tests/markdown-generator.test.ts`   | 新增：含特殊字符标题的 frontmatter 完整性测试                          |

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm --filter @shuhai/extension run build
```

重点验证：

- 含 `:`、`[]`、`---` 的标题经模板渲染后 frontmatter 结构完整
- Twitter/Weibo 降级提取时 diagnostic 能被 service worker 持久化
- content bundle 体积无显著增长（共享模块不应增加重复代码）
