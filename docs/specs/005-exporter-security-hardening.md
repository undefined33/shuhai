---
version: 1
assignee: codex
status: ready
issue: "#5"
---

# Markdown 导出器安全加固

## 目标

修复 `markdown-exporter.ts` 中的注入风险：YAML frontmatter 注入、路径穿越、Markdown 链接注入、模板语法注入。

## Prior Context

- 已完成: Markdown 导出器 (`packages/desktop/src/main/exporters/markdown-exporter.ts`)
- 风险分析: 书签标题来自外部（任何网站可设置 `<title>`），属于不可信输入
- 当前问题:
  1. 标题中的换行符可打断 YAML frontmatter 边界
  2. category 路径未做穿越检查
  3. URL 中的 `)` 可打断 Markdown 链接
  4. Obsidian Templater 插件语法可能被执行

## 技术方案

### 1. YAML frontmatter 注入防护

```typescript
// 当前代码（有漏洞）:
lines.push(`title: "${bookmark.title.replace(/"/g, '\\"')}"`);

// 修复: 清除所有控制字符和换行，转义 YAML 特殊字符
function sanitizeYamlString(value: string): string {
  return value
    .replace(/[\x00-\x1f\x7f]/g, '')  // 移除所有控制字符（含 \n \r \t）
    .replace(/\\/g, '\\\\')            // 转义反斜杠
    .replace(/"/g, '\\"');             // 转义双引号
}

// 使用:
lines.push(`title: "${sanitizeYamlString(bookmark.title)}"`);
lines.push(`url: "${sanitizeYamlString(bookmark.url)}"`);
```

对所有写入 frontmatter 的字符串字段都应用 `sanitizeYamlString`。

### 2. 路径穿越防护

```typescript
// 当前代码（有漏洞）:
const categoryDir = bookmark.category.replace(/\//g, '/');  // no-op
const dir = join(this.vaultPath, 'Bookmarks', categoryDir);

// 修复: 规范化后验证不会跳出 vault
function safeCategoryPath(vaultPath: string, category: string): string {
  // 移除路径穿越序列
  const sanitized = category
    .split('/')
    .map(segment => segment.replace(/\.\./g, '').replace(/[/\\]/g, ''))
    .filter(segment => segment.length > 0)
    .join('/');

  const resolved = resolve(join(vaultPath, 'Bookmarks', sanitized));
  const vaultRoot = resolve(join(vaultPath, 'Bookmarks'));

  // 确保解析后的路径仍在 vault 内
  if (!resolved.startsWith(vaultRoot)) {
    return join(vaultPath, 'Bookmarks', '未分类');
  }

  return resolved;
}
```

### 3. Markdown 链接注入防护

```typescript
// 当前代码:
lines.push(`- **原始链接**: [点击访问](${bookmark.url})`);

// 修复: 转义 URL 中的 markdown 特殊字符，拒绝 javascript: scheme
function safeMarkdownUrl(url: string): string {
  // 拒绝危险 scheme
  const lower = url.toLowerCase().trim();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return '';
  }
  // 转义括号（Markdown 链接语法字符）
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29');
}
```

### 4. 模板语法过滤

```typescript
// 过滤 Obsidian Templater / Dataview 可执行语法
function stripTemplateSyntax(text: string): string {
  return text
    .replace(/<%[*\-=~]?/g, '＜%')   // Templater: <% → 全角
    .replace(/%>/g, '%＞')             // Templater: %> → 全角
    .replace(/\{\{/g, '｛｛')          // Handlebars/Templater: {{ → 全角
    .replace(/\}\}/g, '｝｝');          // Handlebars/Templater: }} → 全角
}

// 应用于: bookmark.title, bookmark.summary, tags 中的每个值
```

### 5. 文件名安全增强

```typescript
// 当前 sanitizeFilename 已处理基本非法字符
// 额外增加: 移除前导/尾随点号（Windows 隐藏文件/目录问题）
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/[\x00-\x1f\x7f]/g, '')  // 控制字符
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')               // 前导点号
    .replace(/\.+$/, '')               // 尾随点号
    .trim()
    .slice(0, 80) || 'untitled';       // 空标题兜底
}
```

## 文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| 修改 | `packages/desktop/src/main/exporters/markdown-exporter.ts` | 应用所有安全修复 |
| 新建 | `packages/desktop/src/main/exporters/sanitize.ts` | 提取所有 sanitize 函数 |
| 新建 | `packages/desktop/tests/sanitize.test.ts` | 安全函数单元测试 |
| 修改 | `packages/desktop/tests/pipeline.test.ts` | 更新导出器相关测试 |

## 验收标准

- [ ] 标题含 `\n---\n` 时 frontmatter 不被打断
- [ ] 标题含 `"`, `\`, 控制字符时正确转义
- [ ] category 含 `../../` 时路径不跳出 vault
- [ ] URL 含 `)` 时 Markdown 链接不被打断
- [ ] `javascript:` / `data:` URL 被过滤
- [ ] `<%* code %>` 和 `{{ template }}` 语法被替换为全角
- [ ] 空标题生成 `untitled` 而非空文件名
- [ ] 前导点号被移除（不生成隐藏文件）
- [ ] 现有 pipeline 测试仍然通过
- [ ] lint + typecheck 无错误

## 注意事项

- MUST: 所有外部输入（title, url, tags, category, summary）都必须经过 sanitize
- MUST: 路径穿越检查使用 `resolve()` 后比较前缀，不能只做字符串替换
- MUST: 测试覆盖每种攻击向量的具体 payload
- SHOULD: sanitize 函数集中在 `sanitize.ts`，方便复用和审计
- 不要修改 renderer 代码
- 不要修改 shared 包
