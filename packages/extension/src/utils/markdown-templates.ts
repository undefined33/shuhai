import type { MarkdownTemplate, MarkdownTemplateScope } from '../shared/bookmark-types.js';
import {
  neutralizeObsidianSyntax,
  sanitizeArticleMarkdown,
  sanitizeText,
  sanitizeUrl,
  sanitizeYamlList,
  sanitizeYamlString,
} from './sanitize.js';

export const DEFAULT_MARKDOWN_TEMPLATES: MarkdownTemplate[] = [
  {
    id: 'default-bookmark',
    name: '默认书签索引',
    scope: 'bookmark',
    frontmatter: [
      'title: {{title_yaml}}',
      'url: {{url_yaml}}',
      'source: chrome',
      'folder: {{folder_yaml}}',
      'tags: {{tags}}',
      'status: unchecked',
      'created: {{created}}',
      'exported: {{date}}',
      'shuhai_format: 3',
    ].join('\n'),
    body: [
      '# {{title}}',
      '',
      '- 来源: Chrome 书签 > {{folder}}',
      '- 链接: {{url_link}}',
      '- 分类置信度: {{confidence}}',
      '',
      '## 笔记',
      '',
    ].join('\n'),
  },
  {
    id: 'default-twitter',
    name: '默认推文内容',
    scope: 'twitter',
    frontmatter: [
      'title: {{title_yaml}}',
      'url: {{url_yaml}}',
      'source: {{source}}',
      'author: {{author_yaml}}',
      'created: {{created}}',
      'exported: {{date}}',
      'tags: {{tags}}',
      'shuhai_format: 3',
    ].join('\n'),
    body: [
      '# {{title}}',
      '',
      '- 作者: {{author}}',
      '- 原文: {{url_link}}',
      '',
      '## 内容',
      '',
      '{{text_quote}}',
      '',
      '{{media_list}}',
      '',
      '## 笔记',
      '',
    ].join('\n'),
  },
  {
    id: 'default-weibo',
    name: '默认微博内容',
    scope: 'weibo',
    frontmatter: [
      'title: {{title_yaml}}',
      'url: {{url_yaml}}',
      'source: {{source}}',
      'author: {{author_yaml}}',
      'created: {{created}}',
      'exported: {{date}}',
      'tags: {{tags}}',
      'shuhai_format: 3',
    ].join('\n'),
    body: [
      '# {{title}}',
      '',
      '- 作者: {{author}}',
      '- 原文: {{url_link}}',
      '',
      '## 内容',
      '',
      '{{text_quote}}',
      '',
      '{{media_list}}',
      '',
      '## 笔记',
      '',
    ].join('\n'),
  },
  {
    id: 'default-article',
    name: '默认文章内容',
    scope: 'article',
    frontmatter: [
      'title: {{title_yaml}}',
      'url: {{url_yaml}}',
      'source: article',
      'site: {{site_name_yaml}}',
      'author: {{author_yaml}}',
      'created: {{created}}',
      'saved: {{date}}',
      'tags: {{tags}}',
      'word_count: {{word_count}}',
      'shuhai_format: 3',
    ].join('\n'),
    body: [
      '# {{title}}',
      '',
      '> 来源: {{source_link}}',
      '> 作者: {{author}} · 保存时间: {{date}}',
      '> 摘要: {{description}}',
      '',
      '---',
      '',
      '{{text}}',
      '',
      '---',
      '',
      '## 笔记',
      '',
    ].join('\n'),
  },
];

export const TEMPLATE_VARIABLES: Record<MarkdownTemplateScope, string[]> = {
  bookmark: [
    'title',
    'url',
    'date',
    'created',
    'source',
    'tags',
    'tags_inline',
    'folder',
    'confidence',
  ],
  twitter: [
    'title',
    'url',
    'date',
    'created',
    'source',
    'tags',
    'tags_inline',
    'author',
    'handle',
    'text',
    'media_list',
  ],
  weibo: [
    'title',
    'url',
    'date',
    'created',
    'source',
    'tags',
    'tags_inline',
    'author',
    'handle',
    'text',
    'media_list',
  ],
  article: [
    'title',
    'url',
    'date',
    'created',
    'source',
    'tags',
    'tags_inline',
    'author',
    'text',
    'description',
    'site_name',
    'word_count',
  ],
};

export function markdownLink(label: string, url: string): string {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) {
    return sanitizeText(label);
  }

  return `[${neutralizeObsidianSyntax(label)}](${safeUrl})`;
}

export function tagsInline(tags: string[]): string {
  return tags
    .map((tag) => sanitizeText(tag).replace(/\s+/g, '-'))
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(' ');
}

export function quoteMarkdown(value: string): string {
  const text = sanitizeArticleMarkdown(value);
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

export function mediaListMarkdown(media: Array<{ url: string; alt?: string }>): string {
  const lines = media
    .map((item) => {
      const safeUrl = sanitizeUrl(item.url);
      if (!safeUrl) {
        return '';
      }

      return `- ${markdownLink(`图片: ${item.alt ?? ''}`.trim(), safeUrl)}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? ['## 媒体', ...lines].join('\n') : '';
}

export function renderTemplate(
  template: MarkdownTemplate,
  variables: Record<string, string>,
): string {
  const pattern = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const frontmatterRendered = template.frontmatter.replace(pattern, (_match, key: string) => {
    const value = variables[key] ?? '';
    if (key === 'tags' || key.endsWith('_yaml')) {
      return value;
    }

    return sanitizeYamlString(value);
  });
  const bodyRendered = template.body.replace(pattern, (_match, key: string) => {
    return variables[key] ?? '';
  });

  return ['---', frontmatterRendered, '---', '', sanitizeArticleMarkdown(bodyRendered)].join('\n');
}

export function getDefaultTemplate(scope: MarkdownTemplateScope): MarkdownTemplate {
  return DEFAULT_MARKDOWN_TEMPLATES.find((template) => template.scope === scope)!;
}

export function normalizeTemplates(value: unknown): MarkdownTemplate[] {
  if (!Array.isArray(value)) {
    return DEFAULT_MARKDOWN_TEMPLATES;
  }

  const userTemplates = value
    .map((item) => {
      const template = item as Partial<MarkdownTemplate>;
      if (
        typeof template.id !== 'string' ||
        typeof template.name !== 'string' ||
        (template.scope !== 'bookmark' &&
          template.scope !== 'twitter' &&
          template.scope !== 'weibo' &&
          template.scope !== 'article') ||
        typeof template.frontmatter !== 'string' ||
        typeof template.body !== 'string'
      ) {
        return undefined;
      }

      return {
        id: sanitizeText(template.id).slice(0, 80),
        name: sanitizeText(template.name).slice(0, 80),
        scope: template.scope,
        frontmatter: template.frontmatter,
        body: template.body,
      };
    })
    .filter((template): template is MarkdownTemplate => Boolean(template));

  const byId = new Map(DEFAULT_MARKDOWN_TEMPLATES.map((template) => [template.id, template]));
  for (const template of userTemplates) {
    byId.set(template.id, template);
  }

  return Array.from(byId.values());
}

export function normalizeActiveTemplateIds(
  value: unknown,
): Partial<Record<MarkdownTemplateScope, string>> {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    bookmark: typeof record.bookmark === 'string' ? record.bookmark : 'default-bookmark',
    twitter: typeof record.twitter === 'string' ? record.twitter : 'default-twitter',
    weibo: typeof record.weibo === 'string' ? record.weibo : 'default-weibo',
    article: typeof record.article === 'string' ? record.article : 'default-article',
  };
}

export function pickTemplate(
  templates: MarkdownTemplate[] | undefined,
  activeTemplateIds: Partial<Record<MarkdownTemplateScope, string>> | undefined,
  scope: MarkdownTemplateScope,
): MarkdownTemplate {
  const allTemplates = normalizeTemplates(templates);
  const activeId = activeTemplateIds?.[scope] ?? getDefaultTemplate(scope).id;

  return (
    allTemplates.find((template) => template.scope === scope && template.id === activeId) ??
    getDefaultTemplate(scope)
  );
}

export function yamlVariables(
  values: Record<string, string>,
  tags: string[],
): Record<string, string> {
  const yaml: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    yaml[`${key}_yaml`] = sanitizeYamlString(value);
  }

  return {
    ...yaml,
    tags: sanitizeYamlList(tags),
    tags_inline: tagsInline(tags),
  };
}
