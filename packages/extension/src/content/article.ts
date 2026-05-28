import type { CapturedContent, CapturedMedia } from '../shared/bookmark-types.js';

const BLOCK_SELECTORS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'applet',
  'link',
  'meta',
  'base',
  'nav',
  'header',
  'footer',
  'aside',
  'noscript',
];
const SITE_SELECTORS: Array<{ host: string; selector: string }> = [
  { host: 'dev.to', selector: '.crayons-article__body' },
  { host: 'zhihu.com', selector: '.RichContent' },
  { host: 'github.com', selector: '.markdown-body' },
  { host: 'notion.site', selector: '.notion-page-content' },
  { host: 'medium.com', selector: 'article' },
];
const MAX_IMAGES = 50;
const MAX_CODE_BLOCK_LENGTH = 50_000;

function limitLength(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('');
}

function sanitizeText(value: string): string {
  return Array.from(value.normalize('NFC'))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('')
    .trim();
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url.href;
    }
  } catch {
    return '';
  }

  return '';
}

function neutralizeObsidianSyntax(value: string): string {
  return sanitizeText(value)
    .replace(/<%/g, '<\\%')
    .replace(/%>/g, '%\\>')
    .replace(/\{\{/g, '\\{\\{')
    .replace(/\}\}/g, '\\}\\}')
    .replace(/```(?:dataviewjs|dataview|templater)\b/gi, '```text')
    .replace(/obsidian:\/\//gi, 'obsidian-disabled://')
    .replace(/!\[\[/g, '\\!\\[\\[')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[图片: $1]($2)');
}

function closeUnclosedCodeFence(value: string): string {
  const fences = value.match(/^```/gm) ?? [];
  return fences.length % 2 === 0 ? value : `${value}\n\`\`\``;
}

function truncateLongLines(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) =>
      Array.from(line).length > 10000
        ? `${limitLength(line, 10000)}\n\n[超长单行已截断]`
        : line,
    )
    .join('\n');
}

function sanitizeArticleMarkdown(value: string): string {
  const neutralized = neutralizeObsidianSyntax(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[图片: $1]($2)')
    .replace(/```(?:dataviewjs|dataview|templater)\b/gi, '```text');
  const limitedLines = truncateLongLines(neutralized);
  const maxLength = 500_000;
  const truncated =
    Array.from(limitedLines).length > maxLength
      ? `${limitLength(limitedLines, maxLength)}\n\n[内容已截断，超过 500KB 限制]`
      : limitedLines;

  return closeUnclosedCodeFence(truncated).trim();
}

interface ArticleMeta {
  title: string;
  author?: string;
  siteName?: string;
  description?: string;
  publishedTime?: string;
}

interface MarkdownContext {
  baseUrl: string;
  images: CapturedMedia[];
}

function tagName(node: Node): string {
  return 'tagName' in node ? String((node as Element).tagName).toLowerCase() : '';
}

function textContent(node: Node | null | undefined): string {
  return sanitizeText(node?.textContent ?? '');
}

function getMeta(documentRef: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const element = documentRef.querySelector(selector);
    const content = element?.getAttribute('content') ?? element?.textContent ?? '';
    const text = sanitizeText(content);
    if (text) {
      return text;
    }
  }

  return '';
}

export function extractArticleMeta(documentRef: Document): ArticleMeta {
  return {
    title:
      getMeta(documentRef, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
      sanitizeText(documentRef.title),
    author:
      getMeta(documentRef, [
        'meta[name="author"]',
        'meta[property="article:author"]',
        '[rel="author"]',
        '.author',
        '.byline',
      ]) || undefined,
    siteName:
      getMeta(documentRef, ['meta[property="og:site_name"]', 'meta[name="application-name"]']) ||
      undefined,
    description:
      getMeta(documentRef, ['meta[name="description"]', 'meta[property="og:description"]']) ||
      undefined,
    publishedTime:
      getMeta(documentRef, [
        'meta[property="article:published_time"]',
        'time[datetime]',
        'meta[name="date"]',
      ]) || undefined,
  };
}

function toAbsoluteUrl(rawUrl: string, baseUrl: string): string {
  try {
    return new URL(rawUrl, baseUrl).href;
  } catch {
    return '';
  }
}

function safeLinkUrl(rawUrl: string, baseUrl: string): string {
  const absolute = toAbsoluteUrl(rawUrl, baseUrl);
  try {
    const url = new URL(absolute);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return sanitizeUrl(url.href);
    }
  } catch {
    return '';
  }

  return '';
}

function safeImageUrl(rawUrl: string, baseUrl: string): string {
  const absolute = toAbsoluteUrl(rawUrl, baseUrl);
  try {
    const url = new URL(absolute);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {
    return '';
  }

  return '';
}

function isBlockedTag(tag: string): boolean {
  return BLOCK_SELECTORS.includes(tag) || tag === 'svg';
}

function childMarkdown(element: Element, context: MarkdownContext): string {
  return Array.from(element.childNodes)
    .map((child) => nodeToMarkdown(child, context))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function codeLanguage(element: Element): string {
  const code = element.querySelector('code');
  const className = code?.getAttribute('class') ?? element.getAttribute('class') ?? '';
  const match = className.match(/language-([a-z0-9_-]+)/i);
  const language = match?.[1]?.toLowerCase() ?? '';

  return ['dataview', 'dataviewjs', 'templater'].includes(language) ? 'text' : language;
}

function codeBlock(element: Element): string {
  const language = codeLanguage(element);
  const text = textContent(element);
  const truncated =
    text.length > MAX_CODE_BLOCK_LENGTH
      ? `${text.slice(0, MAX_CODE_BLOCK_LENGTH)}\n\n[代码块已截断]`
      : text;

  return `\n\n\`\`\`${language}\n${truncated}\n\`\`\`\n\n`;
}

function listMarkdown(element: Element, context: MarkdownContext, ordered: boolean): string {
  const items = Array.from(element.children).filter((child) => tagName(child) === 'li');

  return `\n${items
    .map((item, index) => {
      const prefix = ordered ? `${index + 1}. ` : '- ';
      const body = childMarkdown(item, context).trim().replace(/\n/g, '\n  ');
      return `${prefix}${body}`;
    })
    .join('\n')}\n\n`;
}

function blockquoteMarkdown(element: Element, context: MarkdownContext): string {
  const body = childMarkdown(element, context).trim();
  if (!body) {
    return '';
  }

  return `\n\n${body
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')}\n\n`;
}

function tableMarkdown(element: Element): string {
  const rows = Array.from(element.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll('th,td')).map((cell) =>
      textContent(cell).replace(/\|/g, '\\|'),
    ),
  );
  const nonEmptyRows = rows.filter((row) => row.some(Boolean));
  const columnCount = Math.max(...nonEmptyRows.map((row) => row.length), 0);

  if (columnCount === 0) {
    return '';
  }

  const [firstRow, ...restRows] = nonEmptyRows.map((row) => [
    ...row,
    ...Array.from({ length: columnCount - row.length }, () => ''),
  ]);
  const header = firstRow ?? [];
  const divider = Array.from({ length: columnCount }, () => '---');

  return [
    '',
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...restRows.map((row) => `| ${row.join(' | ')} |`),
    '',
    '',
  ].join('\n');
}

function nodeToMarkdown(node: Node, context: MarkdownContext): string {
  if (node.nodeType === 3) {
    return (node.textContent ?? '').replace(/\s+/g, ' ');
  }

  if (node.nodeType !== 1) {
    return '';
  }

  const element = node as Element;
  const tag = tagName(node);

  if (isBlockedTag(tag)) {
    return '';
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    return `\n\n${'#'.repeat(level)} ${childMarkdown(element, context).trim()}\n\n`;
  }

  if (tag === 'p') {
    const body = childMarkdown(element, context).trim();
    return body ? `\n\n${body}\n\n` : '';
  }

  if (tag === 'br') {
    return '\n';
  }

  if (tag === 'pre') {
    return codeBlock(element);
  }

  if (tag === 'code') {
    return `\`${textContent(element).replace(/`/g, '\\`')}\``;
  }

  if (tag === 'strong' || tag === 'b') {
    return `**${childMarkdown(element, context).trim()}**`;
  }

  if (tag === 'em' || tag === 'i') {
    return `*${childMarkdown(element, context).trim()}*`;
  }

  if (tag === 'a') {
    const label = childMarkdown(element, context).trim() || textContent(element);
    const href = safeLinkUrl(element.getAttribute('href') ?? '', context.baseUrl);
    return href ? `[${label || href}](${href})` : label;
  }

  if (tag === 'img') {
    if (context.images.length >= MAX_IMAGES) {
      return '';
    }

    const src = safeImageUrl(element.getAttribute('src') ?? '', context.baseUrl);
    if (!src) {
      return '';
    }

    const alt = sanitizeText(element.getAttribute('alt') ?? '图片') || '图片';
    context.images.push({ url: src, alt });

    return `\n\n[图片: ${alt}](${src})\n\n`;
  }

  if (tag === 'ul' || tag === 'ol') {
    return listMarkdown(element, context, tag === 'ol');
  }

  if (tag === 'blockquote') {
    return blockquoteMarkdown(element, context);
  }

  if (tag === 'table') {
    return tableMarkdown(element);
  }

  return `\n\n${childMarkdown(element, context).trim()}\n\n`;
}

export function domToMarkdown(
  element: Element,
  baseUrl: string,
  media: CapturedMedia[] = [],
): string {
  const markdown = childMarkdown(element, {
    baseUrl,
    images: media,
  });

  return sanitizeArticleMarkdown(markdown);
}

function candidateScore(element: Element): number {
  const textLength = textContent(element).length;
  const htmlLength = 'innerHTML' in element ? String(element.innerHTML).length : textLength;
  const paragraphCount = element.querySelectorAll('p,li,pre,blockquote').length;
  const density = textLength / Math.max(htmlLength, 1);

  return textLength < 200 ? 0 : textLength * Math.max(density, 0.1) + paragraphCount * 80;
}

function selectArticleElement(documentRef: Document, url: string): Element {
  const host = new URL(url).hostname;

  for (const site of SITE_SELECTORS) {
    if (host.includes(site.host)) {
      const element = documentRef.querySelector(site.selector);
      if (element && textContent(element).length > 80) {
        return element;
      }
    }
  }

  const explicit = documentRef.querySelector(
    'article, [role="main"], main, #content, .content, .post-content, ' +
      '.article-content, .entry-content',
  );
  if (explicit && textContent(explicit).length > 80) {
    return explicit;
  }

  const candidates = Array.from(documentRef.body?.querySelectorAll('article, main, section, div, td') ?? []);
  const best = candidates
    .filter((element) => !isBlockedTag(tagName(element)))
    .sort((a, b) => candidateScore(b) - candidateScore(a))[0];

  return best ?? documentRef.body;
}

function countWords(markdown: string): number {
  return Array.from(neutralizeObsidianSyntax(markdown).replace(/\s+/g, '')).length;
}

export function extractArticleContent(documentRef: Document, url: string): CapturedContent {
  const meta = extractArticleMeta(documentRef);
  const media: CapturedMedia[] = [];
  const element = selectArticleElement(documentRef, url);
  const text = domToMarkdown(element, url, media);
  const title = meta.title || sanitizeText(documentRef.title) || url;

  return {
    id: `article-${crypto.randomUUID()}`,
    source: 'article',
    title,
    url,
    author: meta.author,
    created: meta.publishedTime,
    text: text || sanitizeArticleMarkdown(textContent(element).slice(0, 4000)),
    media,
    tags: ['article'],
    capturedAt: new Date().toISOString(),
    siteName: meta.siteName,
    description: meta.description,
    wordCount: countWords(text),
  };
}

const articleWindow =
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { __shuhaiArticleExtractorInstalled?: boolean });

if (articleWindow && !articleWindow.__shuhaiArticleExtractorInstalled) {
  articleWindow.__shuhaiArticleExtractorInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'article:ping') {
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type !== 'article:extract') {
      return false;
    }

    try {
      sendResponse({
        ok: true,
        data: extractArticleContent(document, location.href),
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return true;
  });
}
