import type {
  BookmarkItem,
  CapturedContent,
  MovePlan,
} from '../shared/bookmark-types.js';
import {
  neutralizeObsidianSyntax,
  sanitizeArticleMarkdown,
  sanitizeText,
  sanitizeUrl,
  sanitizeYamlList,
  sanitizeYamlString,
} from './sanitize.js';

function dateFromChromeTime(value: number | undefined): string {
  if (!value) {
    return '';
  }

  return new Date(value).toISOString().slice(0, 10);
}

function frontmatter(values: Record<string, string>): string {
  const lines = Object.entries(values)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}: ${value}`);

  return ['---', ...lines, '---'].join('\n');
}

function markdownLink(label: string, url: string): string {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) {
    return sanitizeText(label);
  }

  return `[${neutralizeObsidianSyntax(label)}](${safeUrl})`;
}

function sourceLabel(source: CapturedContent['source']): string {
  if (source === 'article') {
    return 'article';
  }

  return source;
}

export function generateBookmarkMarkdown(
  bookmark: BookmarkItem,
  move?: MovePlan,
  exportedAt = new Date(),
): string {
  const title = sanitizeText(bookmark.title || bookmark.url);
  const url = sanitizeUrl(bookmark.url);
  const folder = sanitizeText(move?.targetFolder ?? bookmark.parentPath);
  const tags = move?.tags ?? folder.split('/').filter(Boolean).slice(0, 6);
  const confidence = move ? `${Math.round(move.confidence * 100)}% (${move.reason})` : '';
  const yaml = frontmatter({
    title: sanitizeYamlString(title),
    url: sanitizeYamlString(url),
    source: 'chrome',
    folder: sanitizeYamlString(folder),
    tags: sanitizeYamlList(tags),
    status: 'unchecked',
    created: dateFromChromeTime(bookmark.dateAdded),
    exported: exportedAt.toISOString().slice(0, 10),
    shuhai_format: '2',
  });

  return [
    yaml,
    '',
    `# ${neutralizeObsidianSyntax(title)}`,
    '',
    `- 来源: Chrome 书签 > ${neutralizeObsidianSyntax(folder || '根目录')}`,
    url ? `- 链接: ${markdownLink('打开', url)}` : '- 链接: 已过滤不安全 URL',
    confidence ? `- 分类置信度: ${confidence}` : '',
    '',
    '## 笔记',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function generateCapturedContentMarkdown(
  capture: CapturedContent,
  exportedAt = new Date(),
): string {
  const title = sanitizeText(capture.title || capture.url);
  const url = sanitizeUrl(capture.url);
  const author = sanitizeText(capture.author ?? capture.handle ?? '');
  const savedDate = exportedAt.toISOString().slice(0, 10);

  if (capture.source === 'article') {
    const yaml = frontmatter({
      title: sanitizeYamlString(title),
      url: sanitizeYamlString(url),
      source: 'article',
      site: sanitizeYamlString(capture.siteName ?? ''),
      author: sanitizeYamlString(author),
      created: capture.created ? sanitizeYamlString(capture.created) : '',
      saved: savedDate,
      tags: sanitizeYamlList(capture.tags),
      word_count: capture.wordCount ? String(capture.wordCount) : '',
      shuhai_format: '2',
    });
    const source = capture.siteName
      ? markdownLink(capture.siteName, capture.url)
      : markdownLink('原文', capture.url);

    return [
      yaml,
      '',
      `# ${neutralizeObsidianSyntax(title)}`,
      '',
      `> 来源: ${source}`,
      author ? `> 作者: ${neutralizeObsidianSyntax(author)} · 保存时间: ${savedDate}` : `> 保存时间: ${savedDate}`,
      capture.description ? `> 摘要: ${neutralizeObsidianSyntax(capture.description)}` : '',
      '',
      '---',
      '',
      sanitizeArticleMarkdown(capture.text),
      '',
      '---',
      '',
      '## 笔记',
      '',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  const yaml = frontmatter({
    title: sanitizeYamlString(title),
    url: sanitizeYamlString(url),
    source: sourceLabel(capture.source),
    author: sanitizeYamlString(author),
    created: capture.created ? sanitizeYamlString(capture.created) : '',
    exported: exportedAt.toISOString().slice(0, 10),
    tags: sanitizeYamlList(capture.tags),
    shuhai_format: '2',
  });
  const mediaLines = capture.media
    .map((item) => {
      const mediaUrl = sanitizeUrl(item.url);
      if (!mediaUrl) {
        return '';
      }

      return `- ${markdownLink(`图片: ${item.alt ?? ''}`.trim(), mediaUrl)}`;
    })
    .filter(Boolean);

  return [
    yaml,
    '',
    `# ${neutralizeObsidianSyntax(title)}`,
    '',
    author ? `- 作者: ${neutralizeObsidianSyntax(author)}` : '',
    url ? `- 原文: ${markdownLink('打开', url)}` : '- 原文: 已过滤不安全 URL',
    '',
    '## 内容',
    '',
    neutralizeObsidianSyntax(capture.text)
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join('\n'),
    '',
    mediaLines.length > 0 ? '## 媒体' : '',
    ...mediaLines,
    '',
    '## 笔记',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
