import type {
  AppSettings,
  BookmarkItem,
  CapturedContent,
  MarkdownTemplateScope,
  MovePlan,
} from '../shared/bookmark-types.js';
import { neutralizeObsidianSyntax, sanitizeText, sanitizeUrl } from './sanitize.js';
import {
  markdownLink,
  mediaListMarkdown,
  pickTemplate,
  quoteMarkdown,
  renderTemplate,
  yamlVariables,
} from './markdown-templates.js';

function dateFromChromeTime(value: number | undefined): string {
  if (!value) {
    return '';
  }

  return new Date(value).toISOString().slice(0, 10);
}

function exportedDate(exportedAt: Date): string {
  return exportedAt.toISOString().slice(0, 10);
}

function linkOrUnsafe(label: string, url: string): string {
  return sanitizeUrl(url) ? markdownLink(label, url) : '已过滤不安全 URL';
}

function baseVariables(values: {
  title: string;
  url: string;
  date: string;
  created?: string;
  source: string;
  tags: string[];
}): Record<string, string> {
  const safeTitle = sanitizeText(values.title);
  const safeUrl = sanitizeUrl(values.url);

  return {
    title: neutralizeObsidianSyntax(safeTitle),
    url: safeUrl,
    date: values.date,
    created: values.created ?? '',
    source: values.source,
    url_link: linkOrUnsafe('打开', values.url),
    ...yamlVariables(
      {
        title: safeTitle,
        url: safeUrl,
        source: values.source,
        created: values.created ?? '',
      },
      values.tags,
    ),
  };
}

export function generateBookmarkMarkdown(
  bookmark: BookmarkItem,
  move?: MovePlan,
  exportedAt = new Date(),
  settings?: Pick<AppSettings, 'templates' | 'activeTemplateIds'>,
): string {
  const title = sanitizeText(bookmark.title || bookmark.url);
  const url = sanitizeUrl(bookmark.url);
  const folder = sanitizeText(move?.targetFolder ?? bookmark.parentPath);
  const tags = move?.tags ?? folder.split('/').filter(Boolean).slice(0, 6);
  const confidence = move ? `${Math.round(move.confidence * 100)}% (${move.reason})` : '';
  const template = pickTemplate(settings?.templates, settings?.activeTemplateIds, 'bookmark');

  return renderTemplate(template, {
    ...baseVariables({
      title,
      url,
      date: exportedDate(exportedAt),
      created: dateFromChromeTime(bookmark.dateAdded),
      source: 'chrome',
      tags,
    }),
    folder: neutralizeObsidianSyntax(folder || '根目录'),
    folder_yaml: JSON.stringify(neutralizeObsidianSyntax(folder)),
    confidence: neutralizeObsidianSyntax(confidence),
  });
}

function captureScope(source: CapturedContent['source']): MarkdownTemplateScope {
  return source === 'twitter' || source === 'weibo' ? source : 'article';
}

export function generateCapturedContentMarkdown(
  capture: CapturedContent,
  exportedAt = new Date(),
  settings?: Pick<AppSettings, 'templates' | 'activeTemplateIds'>,
): string {
  const title = sanitizeText(capture.title || capture.url);
  const url = sanitizeUrl(capture.url);
  const author = sanitizeText(capture.author ?? capture.handle ?? '');
  const tags = capture.tags;
  const source = capture.source === 'article' ? 'article' : capture.source;
  const template = pickTemplate(
    settings?.templates,
    settings?.activeTemplateIds,
    captureScope(source),
  );
  const description = sanitizeText(capture.description ?? '');
  const siteName = sanitizeText(capture.siteName ?? '');

  return renderTemplate(template, {
    ...baseVariables({
      title,
      url,
      date: exportedDate(exportedAt),
      created: capture.created,
      source,
      tags,
    }),
    author: neutralizeObsidianSyntax(author),
    author_yaml: JSON.stringify(neutralizeObsidianSyntax(author)),
    handle: neutralizeObsidianSyntax(capture.handle ?? ''),
    text: capture.source === 'article' ? capture.text : neutralizeObsidianSyntax(capture.text),
    text_quote: quoteMarkdown(capture.text),
    description: neutralizeObsidianSyntax(description),
    description_yaml: JSON.stringify(neutralizeObsidianSyntax(description)),
    site_name: neutralizeObsidianSyntax(siteName),
    site_name_yaml: JSON.stringify(neutralizeObsidianSyntax(siteName)),
    word_count: capture.wordCount ? String(capture.wordCount) : '',
    media_list: mediaListMarkdown(capture.media),
    source_link: siteName ? markdownLink(siteName, capture.url) : markdownLink('原文', capture.url),
  });
}
