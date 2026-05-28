const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*]/g;
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

function limitLength(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('');
}

export function sanitizeText(value: string): string {
  return Array.from(value.normalize('NFC'))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('')
    .trim();
}

export function sanitizeYamlString(value: string): string {
  return JSON.stringify(neutralizeObsidianSyntax(value).replace(/\r?\n/g, ' '));
}

export function sanitizeYamlList(values: string[]): string {
  const safeValues = values
    .map((value) => sanitizeText(value))
    .filter(Boolean)
    .map((value) => sanitizeYamlString(value));

  return `[${safeValues.join(', ')}]`;
}

export function sanitizeUrl(value: string): string {
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

export function sanitizePathSegment(value: string, fallback = 'untitled'): string {
  const cleaned = limitLength(
    sanitizeText(value)
      .replace(FORBIDDEN_FILENAME_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\.+|\.+$/g, '')
      .trim(),
    80,
  );
  const lower = cleaned.toLowerCase();

  if (!cleaned || cleaned === '.' || cleaned === '..' || RESERVED_NAMES.has(lower)) {
    return fallback;
  }

  return cleaned;
}

export function sanitizeFileName(value: string): string {
  const segment = sanitizePathSegment(value);
  return segment.endsWith('.md') ? segment : `${segment}.md`;
}

export function sanitizeRelativePath(value: string): string[] {
  return value
    .split(/[\\/]/)
    .map((segment) => sanitizePathSegment(segment, ''))
    .filter(Boolean);
}

export function neutralizeObsidianSyntax(value: string): string {
  return sanitizeText(value)
    .replace(/<%/g, '<\\%')
    .replace(/%>/g, '%\\>')
    .replace(/\{\{/g, '\\{\\{')
    .replace(/\}\}/g, '\\}\\}')
    .replace(/```(?:dataviewjs|dataview|templater)\b/gi, '```text')
    .replace(/obsidian:\/\//gi, 'obsidian-disabled://')
    .replace(/!\[\[/g, '\\!\\[\\[')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi, '[图片: $1]($2)');
}

export function assertSafeRelativePath(segments: string[]): void {
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\\/]/.test(segment)) {
      throw new Error(`Unsafe export path segment: ${segment}`);
    }
  }
}
