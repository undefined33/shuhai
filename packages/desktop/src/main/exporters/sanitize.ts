import { isAbsolute, join, relative, resolve } from 'node:path';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_EXCEPT_LINE_BREAKS = /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g;
const DANGEROUS_URL_SCHEME = /^(javascript|data|vbscript):/i;

export function stripTemplateSyntax(text: string): string {
  return text
    .replace(/<%[*\-=~]?/g, '＜%')
    .replace(/%>/g, '%＞')
    .replace(/\{\{/g, '｛｛')
    .replace(/\}\}/g, '｝｝');
}

export function sanitizeYamlString(value: string): string {
  return stripTemplateSyntax(value)
    .replace(CONTROL_CHARS, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

export function sanitizeMarkdownText(value: string): string {
  return stripTemplateSyntax(value).replace(CONTROL_CHARS, '');
}

export function sanitizeMarkdownBlock(value: string): string {
  return stripTemplateSyntax(value).replace(CONTROL_CHARS_EXCEPT_LINE_BREAKS, '');
}

export function sanitizeFilename(name: string): string {
  return stripTemplateSyntax(name)
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 80) || 'untitled';
}

export function sanitizeCategory(category: string): string {
  const segments = getSafeCategorySegments(category);
  return segments.length > 0 ? segments.join('/') : '未分类';
}

export function safeCategoryPath(vaultPath: string, category: string): string {
  const vaultRoot = resolve(join(vaultPath, 'Bookmarks'));
  const segments = getSafeCategorySegments(category);
  if (segments.length === 0) {
    return join(vaultRoot, '未分类');
  }

  const resolved = resolve(join(vaultRoot, ...segments));

  if (!isWithinDirectory(vaultRoot, resolved)) {
    return join(vaultRoot, '未分类');
  }

  return resolved;
}

export function safeMarkdownUrl(url: string): string {
  const sanitized = stripTemplateSyntax(url).replace(CONTROL_CHARS, '').trim();
  if (DANGEROUS_URL_SCHEME.test(sanitized)) {
    return '';
  }

  return sanitized.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function getSafeCategorySegments(category: string): string[] {
  return stripTemplateSyntax(category)
    .replace(CONTROL_CHARS, '')
    .split(/[\\/]+/)
    .map((segment) => sanitizeCategorySegment(segment))
    .filter((segment) => segment.length > 0);
}

function sanitizeCategorySegment(segment: string): string {
  return segment
    .replace(/\.\./g, '')
    .replace(/[<>:"|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 80);
}

function isWithinDirectory(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}
